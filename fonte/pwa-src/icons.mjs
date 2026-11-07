// Gera os ícones do app a partir da logo (SVG) com o Chromium do Playwright.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require("/opt/npm-tools/node_modules/playwright"); }
const out = process.argv[2];
// cores do tema claro do app
const C = { band: "#d4eee6", raised: "#ffffff", link: "#16756a", accent: "#1f2d45", border: "#e2e8ee" };
const mark = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${48 + 2 * pad} ${48 + 2 * pad}">
<rect x="${-pad}" y="${-pad}" width="${48 + 2 * pad}" height="${48 + 2 * pad}" fill="${C.band}"/>
<circle cx="24" cy="24" r="15.5" fill="${C.raised}" stroke="${C.border}" stroke-width=".6"/>
<path d="M24 4.5a19.5 19.5 0 0 1 18.6 25.4" fill="none" stroke="${C.link}" stroke-width="4" stroke-linecap="round"/>
<path d="M24 32.5c-.4-4.6-3.4-7.8-8.2-8.6-.3 4.9 2.8 8.3 8.2 8.6z" fill="${C.link}"/>
<path d="M24 32.5c.2-6.4 3.6-10.6 9.4-11.6.4 6.1-3.2 10.6-9.4 11.6z" fill="${C.accent}"/>
<path d="M24 33.5v-6" stroke="${C.accent}" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const jobs = [
  ["icon-192.png", 192, 2], ["icon-512.png", 512, 2], ["apple-touch-icon.png", 180, 3],
  ["maskable-512.png", 512, 10], ["icon-1024.png", 1024, 3], ["adaptive-fg-1024.png", 1024, 14],
];
const b = await pw.chromium.launch();
const p = await b.newPage();
for (const [name, size, pad] of jobs) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${mark(pad)}`);
  await p.screenshot({ path: `${out}/${name}`, omitBackground: false });
}
await b.close();
console.log("ícones:", jobs.map((j) => j[0]).join(", "));
