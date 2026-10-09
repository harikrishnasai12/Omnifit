// Three people use OmniFit at different times: a recorded, real run.
//
// Each persona gets their own browser (phone size), city, test date and
// account, and goes through the app like a real user. Every screen is
// screenshotted, and the backend's "Behind the scenes" trace for each step
// is saved, so the run can be shown as a journey (see personas.json).
//
// Needs: backend with OMNIFIT_DEV_MODE=1 (port 8000), frontend (port 5173).
//   cd tests/e2e && npm run personas
// Results: tests/e2e/results/personas/. The throwaway accounts are deleted at the end.

import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const APP = process.env.OMNIFIT_URL || "http://localhost:5173";
const RESULTS = join(here, "results", "personas");
const AI_TIMEOUT = 240_000;
mkdirSync(RESULTS, { recursive: true });

const PERSONAS = [
  {
    id: "arjun",
    name: "Arjun",
    age: 21,
    city: "Chennai",
    geo: { latitude: 13.08, longitude: 80.27 },
    date: "2026-10-06",
    when: "Tuesday morning, before college",
    trend: "Gen Z streetwear on a student budget",
    section: "men",
    ageGroup: "gen_z",
    startsAsGuest: true,
    chats: ["I'm 21, a guy, need a casual outfit for college, under 1500"],
    // Both photo routes: one from the gallery, one with the camera
    photos: [
      { kind: "upload", file: "outfit-sample.jpg", message: "What can I wear with this?" },
      { kind: "camera", file: "outfit-camera.jpg", message: "Is this good for college? What should I add?" },
    ],
    loveStyle: "streetwear",
    notMe: null,
  },
  {
    id: "priya",
    name: "Priya",
    age: 32,
    city: "Bengaluru",
    geo: { latitude: 12.97, longitude: 77.59 },
    date: "2026-10-14",
    when: "Wednesday evening, after work",
    trend: "Office wear, and her sister's wedding in December",
    section: "women",
    ageGroup: "millennial",
    startsAsGuest: false,
    chats: ["My sister's wedding is on 14 December, I'm a woman. What should I wear for the sangeet? Budget 6000"],
    loveOccasion: "wedding",
    notMe: null,
  },
  {
    id: "meena",
    name: "Meena",
    age: 50,
    city: "Delhi",
    geo: { latitude: 28.61, longitude: 77.21 },
    date: "2026-11-03",
    when: "Weekend morning, 5 days before Diwali",
    trend: "Ethnic and festive, chats in Hinglish",
    section: "women",
    ageGroup: "gen_x",
    startsAsGuest: false,
    chats: ["Diwali ke liye kuch traditional batao, main 50 saal ki hoon, budget 4000"],
    loveStyle: "ethnic",
    notMe: "colour",
  },
];

const FIXTURES = join(here, "..", "ui", "fixtures");
// The camera shows this photo (make it with make_camera_feed.py)
const CAMERA_FEED = join(FIXTURES, "outfit-camera.y4m");

// `node personas.mjs arjun` re-records only Arjun and keeps the others
const only = process.argv.slice(2);
const browser = await chromium.launch({
  channel: "msedge",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${CAMERA_FEED}`],
});
const run = { recorded_at: new Date().toISOString(), app: "OmniFit Live", personas: [] };

for (const persona of PERSONAS.filter((p) => !only.length || only.includes(p.id))) {
  console.log(`\n=== ${persona.name} (${persona.city}, ${persona.date}) ===`);
  const devHeaders = { "x-omnifit-persona": persona.id, "x-omnifit-dev-date": persona.date };
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    geolocation: persona.geo,
    permissions: ["geolocation", "camera"],
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
  });
  // The persona and test date go only to OmniFit's own API
  await context.route("**/api/**", (route) =>
    route.continue({ headers: { ...route.request().headers(), ...devHeaders } })
  );
  const page = await context.newPage();
  const request = context.request;
  const call = (method, path, data) =>
    request.fetch(`${APP}${path}`, { method, data, headers: { ...devHeaders, "content-type": "application/json" } })
      .then((response) => response.json());

  const record = { ...persona, steps: [], account: null };
  let lastTraceId = 0;
  let shot = 0;

  const traces = async () => {
    const { traces: found } = await call("GET", `/api/dev/trace?since=${lastTraceId}&persona=${persona.id}`);
    if (found.length) lastTraceId = found.at(-1).id;
    return found.filter((trace) => !trace.path.startsWith("/api/dev/"));
  };
  const screenshot = async (label) => {
    shot += 1;
    const file = `${persona.id}-${String(shot).padStart(2, "0")}-${label}.jpg`;
    await page.screenshot({ path: join(RESULTS, file), type: "jpeg", quality: 72 });
    return file;
  };
  const step = async (title, screen, action) => {
    const started = Date.now();
    let outcome = {};
    try {
      outcome = (await action()) || {};
    } catch (error) {
      outcome = { error: error.message.split("\n")[0] };
    }
    await page.waitForTimeout(400);
    const entry = {
      title,
      screen,
      seconds: (Date.now() - started) / 1000,
      outcome,
      screenshot: outcome.noScreenshot ? null : await screenshot(title.toLowerCase().replace(/[^a-z]+/g, "-").slice(0, 30)),
      traces: await traces(),
    };
    delete entry.outcome.noScreenshot;
    record.steps.push(entry);
    console.log(`${outcome.error ? "❌" : "✅"} ${title} (${entry.seconds.toFixed(1)} s) ${outcome.error || ""}`);
    return outcome;
  };

  // A chat turn is finished when the send button stops showing its spinner
  // (whatever the answer looks like: looks, products, tips or advice)
  const chatTurn = async (send) => {
    await send();
    await page.locator(".send-button .spinner").waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
    await page.locator(".send-button .spinner").waitFor({ state: "detached", timeout: AI_TIMEOUT });
    await page.waitForTimeout(1500);
  };

  const sendChat = async (message) => {
    await page.locator("#styling-question").fill(message);
    await chatTurn(() => page.keyboard.press("Enter"));
    const last = page.locator(".msg.bot").last();
    const chips = await last.locator(".understood-chips span").allInnerTexts();
    const options = last.locator(".question-options button");
    const outcome = { message, understood: chips };
    if (await options.count()) {
      outcome.question = (await last.innerText()).split("\n").find((line) => line.trim().endsWith("?")) || "";
      outcome.answered = await options.first().innerText();
      await chatTurn(() => options.first().click());
    }
    await page.locator(".results .product-card").first().waitFor({ timeout: 30_000 }).catch(() => {});
    outcome.looks = await page.locator(".outfit-option h3, .option-card h3").allInnerTexts();
    await page.locator(".msg.bot").last().scrollIntoViewIfNeeded();
    return outcome;
  };

  // Attach a photo the way a person does: 📷 → Choose a photo (gallery) or
  // Take a photo (camera, then the shutter), then ask about it
  const sendPhoto = async (photo) => {
    await page.getByRole("button", { name: "Add a photo" }).click();
    const outcome = { photo: photo.kind, photo_file: photo.file };
    if (photo.kind === "upload") {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page.getByRole("menuitem", { name: /Choose a photo/ }).click(),
      ]);
      await chooser.setFiles(join(FIXTURES, photo.file));
    } else {
      await page.getByRole("menuitem", { name: /Take a photo/ }).click();
      await page.waitForFunction(() => {
        const shutter = document.querySelector(".shutter-button");
        return shutter && !shutter.disabled;
      }, null, { timeout: 20_000 });
      await page.waitForTimeout(800);
      outcome.viewfinder = await screenshot("camera-viewfinder");
      await page.locator(".shutter-button").click();
    }
    await page.getByText(/Photo attached/).waitFor({ timeout: 10_000 });
    outcome.attached = await screenshot(`${photo.kind}-attached`);
    return { ...outcome, ...(await sendChat(photo.message)) };
  };

  const signUp = async () => {
    const email = `persona-${persona.id}-${randomBytes(3).toString("hex")}@example.com`;
    const result = await call("POST", "/api/auth/register", {
      email, password: randomBytes(12).toString("base64url"), name: persona.name, consent: true,
    });
    record.account = { email, user_id: result.user?.id };
    await page.reload();
    return { signed_in_as: persona.name };
  };

  const feed = (extra = {}) =>
    call("POST", "/api/feed", {
      section: persona.section, age_group: persona.ageGroup, ...persona.geo, ...extra,
    });
  const summarize = (cards) =>
    cards.map((card) => ({
      type: card.type,
      title: card.title || card.name || card.label || card.product?.title,
      reason: card.reason,
      occasion: card.occasion,
      styles: card.styles,
      price: card.total_price || card.product?.price,
      image: card.pieces?.[0]?.product?.image || card.product?.image || null,
    }));

  // ---- The journey ----
  await page.goto(`${APP}/#stylist`);
  await page.getByText("are we dressing for today").waitFor();

  if (!persona.startsAsGuest) {
    await step("Signs up", "Sign in", signUp);
  }

  await step("Opens the Stylist", "Stylist", async () => ({ note: persona.startsAsGuest ? "as a guest" : "signed in" }));

  for (const message of persona.chats) {
    await step("Asks the stylist", "Stylist chat", () => sendChat(message));
  }

  for (const photo of persona.photos || []) {
    await step(photo.kind === "upload" ? "Uploads a photo" : "Takes a picture", "Stylist chat", () => sendPhoto(photo));
  }

  await step("Home: AI-written page", "Home", async () => {
    await page.getByRole("tab", { name: /Home/ }).click();
    await page.locator(".today-card").waitFor({ timeout: AI_TIMEOUT });
    return {
      greeting: await page.locator(".foryou-header h1").innerText(),
      ideas: await page.locator(".idea-card h3").allInnerTexts().catch(() => []),
      festivals: await page.locator(".festival-chip strong").allInnerTexts().catch(() => []),
    };
  });

  let firstFeed;
  if (persona.startsAsGuest) {
    await step("Scrolls the look feed (guest)", "Home feed", async () => {
      firstFeed = await feed();
      const looks = firstFeed.cards.filter((card) => card.type === "look");
      const loved = looks.filter((card) => card.styles.includes(persona.loveStyle)).slice(0, 2);
      const stored = await call("POST", "/api/signals", {
        signals: loved.map((card) => ({ kind: "love", look_id: card.id })),
      });
      const taste = { style: { [persona.loveStyle]: 6 } };
      const again = await feed({ taste });
      return {
        noScreenshot: true,
        feed: summarize(firstFeed.cards),
        loved: loved.map((card) => card.title),
        stored_on_server: stored.stored,
        after_love_on_device: summarize(again.cards).slice(0, 4),
      };
    });
    await step("Signs up", "Sign in", signUp);
  }

  await step("Scrolls the look feed", "Home feed", async () => {
    firstFeed = await feed();
    const looks = firstFeed.cards.filter((card) => card.type === "look");
    const likes = (card) =>
      persona.loveOccasion ? card.occasion === persona.loveOccasion : card.styles.includes(persona.loveStyle);
    const loved = looks.filter(likes).slice(0, 3);
    const skipped = looks.filter((card) => !likes(card)).slice(0, 2);
    const signals = [
      ...looks.map((card) => ({ kind: "view", look_id: card.id })),
      ...loved.map((card) => ({ kind: "love", look_id: card.id })),
      ...loved.slice(0, 1).map((card) => ({ kind: "dwell", look_id: card.id, value: 7000 })),
      ...loved.slice(0, 1).map((card) => ({
        kind: "save", product_id: card.pieces[0].product.id, price: card.pieces[0].product.price,
      })),
      ...skipped.map((card) => ({ kind: "skip", look_id: card.id })),
    ];
    const stored = await call("POST", "/api/signals", { signals });
    return {
      noScreenshot: true,
      feed: summarize(firstFeed.cards),
      loved: loved.map((card) => card.title),
      skipped: skipped.map((card) => card.title),
      stored_on_server: stored.stored,
    };
  });

  await step("Comes back: feed has learned", "Home feed", async () => {
    const next = await feed();
    return { noScreenshot: true, feed: summarize(next.cards), personalised: next.personalised };
  });

  await step("Stories row", "Home stories", async () => {
    const { stories } = await call("POST", "/api/stories", {
      section: persona.section, age_group: persona.ageGroup, ...persona.geo,
    });
    return {
      noScreenshot: true,
      stories: stories.map((story) => ({
        title: story.title, reason: story.reason, cover: story.cover, looks: story.looks.map((look) => look.title),
      })),
    };
  });

  let profile = await call("GET", "/api/me/profile");
  if (persona.notMe && profile.taste[persona.notMe]?.length) {
    const value = profile.taste[persona.notMe][0].value;
    await step(`"Not me": ${value}`, "You", async () => {
      await call("PATCH", "/api/me/profile", { action: "not_me", dimension: persona.notMe, value });
      const after = await feed();
      return { noScreenshot: true, corrected: `${persona.notMe}: ${value}`, feed: summarize(after.cards).slice(0, 5) };
    });
  }

  await step("You: what OmniFit learned", "You", async () => {
    profile = await call("GET", "/api/me/profile");
    await page.getByRole("tab", { name: /You/ }).click();
    await page.waitForTimeout(800);
    return { profile };
  });

  // Clean up: the throwaway account and everything learned
  await call("DELETE", "/api/account");
  record.deleted = true;
  run.personas.push(record);
  await context.close();
}

await browser.close();

// Re-recording some personas keeps the others from the last run
if (only.length) {
  const previous = JSON.parse(readFileSync(join(RESULTS, "personas.json"), "utf8"));
  const fresh = new Map(run.personas.map((p) => [p.id, p]));
  run.personas = PERSONAS.map((p) => fresh.get(p.id) || previous.personas.find((old) => old.id === p.id)).filter(Boolean);
}
writeFileSync(join(RESULTS, "personas.json"), JSON.stringify(run, null, 1));
console.log(`\nSaved ${join(RESULTS, "personas.json")}`);
