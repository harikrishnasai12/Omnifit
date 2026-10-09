// Record the narrated persona walkthrough as video frames, one persona at a time.
//
// Plays the walkthrough page (built by build_walkthrough.py --audio) in its
// record mode at 1280x720, where each scene lasts as long as its narration,
// and captures the screen with the browser's own screencast (JPEG frames with
// timestamps; no ffmpeg needed). mux_walkthrough.py then adds the voice and
// writes the MP4s.
//
//   node record_walkthrough.mjs <walkthrough folder> [persona ...]

import { chromium } from "playwright";
import { closeSync, openSync, readFileSync, writeFileSync, writeSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const folder = process.argv[2];
const story = JSON.parse(readFileSync(join(folder, "story.json"), "utf8"));
const wanted = process.argv.slice(3);
const videos = join(folder, "video");
mkdirSync(videos, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
for (const persona of story.personas.filter((p) => !wanted.length || wanted.includes(p.id))) {
  const seconds = persona.scenes.reduce((sum, scene) => sum + (scene.seconds || 8) + 0.7, 0);
  console.log(`Recording ${persona.name}: about ${Math.round(seconds)} s`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.goto(`${pathToFileURL(join(folder, "journeys.html")).href}#rec-${persona.id}`);
  await page.waitForFunction(() => typeof window.__go === "function");

  // Frames go into one file; the index keeps each frame's time and place
  const bin = openSync(join(videos, `${persona.id}.frames`), "w");
  const frames = [];
  let offset = 0;
  const cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const bytes = Buffer.from(data, "base64");
    writeSync(bin, bytes);
    frames.push({ wall: Math.round(metadata.timestamp * 1000), offset, size: bytes.length });
    offset += bytes.length;
    await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  await page.waitForTimeout(1200);

  await page.evaluate(() => window.__go());
  await page.waitForFunction(() => window.__done === true, null, { timeout: (seconds + 90) * 1000, polling: 500 });
  await page.waitForTimeout(1500);
  const timeline = await page.evaluate(() => window.__timeline);
  await cdp.send("Page.stopScreencast");
  closeSync(bin);
  await context.close();
  writeFileSync(join(videos, `${persona.id}.json`), JSON.stringify({ frames, timeline }));
  console.log(`  ${frames.length} frames`);
}
await browser.close();
