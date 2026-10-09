// OmniFit end-to-end test: drives the real app like a user, desktop and phone.
//
// Needs the backend (port 8000) and frontend (port 5173) running, and uses the
// installed Microsoft Edge (no browser download). Real Gemma answers, so the
// stylist steps take 10-40 s each.
//
//   cd tests/e2e && npm install && npm test
//
// Prints one line per check and saves screenshots to tests/e2e/results/.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const APP = process.env.OMNIFIT_URL || "http://localhost:5173";
const RESULTS = join(here, "results");
const FIXTURES = join(here, "..", "ui", "fixtures");
const AI_TIMEOUT = 150_000;

mkdirSync(RESULTS, { recursive: true });

const results = [];
const check = async (name, fn) => {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail || "", seconds: (Date.now() - started) / 1000 });
    console.log(`✅ ${name} ${detail ? `- ${detail}` : ""}`);
  } catch (error) {
    results.push({ name, ok: false, detail: error.message.split("\n")[0], seconds: (Date.now() - started) / 1000 });
    console.log(`❌ ${name} - ${error.message.split("\n")[0]}`);
  }
};

const browser = await chromium.launch({
  channel: "msedge",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

const newPage = async (viewport) => {
  const context = await browser.newContext({
    viewport,
    geolocation: { latitude: 13.08, longitude: 80.27 },
    permissions: ["geolocation"],
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
  });
  const page = await context.newPage();
  page.consoleErrors = [];
  page.on("console", (message) => {
    // Failed product images from store CDNs are not app errors, and MediaPipe
    // prints its own "INFO:" start-up lines as console errors
    if (message.type() === "error" && !/Failed to load resource|^INFO:/.test(message.text())) {
      page.consoleErrors.push(message.text());
    }
  });
  return page;
};

const lastBot = (page) => page.locator(".msg.bot").last();

// ------------------------------------------------------------
// Desktop
// ------------------------------------------------------------

const page = await newPage({ width: 1366, height: 900 });
await page.goto(`${APP}/#stylist`);

await check("Welcome screen", async () => {
  await page.getByText("are we dressing for today").waitFor();
  const starters = await page.locator(".starter").count();
  const tabs = await page.locator(".app-nav-item").count();
  if (starters !== 6 || tabs !== 5) throw new Error(`${starters} starters, ${tabs} nav items`);
  if (!(await page.locator("#styling-question").isVisible())) throw new Error("no composer");
  await page.screenshot({ path: join(RESULTS, "01-welcome.png") });
  return "6 starters, 5 nav items (Home, Explore, Stylist orb, Try-On, You), composer";
});

await check("Starters are written by the AI for today", async () => {
  await page.locator(".starters-note").waitFor({ timeout: 45_000 });
  const texts = await page.locator(".starter").allInnerTexts();
  if (texts.length !== 6) throw new Error(`${texts.length} starters`);
  if (!texts.some((text) => /What can I wear with this/.test(text))) throw new Error("the photo starter is gone");
  await page.screenshot({ path: join(RESULTS, "01-welcome.png") });
  return texts.slice(0, 5).map((text) => text.replace(/\s+/g, " ").trim()).join(" | ");
});

await check("AI understands and asks one question", async () => {
  await page.locator("#styling-question").fill("I'm going to my cousin's wedding reception, I'm a woman, budget 5000");
  await page.keyboard.press("Enter");
  await lastBot(page).locator(".understood-chips").waitFor({ timeout: AI_TIMEOUT });
  const chips = await lastBot(page).locator(".understood-chips span").allInnerTexts();
  const options = lastBot(page).locator(".question-options button");
  await options.first().waitFor({ timeout: 10_000 }).catch(() => {});
  return `understood: ${chips.join(" · ")}; options: ${(await options.allInnerTexts()).join(" / ") || "(no question needed)"}`;
});

await check("Stylist answers with looks and products", async () => {
  const options = lastBot(page).locator(".question-options button");
  if (await options.count()) {
    await options.first().click();
  }
  await page.getByText("are just below").last().waitFor({ timeout: AI_TIMEOUT });
  // Looks show their products on the look board; item suggestions as product cards
  await page.locator(".results .product-card, .results .board-tile img").first().waitFor({ timeout: 30_000 });
  const looks = await page.locator(".outfit-option h3, .option-card h3").allInnerTexts();
  await page.screenshot({ path: join(RESULTS, "02-stylist-answer.png"), fullPage: true });
  return `${looks.length} suggestions: ${looks.join(" / ")}`;
});

await check("AI writes the next steps, and tapping one edits the looks", async () => {
  const chips = lastBot(page).locator(".next-steps button");
  await chips.first().waitFor({ timeout: 10_000 });
  const steps = (await chips.allInnerTexts()).map((text) => text.replace(/^✦\s*/, ""));
  if (steps.length < 3) throw new Error(`${steps.length} next steps`);
  const before = await page.locator(".msg.bot").count();
  await chips.first().click();
  await page.locator(".send-button .spinner").waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  await page.locator(".send-button .spinner").waitFor({ state: "detached", timeout: AI_TIMEOUT });
  if ((await page.locator(".msg.bot").count()) <= before) throw new Error("no answer to the tapped step");
  const note = await lastBot(page).locator(".bot-note").allInnerTexts();
  return `${steps.join(" | ")}; tapped the first → ${note.join(" ") || "new answer"}`;
});

await check("Refinement keeps the context", async () => {
  await page.locator("#styling-question").fill("make it lighter, it's very hot here");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".showing-below, .show-again").length >= 3, null, { timeout: AI_TIMEOUT });
  const pieces = await page.locator(".outfit-option .outfit-piece h4").allInnerTexts();
  const showAgain = await page.locator(".show-again").count();
  if (!showAgain) throw new Error("no 'Show again' on the earlier answer");
  return `new pieces: ${pieces.slice(0, 4).join(", ")}…`;
});

await check("Conversation survives a refresh", async () => {
  const before = await page.locator(".msg").count();
  await page.reload();
  await page.locator(".msg").first().waitFor();
  const after = await page.locator(".msg").count();
  if (after !== before) throw new Error(`${before} messages before, ${after} after`);
  return `${after} messages kept`;
});

await check("Plain search goes straight to products", async () => {
  await page.getByRole("button", { name: /New chat/ }).click();
  await page.locator("#styling-question").fill("white sneakers");
  const started = Date.now();
  await page.keyboard.press("Enter");
  await page.locator(".browse-card").waitFor({ timeout: 20_000 });
  const picks = await page.locator(".browse-card .ai-badge").innerText();
  return `${picks.trim()} in ${((Date.now() - started) / 1000).toFixed(1)} s`;
});

await check("Explore search goes to the stylist", async () => {
  await page.getByRole("tab", { name: /Explore/ }).click();
  await page.locator(".explore-search input").fill("linen shirts men");
  await page.keyboard.press("Enter");
  await page.locator(".browse-card").waitFor({ timeout: 30_000 });
  const url = page.url();
  if (!url.includes("#stylist")) throw new Error(`stayed on ${url}`);
  return `${(await page.locator(".browse-card .ai-badge").innerText()).trim()} on the Stylist page`;
});

await check("Home look feed, with a reason on every card", async () => {
  await page.getByRole("tab", { name: /Home/ }).click();
  await page.locator(".look-card[data-look-id]").first().waitFor({ timeout: 30_000 });
  const looks = await page.locator(".look-card[data-look-id]").count();
  const reasons = await page.locator(".look-card[data-look-id] .look-why").allInnerTexts();
  const specials = await page.locator(".feed-special").count();
  if (looks < 4) throw new Error(`${looks} looks`);
  if (reasons.some((reason) => reason.replace(/[✦\s]|Why\?/g, "").length < 4)) throw new Error("a card has no reason");
  await page.screenshot({ path: join(RESULTS, "03-home-feed.png") });
  return `${looks} looks + ${specials} other cards; first reason: "${reasons[0].replace(/\s*Why\?$/, "")}"`;
});

await check("Love, Why? and Shop the look", async () => {
  const card = page.locator(".look-card[data-look-id]").first();
  await card.getByRole("button", { name: "Love", exact: true }).click();
  if ((await card.getByRole("button", { name: "Unlove", exact: true }).getAttribute("aria-pressed")) !== "true") throw new Error("love didn't stick");
  await card.locator(".look-why").click();
  await card.getByText("Why am I seeing this?").waitFor();
  await card.locator(".shop-look").click();
  await page.locator(".product-sheet").waitFor();
  const pieces = await page.locator(".sheet-pieces li").count();
  const prices = await page.locator(".sheet-store").allInnerTexts();
  await page.screenshot({ path: join(RESULTS, "04-shop-the-look.png") });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  if (pieces < 2 || !prices.every((price) => /₹/.test(price))) throw new Error(`${pieces} pieces`);
  return `${pieces} pieces with prices (e.g. ${prices[0]})`;
});

await check("Explore has today's page, written by the AI", async () => {
  await page.getByRole("tab", { name: /Explore/ }).click();
  await page.locator(".today-card").waitFor({ timeout: AI_TIMEOUT });
  const greeting = await page.locator(".foryou .foryou-header h1").innerText();
  const ideas = await page.locator(".idea-card").count();
  const festivals = await page.locator(".festival-chip").count();
  if (ideas !== 3) throw new Error(`${ideas} ideas`);
  return `"${greeting}"; ${ideas} ideas, ${festivals} festivals`;
});

await check("Style DNA shows what was learned", async () => {
  await page.locator(".app-nav-item", { hasText: "You" }).click();
  await page.locator(".dna-grid").waitFor();
  const items = await page.locator(".dna-item").allInnerTexts();
  await page.screenshot({ path: join(RESULTS, "05-style-dna.png") });
  const learned = items.filter((item) => !/Not set|Any budget|works it out/i.test(item)).length;
  return `${items.length} fields, ${learned} filled (e.g. ${items.find((item) => /Budget/i.test(item))?.replace(/\n/g, ": ")})`;
});

await check("Style Scan asks for consent first", async () => {
  await page.locator(".dna-actions").getByRole("button", { name: /Style Scan/ }).click();
  await page.getByText("I agree, open the camera").waitFor();
  await page.getByRole("button", { name: "Close Style Scan" }).click();
  return "consent screen shown";
});

await check("Body Scan measures on the device", async () => {
  await page.locator(".dna-actions").getByRole("button", { name: /Body Scan/ }).click();
  await page.locator(".scan-dialog input[type=number]").fill("168");
  await page.locator(".scan-dialog input[type=file]").setInputFiles(join(FIXTURES, "outfit-sample.jpg"));
  // Either measurements or a clear reason (the sample photo may not show a full body)
  await page.waitForFunction(
    () => document.querySelector(".scan-dialog .measure-static, .scan-dialog .inline-error"),
    null,
    { timeout: 90_000 }
  );
  const text = await page.locator(".scan-dialog .measure-static, .scan-dialog .inline-error").first().innerText();
  await page.screenshot({ path: join(RESULTS, "06-body-scan.png") });
  await page.getByRole("button", { name: "Close Body Scan" }).click();
  if (/couldn't start/i.test(text)) throw new Error(text);
  return `MediaPipe ran: "${text}"`;
});

await check("No console errors (desktop)", async () => {
  if (page.consoleErrors.length) throw new Error(page.consoleErrors.slice(0, 3).join(" | "));
  return "none";
});

// ------------------------------------------------------------
// Phone
// ------------------------------------------------------------

const phone = await newPage({ width: 390, height: 844 });
await phone.goto(`${APP}/#stylist`);

await check("Phone layout", async () => {
  await phone.getByText("are we dressing for today").waitFor();
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const tabBar = await phone.locator(".app-nav").boundingBox();
  const composer = await phone.locator(".composer").boundingBox();
  await phone.screenshot({ path: join(RESULTS, "07-phone.png") });
  if (overflow) throw new Error("page scrolls sideways");
  if (!tabBar || tabBar.y < 700) throw new Error(`tab bar at y=${tabBar?.y}, expected at the bottom`);
  const orb = await phone.locator(".app-nav-item.orb .app-nav-icon").boundingBox();
  if (!orb || orb.y > tabBar.y) throw new Error("the Stylist orb isn't raised above the bar");
  if (!composer || composer.y + composer.height > tabBar.y) throw new Error("composer hidden behind the tab bar");
  return "no sideways scroll, tab bar at the bottom with the raised orb, composer above it";
});

await check("No console errors (phone)", async () => {
  if (phone.consoleErrors.length) throw new Error(phone.consoleErrors.slice(0, 3).join(" | "));
  return "none";
});

await browser.close();

const passed = results.filter((result) => result.ok).length;
console.log(`\n${passed}/${results.length} checks passed. Screenshots: ${RESULTS}`);
process.exit(passed === results.length ? 0 : 1);

