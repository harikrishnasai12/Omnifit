// Live Try-On audit: how much of the catalogue can actually be tried on?
//
// Picks a spread of real products (several kinds of garment, different
// brands), runs each through the app's own try-on pipeline in a real browser
// (Gemma's reading of the garment, the cut-out, the drawing on a stand-in
// person facing the camera and turned), and writes:
//   results/tryon-audit/index.html   every product: photo, cut-out, on the person, verdict
//   results/tryon-audit/report.json  the same as data
//
// Needs the backend (8000) and frontend dev server (5173) running. Each
// product not read before costs one Gemma call (5-15 s).
//
//   cd tests/e2e && npm run tryon-audit            # 2 products per kind
//   node tryon_audit.mjs 3                         # 3 per kind

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const APP = process.env.OMNIFIT_URL || "http://localhost:5173";
const OUT = join(here, "results", "tryon-audit");
const PER_KIND = Number(process.argv[2]) || 2;

// Plain searches the catalogue answers without the AI
const KINDS = [
  "t-shirt men", "shirt men", "kurta men", "blazer men", "hoodie men", "jeans men", "trousers men", "shorts men",
  "dress women", "kurta women", "top women", "skirt women", "saree", "jeans women", "sunglasses", "cap",
];

mkdirSync(OUT, { recursive: true });

const post = async (path, body) => {
  const response = await fetch(`${APP}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
};

// A spread: for each kind, products from different brands
const picked = [];
const seen = new Set();
for (const kind of KINDS) {
  const { data } = await post("/api/browse", { question: kind, region: "IN", personalize: false });
  const brands = new Set();
  let count = 0;
  for (const product of data?.products || []) {
    if (count === PER_KIND) break;
    if (!product.image || seen.has(product.id) || brands.has(product.store)) continue;
    seen.add(product.id);
    brands.add(product.store);
    picked.push({ kind, product });
    count += 1;
  }
  if (!count) console.log(`(no products found for "${kind}")`);
}
console.log(`Auditing ${picked.length} products from ${new Set(picked.map((item) => item.product.store)).size} brands…\n`);

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(APP);

const rows = [];
for (const { kind, product } of picked) {
  const row = { kind, id: product.id, title: product.title, store: product.store, image: product.image };
  const info = await post("/api/tryon/garment", { product_id: product.id });

  if (info.status === 422) {
    Object.assign(row, { verdict: "blocked", reasons: [info.data?.detail || "Not a kind of product the try-on draws"] });
  } else if (info.status !== 200) {
    // Gemma or the store's image host didn't answer: says nothing about the product
    Object.assign(row, { verdict: "skipped", reasons: [info.data?.detail || `HTTP ${info.status}`] });
  } else {
    row.garment = info.data.garment;
    const result = await page.evaluate(
      async ({ photo, garment }) => {
        const { auditGarment } = await import("/src/tryon/audit.js");
        return auditGarment(photo, garment);
      },
      { photo: info.data.photo, garment: info.data.garment }
    );
    Object.assign(row, result);
  }

  rows.push(row);
  const mark = { pass: "✅", partial: "🟡", fail: "❌", blocked: "⛔", skipped: "⏭" }[row.verdict];
  console.log(`${mark} ${kind.padEnd(14)} ${product.store.padEnd(16)} ${row.garment ? `${row.garment.region}/${row.source || "-"}` : ""} ${row.reasons.join("; ")}`);
}

await browser.close();

// ------------------------------------------------------------
// Report
// ------------------------------------------------------------

const judged = rows.filter((row) => row.verdict !== "skipped");
const count = (verdict, list = judged) => list.filter((row) => row.verdict === verdict).length;
const share = (number) => (judged.length ? `${Math.round((number / judged.length) * 100)}%` : "-");
const times = rows.filter((row) => row.ms).map((row) => row.ms).sort((a, b) => a - b);

const summary = {
  products: rows.length,
  judged: judged.length,
  pass: count("pass"),
  partial: count("partial"),
  fail: count("fail"),
  blocked: count("blocked"),
  skipped: rows.length - judged.length,
  median_cut_ms: times.length ? times[Math.floor(times.length / 2)] : null,
  by_kind: Object.fromEntries(
    KINDS.map((kind) => {
      const list = judged.filter((row) => row.kind === kind);
      return [kind, { pass: count("pass", list), partial: count("partial", list), fail: count("fail", list), blocked: count("blocked", list) }];
    })
  ),
};

writeFileSync(
  join(OUT, "report.json"),
  JSON.stringify({ summary, rows: rows.map(({ cut, front, side, ...rest }) => rest) }, null, 2)
);

const escape = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const LABELS = { pass: "Works", partial: "Works with limits", fail: "Doesn't work", blocked: "Not offered", skipped: "Not tested" };

writeFileSync(
  join(OUT, "index.html"),
  `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Live Try-On audit</title>
<style>
  body { margin: 0; padding: 24px; font: 14px/1.45 system-ui, sans-serif; color: #16131f; background: #fbf9f6; }
  h1 { margin: 0 0 4px; font-size: 24px; }
  .lede { margin: 0 0 20px; color: #766f86; max-width: 70ch; }
  .tiles { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
  .tile { padding: 12px 16px; border: 1px solid #e8e4ee; border-radius: 12px; background: #fff; }
  .tile b { display: block; font-size: 26px; }
  .row { display: grid; grid-template-columns: 150px 150px 150px 150px minmax(200px, 1fr); gap: 12px; align-items: start;
         padding: 14px 0; border-top: 1px solid #e8e4ee; }
  .row img { width: 150px; height: 200px; object-fit: contain; border-radius: 8px; background: #f1eef6; }
  .row img.cut { background: repeating-conic-gradient(#e8e4ee 0% 25%, #fff 0% 50%) 50% / 16px 16px; }
  .none { width: 150px; height: 200px; display: grid; place-items: center; border-radius: 8px; background: #f1eef6; color: #766f86; }
  .verdict { display: inline-block; padding: 2px 10px; border-radius: 999px; font-weight: 700; font-size: 12.5px; }
  .pass { background: #e2f4ea; color: #1f7a52; } .partial { background: #fff4dc; color: #8a5a00; }
  .fail, .blocked { background: #fdeced; color: #c0262d; } .skipped { background: #f1eef6; color: #766f86; }
  small { color: #766f86; } ul { margin: 6px 0 0; padding-left: 18px; }
  .head { color: #766f86; font-size: 12px; font-weight: 700; border: none; padding-bottom: 6px; }
  @media (max-width: 900px) { .row { grid-template-columns: repeat(2, 150px); } .head { display: none; } }
</style>
<h1>Live Try-On audit</h1>
<p class="lede">${rows.length} catalogue products run through the app's own try-on: Gemma's reading of the garment, the
cut-out from the store's photo, then drawn on a stand-in person facing the camera and turned ${40}°.
The verdicts are automatic checks; look at the pictures to judge how good each one is.</p>
<div class="tiles">
  <div class="tile"><b>${summary.pass} <small>(${share(summary.pass)})</small></b>Work</div>
  <div class="tile"><b>${summary.partial} <small>(${share(summary.partial)})</small></b>Work with limits</div>
  <div class="tile"><b>${summary.fail} <small>(${share(summary.fail)})</small></b>Don't work</div>
  <div class="tile"><b>${summary.blocked}</b>Not offered</div>
  <div class="tile"><b>${summary.skipped}</b>Not tested</div>
  <div class="tile"><b>${summary.median_cut_ms ?? "-"} ms</b>Typical cut-out time</div>
</div>
<div class="row head"><span>Store photo</span><span>Cut-out</span><span>Facing the camera</span><span>Turned</span><span>Result</span></div>
${rows
  .map(
    (row) => `<div class="row">
  <img src="${escape(row.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">
  ${row.cut ? `<img class="cut" src="${row.cut}" alt="">` : `<span class="none">no cut-out</span>`}
  ${row.front ? `<img src="${row.front}" alt="">` : `<span class="none">-</span>`}
  ${row.side ? `<img src="${row.side}" alt="">` : `<span class="none">-</span>`}
  <div>
    <span class="verdict ${row.verdict}">${LABELS[row.verdict]}</span>
    <div><b>${escape(row.title)}</b></div>
    <small>${escape(row.store)} · searched as “${escape(row.kind)}”${
      row.garment ? ` · read as ${escape(row.garment.garment)} (${row.garment.region}, ${row.garment.view} view, ${escape(row.source || "-")})` : ""
    }${row.ms ? ` · ${row.ms} ms` : ""}</small>
    ${row.reasons.length ? `<ul>${row.reasons.map((reason) => `<li>${escape(reason)}</li>`).join("")}</ul>` : ""}
  </div>
</div>`
  )
  .join("\n")}
`
);

console.log(
  `\n${summary.judged} judged: ${summary.pass} work (${share(summary.pass)}), ${summary.partial} work with limits (${share(summary.partial)}), ` +
    `${summary.fail} don't (${share(summary.fail)}), ${summary.blocked} not offered; ${summary.skipped} not tested.` +
    `\nTypical cut-out time ${summary.median_cut_ms ?? "-"} ms. Report: ${join(OUT, "index.html")}`
);
