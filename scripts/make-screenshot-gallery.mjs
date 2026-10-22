import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../docs/screenshots/", import.meta.url);
const groups = ["1440", "768", "390", "print"];
const sections = [];
let count = 0;
for (const group of groups) {
  const files = (await readdir(new URL(`${group}/`, root)))
    .filter((name) => /^[a-z-]+\.png$/.test(name))
    .sort();
  count += files.length;
  sections.push(
    `<section><h2>${group === "print" ? "Print layouts" : `${group}px`}</h2><div class="grid">${files.map((name) => `<figure><a href="${join(group, name)}"><img loading="lazy" src="${join(group, name)}" alt="${name.replace(".png", "")} at ${group}" /></a><figcaption>${name.replace(".png", "")}</figcaption></figure>`).join("")}</div></section>`,
  );
}
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Taky Apartment Phase 1 screenshots</title><style>*{box-sizing:border-box}body{margin:0;padding:32px;background:#edf4fc;color:#172e4d;font:15px system-ui,sans-serif}main{max-width:1500px;margin:auto}h1{font-size:28px}p{line-height:1.7;color:#506582}a{color:#125eaa}section{margin-top:36px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}figure{margin:0;background:white;border:1px solid #d9e5f3;border-radius:9px;overflow:hidden}figure a{display:block;height:310px;overflow:auto;background:#e5edf8}img{display:block;width:100%;height:auto}figcaption{padding:13px 16px;font-weight:600}a:focus-visible{outline:3px solid #126ce0;outline-offset:3px}@media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){body{padding:18px}.grid{grid-template-columns:1fr}}</style></head><body><main><h1>Taky Apartment ERP · Phase 1</h1><p>${count} screenshots of the production frontend. Open any image for the full page.<br>Ten routes at 1440, 768 and 390px, the billing draft, payment dialog, and invoice/receipt print layouts.</p><p><a href="../../ERP-TakyApartment-UXUI-Reference.pdf">Approved UX/UI reference PDF</a> · <a href="../verification.md">Verification notes</a></p>${sections.join("")}</main></body></html>`;
await writeFile(new URL("index.html", root), html);
console.log(`Gallery created for ${count} screenshots.`);
