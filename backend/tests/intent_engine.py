"""
Intent Engine API check: feed, signals, learned taste, "Not me", events from
the chat, stories, pause/reset and account deletion.

Needs the backend on port 8000. Creates a throwaway account and deletes it
at the end (which must remove everything learned).

Usage (from backend/, with the venv active):
    python tests/intent_engine.py
Exit code 1 if any check fails.
"""

import json
import secrets
import sqlite3
import sys
from pathlib import Path

import httpx

API = "http://127.0.0.1:8000"
USERS_DB = Path(__file__).resolve().parent.parent / "data" / "users.db"
INTENT_TABLES = ("signals", "taste_scores", "taste_overrides", "intents", "events", "shown_looks", "personalization")

sys.stdout.reconfigure(encoding="utf-8")
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(f"{'✅' if ok else '❌'} {name}{f' - {detail}' if detail else ''}")


client = httpx.Client(base_url=API, timeout=180)

# Guests: a feed, nothing stored
guest = client.post("/api/feed", json={"section": "men"}).json()
looks = [card for card in guest["cards"] if card["type"] == "look"]
check("Guest feed", len(looks) >= 4 and all(card["pieces"] for card in looks),
      f"{len(guest['cards'])} cards ({', '.join(card['type'] for card in guest['cards'])})")
check("Guest signals stay on the device",
      client.post("/api/signals", json={"signals": [{"kind": "love", "look_id": looks[0]["id"]}]}).json()["stored"] == 0)

guest_taste = {"style": {looks[0]["styles"][0]: 6}}
tasted = client.post("/api/feed", json={"section": "men", "taste": guest_taste}).json()
first = next(card for card in tasted["cards"] if card["type"] == "look")
check("Guest taste from the device ranks the feed", looks[0]["styles"][0] in first["styles"],
      f"liked {looks[0]['styles'][0]}; first look: {first['title']} ({first['reason'] or 'no reason'})")

# Sign up
email = f"intent-test-{secrets.token_hex(4)}@example.com"
response = client.post("/api/auth/register", json={
    "email": email, "password": secrets.token_urlsafe(16), "name": "Intent Test", "consent": True
})
check("Sign up", response.status_code == 200)
user_id = response.json()["user"]["id"]

page1 = client.post("/api/feed", json={"section": "men"}).json()
page1_looks = [card for card in page1["cards"] if card["type"] == "look"]
page2 = client.post("/api/feed", json={"section": "men", "cursor": page1["cursor"]}).json()
page2_looks = [card for card in page2["cards"] if card["type"] == "look"]
overlap = {card["id"] for card in page1_looks} & {card["id"] for card in page2_looks}
check("Paging", page1["cursor"] and page2_looks and not overlap,
      f"page 1: {len(page1_looks)} looks, page 2: {len(page2_looks)}, repeats: {len(overlap)}")

# Love three looks of one style, skip others
target = page1_looks[0]["styles"][0]
loved = [card for card in page1_looks + page2_looks if target in card["styles"]][:3]
skipped = [card for card in page1_looks + page2_looks if target not in card["styles"]][:3]
signals = [{"kind": "view", "look_id": card["id"]} for card in page1_looks]
signals += [{"kind": "love", "look_id": card["id"]} for card in loved]
signals += [{"kind": "skip", "look_id": card["id"]} for card in skipped]
signals += [{"kind": "dwell", "look_id": loved[0]["id"], "value": 6000}]
signals += [{"kind": "save", "product_id": loved[0]["pieces"][0]["product"]["id"],
             "price": loved[0]["pieces"][0]["product"]["price"] * 1.3}]
stored = client.post("/api/signals", json={"signals": signals}).json()["stored"]
check("Signals stored", stored == len(signals), f"{stored} of {len(signals)}")

profile = client.get("/api/me/profile").json()
styles = [item["value"] for item in profile["taste"]["style"]]
check("Taste learned", styles and styles[0] == target,
      f"{profile['summary']} | top style {styles[:2]}, confidence {profile['taste']['style'][0]['confidence']}")
check("Why? explanation", bool(profile["taste"]["style"][0]["why"]), profile["taste"]["style"][0]["why"])

fresh = client.post("/api/feed", json={"section": "men"}).json()
fresh_looks = [card for card in fresh["cards"] if card["type"] == "look"]
check("Feed follows taste, with reasons",
      sum(target in card["styles"] for card in fresh_looks) >= 3 and all(card["reason"] for card in fresh_looks),
      "; ".join(f"{card['title']}: {card['reason']}" for card in fresh_looks[:4]))
check("Already-seen looks are not repeated", not ({c["id"] for c in page1_looks} & {c["id"] for c in fresh_looks}))
drops = [card for card in fresh["cards"] if card["type"] == "price_drop"]
check("Price drop on a saved product", bool(drops), drops[0]["reason"] if drops else "none")

# Not me
client.patch("/api/me/profile", json={"action": "not_me", "dimension": "style", "value": target})
after = client.post("/api/feed", json={"section": "men"}).json()
after_looks = [card for card in after["cards"] if card["type"] == "look"]
profile = client.get("/api/me/profile").json()
check('"Not me" wins', target not in [i["value"] for i in profile["taste"]["style"]]
      and sum(target in card["styles"] for card in after_looks) <= 1,
      f"{sum(target in card['styles'] for card in after_looks)} {target} looks now")
client.patch("/api/me/profile", json={"action": "undo_not_me", "dimension": "style", "value": target})

# An event said in the chat
events_seen = []
with client.stream("POST", "/api/chat", data={
    "message": "My sister's wedding is on 14 December, I'm a woman, what should I wear for the sangeet?",
    "history": "[]", "profile": "{}", "region": "IN",
}) as stream:
    for line in stream.iter_lines():
        event = json.loads(line) if line else {}
        if event.get("event") == "understood":
            events_seen = event.get("saved_events", [])
            break
profile = client.get("/api/me/profile").json()
check("Event from the chat", bool(profile["events"]) and profile["events"][0]["date"].endswith("-12-14"),
      f"saved {events_seen}; intents: {list(profile['intents'])}")

feed_with_event = client.post("/api/feed", json={"section": "women"}).json()
event_cards = [card for card in feed_with_event["cards"] if card["type"] == "event"]
wedding_first = next(card for card in feed_with_event["cards"] if card["type"] == "look")
check("Event shapes the feed", bool(event_cards) and wedding_first.get("occasion") == "wedding",
      f"{event_cards[0]['name'] if event_cards else '-'} in {event_cards[0]['days_away'] if event_cards else '-'} days; "
      f"first look: {wedding_first['title']} ({wedding_first['reason']})")

stories = client.post("/api/stories", json={"section": "women"}).json()["stories"]
check("Stories", len(stories) >= 4, ", ".join(f"{s['title']} ({len(s['looks'])})" for s in stories))

# Pause and reset
client.patch("/api/me/profile", json={"action": "pause"})
paused = client.post("/api/signals", json={"signals": [{"kind": "love", "look_id": looks[1]["id"]}]}).json()
check("Pause stops learning", paused["stored"] == 0 and client.get("/api/me/profile").json()["paused"])
client.patch("/api/me/profile", json={"action": "resume"})
reset = client.patch("/api/me/profile", json={"action": "reset"}).json()
check("Reset forgets", not any(reset["taste"].values()) and not reset["events"])

# Delete the account: nothing learned may remain
client.post("/api/signals", json={"signals": [{"kind": "love", "look_id": looks[1]["id"]}]})
client.delete("/api/account")
with sqlite3.connect(USERS_DB) as connection:
    left = {table: connection.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id = ?", (user_id,)).fetchone()[0]
            for table in INTENT_TABLES}
check("Delete account removes everything learned", not any(left.values()), str(left))

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
