/* Prato Diário — adaptador para rodar fora do Claude (versão de celular).
   Recria as quatro capacidades que o app usa dentro do Claude:
     db        → tabela "docs" no seu Supabase (cada pessoa só vê o que é seu)
     user      → sua conta do Supabase (entrar com código por e-mail)
     sample    → função "ai" no seu Supabase, que chama a API do Claude com a sua chave
     downloads → baixar/compartilhar arquivo pelo celular
   A chave da API do Claude NUNCA passa por aqui. O app só conhece o endereço do projeto
   e a chave pública (anon/publishable), que foi feita para ficar no aplicativo. */
(function () {
  "use strict";
  if (window.claude && window.claude.use) return; // dentro do Claude: usa o original

  const CFG_KEY = "pd:cfg";
  const baked = window.PD_CONFIG || {};
  const readCfg = () => { let s = {}; try { s = JSON.parse(localStorage.getItem(CFG_KEY) || "{}"); } catch {} return { ...baked, ...s }; };
  const writeCfg = (c) => { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch {} };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const deepFreeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
  const E = (code, message) => Object.assign(new Error(message || code), { code });

  let sb = null, user = null, usage = null;

  /* ---------------------------------------------------------------- tela de entrada */
  const css = `
  #pd-gate{position:fixed;inset:0;z-index:100;background:var(--bg,#fff);color:var(--text,#1c2a3f);overflow:auto;
    padding:calc(env(safe-area-inset-top,0px) + 32px) 20px calc(env(safe-area-inset-bottom,0px) + 24px);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  #pd-gate .w{max-width:420px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
  #pd-gate .f{display:flex;flex-direction:column;gap:14px}
  #pd-gate h1{font-size:24px;line-height:1.2;margin:8px 0 0}
  #pd-gate p{margin:0}#pd-gate .m{color:var(--muted,#5a6779);font-size:14px}
  #pd-gate label{font-weight:600;font-size:14px;display:block;margin-bottom:6px}
  #pd-gate input{width:100%;box-sizing:border-box;min-height:48px;border-radius:12px;border:1.5px solid var(--border-input,#7a8696);
    background:var(--bg,#fff);color:inherit;font:inherit;padding:10px 14px}
  #pd-gate input.code{letter-spacing:.35em;font-size:22px;text-align:center;font-variant-numeric:tabular-nums}
  #pd-gate button{min-height:52px;border-radius:999px;border:0;font:inherit;font-weight:600;cursor:pointer}
  #pd-gate .p{background:var(--accent,#1f2d45);color:var(--on-accent,#fff)}
  #pd-gate .g{background:transparent;color:var(--link,#16756a);min-height:44px}
  #pd-gate .e{color:var(--danger,#b42318);font-size:14px;min-height:1em}
  #pd-gate button[disabled]{opacity:.6}`;
  const logoSvg = `<svg width="72" height="72" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22" fill="var(--band,#dff3ee)"/><circle cx="24" cy="24" r="15.5" fill="var(--raised,#fff)"/><path d="M24 4.5a19.5 19.5 0 0 1 18.6 25.4" fill="none" stroke="var(--link,#16756a)" stroke-width="4" stroke-linecap="round"/><path d="M24 32.5c-.4-4.6-3.4-7.8-8.2-8.6-.3 4.9 2.8 8.3 8.2 8.6z" fill="var(--link,#16756a)"/><path d="M24 32.5c.2-6.4 3.6-10.6 9.4-11.6.4 6.1-3.2 10.6-9.4 11.6z" fill="var(--accent,#1f2d45)"/><path d="M24 33.5v-6" stroke="var(--accent,#1f2d45)" stroke-width="1.6" stroke-linecap="round"/></svg>`;

  let gate = null;
  function showGate(html) {
    if (!document.getElementById("pd-gate-css")) { const s = document.createElement("style"); s.id = "pd-gate-css"; s.textContent = css; document.head.appendChild(s); }
    if (!gate) { gate = document.createElement("div"); gate.id = "pd-gate"; gate.setAttribute("role", "dialog"); gate.setAttribute("aria-modal", "true"); document.body.appendChild(gate); }
    gate.innerHTML = `<div class="w">${logoSvg}${html}</div>`;
    const f = gate.querySelector("input"); if (f) setTimeout(() => f.focus(), 50);
  }
  function hideGate() { if (gate) { gate.remove(); gate = null; } }
  const errBox = (msg) => { const e = gate && gate.querySelector(".e"); if (e) e.textContent = msg || ""; };
  const busy = (b, label) => { const btn = gate && gate.querySelector("button.p"); if (btn) { btn.disabled = b; if (label) btn.textContent = label; } };

  function setupScreen(resolve, c) {
    showGate(`<h1>Conectar ao seu banco</h1>
      <p class="m">Só na primeira vez. Os dois valores ficam no Supabase, em <b>Project Settings → API</b>. A chave da IA não entra aqui.</p>
      <form id="pd-f" novalidate class="f">
        <div><label for="pd-url">Endereço do projeto (Project URL)</label><input id="pd-url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://xxxx.supabase.co" value="${esc(c.url || "")}"></div>
        <div><label for="pd-anon">Chave pública (anon / publishable)</label><input id="pd-anon" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="eyJ… ou sb_publishable_…" value="${esc(c.anonKey || "")}"></div>
        <p class="e" role="alert"></p>
        <button class="p" type="submit">Continuar</button></form>`);
    gate.querySelector("#pd-f").onsubmit = (ev) => {
      ev.preventDefault();
      const url = gate.querySelector("#pd-url").value.trim().replace(/\/+$/, "");
      const anonKey = gate.querySelector("#pd-anon").value.trim();
      if (!/^https:\/\/[a-z0-9-]+\.(supabase\.co|supabase\.in)$/i.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) return errBox("Cole o endereço completo, como https://abcd1234.supabase.co");
      if (anonKey.length < 20) return errBox("Cole a chave pública inteira.");
      if (/service_role|sb_secret_/i.test(anonKey) || (() => { try { return JSON.parse(atob(anonKey.split(".")[1])).role === "service_role"; } catch { return false; } })()) return errBox("Essa é a chave secreta (service_role). Use a chave pública (anon / publishable).");
      writeCfg({ url, anonKey }); start(resolve);
    };
  }

  const pwField = (id, label, ac) => `<div><label for="${id}">${label}</label><input id="${id}" type="password" autocomplete="${ac}" minlength="8"></div>`;
  const emailOk = (em) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em);

  function loginScreen(resolve, email, note) {
    showGate(`<h1>Entrar</h1>${note ? `<p class="m">${note}</p>` : `<p class="m">Use o e-mail e a senha da sua conta do Prato Diário.</p>`}
      <form id="pd-f" novalidate class="f"><div><label for="pd-em">E-mail</label><input id="pd-em" type="email" inputmode="email" autocomplete="email" autocapitalize="off" value="${esc(email || "")}"></div>
      ${pwField("pd-pw", "Senha", "current-password")}
      <p class="e" role="alert"></p><button class="p" type="submit">Entrar</button></form>
      <button class="g" id="pd-new" type="button">Criar conta</button>
      <button class="g" id="pd-forgot" type="button">Esqueci a senha</button>
      <button class="g" id="pd-reset" type="button">Trocar o banco conectado</button>`);
    const em = () => gate.querySelector("#pd-em").value.trim().toLowerCase();
    gate.querySelector("#pd-new").onclick = () => signupScreen(resolve, em());
    gate.querySelector("#pd-reset").onclick = () => { writeCfg({}); start(resolve); };
    gate.querySelector("#pd-forgot").onclick = async () => {
      if (!emailOk(em())) return errBox("Digite seu e-mail acima e toque de novo em Esqueci a senha.");
      errBox("");
      const { error } = await sb.auth.resetPasswordForEmail(em(), { redirectTo: location.origin + location.pathname });
      if (error) return errBox(authMsg(error));
      loginScreen(resolve, em(), `Enviamos um link para <b>${esc(em())}</b>. Abra o link, crie a senha nova na página que abrir e depois entre aqui.`);
    };
    gate.querySelector("#pd-f").onsubmit = async (ev) => {
      ev.preventDefault();
      const pw = gate.querySelector("#pd-pw").value;
      if (!emailOk(em())) return errBox("Digite um e-mail válido.");
      if (!pw) return errBox("Digite a senha.");
      busy(true, "Entrando…"); errBox("");
      const { data, error } = await sb.auth.signInWithPassword({ email: em(), password: pw });
      if (error || !data?.session) { busy(false, "Entrar"); return errBox(authMsg(error)); }
      user = data.session.user; hideGate(); resolve();
    };
  }

  function signupScreen(resolve, email) {
    showGate(`<h1>Criar conta</h1><p class="m">Escolha uma senha com pelo menos 8 caracteres. Depois, confirme pelo link que chega no seu e-mail.</p>
      <form id="pd-f" novalidate class="f"><div><label for="pd-em">E-mail</label><input id="pd-em" type="email" inputmode="email" autocomplete="email" autocapitalize="off" value="${esc(email || "")}"></div>
      ${pwField("pd-pw", "Senha", "new-password")}${pwField("pd-pw2", "Repita a senha", "new-password")}
      <p class="e" role="alert"></p><button class="p" type="submit">Criar conta</button></form>
      <button class="g" id="pd-back" type="button">Já tenho conta</button>`);
    gate.querySelector("#pd-back").onclick = () => loginScreen(resolve, gate.querySelector("#pd-em").value.trim());
    gate.querySelector("#pd-f").onsubmit = async (ev) => {
      ev.preventDefault();
      const em = gate.querySelector("#pd-em").value.trim().toLowerCase(), pw = gate.querySelector("#pd-pw").value, pw2 = gate.querySelector("#pd-pw2").value;
      if (!emailOk(em)) return errBox("Digite um e-mail válido.");
      if (pw.length < 8) return errBox("A senha precisa ter pelo menos 8 caracteres.");
      if (pw !== pw2) return errBox("As duas senhas não são iguais.");
      busy(true, "Criando…"); errBox("");
      const { data, error } = await sb.auth.signUp({ email: em, password: pw, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) { busy(false, "Criar conta"); return errBox(authMsg(error)); }
      if (data?.session?.user) { user = data.session.user; hideGate(); resolve(); return; }
      loginScreen(resolve, em, `Conta criada. Enviamos um link de confirmação para <b>${esc(em)}</b> (olhe também o spam). Toque no link e depois entre aqui com a sua senha.`);
    };
  }

  function newPasswordScreen(resolve) {
    showGate(`<h1>Senha nova</h1><p class="m">Escolha a senha nova, com pelo menos 8 caracteres.</p>
      <form id="pd-f" novalidate class="f">${pwField("pd-pw", "Senha nova", "new-password")}${pwField("pd-pw2", "Repita a senha", "new-password")}
      <p class="e" role="alert"></p><button class="p" type="submit">Salvar senha</button></form>`);
    gate.querySelector("#pd-f").onsubmit = async (ev) => {
      ev.preventDefault();
      const pw = gate.querySelector("#pd-pw").value, pw2 = gate.querySelector("#pd-pw2").value;
      if (pw.length < 8) return errBox("A senha precisa ter pelo menos 8 caracteres.");
      if (pw !== pw2) return errBox("As duas senhas não são iguais.");
      busy(true, "Salvando…");
      const { data, error } = await sb.auth.updateUser({ password: pw });
      if (error) { busy(false, "Salvar senha"); return errBox(authMsg(error)); }
      user = data.user; hideGate(); resolve();
    };
  }

  function authMsg(e) {
    const m = String(e?.message || "");
    if (/invalid login|invalid credentials/i.test(m)) return "E-mail ou senha errados.";
    if (/not confirmed/i.test(m)) return "Falta confirmar o e-mail: toque no link que enviamos (olhe o spam).";
    if (/already registered|already exists/i.test(m)) return "Já existe conta com este e-mail. Use Entrar.";
    if (/weak|password should/i.test(m)) return "Senha fraca. Use pelo menos 8 caracteres, com letras e números.";
    if (/rate|seconds|too many/i.test(m)) return "Muitos pedidos seguidos. Espere alguns minutos e tente de novo.";
    if (/signups? not allowed|not allowed/i.test(m)) return "Novos cadastros estão desligados neste banco.";
    if (/fetch|network/i.test(m)) return "Sem conexão com o servidor. Confira a internet.";
    return "Não deu certo: " + m.slice(0, 120);
  }

  function start(resolve) {
    const c = readCfg();
    if (!c.url || !c.anonKey) return setupScreen(resolve, c);
    if (!window.supabase?.createClient) { showGate(`<h1>Arquivo faltando</h1><p class="m">Não encontrei vendor/supabase.js. Publique a pasta inteira, não só o index.html.</p>`); return; }
    const recovering = /type=recovery/.test(location.hash + location.search);
    sb = window.supabase.createClient(c.url, c.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "pd-auth" } });
    sb.auth.onAuthStateChange((ev, s) => {
      if (ev === "SIGNED_OUT") user = null; else if (s?.user) user = s.user;
      if (ev === "PASSWORD_RECOVERY") setTimeout(() => newPasswordScreen(resolve), 0);
    });
    sb.auth.getSession().then(({ data }) => {
      if (recovering && data?.session?.user) { user = data.session.user; return newPasswordScreen(resolve); }
      if (data?.session?.user) { user = data.session.user; hideGate(); resolve(); }
      else loginScreen(resolve, "");
    }, () => loginScreen(resolve, ""));
  }

  const ready = new Promise((resolve) => {
    const go = () => start(resolve);
    if (document.body) go(); else document.addEventListener("DOMContentLoaded", go, { once: true });
  });

  /* ---------------------------------------------------------------- db */
  const parentOf = (p) => p.slice(0, p.lastIndexOf("/"));
  const dbErr = (error) => {
    const m = String(error?.message || error || "");
    if (/fetch|network|Load failed/i.test(m)) return E("unavailable", "Sem conexão.");
    if (/JWT|expired|401/i.test(m)) return E("session_expired", m);
    if (/docs_tamanho|too large|payload/i.test(m)) return E("quota_exceeded", m);
    return E("db_error", m);
  };
  const snap = (data) => ({ exists: data != null, data: () => (data == null ? undefined : deepFreeze(data)) });
  const OPS = { "==": "eq", ">=": "gte", "<=": "lte", ">": "gt", "<": "lt", "!=": "neq" };

  function docRef(path) {
    return {
      path, id: path.slice(path.lastIndexOf("/") + 1),
      async get() {
        const { data, error } = await sb.from("docs").select("data").eq("path", path).maybeSingle();
        if (error) throw dbErr(error); return snap(data ? data.data : null);
      },
      async set(d) {
        const { error } = await sb.from("docs").upsert({ user_id: user.id, path, parent: parentOf(path), data: d }, { onConflict: "user_id,path" });
        if (error) throw dbErr(error);
      },
      async delete() { const { error } = await sb.from("docs").delete().eq("path", path); if (error) throw dbErr(error); },
      collection: (name) => colRef(path + "/" + name),
    };
  }
  function colRef(path, filters = []) {
    return {
      path,
      doc: (id) => docRef(path + "/" + id),
      where: (field, op, value) => { if (!OPS[op]) throw E("bad_query", op); return colRef(path, [...filters, [field, op, value]]); },
      async get() {
        let q = sb.from("docs").select("path,data").eq("parent", path);
        for (const [f, op, v] of filters) q = q[OPS[op]]("data->>" + f, v);
        const { data, error } = await q.order("path").limit(1000);
        if (error) throw dbErr(error);
        const docs = (data || []).map((r) => ({ id: r.path.slice(r.path.lastIndexOf("/") + 1), exists: true, data: () => deepFreeze(r.data) }));
        return { docs, empty: !docs.length, size: docs.length };
      },
    };
  }
  const dbApi = { doc: docRef, collection: (p) => colRef(p) };

  /* ---------------------------------------------------------------- IA */
  async function toJpegB64(file, maxSide = 1568, q = 0.85) {
    let img;
    try { img = await createImageBitmap(file); }
    catch {
      img = await new Promise((res, rej) => { const u = URL.createObjectURL(file); const i = new Image(); i.onload = () => { URL.revokeObjectURL(u); res(i); }; i.onerror = () => { URL.revokeObjectURL(u); rej(E("image_rejected")); }; i.src = u; });
    }
    const w = img.width, h = img.height, k = Math.min(1, maxSide / Math.max(w, h));
    const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    const url = cv.toDataURL("image/jpeg", q);
    if (!url.startsWith("data:image/jpeg")) throw E("image_rejected");
    return { media_type: "image/jpeg", data: url.slice(url.indexOf(",") + 1) };
  }
  async function token() {
    const { data } = await sb.auth.getSession();
    const t = data?.session?.access_token;
    if (!t) throw E("session_expired");
    return t;
  }
  const sampleApi = {
    async limits() { return { images: true, maxImages: 3 }; },
    async json(prompt, opts = {}) {
      const images = [];
      for (const f of (opts.images || []).slice(0, 3)) images.push(await toJpegB64(f));
      if (opts.signal?.aborted) throw E("cancelled");
      const c = readCfg();
      let r;
      try {
        r = await fetch(c.url + "/functions/v1/ai", {
          method: "POST", signal: opts.signal,
          headers: { "content-type": "application/json", authorization: "Bearer " + (await token()), apikey: c.anonKey },
          body: JSON.stringify({ prompt: String(prompt), images, tier: opts.modelTier === "quick" ? "quick" : "default" }),
        });
      } catch (e) {
        if (e?.name === "AbortError" || opts.signal?.aborted) throw E("cancelled");
        throw E("network", "Sem conexão.");
      }
      const body = await r.json().catch(() => null);
      refreshUsage();
      if (!r.ok || !body || body.error) {
        const code = body?.error?.code || (r.status === 404 ? "sampling_disabled" : r.status === 401 ? "session_expired" : "network");
        throw E(code, body?.error?.message || "HTTP " + r.status);
      }
      return body.data;
    },
  };

  /* ---------------------------------------------------------------- downloads */
  const downloadsApi = {
    async save({ filename, data, mimeType }) {
      const type = mimeType || (/\.csv$/i.test(filename) ? "text/csv;charset=utf-8" : "application/octet-stream");
      const blob = data instanceof Blob ? data : new Blob([data], { type });
      try {
        const file = new File([blob], filename, { type });
        if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return; }
      } catch (e) { if (e?.name === "AbortError") throw E("cancelled"); }
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    },
  };

  /* ---------------------------------------------------------------- conta (cartão no Perfil) */
  async function refreshUsage() {
    try {
      const day = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
      const { data } = await sb.from("ai_usage").select("calls,in_tok,out_tok").eq("day", day).maybeSingle();
      usage = data || { calls: 0, in_tok: 0, out_tok: 0 };
    } catch {}
  }
  window.PD_PWA = {
    profileHtml() {
      const u = usage ? `${usage.calls} ${usage.calls === 1 ? "análise" : "análises"} de IA hoje` : "";
      return `<section class="card stack" style="gap:8px"><h2 class="lg">Conta deste celular</h2>
        <p class="sm muted" style="overflow-wrap:anywhere">Conectada como <b>${esc(user?.email || "")}</b>.${u ? " " + esc(u) + "." : ""} Seus dados ficam no seu Supabase; a foto vai para a API do Claude pela sua chave.</p>
        <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn secondary" data-pd-act="logout">Sair desta conta</button></div></section>`;
    },
  };
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest && ev.target.closest("[data-pd-act]");
    if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    if (b.dataset.pdAct === "logout") { try { await sb.auth.signOut(); } catch {} location.reload(); }
  }, true);

  /* ---------------------------------------------------------------- a ponte */
  window.claude = {
    async use(name) {
      await ready;
      if (name === "db") return dbApi;
      if (name === "user") return { id: async () => user.id, name: async () => user.email || "" };
      if (name === "sample") { refreshUsage(); return sampleApi; }
      if (name === "downloads") return downloadsApi;
      return null;
    },
  };

  /* ---------------------------------------------------------------- funcionar como app instalado */
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
