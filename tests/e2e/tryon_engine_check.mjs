// Why does the Try-On page say "The camera couldn't start"? The page shows
// one sentence for every failure, so this opens the real page on a fake
// camera feed, presses its start button, and records what happened at each
// step: the camera stream, the <video> starting, and the engine.
//
//   cd tests/e2e && node tryon_engine_check.mjs            # hidden window, fake camera
//   node tryon_engine_check.mjs headed                     # visible window, fake camera
//   node tryon_engine_check.mjs real                       # visible window, real camera

import { chromium } from "playwright";

const APP = process.env.OMNIFIT_URL || "http://localhost:5173";
// "real": a visible window, the real camera and Edge's real permission prompt
const real = process.argv[2] === "real";
const headed = real || process.argv[2] === "headed";
// "impatient": the camera takes 1.5 s to open and the start button is pressed twice
const impatient = process.argv[2] === "impatient";

const browser = await chromium.launch({
  channel: "msedge",
  headless: !headed,
  args: real ? [] : ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const consoleErrors = [];
page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
page.on("pageerror", (error) => consoleErrors.push(`page error: ${error.message}`));

await page.addInitScript(() => {
  window.__steps = [];
  const note = (step) => window.__steps.push(step);
  const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    try {
      // A real webcam takes a moment to open (and longer with a permission prompt)
      await new Promise((resolve) => setTimeout(resolve, window.__cameraDelay || 0));
      const stream = await getUserMedia(constraints);
      note("camera stream ok");
      return stream;
    } catch (error) {
      note(`camera stream FAILED ${error.name}: ${error.message}`);
      throw error;
    }
  };
  // The engine's drawing loop: an error there stops the try-on silently
  window.addEventListener("error", (event) => note(`error: ${event.message} (${String(event.filename).split("/").pop()}:${event.lineno})`));
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function wrapped() {
    note(`video.play() called, in the page: ${document.contains(this)}`);
    return play.call(this).then(
      () => note(`video playing ${this.videoWidth}x${this.videoHeight}`),
      (error) => {
        note(`video.play() FAILED ${error.name}: ${error.message}`);
        throw error;
      }
    );
  };
  window.addEventListener("unhandledrejection", (event) => note(`unhandled: ${event.reason?.name}: ${event.reason?.message}`));
});

const response = await fetch(`${APP}/api/browse`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ question: "t-shirt men", region: "IN", personalize: false }),
});
const product = ((await response.json()).products || []).find((item) => item.image);

await page.goto(`${APP}/#home`);
if (impatient) await page.evaluate(() => { window.__cameraDelay = 1500; });
await page.evaluate((item) => sessionStorage.setItem("omnifit.tryon.product", JSON.stringify(item)), product);
await page.goto(`${APP}/#tryon`);
// The page opens on the 3D mannequin; this checks the live camera
await page.getByRole("tab", { name: /Live camera/ }).click();
await page.waitForFunction(
  () => document.querySelector(".tryon-consent .primary-button, .tryon-open, .tryon .inline-error"),
  null,
  { timeout: 120_000 }
);
await page.evaluate(() => document.querySelector(".tryon-consent .primary-button, .tryon-open")?.click());
if (impatient) {
  // An impatient second press while the camera is still opening
  await page.waitForTimeout(400);
  const pressed = await page.evaluate(() => {
    const button = document.querySelector(".tryon-consent .primary-button, .tryon-open");
    if (button && !button.disabled) button.click();
    return Boolean(button && !button.disabled);
  });
  console.log(`second press while starting: ${pressed ? "accepted by the page" : "not possible (button gone or disabled)"}`);
}
await page.waitForFunction(
  () => document.querySelector(".tryon .inline-error") || document.querySelector(".tryon-stage canvas")?.dataset.fps,
  null,
  { timeout: 60_000 }
).catch(() => {});

console.log(JSON.stringify({
  steps: await page.evaluate(() => window.__steps),
  shown: await page.locator(".tryon .inline-error").innerText().catch(() => ""),
  live: await page.locator(".tryon-live").count(),
  fps: await page.evaluate(() => document.querySelector(".tryon-stage canvas")?.dataset.fps || null),
  hint: await page.locator(".tryon-hint").innerText().catch(() => ""),
  consoleErrors: consoleErrors.slice(0, 6),
}, null, 2));
await browser.close();
