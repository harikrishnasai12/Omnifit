"""
Photo-aware understanding, end to end with the real model: the understanding
step sees the photo, fills in the outfit, style and occasion, doesn't ask
what the photo answers, and follows "change my shoes" / "keep the trousers".
The section comes only from words or clearly gendered garments, never from
the person.

Needs the backend on port 8000. About 3-5 minutes (live Gemma).

Usage (from backend/, with the venv active):
    python tests/photo_understanding.py
Exit code 1 if any check fails.
"""

import json
import sys
import time
from pathlib import Path

import httpx

API = "http://127.0.0.1:8000"
FIXTURES = Path(__file__).resolve().parents[2] / "tests" / "ui" / "fixtures"

sys.stdout.reconfigure(encoding="utf-8")
results = []
client = httpx.Client(base_url=API, timeout=300)


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(f"{'✅' if ok else '❌'} {name}{f' - {detail}' if detail else ''}")


def ask(message: str, photo: str) -> dict:
    """One fresh chat turn with a photo: understood, question, result, timings."""
    path = FIXTURES / photo
    started = time.time()
    out = {"understood": {}, "question": None, "result": {}, "understood_s": None}
    with client.stream("POST", "/api/chat",
                       data={"message": message, "history": "[]", "profile": "{}", "region": "IN"},
                       files={"image": (path.name, path.read_bytes(), "image/jpeg")}) as stream:
        for line in stream.iter_lines():
            if not line:
                continue
            event = json.loads(line)
            if event["event"] == "understood":
                out["understood"] = event
                out["understood_s"] = time.time() - started
            elif event["event"] == "question":
                out["question"] = event
            elif event["event"] == "stylist":
                out["result"] = event["result"]
    out["total_s"] = time.time() - started
    return out


def seen(turn: dict) -> str:
    photo = turn["understood"].get("photo") or {}
    return ", ".join(f"{item['color']} {item['item']}" for item in photo.get("items", []))


def looks(turn: dict) -> list[dict]:
    return turn["result"].get("recommendations", [])


# 1. The plain photo question that used to trigger "What is the occasion?"
turn = ask("What can I wear with this?", "outfit-camera.jpg")
u = turn["understood"]
occasion = u.get("occasion") or {}
check("Sees the outfit and doesn't ask about it", turn["question"] is None and bool(seen(turn)),
      f"saw: {seen(turn)}; style: {(u.get('photo') or {}).get('style')}; understood {u.get('understood')}; "
      f"understanding {turn['understood_s']:.1f} s")
check("Occasion comes from the clothes", occasion.get("from_photo") and occasion.get("id") == "casual",
      f"occasion {occasion}")
check("No section guessed from the photo of a person", u.get("department") in ("auto", "unisex", None, "unknown"),
      f"department {u.get('department')}")
check("Styles around their own pieces", bool(looks(turn)) and all({"top", "bottom"} & set(l.get("keep", [])) for l in looks(turn)),
      f"{[(l.get('title'), l.get('keep')) for l in looks(turn)]}; {turn['total_s']:.0f} s")

# 2. Change only their shoes
turn = ask("change my shoes", "outfit-camera.jpg")
photo = turn["understood"].get("photo") or {}
check('"Change my shoes": understood as replacing their footwear', "footwear" in photo.get("change", []),
      f"change {photo.get('change')}, keep {photo.get('keep')}")
# Either shoe options on their own, or whole looks with new shoes: both answer it
SHOES = ("shoe", "sneaker", "loafer", "boot", "sandal", "slide", "mule", "trainer", "runner", "oxford", "derby", "slip-on")
if turn["result"].get("request_type") == "item_options":
    ok = bool(looks(turn)) and all(any(word in (l.get("item", "") + " " + l.get("style", "")).lower() for word in SHOES)
                                   for l in looks(turn))
    detail = f"shoe options: {[' '.join(filter(None, (l.get('color'), l.get('style')))) for l in looks(turn)]}"
else:
    ok = bool(looks(turn)) and all("footwear" not in l.get("keep", []) and l.get("footwear") for l in looks(turn))
    detail = f"{[(l.get('footwear'), l.get('keep')) for l in looks(turn)]}"
check("The answer is new shoes for what they're wearing", ok, f"{detail}; {turn['total_s']:.0f} s")

# 3. Keep one piece, change the rest
turn = ask("keep the trousers, change everything else for a party", "outfit-sample.jpg")
photo = turn["understood"].get("photo") or {}
check('"Keep the trousers, change the rest": keep bottom, replace top',
      "bottom" in photo.get("keep", []) and bool(looks(turn))
      and all("bottom" in l.get("keep", []) and "top" not in l.get("keep", []) for l in looks(turn)),
      f"plan keep {photo.get('keep')} change {photo.get('change')}; "
      f"{[(l.get('top'), l.get('keep')) for l in looks(turn)]}; occasion {(turn['understood'].get('occasion') or {}).get('id')}")

# 4. Ethnic wear: the occasion and the section from the garment itself
turn = ask("What can I wear with this?", "saree-sample.jpg")
u = turn["understood"]
occasion = u.get("occasion") or {}
check("A saree suggests a festive occasion without asking",
      turn["question"] is None and occasion.get("id") in ("wedding", "festival"),
      f"saw: {seen(turn)}; occasion {occasion.get('id')} (from photo: {occasion.get('from_photo')})")
check("Section from the garment (saree), not the person", u.get("department") == "women",
      f"department {u.get('department')}; looks {[l.get('title') for l in looks(turn)]}; {turn['total_s']:.0f} s")

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
