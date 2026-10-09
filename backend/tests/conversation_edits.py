"""
Conversational edits, end to end with the real model: a chain of follow-ups
("change the shoes in the first one", "make it more formal", "I don't like
the second one", "remove the last one", "show me 2 more", a photo and
"make it casual"), checking that exactly the right things changed and
everything else was kept.

Needs the backend on port 8000. About 3-6 minutes (several Gemma calls).

Usage (from backend/, with the venv active):
    python tests/conversation_edits.py
Exit code 1 if any check fails.
"""

import json
import sys
import time
from pathlib import Path

import httpx

API = "http://127.0.0.1:8000"
PHOTO = Path(__file__).resolve().parents[2] / "tests" / "ui" / "fixtures" / "outfit-camera.jpg"
SLOTS = ("top", "layer", "bottom", "footwear", "accessories", "extra")

sys.stdout.reconfigure(encoding="utf-8")
results = []
client = httpx.Client(base_url=API, timeout=300)
history: list[dict] = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(f"{'✅' if ok else '❌'} {name}{f' - {detail}' if detail else ''}")


def say(message: str, current: dict | None = None, photo: Path | None = None) -> tuple[dict, dict, float]:
    """One chat turn: (understood, stylist result, seconds)."""
    started = time.time()
    data = {"message": message, "history": json.dumps(history[-12:]), "profile": json.dumps({"department": "men"}),
            "region": "IN"}
    if current:
        data["current"] = json.dumps({key: current[key] for key in ("request_type", "recommendations", "outfit_analysis")
                                      if key in current})
    files = {"image": (photo.name, photo.read_bytes(), "image/jpeg")} if photo else None
    understood, result = {}, {}
    with client.stream("POST", "/api/chat", data=data, files=files) as stream:
        for line in stream.iter_lines():
            if not line:
                continue
            event = json.loads(line)
            if event["event"] == "understood":
                understood = event
            elif event["event"] == "stylist":
                result = event["result"]
            elif event["event"] == "error":
                print("   error:", event.get("detail"))
    history.append({"role": "user", "text": message})
    if result:
        titles = "; ".join(look.get("title") or look.get("style", "") for look in result["recommendations"])
        history.append({"role": "assistant", "text": f"Suggested: {titles}"})
    return understood, result, time.time() - started


def pieces(look: dict) -> dict:
    return {slot: look.get(slot) for slot in SLOTS if look.get(slot)}


def show(result: dict) -> str:
    return " | ".join(f"{i}. {look.get('title')}: {look.get('footwear', '-')}"
                      for i, look in enumerate(result.get("recommendations", []), start=1))


# 1. A fresh request with a count
understood, a, seconds = say("Give me 3 casual outfits for college, I'm a guy")
check("Asks for 3, gets 3", len(a.get("recommendations", [])) == 3,
      f"{len(a.get('recommendations', []))} looks in {seconds:.0f} s; understood {understood.get('understood')}")

# 2. Change only the shoes of the first look
understood, b, seconds = say("change the shoes in the first one", a)
edit = understood.get("edit") or {}
ok = bool(b) and edit.get("action") == "swap_pieces" and edit.get("looks") == [1]
if ok:
    first_before, first_after = pieces(a["recommendations"][0]), pieces(b["recommendations"][0])
    ok = (first_after.get("footwear") != first_before.get("footwear")
          and {k: v for k, v in first_after.items() if k != "footwear"} == {k: v for k, v in first_before.items() if k != "footwear"}
          and [pieces(l) for l in b["recommendations"][1:]] == [pieces(l) for l in a["recommendations"][1:]])
check('"Change the shoes in the first one": only look 1\'s shoes change', ok,
      f"{a['recommendations'][0].get('footwear')} -> {(b.get('recommendations') or [{}])[0].get('footwear')}; "
      f"plan {edit.get('action')} {edit.get('looks')}; note: {(b.get('edit') or {}).get('note')}; {seconds:.0f} s")

# 3. Refine everything in a direction
understood, c, seconds = say("make them a bit more formal", b)
edit = understood.get("edit") or {}
check('"Make them more formal": refines all 3, count kept',
      edit.get("action") == "refine" and len(c.get("recommendations", [])) == 3
      and [pieces(l) for l in c["recommendations"]] != [pieces(l) for l in b["recommendations"]],
      f"{show(c)}; note: {(c.get('edit') or {}).get('note')}; {seconds:.0f} s")

# 4. Replace one look
understood, d, seconds = say("I don't like the second one", c)
edit = understood.get("edit") or {}
ok = edit.get("action") in ("replace_looks", "drop_looks") and edit.get("looks") == [2] and bool(d)
if ok and edit["action"] == "replace_looks":
    ok = (pieces(d["recommendations"][0]) == pieces(c["recommendations"][0])
          and pieces(d["recommendations"][2]) == pieces(c["recommendations"][2])
          and pieces(d["recommendations"][1]) != pieces(c["recommendations"][1]))
check('"I don\'t like the second one": only look 2 changes', ok,
      f"plan {edit.get('action')} {edit.get('looks')}; {c['recommendations'][1].get('title')} -> "
      f"{(d.get('recommendations') or [{}, {}])[1].get('title') if len(d.get('recommendations', [])) > 1 else '-'}; {seconds:.0f} s")

# 5. Remove one: no model call needed for the looks
understood, e, seconds = say("remove the last one", d)
edit = understood.get("edit") or {}
check('"Remove the last one": 2 looks left, the others untouched',
      edit.get("action") == "drop_looks" and len(e.get("recommendations", [])) == len(d["recommendations"]) - 1
      and [pieces(l) for l in e["recommendations"]] == [pieces(l) for l in d["recommendations"][:-1]],
      f"plan {edit.get('action')} {edit.get('looks')}; {seconds:.0f} s (understanding only)")

# 6. More like these
understood, f, seconds = say("show me 2 more", e)
edit = understood.get("edit") or {}
check('"Show me 2 more": adds 2, keeps the rest',
      edit.get("action") == "more" and len(f.get("recommendations", [])) == len(e["recommendations"]) + 2
      and [pieces(l) for l in f["recommendations"][:len(e["recommendations"])]] == [pieces(l) for l in e["recommendations"]],
      f"{len(e['recommendations'])} -> {len(f.get('recommendations', []))} looks; {seconds:.0f} s")

# 7. A photo, then "make it casual" without sending the photo again
history.clear()
understood, g, seconds = say("What can I wear with this for college?", None, PHOTO)
own = {slot: g["recommendations"][0].get(slot) for slot in g["recommendations"][0].get("keep", [])} if g else {}
check("Photo answer keeps their own pieces", bool(own),
      f"their own: {own}; saw {[i.get('color', '') + ' ' + i.get('item', '') for i in g.get('outfit_analysis', {}).get('visible_items', [])]}; {seconds:.0f} s")

understood, h, seconds = say("make it more casual", g)
kept = all(
    all(look.get(slot) == value for slot, value in {s: before.get(s) for s in before.get("keep", [])}.items())
    for look, before in zip(h.get("recommendations", []), g.get("recommendations", []))
) if h else False
check('"Make it more casual" after a photo keeps their own pieces', kept and (understood.get("edit") or {}).get("action") == "refine",
      f"look 1 now: {pieces((h.get('recommendations') or [{}])[0])}; photo panel kept: "
      f"{bool(h.get('outfit_analysis', {}).get('visible_items'))}; {seconds:.0f} s")

understood, i, seconds = say("complete the look", h)
edit = understood.get("edit") or {}
filled_before = [set(pieces(l)) for l in h.get("recommendations", [])]
ok = edit.get("action") == "complete_look" and all(
    before <= set(pieces(after)) and all(after.get(s) == h["recommendations"][n].get(s) for s in before)
    for n, (before, after) in enumerate(zip(filled_before, i.get("recommendations", [])))
    if n + 1 in (edit.get("looks") or [])
) if i else False
check('"Complete the look" keeps every piece and fills the gaps', ok,
      f"plan {edit.get('action')} {edit.get('looks')}; note: {(i.get('edit') or {}).get('note')}; {seconds:.0f} s")

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
