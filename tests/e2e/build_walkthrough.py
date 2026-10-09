"""
Build the narrated persona walkthrough from a recorded run.

Reads results/personas/personas.json (from `npm run personas`), turns each
persona's journey into scenes (what they did, what the phone showed, what
the backend did, and a narration line), and writes one self-contained page:
the Persona Journeys page with a "Watch" player on top. Images are embedded,
so the page is a single file.

With --audio, it also speaks every narration line with the Windows voice
(System.Speech) into WAV files, and uses their lengths as scene durations,
so the MP4 export (record_walkthrough.mjs) lines up with the voice.

Usage (with the backend venv):
    python tests/e2e/build_walkthrough.py <out folder> [--audio]
"""

import base64
import hashlib
import json
import re
import subprocess
import sys
import wave
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "results" / "personas"
FIXTURES = HERE.parent / "ui" / "fixtures"
TEMPLATE = HERE / "walkthrough_template.html"
ALLOWED_IMAGE_HOSTS = ("cdn.shopify.com",)
PRONOUNS = {"arjun": ("he", "his", "him"), "priya": ("she", "her", "her"), "meena": ("she", "her", "her")}
VOICE = "Microsoft Zira Desktop"


class Images:
    """Embedded images, each stored once and referenced as "@<key>"."""

    def __init__(self):
        self.data: dict[str, str] = {}
        self.client = httpx.Client(timeout=20, follow_redirects=False)

    def add_bytes(self, content: bytes, mime: str = "image/jpeg") -> str:
        key = hashlib.sha1(content).hexdigest()[:12]
        self.data.setdefault(key, f"data:{mime};base64," + base64.b64encode(content).decode())
        return "@" + key

    def file(self, path: Path) -> str:
        return self.add_bytes(path.read_bytes())

    def url(self, url):
        if not url or not url.startswith("https://") or httpx.URL(url).host not in ALLOWED_IMAGE_HOSTS:
            return None
        try:
            response = self.client.get(url)
        except httpx.HTTPError:
            return None
        if response.status_code != 200 or not response.headers.get("content-type", "").startswith("image/"):
            return None
        return self.add_bytes(response.content)


def secs(ms) -> str:
    seconds = (ms or 0) / 1000
    return f"{seconds:.1f} seconds" if seconds < 10 else f"{round(seconds)} seconds"


def spoken(text: str) -> str:
    """Narration text for a voice: rupees in words, no symbols."""
    text = re.sub(r"₹\s?(\d[\d,]*\d|\d)", r"\1 rupees", text)
    text = re.sub(r"(\d)\s?°C", r"\1 degrees", text)
    text = text.replace("–", " to ")
    return text.replace("·", ",").replace("“", "").replace("”", "").replace("’", "'")


def plural(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


def traces_of(step: dict, path: str) -> list[dict]:
    return [trace for trace in step.get("traces", []) if trace["path"] == path]


def backend_steps(trace: dict, kinds=None, limit: int = 8) -> list[dict]:
    rows = []
    for item in trace["steps"]:
        if kinds and item["kind"] not in kinds:
            continue
        if item["kind"] == "stream" and not any(word in item["label"] for word in ("understood", "question", "done")):
            continue
        rows.append({"kind": item["kind"], "label": item["label"], "ms": item["ms"]})
    return rows[:limit]


def node_times(traces: list[dict]) -> dict:
    """Total ms per diagram node for these traces."""
    nodes: dict[str, float] = {}
    for trace in traces:
        for item in trace["steps"]:
            if item["kind"] == "gemma":
                key = "understand" if "Understanding" in item["label"] else "style"
            elif item["kind"] in ("catalog", "intent", "context", "memory", "voice"):
                key = item["kind"]
            else:
                continue
            nodes[key] = nodes.get(key, 0) + (item["ms"] or 0)
    return {key: round(value) for key, value in nodes.items()}


def card(card: dict, images: Images) -> dict:
    return {
        "type": card["type"],
        "title": card.get("title"),
        "reason": card.get("reason"),
        "price": card.get("price"),
        "image": images.url(card.get("image")),
    }


def weather_of(persona: dict):
    for step in persona["steps"]:
        for trace in step["traces"]:
            for item in trace["steps"]:
                if item["label"].startswith("Weather") and item["data"].get("feel"):
                    return item["data"]
    return None


def scenes_for(persona: dict, images: Images) -> list[dict]:
    he, his, him = PRONOUNS.get(persona["id"], ("they", "their", "them"))
    He = he.capitalize()
    name = persona["name"]
    scenes = []

    def add(kind, title, narration, phone=None, nodes=None, log=None, caption=None):
        scenes.append({
            "type": kind, "title": title, "narration": spoken(narration), "caption": caption or narration,
            "phone": phone or {}, "nodes": nodes or {}, "log": log or [],
        })

    weather = weather_of(persona)
    weather_text = f" It's {weather['high']} degrees and {weather['feel']} in {persona['city']}." if weather else ""
    import datetime
    day = datetime.date.fromisoformat(persona["date"])
    add("intro", f"Meet {name}",
        f"Meet {name}: {persona['age']}, from {persona['city']}. It's {day.strftime('%A')}, {day.day} {day.strftime('%B')}, "
        f"{persona['when'].split(',', 1)[-1].strip()}."
        f"{weather_text} What {he} is into: {persona['trend']}.",
        phone={"kind": "intro", "name": name, "age": persona["age"], "city": persona["city"],
               "date": persona["date"], "when": persona["when"], "trend": persona["trend"], "weather": weather},
        nodes={"context": 0} if weather else {})

    steps = persona["steps"]
    for index, step in enumerate(steps):
        o = step.get("outcome", {})
        title = step["title"]
        shot = images.file(SOURCE / step["screenshot"]) if step.get("screenshot") else None

        if title == "Opens the Stylist":
            if persona.get("startsAsGuest"):
                add("screen", "Opens OmniFit as a guest",
                    f"{name} opens the app without an account. As a guest, nothing {he} does is stored on our server; "
                    f"{his} taste stays on {his} phone.", phone={"kind": "screen", "image": shot})
            continue

        if title == "Signs up":
            add("screen", "Signs up",
                f"{name} creates an account and agrees to let OmniFit remember {his} style. "
                f"{He} can pause, reset or delete it at any time.", phone={"kind": "screen", "image": shot})
            continue

        if title in ("Asks the stylist", "Uploads a photo", "Takes a picture"):
            chats = traces_of(step, "/api/chat")
            first = chats[0] if chats else {"steps": []}
            understand = next((i for i in first["steps"] if i["kind"] == "gemma"), None)
            understood_event = next((i for i in first["steps"] if i["label"].endswith("understood")), None)
            saved = (understood_event or {}).get("data", {}).get("saved_events") or []
            message = o.get("message", "")
            photo = o.get("photo")
            photo_ref = images.file(FIXTURES / o["photo_file"]) if photo else None

            if photo == "upload":
                add("photo", "Uploads a photo",
                    f"Next, {name} wants ideas for clothes {he} already has. {He} taps the camera icon, picks "
                    f"Choose a photo, and uploads an outfit photo from {his} gallery. It's attached to {his} message.",
                    phone={"kind": "gallery", "image": photo_ref,
                           "attached": images.file(SOURCE / o["attached"]) if o.get("attached") else None})
            elif photo == "camera":
                add("photo", "Takes a picture",
                    f"Then {he} tries the camera. {He} taps Take a photo, frames what {he}'s wearing, and presses "
                    f"the shutter. As a guest, the photo is only used for this answer and isn't stored.",
                    phone={"kind": "camera", "image": images.file(SOURCE / o["viewfinder"]) if o.get("viewfinder") else photo_ref,
                           "attached": images.file(SOURCE / o["attached"]) if o.get("attached") else None})

            said = (f"{He} types in Hinglish, asking for something traditional for Diwali, mentioning {his} age, "
                    f"with a budget of 4,000 rupees." if persona["id"] == "meena"
                    else f"{He} types: {message}")
            add("typing", "Types a message", said, phone={"kind": "typing", "text": message, "image": photo_ref},
                caption=f"{He} types: “{message}”")

            chips = o.get("understood", [])
            narration = (f"Gemma, the AI model on our own server, reads it and understands: {', '.join(chips)}. "
                         f"That took {secs(understand['ms'] if understand else 0)}.")
            if saved:
                narration += f" It also spots a date, and saves {saved[0]} as an event."
            if photo:
                narration = (f"First, Gemma reads the message, knowing a photo is attached, and understands: "
                             f"{', '.join(chips)}. That took {secs(understand['ms'] if understand else 0)}.")
            add("understood", "Gemma understands", narration,
                phone={"kind": "chat", "text": message, "chips": chips, "image": photo_ref},
                nodes={"understand": round(understand["ms"]) if understand else 0, **({"intent": 0} if saved else {})},
                log=backend_steps(first))

            if o.get("question"):
                add("question", "Asks one question",
                    f"One detail would change the outfit, so it asks just one question: {o['question']} "
                    f"{name} taps {o.get('answered')}.",
                    phone={"kind": "chat", "text": message, "chips": chips, "question": o["question"],
                           "answer": o.get("answered")})

            last = chats[-1] if chats else {"steps": []}
            # The attempt that answered is the last one (earlier ones may have been retried)
            style = next((i for i in reversed(last["steps"]) if i["kind"] == "gemma" and "Styling" in i["label"]), None)
            nxt = steps[index + 1] if index + 1 < len(steps) else {}
            product_traces = traces_of(step, "/api/products") or traces_of(nxt, "/api/products")
            searches = sum(1 for t in product_traces for i in t["steps"] if i["kind"] == "catalog")
            looks = o.get("looks", [])
            saw = ((style or {}).get("data") or {}).get("saw") or []
            if photo:
                around = (f"It keeps {his} own pieces and completes the outfit around them."
                          if len(looks) <= 1 else
                          f"It keeps {his} own pieces and styles {len(looks)} looks around them: {', '.join(looks)}.")
                if searches:
                    styled_text = (f"Now Gemma looks at the photo itself{': it sees ' + ', '.join(saw) if saw else ''}. "
                                   f"{around} Only the missing pieces are matched to real products, with {searches} "
                                   f"searches. This took {secs(style['ms'] if style else 0)}.")
                else:
                    styled_text = (f"Now Gemma looks at the photo itself{': it sees ' + ', '.join(saw) if saw else ''}. "
                                   f"This time it says the outfit already works for college, and suggests nothing new "
                                   f"to buy. The shared GPU was busy, so this answer is weaker than usual.")
            else:
                styled_text = (f"Then Gemma styles {len(looks)} complete looks: {', '.join(looks)}. "
                               f"The app matches every piece to real products, with {searches} searches across 92,000 "
                               f"items from 32 Indian brands. Styling took {secs(style['ms'] if style else 0)}.")
            add("styled", "Styles looks around the photo" if photo else "Styles complete looks", styled_text,
                phone={"kind": "screen", "image": shot},
                nodes={"style": round(style["ms"]) if style else 0, "catalog": searches},
                log=backend_steps(last, limit=6) + [
                    {"kind": "catalog", "label": f"Catalogue search × {searches}", "ms": None}])
            continue

        if title.startswith("Home"):
            for_you = traces_of(step, "/api/for-you")
            fests = o.get("festivals", [])[:2]
            add("screen", "An AI-written Home page",
                f"On Home, Gemma writes a page just for {him}: “{o.get('greeting', '')}” "
                f"It also knows what's coming up: {' and '.join(fests)}.",
                phone={"kind": "screen", "image": shot}, nodes=node_times(for_you),
                log=backend_steps(for_you[0]) if for_you else [])
            continue

        if title.startswith("Scrolls the look feed"):
            feeds = traces_of(step, "/api/feed")
            cards = [card(c, images) for c in (o.get("feed") or [])[:5]]
            ms = feeds[0]["ms"] if feeds else 0
            first_reason = next((c["reason"] for c in cards if c["reason"]), "")
            special = next((c for c in cards if c["type"] in ("event", "festival")), None)
            seen_feed = any(s["type"] == "feed" for s in scenes)
            text = (f"Signed in now, {his} feed opens in {secs(ms)}, ranked for {him} on the server."
                    if seen_feed else
                    f"Next, {his} look feed. It opens in {secs(ms)}, with no AI call, because looks are built "
                    f"ahead of time and only ranked now.")
            if special and special["type"] == "event":
                text += f" At the top: a countdown for {his} {special['title']}, then looks for it."
            elif first_reason:
                text += f" Every card says why it's there, like: {first_reason}."
            add("feed", "The look feed", text, phone={"kind": "feed", "cards": cards},
                nodes={"catalog": 0, "intent": round(ms)}, log=backend_steps(feeds[0]) if feeds else [])

            loved, skipped = o.get("loved", []), o.get("skipped", [])
            if "guest" in title:
                add("signals", "Loves a look, as a guest",
                    f"{name} loves {', '.join(loved)}. As a guest, the server stores nothing: zero signals. "
                    f"{his.capitalize()} phone re-ranks the feed by itself.",
                    phone={"kind": "signals", "loved": loved, "skipped": [], "stored": 0, "guest": True})
            else:
                add("signals", "Loves and skips",
                    f"{name} loves {plural(len(loved), 'look')} and skips {len(skipped)}. Each tap, and how long {he} looks, "
                    f"is a signal. The Intent Engine stored {o.get('stored_on_server', 0)} of them, and updates "
                    f"{his} taste scores.",
                    phone={"kind": "signals", "loved": loved, "skipped": skipped, "stored": o.get("stored_on_server", 0)},
                    nodes={"intent": 0})
            continue

        if title.startswith("Comes back"):
            feeds = traces_of(step, "/api/feed")
            cards = [card(c, images) for c in (o.get("feed") or [])[:5]]
            reasons = list(dict.fromkeys(c["reason"] for c in cards if c["reason"] and c["type"] == "look"))[:2]
            add("feed", "The feed has learned",
                f"When {he} comes back, the feed has learned. The reasons change: {'; '.join(reasons)}.",
                phone={"kind": "feed", "cards": cards}, nodes={"intent": round(feeds[0]["ms"]) if feeds else 0},
                log=backend_steps(feeds[0]) if feeds else [])
            continue

        if title.startswith('"Not me"'):
            value = o.get("corrected", "").split(":")[-1].strip()
            add("notme", "Not me",
                f"{name} doesn't wear {value}, so {he} taps Not me on {value}. Corrections always win: "
                f"looks with {value} leave {his} feed straight away.",
                phone={"kind": "notme", "value": value, "cards": [card(c, images) for c in (o.get("feed") or [])[:3]]},
                nodes={"intent": 0})
            continue

        if title.startswith("You"):
            profile = o.get("profile") or {}
            taste = profile.get("taste", {})
            bars = [{"dimension": dim, "label": item["label"], "confidence": item["confidence"]}
                    for dim in ("style", "occasion", "colour") for item in taste.get(dim, [])[:2]]
            events = profile.get("events", [])
            text = f"On {his} You page, OmniFit explains what it learned, in plain words: {profile.get('summary', '')}"
            if events:
                text += f" It also remembers {events[0]['name']}, {events[0]['days_away']} days away."
            text += f" Every item has a Why button, and {he} can correct, pause or reset it."
            add("profile", "What OmniFit learned", text,
                phone={"kind": "profile", "summary": profile.get("summary"), "bars": bars,
                       "events": events[:1], "not_me": profile.get("not_me", [])})
            continue

    all_traces = [t for s in steps for t in s["traces"]]
    gemma = sum(1 for t in all_traces for i in t["steps"] if i["kind"] == "gemma")
    feed_ms = [t["ms"] for t in all_traces if t["path"] == "/api/feed"]
    add("outro", f"{name}'s session",
        f"That was {name}'s session: {len(all_traces)} requests and {gemma} AI calls. Feed pages took under "
        f"{secs(max(feed_ms) if feed_ms else 0)}. Afterwards the throwaway account was deleted, with everything learned.",
        phone={"kind": "outro", "requests": len(all_traces), "gemma": gemma,
               "feed_ms": round(max(feed_ms)) if feed_ms else 0})
    return scenes


def speak(scenes_by_persona: dict, out: Path) -> None:
    """One WAV per scene with the Windows voice; durations go into the scenes."""
    audio = out / "audio"
    audio.mkdir(parents=True, exist_ok=True)
    jobs = []
    for pid, scenes in scenes_by_persona.items():
        for index, scene in enumerate(scenes):
            path = audio / f"{pid}-{index:02d}.wav"
            scene["audio"] = path.name
            jobs.append({"text": scene["narration"], "path": str(path)})
    (audio / "jobs.json").write_text(json.dumps(jobs), encoding="utf-8")
    script = f"""
Add-Type -AssemblyName System.Speech
$jobs = Get-Content -Raw -Encoding UTF8 '{audio / "jobs.json"}' | ConvertFrom-Json
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {{ $s.SelectVoice('{VOICE}') }} catch {{}}
$s.Rate = 0
foreach ($job in $jobs) {{ $s.SetOutputToWaveFile($job.path); $s.Speak($job.text) }}
$s.SetOutputToNull()
"""
    subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], check=True)
    for scenes in scenes_by_persona.values():
        for scene in scenes:
            with wave.open(str(audio / scene["audio"])) as wav:
                scene["seconds"] = round(wav.getnframes() / wav.getframerate(), 2)


def main(out: Path, with_audio: bool) -> None:
    run = json.loads((SOURCE / "personas.json").read_text(encoding="utf-8"))
    images = Images()
    story = {"personas": []}
    scenes_by_persona = {}
    for persona in run["personas"]:
        scenes = scenes_for(persona, images)
        scenes_by_persona[persona["id"]] = scenes
        story["personas"].append({"id": persona["id"], "name": persona["name"], "age": persona["age"],
                                  "city": persona["city"], "scenes": scenes})
    if with_audio:
        speak(scenes_by_persona, out)

    # The journey data, with its images embedded the same way
    for persona in run["personas"]:
        persona.pop("account", None)
        for step in persona["steps"]:
            if step.get("screenshot"):
                step["screenshot"] = images.file(SOURCE / step["screenshot"])
            o = step.get("outcome", {})
            for key in ("feed", "after_love_on_device"):
                for c in o.get(key) or []:
                    c["image"] = images.url(c.get("image"))
            for s in o.get("stories") or []:
                s["cover"] = images.url(s.get("cover"))

    def embed(value) -> str:
        return json.dumps(value, ensure_ascii=False).replace("</", "<\\/")

    html = (TEMPLATE.read_text(encoding="utf-8")
            .replace("__IMAGES__", embed(images.data))
            .replace("__STORY__", embed(story))
            .replace("__RECORDING__", embed(run)))
    out.mkdir(parents=True, exist_ok=True)
    (out / "journeys.html").write_text(html, encoding="utf-8")
    (out / "story.json").write_text(json.dumps(story, ensure_ascii=False, indent=1), encoding="utf-8")
    total = sum(s.get("seconds", 0) for scenes in scenes_by_persona.values() for s in scenes)
    print(f"{sum(len(s) for s in scenes_by_persona.values())} scenes, {len(images.data)} images, "
          f"page {len(html.encode()) / 1e6:.1f} MB" + (f", narration {total / 60:.1f} min" if with_audio else ""))


if __name__ == "__main__":
    main(Path(sys.argv[1]), "--audio" in sys.argv)
