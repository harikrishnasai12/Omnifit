"""
For You: a daily feed written by the AI for each person.

One Gemma call per person per day reads what OmniFit knows - Style DNA,
wardrobe, saved-look taste, recent conversations, today's weather,
upcoming festivals and trends for their generation - and writes the page:
a greeting, today's outfit, three conversation ideas, the best next buy,
a trend pick and a festival tip. app.py adds real products to each.
"""

import datetime
import json
import re
import devtools
from typing import Optional

# Upcoming festivals (India). Checked against officeholidays.com on
# 2026-09-30; lunar festivals move every year, so extend this list yearly.
# (date, name, festival choice in occasions.py or "Other")
FESTIVALS = [
    ("2026-10-11", "Navratri", "Navratri"),
    ("2026-10-17", "Durga Puja", "Durga Puja"),
    ("2026-10-20", "Dussehra", "Other"),
    ("2026-11-08", "Diwali", "Diwali"),
    ("2026-11-15", "Chhath Puja", "Other"),
    ("2026-11-24", "Guru Nanak Jayanti", "Other"),
    ("2026-12-25", "Christmas", "Christmas"),
    ("2026-12-31", "New Year's Eve", "Other"),
    ("2027-01-15", "Pongal", "Pongal"),
    ("2027-01-26", "Republic Day", "Other"),
    ("2027-03-09", "Eid-ul-Fitr", "Eid"),
    ("2027-03-22", "Holi", "Holi"),
    ("2027-04-07", "Ugadi / Gudi Padwa", "Other"),
    ("2027-04-14", "Tamil New Year / Vaisakhi", "Other"),
    ("2027-04-15", "Vishu", "Other"),
    ("2027-05-17", "Bakrid", "Eid"),
]

UPCOMING_DAYS = 60
MAX_UPCOMING = 4


def upcoming_festivals(today: Optional[datetime.date] = None) -> list[dict]:
    today = today or devtools.today()
    found = []
    for iso, name, choice in FESTIVALS:
        day = datetime.date.fromisoformat(iso)
        days_away = (day - today).days
        if 0 <= days_away <= UPCOMING_DAYS:
            found.append({
                "name": name,
                "date": iso,
                "label": f"{day.day} {day.strftime('%b')}",
                "days_away": days_away,
                "festival_choice": choice,
            })
    return found[:MAX_UPCOMING]


SLOTS = ("top", "layer", "bottom", "one_piece", "footwear", "accessory")

FEED_SCHEMA = {
    "type": "object",
    "properties": {
        "greeting": {"type": "string"},
        "today_title": {"type": "string"},
        "today_pieces": {
            "type": "array",
            "minItems": 2,
            "maxItems": 5,
            "items": {
                "type": "object",
                "properties": {
                    "slot": {"type": "string", "enum": list(SLOTS)},
                    "name": {"type": "string"},
                    "owned": {"type": "boolean"},
                    "search_query": {"type": "string"},
                },
                "required": ["slot", "name", "owned", "search_query"],
            },
        },
        "today_reason": {"type": "string"},
        "ideas": {
            "type": "array",
            "minItems": 3,
            "maxItems": 3,
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "message": {"type": "string"},
                    "why": {"type": "string"},
                },
                "required": ["title", "message", "why"],
            },
        },
        "next_buy": {
            "type": "object",
            "properties": {
                "item": {"type": "string"},
                "color": {"type": "string"},
                "why": {"type": "string"},
                "search_query": {"type": "string"},
            },
            "required": ["item", "color", "why", "search_query"],
        },
        "trend_pick": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "why": {"type": "string"},
                "search_query": {"type": "string"},
            },
            "required": ["title", "why", "search_query"],
        },
        "festival_tip": {"type": "string"},
    },
    "required": ["greeting", "today_title", "today_pieces", "today_reason", "ideas", "next_buy",
                 "trend_pick", "festival_tip"],
}


def feed_prompt(
    *,
    name: str,
    section: str,
    style_dna: dict,
    wardrobe_lines: list[str],
    taste: Optional[dict],
    recent: list[str],
    weather_section: str,
    festivals: list[dict],
    trend_lines: list[str],
    age_label: str,
) -> str:
    festival_text = "; ".join(f"{f['name']} on {f['label']} (in {f['days_away']} days)" for f in festivals) or "none soon"
    taste_text = ""
    if taste and taste.get("item_count"):
        taste_text = (f"Saved looks lean towards styles {', '.join(taste.get('styles') or []) or '-'}, "
                      f"colours {', '.join(taste.get('colors') or []) or '-'}.")
    return f"""You are OmniFit, a warm, expert personal stylist for Indian shoppers. Write today's personal
"For You" page for {name or "this person"}. Be specific to what you know about them; never generic.

WHAT YOU KNOW
- Shops for: {section or "not known (keep suggestions easy to adapt)"}{f"; generation: {age_label}" if age_label else ""}
- Style DNA: {json.dumps(style_dna, ensure_ascii=False) if style_dna else "nothing yet"}
- {taste_text or "No saved looks yet."}
- Clothes they own: {"; ".join(wardrobe_lines) if wardrobe_lines else "unknown (no wardrobe yet)"}
- Recent conversations: {" | ".join(recent) if recent else "none yet"}
- Upcoming festivals: {festival_text}
- Trending for them: {", ".join(trend_lines) if trend_lines else "-"}
{weather_section}

WRITE
- "greeting": one short, warm line for today, at most 12 words (mention the weather or an upcoming
  festival if relevant).
- "today_title" + "today_pieces": ONE outfit for today that suits the weather. Use pieces they own when
  possible (set "owned" true and write the piece exactly as listed); add 1-2 new pieces to buy
  ("owned" false). Each piece: "slot", "name" (colour + item), "search_query" (3-6 lowercase words:
  colour + details + item{" + " + section if section in ("men", "women") else ""}).
- "today_reason": one line on why it works today.
- "ideas": 3 conversation starters written for THIS person, each a different kind (an upcoming occasion,
  a way to use something they own or recently asked about, something new to try). "title": 3-6 words;
  "message": what they would send to you, in first person ("Plan my Diwali look under ₹4,000");
  "why": 1 short line.
- "next_buy": the one piece that would add the most new outfits to what they own (or, with no wardrobe,
  a versatile staple for their style), with "search_query".
- "trend_pick": one trend from the list that suits them, "title" + "why" + "search_query". It must be a
  different kind of item from "next_buy" and from today's new pieces, so the page never repeats itself.
- "festival_tip": one line of styling advice for the nearest festival, or "" if none soon.
Talk only about clothes, colours and occasions; never about the person's body or looks.
Everything in English. Return ONLY valid JSON."""


def _text(value, limit: int) -> str:
    return re.sub(r"\s+", " ", value).strip()[:limit] if isinstance(value, str) else ""


def _query(value) -> str:
    return " ".join(re.sub(r"[^a-z0-9\s-]", " ", _text(value, 80).lower()).split()[:8])


def clean_feed(raw: str) -> dict:
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("not an object")

    pieces = []
    for piece in (data.get("today_pieces") or [])[:5]:
        if isinstance(piece, dict) and _text(piece.get("name"), 80):
            pieces.append({
                "slot": piece.get("slot") if piece.get("slot") in SLOTS else "top",
                "name": _text(piece.get("name"), 80),
                "owned": bool(piece.get("owned")),
                "search_query": _query(piece.get("search_query")),
            })

    ideas = [
        {"title": _text(idea.get("title"), 60), "message": _text(idea.get("message"), 200), "why": _text(idea.get("why"), 160)}
        for idea in (data.get("ideas") or [])[:3]
        if isinstance(idea, dict) and _text(idea.get("message"), 200)
    ]

    next_buy = data.get("next_buy") if isinstance(data.get("next_buy"), dict) else {}
    trend = data.get("trend_pick") if isinstance(data.get("trend_pick"), dict) else {}

    if len(pieces) < 2 or not ideas:
        raise ValueError("feed too thin")

    return {
        "greeting": _text(data.get("greeting"), 200),
        "today": {"title": _text(data.get("today_title"), 60) or "Today's outfit", "pieces": pieces,
                  "reason": _text(data.get("today_reason"), 240)},
        "ideas": ideas,
        "next_buy": {
            "item": _text(next_buy.get("item"), 60), "color": _text(next_buy.get("color"), 30),
            "why": _text(next_buy.get("why"), 200), "search_query": _query(next_buy.get("search_query")),
        } if _query(next_buy.get("search_query")) else None,
        "trend_pick": {
            "title": _text(trend.get("title"), 60), "why": _text(trend.get("why"), 200),
            "search_query": _query(trend.get("search_query")),
        } if _query(trend.get("search_query")) else None,
        "festival_tip": _text(data.get("festival_tip"), 240),
    }
