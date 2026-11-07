"""Monta a versão de celular (PWA) em mobile/pwa/ a partir do app do Claude (app/dist/index.html).
Só biblioteca padrão. Rode antes: python3 ../app/build/build.py
Uso: python3 build-pwa.py   →   pasta pwa/ pronta para publicar (Netlify, Cloudflare Pages, GitHub Pages).
"""
import hashlib, json, pathlib, shutil, subprocess, sys

here = pathlib.Path(__file__).resolve().parent
app = here.parent / "app"
out = here / "pwa"
src = (app / "dist/index.html").read_text(encoding="utf-8")

# ---- trocas de texto que só fazem sentido fora do Claude (cada uma tem que existir exatamente uma vez)
SWAPS = [
    ("Sua sessão expirou. Entre de novo no Claude e reabra o app.", "Sua sessão expirou. Feche e abra o app para entrar de novo."),
    ("O Claude não está disponível nesta conta agora.", "A IA não está configurada: confira a chave da API do Claude e os créditos no Supabase."),
    ("Sem permissão para usar o Claude neste app. A busca na tabela continua funcionando.", "Esta conta não está autorizada a usar a IA. A busca na tabela continua funcionando."),
    ("${confirm}<button class=\"btn secondary\" data-act=\"ask-wipe\"", "${window.PD_PWA ? PD_PWA.profileHtml() : \"\"}${confirm}<button class=\"btn secondary\" data-act=\"ask-wipe\""),
    ("Seus registros ficam salvos de forma privada na sua conta; só você vê.", "Seus registros ficam no seu banco Supabase, protegidos por login; só você vê."),
]
for a, b in SWAPS:
    n = src.count(a)
    if n != 1:
        sys.exit(f"troca não encontrada exatamente uma vez ({n}x): {a[:60]}")
    src = src.replace(a, b)
src = src.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "", 1)

if out.exists():
    shutil.rmtree(out)
(out / "vendor").mkdir(parents=True)
(out / "icons").mkdir()

shutil.copy(here / "pwa-src/shim.js", out / "shim.js")
shutil.copy(here / "node_modules/@supabase/supabase-js/dist/umd/supabase.js", out / "vendor/supabase.js")
cfg = here / "pwa-src/config.js"
(out / "config.js").write_text(cfg.read_text(encoding="utf-8") if cfg.exists() else
    "// Opcional: preencha para não precisar digitar no primeiro acesso. A chave pública (anon) pode ficar aqui.\n"
    "// NUNCA coloque aqui a chave da API do Claude nem a service_role.\n"
    "window.PD_CONFIG = { url: \"\", anonKey: \"\" };\n", encoding="utf-8")

head = """<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#10151d" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Prato Diário">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="format-detection" content="telephone=no">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
"""
scripts = '<script src="config.js"></script>\n<script src="vendor/supabase.js"></script>\n<script src="shim.js"></script>\n'
# cabeça: tudo antes do </style> final vai no <head>; o resto no <body>, com o adaptador antes do app
style_end = src.index("</style>", 0) + len("</style>")
html = head + src[:style_end] + "\n</head>\n<body>\n" + scripts + src[style_end:].lstrip() + "\n</body>\n</html>\n"
(out / "index.html").write_text(html, encoding="utf-8")

manifest = {
    "name": "Prato Diário", "short_name": "Prato Diário", "lang": "pt-BR",
    "description": "Diário alimentar com foto, tabelas TACO e IBGE.",
    "start_url": "./", "scope": "./", "display": "standalone", "orientation": "portrait",
    "background_color": "#ffffff", "theme_color": "#ffffff",
    "icons": [
        {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
        {"src": "icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}
(out / "manifest.webmanifest").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

subprocess.run(["node", str(here / "pwa-src/icons.mjs"), str(out / "icons")], check=True)
for extra in ["_headers", "netlify.toml"]:
    p = here / "pwa-src" / extra
    if p.exists():
        shutil.copy(p, out / extra)

# service worker com versão = hash dos arquivos (cada build novo atualiza o app no celular)
files = ["./", "index.html", "shim.js", "config.js", "vendor/supabase.js", "manifest.webmanifest",
         "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"]
h = hashlib.sha256()
for f in files[1:]:
    h.update((out / f).read_bytes())
sw = (here / "pwa-src/sw.js").read_text(encoding="utf-8").replace("__VERSION__", h.hexdigest()[:12]).replace("__FILES__", json.dumps(files))
(out / "sw.js").write_text(sw, encoding="utf-8")

total = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
print(f"pwa/ pronto: {len(list(out.rglob('*.*')))} arquivos, {total // 1024} KB, versão {h.hexdigest()[:12]}")
