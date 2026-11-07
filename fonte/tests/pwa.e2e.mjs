// Teste ponta a ponta da versão de celular (pasta pwa/), sem internet:
// - o Supabase (login por código, tabela docs, ai_usage) é simulado aqui em Node;
// - a função "ai" é o CÓDIGO REAL de supabase/functions/ai/index.ts, rodando em Node;
// - só a API do Claude é simulada (nenhuma chave real é usada).
// Rodar: node --experimental-strip-types --no-warnings tests/pwa.e2e.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/npm-tools/node_modules/playwright");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const PWA = path.join(root, "pwa");
const PNG = path.resolve(root, "../app/e2e/fixtures/plate.png");
const SHOTS = path.join(root, "screens"); fs.mkdirSync(SHOTS, { recursive: true });
const SB = "https://teste-pd.supabase.co";
const ANON = "sb_publishable_teste_0123456789abcdef";
const SVC = "service-role-teste";

/* ------------------------------------------------ Supabase simulado */
const users = new Map();      // email -> {id,email}
const tokens = new Map();     // token -> user
const docs = new Map();       // user_id|path -> {user_id,path,parent,data}
const usage = new Map();      // user_id|day -> {calls,in_tok,out_tok}
let otpSent = [], rangeQueries = 0;
const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const session = (u) => { const t = "tok-" + u.id + "-" + Math.random().toString(36).slice(2, 8); tokens.set(t, u); return { access_token: t, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r-" + t, user: { id: u.id, aud: "authenticated", role: "authenticated", email: u.email } }; };
const J = (status, body, headers = {}) => ({ status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", ...headers }, body: body === undefined ? "" : JSON.stringify(body) });

function filterRows(rows, params) {
  for (const [k, v] of params) {
    if (["select", "order", "limit", "on_conflict", "columns"].includes(k)) continue;
    const [op, ...rest] = v.split("."); const val = rest.join(".");
    const get = (r) => k.startsWith("data->>") ? r.data?.[k.slice(7)] : r[k];
    rows = rows.filter((r) => { const x = String(get(r) ?? ""); return op === "eq" ? x === val : op === "gte" ? x >= val : op === "lte" ? x <= val : op === "gt" ? x > val : op === "lt" ? x < val : op === "neq" ? x !== val : true; });
  }
  return rows;
}
const pick = (r, select) => { if (!select || select === "*") return r; const o = {}; for (const c of select.split(",")) o[c] = r[c]; return o; };

async function supabase(method, url, headers, body) {
  const u = new URL(url); const p = u.pathname; const auth = headers["authorization"] || "";
  const bearer = auth.replace(/^Bearer /, "");
  const me = tokens.get(bearer); const svc = bearer === SVC;
  if (method === "OPTIONS") return { status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }, body: "" };
  if (p === "/auth/v1/otp") { const b = JSON.parse(body); otpSent.push(b.email); if (!users.has(b.email)) users.set(b.email, { id: "u-" + (users.size + 1) + "-0000-0000-000000000000", email: b.email }); return J(200, {}); }
  if (p === "/auth/v1/verify") { const b = JSON.parse(body); if (b.token !== "123456" || !users.has(b.email)) return J(403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" }); return J(200, session(users.get(b.email))); }
  if (p === "/auth/v1/signup") { const b = JSON.parse(body); if (users.has(b.email)) return J(422, { code: 422, error_code: "user_already_exists", msg: "User already registered" }); const usr = { id: "u-" + (users.size + 1) + "-0000-0000-000000000000", email: b.email, pw: b.password, confirmed: false }; users.set(b.email, usr); otpSent.push(b.email); return J(200, { id: usr.id, email: usr.email, aud: "authenticated", role: "authenticated", identities: [{}] }); }
  if (p === "/auth/v1/recover") { otpSent.push("recover:" + JSON.parse(body).email); return J(200, {}); }
  if (p === "/auth/v1/token" && u.searchParams.get("grant_type") === "password") { const b = JSON.parse(body); const usr = users.get(b.email); if (!usr || usr.pw !== b.password) return J(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }); if (!usr.confirmed) return J(400, { code: 400, error_code: "email_not_confirmed", msg: "Email not confirmed" }); return J(200, session(usr)); }
  if (p === "/auth/v1/token") { const b = JSON.parse(body); const t = String(b.refresh_token || "").slice(2); const usr = tokens.get(t); return usr ? J(200, session(usr)) : J(400, { msg: "invalid refresh" }); }
  if (p === "/auth/v1/user") return me ? J(200, { id: me.id, email: me.email, aud: "authenticated", role: "authenticated" }) : J(401, { msg: "invalid JWT" });
  if (p === "/auth/v1/logout") { tokens.delete(bearer); return { status: 204, headers: { "access-control-allow-origin": "*" }, body: "" }; }
  if (p === "/rest/v1/docs") {
    if (!me) return J(401, { message: "JWT expired" });
    const mine = [...docs.values()].filter((r) => r.user_id === me.id); // RLS
    if (method === "GET") { const params = [...u.searchParams]; if (params.some(([k]) => k === "data->>date")) rangeQueries++; let rows = filterRows(mine, params); rows.sort((a, b) => a.path.localeCompare(b.path)); return J(200, rows.map((r) => pick(r, u.searchParams.get("select")))); }
    if (method === "POST") {
      const rowsIn = [].concat(JSON.parse(body));
      for (const r of rowsIn) { if (r.user_id !== me.id) return J(403, { message: "new row violates row-level security policy" }); docs.set(me.id + "|" + r.path, { ...r }); }
      return J(201, undefined);
    }
    if (method === "DELETE") { for (const r of filterRows(mine, [...u.searchParams])) docs.delete(me.id + "|" + r.path); return J(204, undefined); }
  }
  if (p === "/rest/v1/ai_usage") {
    let rows = [...usage.entries()].map(([k, v]) => ({ user_id: k.split("|")[0], day: k.split("|")[1], ...v }));
    if (!svc) { if (!me) return J(401, {}); rows = rows.filter((r) => r.user_id === me.id); }
    rows = filterRows(rows, [...u.searchParams]);
    return J(200, rows.map((r) => pick(r, u.searchParams.get("select"))));
  }
  if (p === "/rest/v1/rpc/ai_bump") {
    if (!svc) return J(403, { message: "permission denied for function ai_bump" });
    const b = JSON.parse(body); const k = b.p_user + "|" + today(); const cur = usage.get(k) || { calls: 0, in_tok: 0, out_tok: 0 };
    cur.calls++; cur.in_tok += b.p_in; cur.out_tok += b.p_out; usage.set(k, cur); return J(200, cur.calls);
  }
  if (p === "/functions/v1/ai") {
    const r = await fn.handle(new Request(url, { method, headers, body }));
    return { status: r.status, headers: Object.fromEntries(r.headers), body: await r.text() };
  }
  return J(404, { message: "rota simulada inexistente " + p });
}

/* ------------------------------------------------ função "ai" real + API do Claude simulada */
const envs = { ANTHROPIC_API_KEY: "sk-ant-teste", SUPABASE_URL: SB, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SVC, AI_DAILY_LIMIT: "60" };
globalThis.__PD_TEST__ = true;
globalThis.Deno = { env: { get: (k) => envs[k] } };
const anthropicCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.startsWith(SB)) { const r = await supabase(init.method || "GET", url, Object.fromEntries(new Headers(init.headers)), init.body); return new Response(r.body || null, { status: r.status, headers: r.headers }); }
  if (url === "https://api.anthropic.com/v1/messages") {
    const b = JSON.parse(init.body); anthropicCalls.push({ headers: Object.fromEntries(new Headers(init.headers)), body: b });
    const text = b.messages[0].content.at(-1).text;
    let out = {};
    if (/foto de um prato/.test(text)) out = { items: [{ label: "arroz branco", ref: "t3", grams: 150, confidence: 0.85, per100: null }, { label: "feijão carioca", ref: "t561", grams: 86, confidence: 0.8, per100: null }], note: "" };
    return new Response(JSON.stringify({ content: [{ type: "text", text: "```json\n" + JSON.stringify(out) + "\n```" }], stop_reason: "end_turn", usage: { input_tokens: 12000, output_tokens: 180 } }), { status: 200 });
  }
  return realFetch(input, init);
};
const fn = await import(pathToFileURL(path.join(root, "supabase/functions/ai/index.ts")).href);

/* ------------------------------------------------ servidor estático da pasta pwa/ */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  let f = decodeURIComponent(new URL(req.url, "http://x").pathname); if (f.endsWith("/")) f += "index.html";
  const p = path.join(PWA, f); if (!p.startsWith(PWA) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" }); fs.createReadStream(p).pipe(res);
}).listen(0);
const BASE = `http://localhost:${server.address().port}/`;

/* ------------------------------------------------ navegador */
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const errors = [];
let passed = 0, failed = 0;
const check = async (name, f) => { try { await f(); passed++; console.log("  ok  ", name); } catch (e) { failed++; console.log("  FAIL", name, "\n       ", String(e.message || e).split("\n")[0]); try { await page.screenshot({ path: "/tmp/claude-0/-home-claude/95753027-6b61-55a2-8d95-0bb574c72820/scratchpad/pwa-fail-" + failed + ".png" }); console.log("        gate:", await page.locator("#pd-gate").count(), "| texto:", (await page.locator("body").innerText()).slice(0, 160).replace(/\n/g, " / ")); } catch {} if (process.env.STOP) { await browser.close(); server.close(); process.exit(1); } } };
const ok = (v, m) => { if (!v) throw new Error(m); };

async function newCtx() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "pt-BR" });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  // o pwa/config.js publicado já vem com o banco real; nos testes começa vazio (cada teste que quiser preenche)
  await ctx.route(BASE + "config.js", (r) => r.fulfill({ contentType: "text/javascript", body: "window.PD_CONFIG={};" }));
  await ctx.route(SB + "/**", async (route) => {
    const req = route.request();
    const r = await supabase(req.method(), req.url(), await req.allHeaders(), req.postData()); if (process.env.LOGREQ) console.log("    ", req.method(), decodeURIComponent(req.url().slice(SB.length)).slice(0, 150), r.status, String(r.body).slice(0, 80));
    await route.fulfill({ status: r.status, headers: { ...r.headers, "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }, body: r.body });
  });
  return ctx;
}
const watch = (page) => {
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/fonts|ERR_FAILED|status of (4\d\d|503)/.test(m.text())) errors.push(m.text()); });
};
const signupAndLogin = async (page, email, pw = "senha-forte-1") => {
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(pw);
  await page.getByLabel("Repita a senha").fill(pw);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByText(/link de confirmação/).waitFor();
  users.get(email).confirmed = true; // = tocar no link do e-mail
  await page.getByLabel("Senha", { exact: true }).fill(pw);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
};
const onboard = async (page) => {
  await page.getByLabel("Como você quer ser chamada(o)?").fill("Alex");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: /Perder peso/ }).click(); await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Ano de nascimento").fill("1990"); await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Altura (cm)").fill("165"); await page.getByLabel("Peso atual (kg)").fill("72"); await page.getByLabel("Peso que você quer alcançar (kg)").fill("65");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: /Leve/ }).click(); await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: "Começar" }).click();
  await page.getByRole("button", { name: "Agora não" }).click();
  await page.getByText(/Nada registrado hoje/).waitFor();
};
const photo = async (page) => {
  await page.getByRole("button", { name: "Registrar refeição" }).click();
  const ch = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Escolher foto da galeria/ }).click();
  await (await ch).setFiles(PNG);
};

console.log("Versão de celular (PWA)");
const ctx = await newCtx();
const page = await ctx.newPage(); watch(page);
await page.goto(BASE);

await check("instalável: manifesto, ícones e metatags do iPhone", async () => {
  const man = await page.evaluate(async () => (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
  ok(man.display === "standalone" && man.icons.length === 3, "manifesto incompleto");
  for (const i of [...man.icons.map((x) => x.src), "icons/apple-touch-icon.png", "sw.js"]) ok((await page.request.get(BASE + i)).ok(), "faltando " + i);
  ok(await page.locator('meta[name="apple-mobile-web-app-capable"]').count() === 1, "sem meta do iOS");
  ok(await page.locator('meta[name="viewport"]').getAttribute("content").then((c) => c.includes("viewport-fit=cover")), "viewport sem cover");
});
await check("primeiro acesso pede o banco e recusa a chave secreta", async () => {
  await page.getByRole("heading", { name: "Conectar ao seu banco" }).waitFor();
  await page.screenshot({ path: path.join(SHOTS, "P01-conectar.png") });
  await page.getByLabel(/Endereço do projeto/).fill(SB);
  await page.getByLabel(/Chave pública/).fill("sb_secret_abcdefghijklmnopqrstuvwxyz");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByText(/chave secreta/).waitFor();
  await page.getByLabel(/Chave pública/).fill(ANON);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("heading", { name: "Entrar" }).waitFor();
});
await check("criar conta, confirmar e entrar com senha (erros avisam)", async () => {
  await page.screenshot({ path: path.join(SHOTS, "P02-entrar.png") });
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByLabel("E-mail").fill("alex@exemplo.com");
  await page.getByLabel("Senha", { exact: true }).fill("curta");
  await page.getByLabel("Repita a senha").fill("curta");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByText(/pelo menos 8 caracteres/).last().waitFor();
  await page.getByLabel("Senha", { exact: true }).fill("senha-forte-1");
  await page.getByLabel("Repita a senha").fill("senha-forte-1");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByText(/link de confirmação/).waitFor();
  await page.getByLabel("Senha", { exact: true }).fill("senha-forte-1");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByText(/Falta confirmar o e-mail/).waitFor();
  users.get("alex@exemplo.com").confirmed = true;
  await page.getByLabel("Senha", { exact: true }).fill("errada-123");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByText(/E-mail ou senha errados/).waitFor();
  await page.screenshot({ path: path.join(SHOTS, "P03-erro-senha.png") });
  await page.getByLabel("Senha", { exact: true }).fill("senha-forte-1");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByLabel("Como você quer ser chamada(o)?").waitFor();
});
await check("esqueci a senha manda o link", async () => {
  const c3 = await newCtx(); await c3.route(BASE + "config.js", (r) => r.fulfill({ contentType: "text/javascript", body: `window.PD_CONFIG={url:${JSON.stringify(SB)},anonKey:${JSON.stringify(ANON)}};` }));
  const p3 = await c3.newPage(); watch(p3); await p3.goto(BASE);
  await p3.getByLabel("E-mail").fill("alex@exemplo.com");
  await p3.getByRole("button", { name: "Esqueci a senha" }).click();
  await p3.getByText(/Enviamos um link/).waitFor();
  ok(otpSent.includes("recover:alex@exemplo.com"), "pedido de nova senha não chegou");
  await c3.close();
});
await check("cadastro salva o perfil no Supabase", async () => {
  await onboard(page);
  const uid = users.get("alex@exemplo.com").id;
  const main = docs.get(uid + "|data/users/" + uid + "/main");
  ok(main && main.data.profile?.name === "Alex" && main.parent === "data/users/" + uid, "perfil não chegou ao banco");
});
await check("foto → função ai real → revisão → salvar no banco", async () => {
  await photo(page);
  await page.getByRole("heading", { name: "Confira a refeição" }).waitFor();
  await page.screenshot({ path: path.join(SHOTS, "P04-revisao.png") });
  const call = anthropicCalls.at(-1);
  ok(call.headers["anthropic-version"] === "2026-10-21" && call.headers["x-api-key"] === "sk-ant-teste", "cabeçalhos da API errados");
  const img = call.body.messages[0].content[0];
  ok(img.type === "image" && img.source.media_type === "image/jpeg" && img.source.data.length > 100, "foto não foi como JPEG base64");
  ok(call.body.model === "claude-sonnet-5-5", "modelo errado: " + call.body.model);
  await page.getByRole("button", { name: /Salvar refeição · / }).click();
  await page.getByText(/salvo ·/).waitFor();
  const uid = users.get("alex@exemplo.com").id;
  await page.waitForTimeout(300);
  const day = docs.get(uid + "|data/users/" + uid + "/main/days/" + (await page.evaluate(() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })));
  ok(day && day.data.meals.length === 1 && day.data.meals[0].items.length === 2, "refeição não chegou ao banco");
  ok(usage.get(uid + "|" + today())?.calls === 1, "uso da IA não foi contado");
});
await check("reabrir o app: continua logada e com a refeição do dia", async () => {
  await page.reload();
  await page.getByText(/arroz/i).first().waitFor({ timeout: 8000 });
  ok(await page.locator("#pd-gate").count() === 0, "pediu login de novo");
  ok(await page.getByText(/Nada registrado hoje/).count() === 0, "dia veio vazio");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "rolagem horizontal");
  await page.screenshot({ path: path.join(SHOTS, "P05-hoje.png") });
});
await check("progresso lê a semana pelo filtro de datas", async () => {
  await page.getByRole("tab", { name: "Progresso" }).click();
  await page.waitForTimeout(500);
  ok(rangeQueries > 0, "a semana não foi buscada por data");
  ok(errors.length === 0, "erros: " + errors.join(" | "));
});
await check("perfil mostra a conta, o uso de IA do dia e Sair", async () => {
  await page.getByRole("tab", { name: "Perfil" }).click();
  await page.getByRole("heading", { name: "Conta deste celular" }).waitFor();
  await page.getByText(/alex@exemplo\.com/).waitFor();
  await page.getByText(/1 análise de IA hoje/).waitFor();
  await page.getByRole("heading", { name: "Instalar no celular" }).waitFor(); // no navegador, ensina a instalar
  await page.getByRole("heading", { name: "Conta deste celular" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "P06-perfil.png") });
});
await check("limite diário: avisa e não chama a API", async () => {
  envs.AI_DAILY_LIMIT = "1"; const before = anthropicCalls.length;
  await page.getByRole("tab", { name: "Hoje" }).click();
  await photo(page);
  await page.getByText(/limite de uso atingido/).waitFor();
  ok(anthropicCalls.length === before, "chamou a API mesmo no limite");
  envs.AI_DAILY_LIMIT = "60";
  await page.getByRole("button", { name: "Voltar" }).first().click();
});
await check("chave sem crédito vira mensagem clara", async () => {
  const k = envs.ANTHROPIC_API_KEY; delete envs.ANTHROPIC_API_KEY;
  await photo(page);
  await page.getByText(/A IA não está configurada/).waitFor();
  envs.ANTHROPIC_API_KEY = k;
  await page.getByRole("button", { name: "Voltar" }).first().click();
});
await check("sair volta para a tela de entrar", async () => {
  await page.getByRole("tab", { name: "Perfil" }).click();
  await page.getByRole("button", { name: "Sair desta conta" }).click();
  await page.getByRole("heading", { name: "Entrar" }).waitFor();
});
await check("outra conta no mesmo banco não vê nada da primeira", async () => {
  await signupAndLogin(page, "outra@exemplo.com");
  await page.getByLabel("Como você quer ser chamada(o)?").waitFor();
  const uid = users.get("outra@exemplo.com").id;
  ok(![...docs.values()].some((r) => r.user_id === uid && /arroz/.test(JSON.stringify(r.data))), "vazou dado");
});
await check("config.js preenchido pula a tela de conectar", async () => {
  const c2 = await newCtx();
  await c2.route(BASE + "config.js", (r) => r.fulfill({ contentType: "text/javascript", body: `window.PD_CONFIG={url:${JSON.stringify(SB)},anonKey:${JSON.stringify(ANON)}};` }));
  const p2 = await c2.newPage(); watch(p2); await p2.goto(BASE);
  await p2.getByRole("heading", { name: "Entrar" }).waitFor();
  await c2.close();
});
await check("sem erros no console", async () => ok(errors.length === 0, errors.join(" | ")));

await browser.close(); server.close();
console.log(`\n${passed} de ${passed + failed} testes da versão de celular passaram`);
process.exit(failed ? 1 : 0);
