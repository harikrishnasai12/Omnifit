---
name: omnifit-ui-test
description: Run the OmniFit Live end-to-end UI test in a real browser using the Playwright MCP server, then report pass/fail per test with screenshots. Use when asked to test, smoke-test, or regression-test the OmniFit UI, or after changing the frontend (frontend/src), app.py or catalog code. Optional argument - test IDs to run (e.g. "T4 T6"); default runs all.
---

# OmniFit UI test (Playwright MCP)

Drive the app like a user through the `playwright` MCP server tools
(`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`,
`browser_file_upload`, `browser_wait_for`, `browser_take_screenshot`,
`browser_console_messages`, `browser_tabs`, `browser_resize`,
`browser_evaluate`). Prefer `browser_snapshot` to read the page; take a
screenshot for every failure.

The browser is configured in `playwright-mcp.config.json`: isolated profile
(empty localStorage every run), fake camera, location granted and fixed to
Chennai, India time zone.

## The app in one paragraph

Five places: **Home** (the "For you" look feed with the ask bar on top),
**Explore** (ask bar, trends, today's AI page), **Stylist** (the chat: thread,
answer, composer; `#stylist`), **Try-On**, and **You** (tabs: 🧬 Style DNA,
👕 Wardrobe, 📚 Saved looks; `#you`, `#wardrobe`, `#library`). Phone: top bar
plus a bottom tab bar with the raised Stylist orb. Desktop (900px+): a left
sidebar. Everything typed or shown anywhere goes to the Stylist, which decides
whether to show products ("Showing products") or style looks ("Styling your
outfit").

## 0. Preconditions

1. Check ports: backend on 8000, Vite on 5173
   (`Get-NetTCPConnection -LocalPort 8000,5173 -State Listen`).
   If missing, start them in the background:
   - `backend`: `$env:OMNIFIT_DEV_MODE = "1"; .\venv\Scripts\uvicorn.exe app:app --reload --no-server-header`
   - `frontend`: `npm run dev`
2. `curl.exe -s http://127.0.0.1:8000/health` must report `"ai_service":"ready"`.
   If not, stop and report that Gemma/Ollama is unreachable (don't run tests).
3. `backend/data/catalog.db` must exist, or product tests will fail;
   if missing, report it and skip T4-T7, T13, T15, T16, T23.
4. After any backend change, restart the backend before testing: on Windows
   its auto-reload often keeps serving old code. Stop the `uvicorn.exe`
   process tree and start it again as above.
5. T26 needs the backend in dev mode (`/api/dev/status` returns 200).

Waiting for the stylist: answers take 10-40 s. After sending, wait for the
text `are just below` in the last `.msg.bot` (timeout 150 s), then allow ~3 s
for products. If the stylist asks one question first (`.question-options`
buttons), tap the first option and wait again. A plain search
("white sneakers") needs no AI and answers in about a second.

Clicks: `browser_click` sometimes reports a 5 s timeout although the click
worked. Check the page before retrying; if a click really doesn't land, use
`browser_evaluate` with `element.click()`.

Start each group of tests from a clean chat: "＋ New chat" on the Stylist page.

## 1. Tests

| ID | Steps | Pass when |
|----|-------|-----------|
| T1 Load | Open http://localhost:5173 | Tab title "OmniFit Live · AI Personal Stylist"; heading "For you"; the ask bar (📷 button, "What are we dressing for today?", send) above the feed; 5 nav items (Home, Explore, Stylist, Try-On, You); at least one look card appears; no console errors |
| T2 Location | Wait ~3 s after load (permission is pre-granted, so the region is detected silently). Open You | Style DNA row "Region" shows "India"; prices everywhere are in ₹. In ✎ Edit, "Stores in" shows India and "📍 Use my location" keeps it |
| T3 Empty message | On Home and on Stylist, with nothing typed and no photo | The send button is disabled in both the ask bar and the composer; pressing Enter sends nothing (no new message in the thread) |
| T4 Item suggestions | Stylist. Ask `Give me 3 casual shirt suggestions for a college student, for men` | 3 item cards (`.option-card`); each has 1-3 product cards with ₹ price, a store name and "🛒 Add to cart"; "Search all stores (9)" present; the line "✦ Styling your outfit" with a "Just show products" button; "💡 Most matching products cost … Use as my budget" |
| T5 Complete looks | New chat. Ask `Suggest 2 festive outfits for a women's Diwali party` | A chip naming Womenswear; style chips include ethnic or festive; each look opens with a look board (`.look-board`): one tile per piece with the product photo, store and ₹ price; "🛍 Shop the look · N pieces · ₹…" opens a bottom sheet listing those pieces with "Add to cart" and "View on <store>"; the fold "Piece by piece: more options, how to wear it, other stores" opens the detailed list; "Get this complete look … for ₹" appears when every piece has a product |
| T6 Chosen section | You → ✎ Edit → Shopping for: Women → Done. New chat, ask `Give me 3 streetwear pieces` | Chip "Shopping for: Womenswear"; no product title contains the separate word "Men" or "Men's" (careful: "Women" contains "men"; read titles from the snapshot). Set it back to Auto ✨ afterwards |
| T7 Budget | (a) Items: with T4's answer on screen, click "Use as my budget". (b) Looks: new chat, ask `Give me 2 smart casual outfits for men for a dinner date, budget 4000` | (a) Banner "💰 Showing partner-brand products for ₹… – ₹…"; every product price is inside the range (or "No partner-brand match in your budget"); "Show all prices" brings the 💡 hint back. (b) Banner "💰 Each look kept within ₹4,000 in all. Pieces you already have don't count."; the total on each "Shop the look" button is ₹4,000 or less; a piece that doesn't fit says "Nothing within your budget"; no "Use as my budget" button on looks |
| T8 Results persist | With an answer on screen, type new text in the composer without sending; then reload the page | The answer stays while typing; after the reload the conversation and the last answer are back |
| T9 Photo in the chat | Stylist. 📷 "Add a photo" → "🖼️ Choose a photo" → `tests/ui/fixtures/outfit-sample.jpg` | "Photo attached: I'll style around it" with a thumbnail; ask `Give me 2 shirt suggestions that go with these pants` → the sent message shows the photo and the answer has item cards |
| T10 Remove photo | Attach a photo again, then click "×" (Remove photo) | The attachment row is gone; the send button is disabled again if nothing is typed |
| T11 Camera | 📷 → "📸 Take a photo" | The camera dialog is visible without scrolling (fixed overlay); "Starting camera…" goes away; Escape closes it. Open again, click "Capture photo" → "Photo attached: I'll style around it" |
| T12 Bad file | Home. Give the ask bar's 📷 a non-image (create a small .txt in `.playwright-mcp/`). Repeat in the Stylist composer | "Please use a JPG, PNG, or WEBP photo." each time; Home stays on Home; nothing is attached |
| T13 Links | In an item answer, click the first product's image/title (`.product-link`) | A new tab opens on the brand's own domain (`browser_tabs`; it can take a few seconds to be listed); close it. Expand "Search all stores"; each link has target=_blank and an https URL |
| T14 Phone | `browser_resize` to 390x844, reload, check Home, then `#stylist` | No sideways scroll (`document.documentElement.scrollWidth <= innerWidth`); bottom tab bar with the raised Stylist orb; on Home the ask bar sits between the "For you" header and the feed, and the feed fills the rest; on Stylist the composer sits above the tab bar; ask-bar buttons are at least 44×44 px |
| T15 My sizes | You → ✎ Edit → My sizes: Tops "M", Bottoms "32" → Done. Ask `Give me 3 black oversized t-shirt options for men` | `localStorage["omnifit.sizes"]` is `{"top":"M","bottom":"32"}`; Style DNA shows "Top M · Waist 32"; product cards show size chips with M highlighted; in one option card, no product marked "Not in your size" comes before one that fits |
| T16 Add to cart | On a product with "✓ Your size in stock", click "🛒 Add to cart" | Dialog shows "● Live price" and size buttons with M pre-selected; button reads "Buy size M at <store> →". Click it → a new tab opens on the store's `/checkouts/` page with the product and size M (read `document.body.innerText`); close that tab. Never enter any buyer or payment details |
| T17 Size learned at checkout | Clear `omnifit.sizes` and `omnifit.sizePicks` and reload. Stub `window.open` (`window.open = () => null`) so no store tab opens. Add a product to cart, pick a size, Buy; click Undo; buy the same size again; then buy a different size once, and once more | First buy: toast "Saved <size> as your top size" with Undo, and `omnifit.sizes` has it; Undo empties it; buying again saves it again and the toast leaves by itself in ~8 s; the saved size is pre-selected next time; one different pick changes nothing (`omnifit.sizePicks` counts 1, no toast); the second switches the saved size with a toast |
| T18 Photo of an outfit | Copy `tests/ui/fixtures/outfit-camera.jpg` to `frontend/tmp-camera-test/outfit.jpg` (served same-origin by Vite). Load `#stylist`, then `browser_evaluate` a stub that draws that image on a canvas and replaces `navigator.mediaDevices.getUserMedia` with `async () => canvas.captureStream(15)`. 📷 → Take a photo → Capture photo → ask `What can I wear with this?` | "👁️ What I see in your photo" lists a mustard/yellow t-shirt, blue cargo jeans and white sneakers; on the look board the pieces already worn are dashed green tiles saying "✓ You're wearing this", and at least one tile is a NEW piece with a product; the reason mentions a visible colour; no menswear/womenswear chip unless the words said so. Afterwards delete `frontend/tmp-camera-test` |
| T19 Account | You → 📚 Saved looks → "Sign in or create an account" → "Create account"; fill a unique email (e.g. `uitest-<random>@example.com`) and an 8+ char password | Button disabled until the consent box is ticked; after submit the Saved looks page opens and the top bar (sidebar on desktop) shows an avatar |
| T20 Saved looks | Upload `tests/ui/fixtures/outfit-camera.jpg` via the drop area and "Save to library"; then paste `https://www.youtube.com/watch?v=dQw4w9WgXcQ` and save; paste an Instagram link and save | Two cards with images, summaries and tags ("▶ YouTube" badge on the second); the Instagram link shows the "take a screenshot" message; "What OmniFit has learned" lists styles/colours; "🛍️ Shop this look" shows products per piece |
| T21 Share target | In `browser_evaluate`: wait for `navigator.serviceWorker.ready`, POST a FormData (title, text, `image` = a saved image blob) to `/share-target`; then open `/#library?shared=1` and `location.reload()` | A new card with "↗ Shared" appears; cache `omnifit-share` is emptied |
| T22 Personalisation and delete | Ask `Give me 3 shirt options for a weekend brunch`; click "Surprise me next time" and ask again. Then avatar → "Delete account & data" → accept the confirm dialog | First answer shows "✨ Why these? Personalised from your Style Library: …"; the second has no such note. After deleting: "Sign in" is back, `/api/auth/me` returns `user: null`, no folder left under `backend/data/uploads` for that user |
| T23 Home feed | Home, as a guest | Look cards each with a reason chip ending "Why?", a title, "₹… for N pieces" and "🛍 Shop the look"; Love toggles (aria-pressed); "Why?" opens "Why am I seeing this?" with "Less …" buttons; Shop the look opens the bottom sheet with ₹ prices; Skip hides the card with the toast "Got it: fewer looks like this" |
| T24 One way in | (a) Home ask bar: type `white sneakers`, Enter. (b) Click "Style it instead". (c) Explore ask bar: type `linen shirts men`, Enter. (d) New chat: ask `Give me 3 shirt suggestions that suit a beach holiday, for men`, then click "Just show products" | (a) Lands on `#stylist` with the product grid and "🛍️ Showing products · Style it instead"; (b) the stylist answers with styling for them; (c) product grid on the Stylist page; (d) item cards under "✦ Styling your outfit", and "Just show products" puts a product grid above them while the suggestions stay below |
| T25 Photo from Home | Home. Type `What can I wear with this?` in the ask bar, then give its 📷 `tests/ui/fixtures/outfit-camera.jpg` | Lands on `#stylist` with "Photo attached: I'll style around it" and the typed words in the composer, not yet sent; Send → the answer has "👁️ What I see in your photo" |
| T26 Brand insights | Backend in dev mode. Open `/#insights` (also "📊 Brand insights" in the ⚙ Behind the scenes panel); pick two different brands | Heading "What shoppers do with your products"; three tiles (products, in stock, shoppers); the funnel table "From seeing a look to the cart" with a bar per step, or "Not enough shoppers…" when fewer than 3; if `seed_demo.py` shoppers are counted, the banner "Demo data: N of the M shoppers…"; "What shoppers want, and what you have in stock" lists items with counts. Without dev mode the page shows the "need the backend started with OMNIFIT_DEV_MODE=1" message |
| T27 Dark mode | `browser_evaluate`: `document.documentElement.setAttribute("data-theme", "dark")`. Look at Home, a stylist answer with looks, the Shop the look sheet and `#insights` | Dark surfaces with light text throughout; look-board tiles, the mode line, the size toast, the ask bar and the insights cards are all readable (no dark text on dark, no white panels); kept pieces still stand apart |

Run the requested IDs (default: all, in order). Continue after a failure.
T20-T22 need T19's account; T22 deletes it. T7(b), T5 and T18 depend on what
Gemma writes: if it answers with a different kind of result than the step
expects (looks where items were asked for), ask once more with clearer words
before marking a failure, and say so in the evidence.

## 1a. Scripted end-to-end test (no MCP needed)

`tests/e2e/omnifit.e2e.mjs` drives the installed Microsoft Edge through the
chat, refinement, instant search, the Explore ask bar, the Home look feed (a
reason on every card, love, Why?, Shop the look), today's AI page on Explore,
Style DNA, Style Scan, Body Scan and the phone layout, and saves screenshots to
`tests/e2e/results/`. Run it (servers on 5173 and 8000 must be up):

    cd tests/e2e; npm install; npm test

Report its "N/M checks passed" line alongside the product-match checks below.

## 1b. Product-match checks (run after any change to catalog.py or the search)

From `backend/` with the venv active; each prints every wrong product and exits 1 on any fault:
- `python tests/match_quality.py` - 80+ fixed searches, no server needed, ~1 min
- `python tests/pipeline_quality.py ../tests/ui/fixtures/outfit-camera.jpg ../tests/ui/fixtures/outfit-sample.jpg` - real stylist answers end to end (server running), ~5 min
- `python tests/shop_look_quality.py ../tests/ui/fixtures/outfit-camera.jpg` - "Shop this look" on saved photos (server running)

Report their summary lines ("N products, 0 wrong") alongside the UI table. Restart the backend first:
its auto-reload sometimes keeps serving old code on Windows.

## 1b-2. Persona walkthrough (narrated videos of three users)

Backend started with `OMNIFIT_DEV_MODE=1` (tracing + test clock, this computer only), frontend up. From `tests/e2e`:
1. `npm run personas` - three people use the real app (≈10 min); saves results/personas/personas.json + screenshots.
2. `..\..\backend\venv\Scripts\python.exe build_walkthrough.py <out> --audio` - scenes, Windows-voice narration, and the Persona Journeys page (journeys.html, with the Watch player).
3. `node record_walkthrough.mjs <out>` then `..\..\backend\venv\Scripts\python.exe mux_walkthrough.py <out>` - MP4s with narration in `<out>/video/`.

## 1b-3. Conversational edits (run after any change to chat.py, edits.py or the stylist prompt)

From `backend/` with the server running: `python tests/conversation_edits.py` (3-6 min, live Gemma).
Chains "3 casual outfits" → "change the shoes in the first one" → "make them more formal" →
"I don't like the second one" → "remove the last one" → "show me 2 more", then a photo →
"make it more casual" → "complete the look", and checks exactly the right pieces changed.

## 1b-4. Photo understanding (run after any change to the photo rules in chat.py or the stylist's photo handling)

From `backend/` with the server running: `python tests/photo_understanding.py` (3-5 min, live Gemma).
Four fresh photo requests: the outfit is seen and not asked about, the occasion comes from the
clothes, "change my shoes" / "keep the trousers" are followed, and the section comes only from
words or a clearly gendered garment (saree), never from the person.

## 1b-5. AI suggestions (run after any change to the starters or next-steps prompts)

From `backend/` with the server running: `python tests/suggestions.py` (~2 min, live Gemma).
Today's starters are written and cached; stylist and advice answers come with specific next steps;
tapping one edits the looks on screen.

## 1c. Intent Engine check (run after any change to intent.py, lookpool.py or the feed endpoints)

From `backend/` with the server running: `python tests/intent_engine.py` (~1 min, one Gemma call).
It uses a throwaway account and checks: guest feed and guest signals staying on the device, paging
without repeats, signals -> learned taste with "Why?", the feed following taste with a reason on
every card, price drops, "Not me" winning, an event with a date said in the chat shaping the feed,
stories, pause, reset, and that deleting the account leaves nothing in the intent tables.
The feed needs a look pool: `python build_looks.py --stats` (build more with `python build_looks.py`).

## 1d. Look budget (run after any change to the product lookup in app.py)

With the server running: `python backend/tests/look_budget.py` (a few seconds, no Gemma).
`POST /api/products` with `look_budget` shares that total between the pieces of each look (ids
`look-<n>-<piece>`) and returns one product per piece. The script checks four budgets (every
look's products add up to no more than the budget), that item ids (`item-<n>`) are unaffected,
and that a request without `look_budget` behaves as before (`max_price` is per product).
Exits 1 if any look goes over.

## 2. Report

Reply with one table: ID · Result (✅ / ❌ / ⏭ skipped) · Evidence (one line: what
you saw) · Screenshot path for failures. Then list console errors seen, and for
each failure a short likely cause with the file to look at
(`frontend/src/app/OmniFitProvider.jsx`, `frontend/src/components/*.jsx`,
`frontend/src/pages/*.jsx`, `backend/app.py`, `backend/catalog.py`).
Don't fix anything unless the user asks.

Finish with `browser_close`.
