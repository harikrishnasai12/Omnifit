// A watchable demo of My 3D mannequin, in a visible Edge window.
//
// Uploads one photo, builds the mannequin, puts a catalogue product on it,
// turns it, tries other sizes, and then leaves the window open for you to
// turn the mannequin yourself. A caption at the top says what is happening.
// Runs as a guest: nothing is saved to any profile.
//
// Needs the backend (8000) and the frontend dev server (5173).
//
//   cd tests/e2e && node mannequin_demo.mjs <photo.jpg> [height cm] [product search] [men|women]

import { chromium } from "playwright";

const APP = process.env.OMNIFIT_URL || "http://localhost:5173";
const [photo, height = "170", kind = "top women", figure = ""] = process.argv.slice(2);
if (!photo) {
  console.log("Usage: node mannequin_demo.mjs <photo.jpg> [height cm] [product search] [men|women]");
  process.exit(1);
}

const response = await fetch(`${APP}/api/browse`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ question: kind, region: "IN", personalize: false }),
});
const product = ((await response.json()).products || []).find((item) => item.image);

const browser = await chromium.launch({ channel: "msedge", headless: false, slowMo: 250, args: ["--start-maximized"] });
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();

const say = async (text, seconds = 2.5) => {
  console.log(text);
  await page.evaluate((message) => {
    let banner = document.getElementById("demo-caption");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "demo-caption";
      banner.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:9999;max-width:min(92vw,760px);" +
        "padding:12px 20px;border-radius:14px;background:#221a3d;color:#fff;font:600 16px/1.4 system-ui,sans-serif;" +
        "box-shadow:0 10px 30px rgba(0,0,0,.35);text-align:center;pointer-events:none";
      document.body.append(banner);
    }
    banner.textContent = message;
  }, text).catch(() => {});
  await page.waitForTimeout(seconds * 1000);
};

await page.goto(`${APP}/#home`);
await page.evaluate((item) => sessionStorage.setItem("omnifit.tryon.product", JSON.stringify(item)), product);
await page.goto(`${APP}/#tryon`);
await page.locator(".mannequin-capture").waitFor({ timeout: 30_000 });
await say("Step 1 of 6: the Try-On page. A product is already chosen; now the shopper's photo.");

await page.locator('.mannequin-capture input[data-view="front"]').setInputFiles(photo);
await page.locator(".mannequin-photo.filled").scrollIntoViewIfNeeded();
await say("Step 2 of 6: a front photo is added (side and back are optional).");
await page.locator(".mannequin-height input").fill(height);
await say(`The shopper's height: ${height} cm. It sets the scale for every measurement.`);

await page.locator(".mannequin-capture .primary-button").scrollIntoViewIfNeeded();
await page.locator(".mannequin-capture .primary-button").click({ noWaitAfter: true });
await say("Step 3 of 6: checking the photo and measuring, on this device…", 1);
await page.waitForFunction(
  () => document.querySelector(".mannequin-stage canvas") || document.querySelector(".mannequin-capture .inline-error"),
  null,
  { timeout: 180_000 }
);
const refused = await page.locator(".mannequin-capture .inline-error").innerText().catch(() => "");
if (refused) {
  await say(`The photo was refused: ${refused}`, 20);
  await browser.close();
  process.exit(1);
}

await page.locator(".mannequin-stage").scrollIntoViewIfNeeded();
await page.locator(".mannequin-fit").waitFor({ timeout: 120_000 }).catch(() => {});
if (figure === "men" || figure === "women") {
  await page.locator(".mannequin-section button", { hasText: figure === "women" ? "Women" : "Men" }).click({ noWaitAfter: true });
}
await say("Step 4 of 6: the mannequin, built to the measured sizes, with the face from the photo and the product on it.", 4);

for (const [view, words] of [["Side", "From the side."], ["Back", "From the back (estimated from the front photo)."], ["Front", "And the front again."]]) {
  await page.locator(".mannequin-turn button", { hasText: view }).click({ noWaitAfter: true });
  await say(`Step 5 of 6: turning it. ${words}`, 3);
}

const sizes = page.locator(".mannequin-fit .size-options button");
const count = await sizes.count();
if (count > 2) {
  await page.locator(".mannequin-fit").scrollIntoViewIfNeeded();
  await sizes.first().click({ noWaitAfter: true });
  await say(`Step 6 of 6: the smallest size. ${(await page.locator(".mannequin-verdict").innerText()).split(".")[0]}.`, 4);
  await sizes.last().click({ noWaitAfter: true });
  await say(`The largest size. ${(await page.locator(".mannequin-verdict").innerText()).split(".")[0]}.`, 4);
  await page.locator(".mannequin-fit .size-options button.mine").first().click({ noWaitAfter: true }).catch(() => {});
  await say(`Back to the best size on the chart. ${(await page.locator(".mannequin-verdict").innerText()).split(".")[0]}.`, 3);
}

await page.locator(".mannequin-stage").scrollIntoViewIfNeeded();
await say("Your turn: drag the mannequin to turn it, pick sizes, correct a measurement. Close this window when you're done.", 1);

// Stays open until the window is closed (or 30 minutes pass)
await Promise.race([page.waitForEvent("close", { timeout: 0 }), new Promise((resolve) => setTimeout(resolve, 30 * 60 * 1000))]);
await browser.close().catch(() => {});
