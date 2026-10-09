"""
AI-written suggestions, end to end with the real model: today's starters
for the welcome screen, and the next steps that come with each answer
(specific to it, and usable as the next message).

Needs the backend on port 8000. About 2 minutes (live Gemma).

Usage (from backend/, with the venv active):
    python tests/suggestions.py
Exit code 1 if any check fails.
"""

import json
import sys
import time

import httpx

API = "http://127.0.0.1:8000"
GENERIC = ("show more", "other options", "more options", "see more", "something else")

sys.stdout.reconfigure(encoding="utf-8")
results = []
client = httpx.Client(base_url=API, timeout=300)


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(f"{'✅' if ok else '❌'} {name}{f' - {detail}' if detail else ''}")


def chat(message: str, history: list, current: dict | None = None) -> dict:
    data = {"message": message, "history": json.dumps(history), "profile": json.dumps({"department": "men"}),
            "region": "IN"}
    if current:
        data["current"] = json.dumps({k: current[k] for k in ("request_type", "recommendations", "outfit_analysis")})
    out = {}
    with client.stream("POST", "/api/chat", data=data) as stream:
        for line in stream.iter_lines():
            event = json.loads(line) if line else {}
            if event.get("event") in ("understood", "stylist", "advice"):
                out[event["event"]] = event.get("result", event)
    return out


# 1. Starters for today (Chennai)
body = {"profile": {"department": "men", "age_group": "gen_z"}, "region": "IN", "latitude": 13.08, "longitude": 80.27}
started = time.time()
first = client.post("/api/starters", json=body)
starters = first.json().get("starters", []) if first.status_code == 200 else []
check("Starters written for today", first.status_code == 200 and len(starters) >= 4
      and all(8 <= len(s["text"]) <= 70 and s["icon"] for s in starters),
      f"{time.time() - started:.0f} s: " + " | ".join(f"{s['icon']} {s['text']}" for s in starters))
started = time.time()
again = client.post("/api/starters", json=body).json()
check("Second open is instant (cached for the day)", again.get("cached") and again["starters"] == starters,
      f"{(time.time() - started) * 1000:.0f} ms")

# 2. Next steps with a stylist answer
turn = chat("3 office outfits for men under 3000", [])
answer = turn.get("stylist", {})
steps = answer.get("next_steps", [])
check("The answer comes with 3-4 next steps", 3 <= len(steps) <= 4, " | ".join(steps))
check("They are specific, not generic", bool(steps) and not any(s.lower() in GENERIC for s in steps)
      and all(2 <= len(s.split()) <= 9 and "?" not in s for s in steps))

# 3. Tapping one works as the next message
if steps:
    history = [{"role": "user", "text": "3 office outfits for men under 3000"},
               {"role": "assistant", "text": "Suggested: " + "; ".join(l.get("title", "") for l in answer["recommendations"])}]
    follow = chat(steps[0], history, answer)
    edit = (follow.get("understood") or {}).get("edit")
    check(f'Tapping "{steps[0]}" edits the looks on screen', bool(edit) and bool(follow.get("stylist")),
          f"plan {edit and edit.get('action')} {edit and edit.get('looks')}; note: "
          f"{((follow.get('stylist') or {}).get('edit') or {}).get('note')}; new steps: "
          f"{' | '.join((follow.get('stylist') or {}).get('next_steps', []))}")

# 4. Next steps with an advice answer
turn = chat("which colours go well with olive green?", [])
advice = turn.get("advice", {})
check("Advice answers suggest what to ask next", len(advice.get("next_steps", [])) >= 2,
      " | ".join(advice.get("next_steps", [])))

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
