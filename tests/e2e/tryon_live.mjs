// Live Try-On with the REAL camera and a real person in front of it.
//
// Opens a visible Edge window on the Try-On page with a product ready and
// presses the page's start button; the person answers Edge's camera
// permission prompt. Then, for a few products, it records what the engine does: the hint shown,
// frames per second, how much of the picture the garment covers, and a
// picture of the stage. Everything stays on this computer, in
// results/tryon-live/. The camera is closed at the end.
//
//   cd tests/e2e && node tryon_live.mjs

import { chromium } from "playwright";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const APP = process.env.OMNIFIT_URL || "http://localhost:5173";
const OUT = join(here, "results", "tryon-live");
const LOG = join(OUT, "log.jsonl");
const KINDS = (process.argv[2] || "t-shirt men,shirt men,hoodie men,cap").split(",");
const SAMPLES = 4;

mkdirSync(OUT, { recursive: true });
writeFileSync(LOG, "");
const log = (entry) => {
  appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
  console.log(JSON.stringify(entry));
};

const products = [];
for (const kind of KINDS) {
  const response = await fetch(`${APP}/api/browse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: kind, region: "IN", personalize: false }),
  });
  const product = ((await response.json()).products || []).find((item) => item.image);
  if (product) products.push({ kind, product });
}

// Real camera, and the browser's real permission prompt
const browser = await chromium.launch({ channel: "msedge", headless: false });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error" && !/Failed to load resource|^INFO:/.test(message.text())) errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(`page error: ${error.message}`));
// The page reports every camera failure with one sentence; keep the real cause
await page.addInitScript(() => {
  window.__camera = [];
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    try {
      const stream = await original(constraints);
      window.__camera.push({ ok: true, tracks: stream.getVideoTracks().map((track) => track.label) });
      return stream;
    } catch (error) {
      window.__camera.push({ ok: false, name: error.name, message: error.message });
      throw error;
    }
  };
});

await page.goto(APP);

for (const [index, { kind, product }] of products.entries()) {
  // The Try-On page picks the waiting product up once, when it opens
  await page.goto(`${APP}/#home`);
  await page.evaluate((item) => sessionStorage.setItem("omnifit.tryon.product", JSON.stringify(item)), product);
  await page.goto(`${APP}/#tryon`);
  // The page opens on the 3D mannequin; this test is for the live camera
  await page.getByRole("tab", { name: /Live camera/ }).click();

  // Gemma's reading and the cut-out
  await page.waitForFunction(
    () => document.querySelector(".tryon-facts") && !document.querySelector(".tryon-garment .cart-status"),
    null,
    { timeout: 120_000 }
  ).catch(() => {});
  const problem = await page.locator(".tryon .inline-error").innerText().catch(() => "");
  if (problem) {
    log({ kind, title: product.title, prepared: false, problem, camera: await page.evaluate(() => window.__camera), errors: errors.splice(0) });
    continue;
  }

  // The person at the camera asked for the page's buttons to be pressed for
  // them; the browser's own camera permission prompt is theirs to answer
  const pageState = () => page.evaluate(() => ({
    consent: Boolean(document.querySelector(".tryon-consent")),
    open: Boolean(document.querySelector(".tryon-open")),
    live: Boolean(document.querySelector(".tryon-live")),
    error: document.querySelector(".tryon .inline-error")?.innerText || "",
    preparing: document.querySelector(".tryon-garment .cart-status")?.innerText || "",
    facts: document.querySelector(".tryon-facts")?.innerText.replace(/\n/g, " · ") || "",
  }));
  const reached = await page.waitForFunction(
    () => document.querySelector(".tryon-consent .primary-button, .tryon-open, .tryon-live, .tryon .inline-error"),
    null,
    { timeout: 30_000 }
  ).catch(() => null);
  const before = await pageState();
  if (!reached) {
    await page.screenshot({ path: join(OUT, `stuck-${index + 1}.png`), fullPage: true });
    log({ kind, stuck: true, ...before, camera: await page.evaluate(() => window.__camera), errors: errors.splice(0) });
    break;
  }
  // Already live if the person pressed the start button themselves
  if (!before.live && !before.error) {
    await page.evaluate(() => document.querySelector(".tryon-consent .primary-button, .tryon-open")?.click());
  }
  if (index === 0) log({ waiting: "If Edge asks for camera permission, click Allow", ...before });
  // Live, or the page gave up
  await page.waitForFunction(
    () => {
      const video = document.querySelector(".tryon-live video");
      return (video && video.readyState >= 2 && video.videoWidth > 0) || document.querySelector(".tryon .inline-error");
    },
    null,
    { timeout: 600_000 }
  );
  const failed = await page.locator(".tryon .inline-error").innerText().catch(() => "");
  if (failed) {
    log({ kind, started: false, shown: failed, camera: await page.evaluate(() => window.__camera), errors: errors.splice(0) });
    break;
  }
  if (index === 0) log({ camera: "ON" });
  await page.locator(".tryon-stage").scrollIntoViewIfNeeded();
  await page.waitForTimeout(4000);

  for (let sample = 1; sample <= SAMPLES; sample += 1) {
    const state = await page.evaluate(() => {
      const canvas = document.querySelector(".tryon-stage canvas");
      const video = document.querySelector(".tryon-stage video");
      // How much of the picture the garment covers (sampled every 4th pixel)
      let drawn = 0;
      let total = 0;
      if (canvas.width) {
        const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        for (let offset = 3; offset < data.length; offset += 16) {
          total += 1;
          if (data[offset] > 32) drawn += 1;
        }
      }
      return {
        hint: document.querySelector(".tryon-hint")?.innerText || "",
        fps: Number(canvas.dataset.fps || 0),
        drawn: total ? Number((drawn / total).toFixed(3)) : 0,
        video: `${video.videoWidth}x${video.videoHeight}`,
      };
    });
    const picture = `${String(index + 1).padStart(2, "0")}-${kind.replace(/\W+/g, "-")}-${sample}.jpg`;
    await page.locator(".tryon-stage").screenshot({ path: join(OUT, picture), type: "jpeg", quality: 80 });
    log({ kind, title: product.title, sample, ...state, picture });
    await page.waitForTimeout(2500);
  }

  await page.getByRole("button", { name: /Close camera/ }).click({ noWaitAfter: true }).catch(() => {});
  await page.waitForTimeout(500);
}

log({ camera: "OFF", errors });
await browser.close();
