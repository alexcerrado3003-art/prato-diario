// Prato Diário — função "ai" (Supabase Edge Function, Deno)
// Recebe o pedido do app (texto + fotos), chama a API do Claude com a SUA chave e devolve o JSON.
// A chave fica só aqui, como segredo do Supabase (ANTHROPIC_API_KEY). Nunca vai para o celular.
//
// Segredos/variáveis (Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY   obrigatório. Chave criada em platform.claude.com
//   CLAUDE_MODEL        opcional. Padrão: claude-sonnet-5-5 (fotos, laudos, análises)
//   CLAUDE_MODEL_QUICK  opcional. Padrão: claude-haiku-5-5 (dicas rápidas)
//   AI_DAILY_LIMIT      opcional. Máximo de análises por dia por pessoa. Padrão: 60
//   ALLOWED_EMAILS      opcional. E-mails autorizados, separados por vírgula. Vazio = qualquer conta do seu projeto
// SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY já existem por padrão nas funções.

const API = "https://api.anthropic.com/v1/messages";
const VERSION = "2026-10-21";
const MAX_IMAGES = 3;
const MAX_IMAGE_B64 = 6_000_000; // ~4,5 MB de imagem; o app já reduz para ~300 KB
const MAX_PROMPT = 200_000;

const env = (k: string, d = "") => (Deno.env.get(k) ?? d).trim();
// Projetos novos do Supabase trazem as chaves novas (publishable/secret); os antigos, anon/service_role.
const firstKey = (...names: string[]) => {
  for (const n of names) {
    const v = env(n);
    if (!v) continue;
    if (v.startsWith("{")) { try { const o = JSON.parse(v); const x = o.default ?? Object.values(o)[0]; if (x) return String(x); } catch { /* segue */ } }
    return v;
  }
  return "";
};
const anonKey = () => firstKey("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEYS");
const serviceKey = () => firstKey("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_SECRET_KEYS");
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8" } });
const fail = (status: number, code: string, message: string) => reply(status, { error: { code, message } });

type Img = { media_type: string; data: string };
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function extractJson(text: string): unknown {
  const t = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(t); } catch { /* tenta o maior trecho entre chaves */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* segue */ } }
  throw new Error("invalid_json");
}

async function whoIs(auth: string) {
  const r = await fetch(env("SUPABASE_URL") + "/auth/v1/user", {
    headers: { authorization: auth, apikey: anonKey() },
  });
  if (!r.ok) return null;
  return await r.json() as { id: string; email?: string };
}

async function rest(path: string, init: RequestInit = {}) {
  const key = serviceKey();
  // chave nova (sb_secret_…) vai só no apikey; a antiga (JWT) vai também como Bearer
  const auth: Record<string, string> = key.startsWith("sb_") ? {} : { authorization: "Bearer " + key };
  return fetch(env("SUPABASE_URL") + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: key, ...auth, "content-type": "application/json", ...(init.headers || {}) },
  });
}

async function usedToday(user: string): Promise<number> {
  const day = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10); // horário da Bahia (UTC−3)
  const r = await rest(`ai_usage?select=calls&user_id=eq.${user}&day=eq.${day}`);
  if (!r.ok) return 0;
  const rows = await r.json() as { calls: number }[];
  return rows[0]?.calls ?? 0;
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "bad_request", "Use POST.");

  const key = env("ANTHROPIC_API_KEY");
  if (!key) return fail(503, "sampling_disabled", "A chave da API do Claude ainda não foi configurada no Supabase.");

  const auth = req.headers.get("authorization") || "";
  const user = auth.startsWith("Bearer ") ? await whoIs(auth) : null;
  if (!user?.id) return fail(401, "session_expired", "Sessão expirada. Entre de novo.");

  const allowed = env("ALLOWED_EMAILS").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes((user.email || "").toLowerCase())) {
    return fail(403, "not_granted", "Esta conta não está autorizada a usar a IA.");
  }

  const limit = Number(env("AI_DAILY_LIMIT", "60")) || 60;
  if (await usedToday(user.id) >= limit) {
    return fail(429, "rate_limited", `Limite de ${limit} análises por dia atingido.`);
  }

  let body: { prompt?: unknown; images?: unknown; tier?: unknown };
  try { body = await req.json(); } catch { return fail(400, "bad_request", "Pedido inválido."); }
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt || prompt.length > MAX_PROMPT) return fail(400, "bad_request", "Texto do pedido ausente ou grande demais.");
  const images = (Array.isArray(body.images) ? body.images : []) as Img[];
  if (images.length > MAX_IMAGES) return fail(400, "image_rejected", "Fotos demais num pedido.");
  for (const im of images) {
    if (!im || !IMAGE_TYPES.has(im.media_type) || typeof im.data !== "string" || !im.data || im.data.length > MAX_IMAGE_B64) {
      return fail(400, "image_rejected", "Foto em formato ou tamanho não aceito.");
    }
  }
  const model = body.tier === "quick" ? env("CLAUDE_MODEL_QUICK", "claude-haiku-5-5") : env("CLAUDE_MODEL", "claude-sonnet-5-5");

  // Imagens antes do texto, como recomenda a documentação de visão.
  const content = [
    ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })),
    { type: "text", text: prompt },
  ];

  let r: Response;
  try {
    r = await fetch(API, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": VERSION, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: "Responda sempre em português do Brasil e somente com um objeto JSON válido, sem texto antes ou depois.",
        messages: [{ role: "user", content }],
      }),
    });
  } catch {
    return fail(502, "network", "Não consegui falar com a API do Claude.");
  }

  const out = await r.json().catch(() => null) as any;
  if (!r.ok) {
    const msg = String(out?.error?.message || "").slice(0, 300);
    if (r.status === 401 || r.status === 403) return fail(503, "sampling_disabled", "A chave da API foi recusada. Confira o segredo ANTHROPIC_API_KEY.");
    if (r.status === 429 || r.status === 529) return fail(429, "rate_limited", "A API está ocupada ou o limite da conta foi atingido.");
    if (r.status === 400 && /credit|billing|balance/i.test(msg)) return fail(503, "sampling_disabled", "Sem créditos na conta da API do Claude.");
    if (r.status === 400 && images.length && /image/i.test(msg)) return fail(400, "image_rejected", "A API não aceitou esta foto.");
    return fail(502, "upstream", "A API do Claude respondeu com erro: " + msg);
  }

  const inTok = (out?.usage?.input_tokens ?? 0) + (out?.usage?.cache_read_input_tokens ?? 0) + (out?.usage?.cache_creation_input_tokens ?? 0);
  await rest("rpc/ai_bump", {
    method: "POST",
    body: JSON.stringify({ p_user: user.id, p_in: inTok, p_out: out?.usage?.output_tokens ?? 0 }),
  }).catch(() => null);

  if (out?.stop_reason === "refusal") return fail(422, "refused", "O Claude não analisou este pedido.");
  const text = (out?.content || []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
  try {
    return reply(200, { data: extractJson(text), model, usage: out?.usage ?? null });
  } catch {
    return fail(502, "invalid_json", "A resposta veio num formato inesperado.");
  }
}

// (nos testes locais, __PD_TEST__ evita subir o servidor)
if (!(globalThis as any).__PD_TEST__) Deno.serve(handle);
