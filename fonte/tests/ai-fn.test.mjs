// Testa a função "ai" sem rede: Deno.env e fetch simulados.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const envs = { ANTHROPIC_API_KEY: "sk-test", SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "svc", AI_DAILY_LIMIT: "3" };
globalThis.__PD_TEST__ = true;
globalThis.Deno = { env: { get: (k) => envs[k] } };
let calls = [], used = 0, upstream = null;
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url, init });
  const J = (s, b) => new Response(JSON.stringify(b), { status: s });
  if (url.endsWith("/auth/v1/user")) return init.headers.authorization === "Bearer good" ? J(200, { id: "u1", email: "eu@x.com" }) : J(401, {});
  if (url.includes("/rest/v1/ai_usage")) return J(200, [{ calls: used }]);
  if (url.includes("/rest/v1/rpc/ai_bump")) { used++; return J(200, used); }
  if (url.startsWith("https://api.anthropic.com")) return upstream(JSON.parse(init.body), init);
  throw new Error("url inesperada " + url);
};
const { handle, extractJson } = await import(pathToFileURL(process.argv[2]).href);
const req = (body, tok = "good") => new Request("https://f/ai", { method: "POST", headers: { authorization: "Bearer " + tok }, body: JSON.stringify(body) });
const ok = (text) => () => new Response(JSON.stringify({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log("ok -", name); };

await t("extrai JSON com cercas e texto em volta", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Aqui: {"items":[]} pronto'), { items: [] });
  assert.throws(() => extractJson("sem json"));
});
await t("foto + texto: imagem antes do texto, cabeçalhos certos, sem temperature", async () => {
  let sent, hdr; upstream = (b, i) => { sent = b; hdr = i.headers; return ok('{"items":[{"ref":"t1","grams":100}]}')(); };
  const r = await handle(req({ prompt: "oi", images: [{ media_type: "image/jpeg", data: "AAAA" }] }));
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).data.items[0].ref, "t1");
  assert.equal(sent.model, "claude-sonnet-5-5"); assert.equal(sent.messages[0].content[0].type, "image"); assert.equal(sent.messages[0].content[1].type, "text");
  assert.equal(hdr["anthropic-version"], "2026-10-21"); assert.equal(hdr["x-api-key"], "sk-test"); assert.ok(!("temperature" in sent));
});
await t("tier quick usa o modelo rápido", async () => {
  let sent; upstream = (b) => { sent = b; return ok("{}")(); };
  await handle(req({ prompt: "x", tier: "quick" })); assert.equal(sent.model, "claude-haiku-5-5");
});
await t("sem login → session_expired", async () => {
  const r = await handle(req({ prompt: "x" }, "bad")); assert.equal(r.status, 401); assert.equal((await r.json()).error.code, "session_expired");
});
await t("limite diário → rate_limited, sem chamar a API", async () => {
  used = 3; let hit = false; upstream = () => { hit = true; return ok("{}")(); };
  const r = await handle(req({ prompt: "x" })); assert.equal(r.status, 429); assert.equal(hit, false); used = 0;
});
await t("e-mail fora da lista → not_granted", async () => {
  envs.ALLOWED_EMAILS = "outra@x.com"; const r = await handle(req({ prompt: "x" })); assert.equal((await r.json()).error.code, "not_granted"); delete envs.ALLOWED_EMAILS;
});
await t("formato de imagem estranho → image_rejected", async () => {
  const r = await handle(req({ prompt: "x", images: [{ media_type: "image/heic", data: "A" }] })); assert.equal((await r.json()).error.code, "image_rejected");
});
await t("chave recusada → sampling_disabled", async () => {
  upstream = () => new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 });
  assert.equal((await (await handle(req({ prompt: "x" }))).json()).error.code, "sampling_disabled");
});
await t("sem chave configurada → sampling_disabled", async () => {
  const k = envs.ANTHROPIC_API_KEY; delete envs.ANTHROPIC_API_KEY;
  assert.equal((await (await handle(req({ prompt: "x" }))).json()).error.code, "sampling_disabled"); envs.ANTHROPIC_API_KEY = k;
});
await t("recusa do modelo → refused; texto sem JSON → invalid_json", async () => {
  upstream = () => new Response(JSON.stringify({ content: [], stop_reason: "refusal", usage: {} }), { status: 200 });
  assert.equal((await (await handle(req({ prompt: "x" }))).json()).error.code, "refused");
  upstream = ok("não sei"); assert.equal((await (await handle(req({ prompt: "x" }))).json()).error.code, "invalid_json");
});
await t("cada chamada conta no uso do dia", async () => {
  used = 0; upstream = ok("{}"); await handle(req({ prompt: "x" })); await handle(req({ prompt: "x" })); assert.equal(used, 2);
});
await t("projeto com chaves novas (publishable/secret)", async () => {
  const old = { a: envs.SUPABASE_ANON_KEY, s: envs.SUPABASE_SERVICE_ROLE_KEY }; delete envs.SUPABASE_ANON_KEY; delete envs.SUPABASE_SERVICE_ROLE_KEY;
  envs.SUPABASE_PUBLISHABLE_KEYS = JSON.stringify({ default: "sb_publishable_x" }); envs.SUPABASE_SECRET_KEYS = JSON.stringify({ default: "sb_secret_y" });
  calls = []; upstream = ok("{}"); const r = await handle(req({ prompt: "x" })); assert.equal(r.status, 200);
  const u = calls.find((c) => c.url.endsWith("/auth/v1/user")); assert.equal(u.init.headers.apikey, "sb_publishable_x");
  const b = calls.find((c) => c.url.includes("rpc/ai_bump")); assert.equal(b.init.headers.apikey, "sb_secret_y"); assert.ok(!b.init.headers.authorization);
  envs.SUPABASE_ANON_KEY = old.a; envs.SUPABASE_SERVICE_ROLE_KEY = old.s; delete envs.SUPABASE_PUBLISHABLE_KEYS; delete envs.SUPABASE_SECRET_KEYS;
});
console.log(`\n${n} de ${n} testes da função passaram`);
