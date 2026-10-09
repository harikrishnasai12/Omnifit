// The Community screens in a real browser, with two throwaway accounts
// (removed at the end):
//   A publishes an outfit (through the API)
//   B opens Community -> sees A and the outfit -> follows A -> opens the outfit
//     -> saves it -> Get This Look -> publishes an outfit of their own in the
//     composer -> Try This Look hands the pieces to the Try-On page
// Adapt This Look (Gemma) is checked by backend/tests/social_network.py.
// Pictures go to results/social/.
//
// Needs the backend (8000) and the frontend dev server (5173).
//   cd tests/e2e && node social_check.mjs

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const APP = process.env.OMNIFIT_URL || "http://localhost:5173";
const OUT = join(here, "results", "social");
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` - ${detail}` : ""}`);
};

const browser = await chromium.launch({ channel: "msedge" });
const signUp = async (name) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const response = await context.request.post(`${APP}/api/auth/register`, {
    data: { email: `social-ui-${name.toLowerCase()}-${Date.now()}@example.com`, password: "test-password-123", name, consent: true },
  });
  return { context, id: (await response.json()).user.id };
};
const firstProduct = async (context, question) => {
  const response = await context.request.post(`${APP}/api/browse`, { data: { question, region: "IN", personalize: false, colour: "all" } });
  return (await response.json()).products.find((product) => product.image);
};

const a = await signUp("Asha");
const b = await signUp("Bala");
const errors = [];

try {
  const picks = [await firstProduct(a.context, "t-shirt men"), await firstProduct(a.context, "jeans men"), await firstProduct(a.context, "sneakers men")];
  const published = await (await a.context.request.post(`${APP}/api/social/outfits`, {
    data: { title: "Weekend basics", description: "Easy and clean", tags: ["casual"], items: picks.map((product) => ({ product_id: product.id })) },
  })).json();
  const outfitId = published.outfit.id;

  const page = await b.context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource|^INFO:/.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`page error: ${error.message}`));

  // Explore -> Community tab
  await page.goto(`${APP}/#explore`);
  await page.getByRole("tab", { name: /Community/ }).click();
  const card = page.locator(`.outfit-card[data-outfit-id="${outfitId}"]`);
  await card.waitFor({ timeout: 20_000 });
  check("Community shows A's outfit", await card.locator("img").count() === 3);
  const person = page.locator(".social-people li", { hasText: "Asha" }).first();
  check("Community suggests A as someone to follow", await person.count() === 1);
  await page.screenshot({ path: join(OUT, "1-discover.png") });

  // Follow A, from her profile
  await person.locator(".social-person").click();
  await page.locator(".social-profile h1", { hasText: "Asha" }).waitFor();
  await page.locator(".social-profile .follow-button").click();
  await page.locator(".social-profile .follow-button.on").waitFor();
  check("B follows A on her profile", /1\s*follower/.test(await page.locator(".social-profile p").innerText()), await page.locator(".social-profile p").innerText());
  check("Her profile shows nothing private", !/@example\.com|measure|wardrobe/i.test(await page.locator(".social").innerText()));
  await page.screenshot({ path: join(OUT, "2-profile.png") });

  // Open the outfit, save it, get the look
  await page.locator(`.outfit-card[data-outfit-id="${outfitId}"] .outfit-collage`).click();
  await page.locator(".outfit-detail h1", { hasText: "Weekend basics" }).waitFor();
  await page.getByRole("button", { name: /Save/ }).click();
  await page.getByRole("button", { name: /Saved/ }).waitFor();
  check("B saves the outfit", true);
  await page.getByRole("button", { name: /Get This Look/ }).click();
  await page.locator(".outfit-look .product-card").first().waitFor({ timeout: 20_000 });
  const cards = await page.locator(".outfit-look .product-card").count();
  check("Get This Look shows the real products with Add to cart", cards === 3 && await page.locator(".outfit-look .add-to-cart").count() >= 3, `${cards} products`);
  await page.screenshot({ path: join(OUT, "3-outfit-look.png"), fullPage: true });
  check("Adapt This Look opens with ideas", await (async () => {
    await page.getByRole("button", { name: /Adapt This Look/ }).click();
    return (await page.locator(".adapt-ideas button").count()) === 5;
  })());

  // Try This Look: the wearable pieces arrive on the Try-On page
  await page.getByRole("button", { name: /Try This Look/ }).click();
  await page.locator(".tryon-product").first().waitFor({ timeout: 20_000 });
  const handed = await page.locator(".tryon-product").count();
  check("Try This Look hands the outfit's clothes to Try-On", handed >= 2 && page.url().includes("#tryon"), `${handed} products`);
  await page.screenshot({ path: join(OUT, "4-tryon.png") });

  // B publishes an outfit in the composer
  await page.goto(`${APP}/#community/new`);
  for (const search of ["kurta men", "jeans men"]) {
    await page.getByLabel("Search the catalogue").fill(search);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.locator(".compose-product:not(.picked)").first().click({ timeout: 20_000 });
  }
  await page.locator(".compose-chosen li").nth(1).getByRole("button", { name: /^Move .* up$/ }).click();
  await page.getByLabel("Title").fill("Festive and easy");
  await page.getByLabel(/Tags/).fill("festive, kurta");
  await page.screenshot({ path: join(OUT, "5-compose.png"), fullPage: true });
  await page.getByRole("button", { name: "Publish outfit" }).click();
  await page.locator(".outfit-detail h1", { hasText: "Festive and easy" }).waitFor({ timeout: 20_000 });
  check("B publishes an outfit from the composer", (await page.locator(".outfit-tags span").count()) === 2);

  await page.goto(`${APP}/#community/me`);
  await page.locator(".social-profile h1", { hasText: "Bala" }).waitFor();
  const sections = await page.locator(".social-section").allInnerTexts();
  check("My outfits: the one B published and the one B saved", /Festive and easy/.test(sections[0]) && /Weekend basics/.test(sections[1]));
  await page.screenshot({ path: join(OUT, "6-me.png"), fullPage: true });

  // Phone width: nothing runs off the side
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${APP}/#community/o/${outfitId}`);
  await page.locator(".outfit-detail h1").waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("The outfit page fits a phone", overflow <= 1, `${overflow}px over`);
  await page.screenshot({ path: join(OUT, "7-phone.png") });

  check("No errors in the browser console", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  for (const person of [a, b]) await person.context.request.delete(`${APP}/api/account`).catch(() => {});
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed.\nPictures: ${OUT}`);
process.exit(passed === results.length ? 0 : 1);
