// My 3D mannequin, end to end, with a catalogue model's photo standing in for
// the shopper (no camera, nobody's own photos):
//   product chosen -> front photo + height -> checks and measurements
//   -> the 3D mannequin with the garment on it -> each size's fit
// Prints what was measured and saves pictures of the mannequin from the
// front, side and back to results/mannequin/.
//
// Needs the backend (8000) and the frontend dev server (5173).
//
//   cd tests/e2e && node mannequin_check.mjs                      # a t-shirt
//   node mannequin_check.mjs "jeans men" 178                      # another product, another height

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const APP = process.env.OMNIFIT_URL || "http://localhost:5173";
const OUT = join(here, "results", "mannequin");
const KIND = process.argv[2] || "t-shirt men";
const HEIGHT = process.argv[3] || "175";
mkdirSync(OUT, { recursive: true });

const browse = async (question) => {
  const response = await fetch(`${APP}/api/browse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, region: "IN", personalize: false }),
  });
  return (await response.json()).products || [];
};

// The "shopper": a full-length, front-facing model from the catalogue
// (or any photo: PERSON_FILE=path/to/photo.jpg)
let person = { title: process.env.PERSON_FILE };
let personFile = process.env.PERSON_FILE;
if (!personFile) {
  person = (await browse("kurta men")).find((item) => item.image);
  personFile = join(OUT, "stand-in-front.jpg");
  writeFileSync(personFile, Buffer.from(await (await fetch(person.image.replace(/width=\d+/, "width=900"))).arrayBuffer()));
}
const product = (await browse(KIND)).find((item) => item.image);
const tag = KIND.replace(/\W+/g, "-");

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error" && !/Failed to load resource|^INFO:/.test(message.text())) errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(`page error: ${error.message}`));

await page.goto(`${APP}/#home`);
await page.evaluate((item) => sessionStorage.setItem("omnifit.tryon.product", JSON.stringify(item)), product);
await page.goto(`${APP}/#tryon`);

await page.locator(".mannequin-capture").waitFor({ timeout: 30_000 });
await page.locator('.mannequin-capture input[data-view="front"]').setInputFiles(personFile);
await page.locator(".mannequin-height input").fill(HEIGHT);
await page.locator(".mannequin-capture .primary-button").click({ noWaitAfter: true });

await page.waitForFunction(
  () => document.querySelector(".mannequin-stage canvas") || document.querySelector(".mannequin-capture .inline-error"),
  null,
  { timeout: 180_000 }
);
const refused = await page.locator(".mannequin-capture .inline-error").innerText().catch(() => "");
if (refused) {
  console.log(`Photo refused: ${refused}`);
  await browser.close();
  process.exit(1);
}

// The garment arrives once the product is read and cut out
await page.locator(".mannequin-fit").waitFor({ timeout: 120_000 }).catch(() => {});
await page.waitForTimeout(1500);

const report = await page.evaluate(() => ({
  measurements: Object.fromEntries(
    [...document.querySelectorAll(".mannequin-measures .measure-field")].map((field) => [
      field.querySelector("span").innerText, Number(field.querySelector("input").value),
    ])
  ),
  figure: document.querySelector('.mannequin-section [aria-checked="true"]')?.innerText || null,
  guessed: Boolean([...document.querySelectorAll(".mannequin-measures .measure-hint")].find((node) => /guessed/.test(node.innerText))),
  notes: [...document.querySelectorAll(".mannequin-measures .scan-notes li")].map((node) => node.innerText),
  sizes: [...document.querySelectorAll(".mannequin-fit .size-options button")].map((button) => button.innerText + (button.getAttribute("aria-checked") === "true" ? "*" : "")),
  verdict: document.querySelector(".mannequin-verdict")?.innerText || null,
  parts: [...document.querySelectorAll(".mannequin-parts li")].map((node) => node.innerText.replace(/\n/g, " · ")),
  message: [...document.querySelectorAll(".mannequin-side > .measure-hint, .mannequin-side > .inline-error, .tryon > .inline-error")].map((node) => node.innerText),
}));

for (const view of ["Front", "Side", "Back", "Face"]) {
  await page.locator(".mannequin-turn button", { hasText: view }).click({ noWaitAfter: true });
  await page.waitForTimeout(600);
  await page.locator(".mannequin-stage").screenshot({ path: join(OUT, `${tag}-${view.toLowerCase()}.png`) });
}

// Another size: the garment and the fit change with it
const other = page.locator(".mannequin-fit .size-options button").last();
let largest = null;
if (await other.count()) {
  await page.locator(".mannequin-turn button", { hasText: "Front" }).click({ noWaitAfter: true });
  await other.click({ noWaitAfter: true });
  await page.waitForTimeout(800);
  largest = await page.locator(".mannequin-verdict").innerText().catch(() => null);
  await page.locator(".mannequin-stage").screenshot({ path: join(OUT, `${tag}-largest-size.png`) });
}

console.log(JSON.stringify({ product: product.title, store: product.store, standIn: person.title, heightCm: Number(HEIGHT), ...report, largestSize: largest, errors }, null, 2));
console.log(`Pictures: ${OUT}`);
await browser.close();
