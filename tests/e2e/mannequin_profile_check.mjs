// My Mannequin's profile storage, through the API with a throwaway account:
// nothing without sign-in, save (measurements + a photo), read back, the
// photo only for its owner, replace, size limit, delete, and that deleting
// the account leaves nothing behind.
//
//   cd tests/e2e && node mannequin_profile_check.mjs

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const API = process.env.OMNIFIT_API || "http://127.0.0.1:8000";
const photo = readFileSync(join(here, "..", "ui", "fixtures", "outfit-sample.jpg"));

let cookie = "";
const call = async (path, options = {}) => {
  const response = await fetch(`${API}${path}`, { ...options, headers: { ...(options.headers || {}), Cookie: cookie } });
  const set = response.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const type = response.headers.get("content-type") || "";
  return { status: response.status, body: type.includes("json") ? await response.json() : await response.arrayBuffer() };
};

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` - ${detail}` : ""}`);
};

const form = (data, photos = {}) => {
  const body = new FormData();
  body.append("data", JSON.stringify(data));
  for (const [view, bytes] of Object.entries(photos)) body.append(view, new Blob([bytes], { type: "image/jpeg" }), `${view}.jpg`);
  return body;
};

check("Not signed in: refused", (await call("/api/me/avatar")).status === 401);

const email = `mannequin-test-${Date.now()}@example.com`;
const account = await call("/api/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: "test-password-123", name: "Mannequin Test", consent: true }),
});
check("Throwaway account created", account.status === 200, email);
const userId = account.body?.user?.id;

check("Nothing saved yet", (await call("/api/me/avatar")).body?.saved === false);

const data = { measurements: { height: 170, chest: 96 }, profile: [], section: "women" };
const saved = await call("/api/me/avatar", { method: "POST", body: form(data, { front: photo }) });
check("Saved with a front photo", saved.status === 200 && saved.body.saved && saved.body.photos.join() === "front", JSON.stringify(saved.body.photos));

const back = await call("/api/me/avatar");
check("Read back the same measurements", back.body?.data?.measurements?.chest === 96 && back.body?.data?.section === "women");

const image = await call("/api/me/avatar/photo/front");
check("The photo comes back to its owner", image.status === 200 && image.body.byteLength === photo.length, `${image.body.byteLength} bytes`);

const ownerCookie = cookie;
cookie = "";
check("The photo is refused without sign-in", (await call("/api/me/avatar/photo/front")).status === 401);
cookie = ownerCookie;

const updated = await call("/api/me/avatar", { method: "POST", body: form({ ...data, section: "men" }) });
check("Measurements updated, photo kept", updated.body?.data?.section === "men" && updated.body?.photos?.join() === "front");

const tooBig = await call("/api/me/avatar", { method: "POST", body: form(data, { side: Buffer.concat([photo, Buffer.alloc(1_600_000)]) }) });
check("A photo over the limit is refused", tooBig.status === 413, `HTTP ${tooBig.status}`);

const removed = await call("/api/me/avatar", { method: "DELETE" });
check("Deleted", removed.body?.deleted === true && (await call("/api/me/avatar")).body?.saved === false);
check("The photo is gone after deleting", (await call("/api/me/avatar/photo/front")).status === 404);

await call("/api/me/avatar", { method: "POST", body: form(data, { front: photo }) });
await call("/api/account", { method: "DELETE" });
const folder = join(here, "..", "..", "backend", "data", "uploads", String(userId));
check("Deleting the account leaves no photos behind", !existsSync(folder), folder);

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);
