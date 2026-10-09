"""
The conversation engine's first step: understanding a message.

One small Gemma call reads the user's message (any language), the recent
conversation and their Style DNA, and returns a structured plan:
what they want (intent), the occasion and its details, section, budget,
anything they told us about themselves to remember, and - only when a key
detail is missing - one short follow-up question with tap-to-answer options.
Every value comes from a fixed list, so the plan is always usable.
"""

import datetime
import json
import re
import devtools
from typing import Optional

import edits
from occasions import OCCASIONS
from personal import FACE_SHAPES, UNDERTONES
from trends import AGE_GROUPS

INTENTS = {
    "stylist": "styling advice: outfits, looks, what to wear, pieces that go with something, refining an earlier answer",
    "shop": "just wants to browse/buy a specific product type, no styling (e.g. 'wide leg trousers', 'white sneakers')",
    "wardrobe": "outfits made from clothes they already own ('what can I wear from my wardrobe')",
    "how_to_wear": "how to style one specific piece they have or are looking at",
    "advice": "a general fashion question that needs an explanation, not products (colours, fabrics, care, trends, etiquette)",
    "chat": "greetings, thanks, or anything not about fashion",
}

TOP_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL"]
WAIST_SIZES = [str(size) for size in range(26, 44, 2)]
SHOE_SIZES = [str(size) for size in range(3, 13)]
FITS = ["snug", "regular", "relaxed"]

MAX_OPTIONS = 5
# An occasion detail can offer its full list (a wedding has 7 functions)
MAX_DETAIL_OPTIONS = 10
MAX_UNDERSTOOD = 6
MAX_HISTORY_TURNS = 6


def _occasion_detail_options() -> dict[str, list[str]]:
    """Every quick-question id with the union of its options across occasions."""
    options: dict[str, list[str]] = {}
    for spec in OCCASIONS.values():
        for question, q in spec["questions"].items():
            options.setdefault(question, [])
            options[question] += [option for option in q["options"] if option not in options[question]]
    return options


DETAIL_OPTIONS = _occasion_detail_options()

REMEMBER_VALUES = {
    # The section they shop in, only when they say it about themselves
    "shops_for": ["men", "women"],
    "age_group": list(AGE_GROUPS),
    "face_shape": list(FACE_SHAPES),
    "undertone": list(UNDERTONES),
    "fit": FITS,
    "top_size": TOP_SIZES,
    "waist_size": WAIST_SIZES,
    "shoe_size": SHOE_SIZES,
}


def _today_text() -> str:
    today = devtools.today()
    return f"{today.strftime('%A')} {today.isoformat()}"


def _enum(values: list[str]) -> dict:
    return {"type": "string", "enum": [""] + list(values)}


SCHEMA = {
    "type": "object",
    "properties": {
        "intent": {"type": "string", "enum": list(INTENTS)},
        "search_text": {"type": "string"},
        "occasion": {"type": "string", "enum": ["none"] + list(OCCASIONS)},
        # Details the user stated, as plain values ("Reception", "Close family");
        # mapped to their questions on our side
        "occasion_details": {
            "type": "array",
            "maxItems": 4,
            "items": {"type": "string", "enum": sorted({o for options in DETAIL_OPTIONS.values() for o in options})},
        },
        "department": {"type": "string", "enum": ["men", "women", "unisex", "unknown"]},
        "budget_min": {"type": "integer"},
        "budget_max": {"type": "integer"},
        # Facts the user stated about themselves, each with their exact words
        # as proof (checked against the message; anything unproven is dropped)
        "remember": {
            "type": "array",
            "maxItems": 4,
            "items": {
                "type": "object",
                "properties": {
                    "field": {"type": "string", "enum": list(REMEMBER_VALUES)},
                    "value": {"type": "string"},
                    "quote": {"type": "string"},
                },
                "required": ["field", "value", "quote"],
            },
        },
        # An event with a date the user stated ("my sister's wedding on 14 Dec"),
        # with their exact words as proof; empty strings when none
        "event": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "date": {"type": "string"},
                "quote": {"type": "string"},
            },
            "required": ["name", "date", "quote"],
        },
        # How many looks or items they asked for ("show me 2", "5 options"); 0 when not said
        "count": {"type": "integer"},
        # What to do with the suggestions on screen (see edits.py)
        "edit": edits.PLAN_SCHEMA,
        # The attached photo: the clothes only (never the person)
        "photo": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "maxItems": 8,
                    "items": {
                        "type": "object",
                        "properties": {"item": {"type": "string"}, "color": {"type": "string"}},
                        "required": ["item", "color"],
                    },
                },
                "style": {"type": "string"},
                # The occasion these clothes suit, used when they don't say one
                "occasion_hint": {"type": "string", "enum": ["none"] + list(OCCASIONS)},
                # Their own pieces they want replaced / kept ("change my shoes")
                "change": {"type": "array", "items": {"type": "string", "enum": list(edits.SLOTS)}},
                "keep": {"type": "array", "items": {"type": "string", "enum": list(edits.SLOTS)}},
            },
            "required": ["items", "style", "occasion_hint", "change", "keep"],
        },
        "understood": {"type": "array", "maxItems": MAX_UNDERSTOOD, "items": {"type": "string"}},
        "follow_up_question": {"type": "string"},
        # Which occasion detail the question asks about ("" for other questions)
        "follow_up_detail": _enum(list(DETAIL_OPTIONS)),
        "follow_up_options": {"type": "array", "maxItems": MAX_OPTIONS, "items": {"type": "string"}},
        "reply": {"type": "string"},
    },
    "required": ["intent", "search_text", "occasion", "occasion_details", "department", "budget_min",
                 "budget_max", "remember", "event", "count", "edit", "photo", "understood", "follow_up_question",
                 "follow_up_detail", "follow_up_options", "reply"],
}


def history_text(history: list[dict]) -> str:
    lines = []
    for turn in history[-MAX_HISTORY_TURNS:]:
        role = "User" if turn.get("role") == "user" else "OmniFit"
        text = re.sub(r"\s+", " ", str(turn.get("text", "")))[:400]
        if text:
            lines.append(f"{role}: {text}")
    return "\n".join(lines)


def profile_text(profile: dict) -> str:
    known = {key: value for key, value in (profile or {}).items() if value not in (None, "", [], {})}
    return json.dumps(known, ensure_ascii=False) if known else "nothing yet"


PHOTO_RULES = """- A PHOTO IS ATTACHED. Look at the CLOTHES in it and fill "photo":
  "items": every clothing item, shoe and accessory you can see, each with a precise colour ("mustard
  yellow" + "t-shirt", "blue" + "wide-leg cargo jeans"); "style": a short phrase for the look ("relaxed
  streetwear"); "occasion_hint": the occasion these clothes suit best ("casual" for a tee and jeans,
  "wedding" or "festival" for silk ethnic wear, "office" for formal shirts), "none" if unclear;
  "change": their own pieces the message asks to replace ("change my shoes" -> ["footwear"], "a better
  top" -> ["top"]); "keep": pieces they say to keep ("keep the trousers" -> ["bottom"]).
  Slots: top, layer, bottom, footwear, accessories, extra.
- Describe ONLY the clothes. Never describe or judge the person: not their body, face, skin, hair, age
  or gender. Never set "department" from the person, only from their words.
- The photo answers what they are wearing and its style: never ask about those. If they don't name an
  occasion, the photo's occasion_hint is used, so do NOT ask for the occasion either. Ask a follow-up
  only if they named an occasion that needs a detail (e.g. which wedding function).
- Put what you saw in "understood" as one chip, e.g. "Photo: mustard tee, cargo jeans"."""

NO_PHOTO_RULES = """- No photo is attached: "photo" is {"items": [], "style": "", "occasion_hint": "none", "change": [],
  "keep": []}."""


def prompt(message: str, history: list[dict], profile: dict, has_photo: bool, just_asked: bool,
           current: Optional[dict] = None) -> str:
    intents = "\n".join(f'- "{name}": {meaning}' for name, meaning in INTENTS.items())
    occasions = "\n".join(
        f'- "{occasion_id}" ({spec["label"]}): details '
        + "; ".join(f'{q}: {", ".join(spec["questions"][q]["options"])}' for q in spec["questions"])
        for occasion_id, spec in OCCASIONS.items()
    )
    return f"""You are the understanding step of OmniFit, an AI fashion stylist for Indian shoppers.
Read the user's newest message in the context of the conversation, and fill the JSON plan.

Intents:
{intents}

Occasions and their details (use only these values; "none" if no occasion):
{occasions}

Rules:
- The message may be in any language or a mix (Tamil, Hindi, Tanglish, Hinglish). Understand it; write
  "search_text", "understood", "reply" and the follow-up in English.
- "search_text": a short English shopping phrase for what they want: colour + item + section (e.g.
  "wide leg trousers women", "white formal shirt men"). No prices, occasions or other words. "" for
  chat/advice.
- "occasion_details": every detail the user has actually STATED anywhere in the conversation (e.g. after
  "Reception, I'm close family": "Reception", "Close family"). Never infer one: "my cousin's wedding"
  does not say whether they are a guest or close family.
- "understood" chips follow the same rule: only what the user said, never a guess.
- A message that changes an earlier answer ("darker", "cheaper", "show more", "something for a
  wedding instead", "complete this look") is intent "stylist" and keeps the earlier occasion and section
  unless the user changes them.
- "department": from their words or the conversation, else their Style DNA, else "unknown". Never guess
  it from a person's face or body.
- Budget in rupees from their words ("under 1500" -> budget_max 1500); 0 when not given.
- "remember": ONLY facts the user explicitly states about themselves IN THE NEWEST MESSAGE, each with
  "quote" = their exact words ("I'm 24" -> age_group gen_z; "I wear M" -> top_size M; "my face is round"
  -> face_shape round; "I'm a woman" / "I shop men's" -> shops_for). Shopping for someone else ("for my
  husband") is NOT about themselves: never remember it. Usually this is an empty list. Never infer
  anything, never from a photo.
  Age groups: gen_z 12-29, millennial 30-45, gen_x 46-61, boomer 62+.
- "event": when the NEWEST MESSAGE names an event they are dressing for WITH a date or day ("my
  sister's wedding on 14 December", "a party this Saturday", "interview next Monday", "a reception next
  week", "a trip in a week", "a function tomorrow"): "name" = a short title ("Sister's wedding"),
  "date" = YYYY-MM-DD worked out from today ({_today_text()}; a date without a year is the next one to
  come), "quote" = their exact words for the date ("next week", "in a week"). A loose time like "next
  week" still counts as a date. No date or day said: all three "".
- "understood": up to {MAX_UNDERSTOOD} very short chips of what you understood (e.g. "Wedding reception",
  "Guest", "Under ₹6,000", "Womenswear"). For an edit, say what will change ("Casual version", "New shoes
  for look 1", "Keeping your kurta").
- "count": how many looks or items the NEWEST MESSAGE asks for ("show me 2 looks" -> 2, "5 kurta
  options" -> 5, "2 more" -> 2); 0 when no number is said.
{edits.understanding_prompt_section(current)}
- Follow-up: ask about ONE thing, only when the answer would clearly change the outfit and the user
  hasn't said it: for a wedding, which function (then the role); for a festival, which one; the section
  when it is unknown and they want outfits without a photo. When it is an occasion detail, set
  "follow_up_detail" to that detail's name (e.g. "function"); the options then come from its list.
  Otherwise give 2-{MAX_OPTIONS} short tap-to-answer options.
  {"Do NOT ask anything now: you just asked a question." if just_asked else ""}
  If nothing essential is missing, leave "follow_up_question" empty and "follow_up_options" [].
- "reply": one warm, short sentence to show before the results (or the full answer for "chat").
{PHOTO_RULES if has_photo else NO_PHOTO_RULES}

Their Style DNA (what OmniFit already knows): {profile_text(profile)}

Conversation so far:
{history_text(history) or "(new conversation)"}

<<<NEWEST MESSAGE
{message}
NEWEST MESSAGE>>>"""


def _clean(value, limit: int = 120) -> str:
    return re.sub(r"\s+", " ", value).strip()[:limit] if isinstance(value, str) else ""


def _normalized(text: str) -> str:
    return re.sub(r"[^\w]+", " ", (text or "").lower()).strip()


MONTHS = {name: number for number, names in enumerate(
    [("jan", "january"), ("feb", "february"), ("mar", "march"), ("apr", "april"), ("may",), ("jun", "june"),
     ("jul", "july"), ("aug", "august"), ("sep", "sept", "september"), ("oct", "october"), ("nov", "november"),
     ("dec", "december")], start=1) for name in names}
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
MAX_EVENT_DAYS = 365


def _next_occurrence(month: int, day: int, today: datetime.date) -> Optional[datetime.date]:
    for year in (today.year, today.year + 1):
        try:
            candidate = datetime.date(year, month, day)
        except ValueError:
            return None
        if candidate >= today:
            return candidate
    return None


def resolve_date(words: str, model_date: str = "", today: Optional[datetime.date] = None) -> Optional[datetime.date]:
    """The date the user's words mean, from today: "14 december", "dec 14",
    "this saturday", "next monday", "tomorrow", "in 10 days", "in 2 weeks"."""
    today = today or devtools.today()
    text = words.lower()
    found = None

    if "day after tomorrow" in text:
        found = today + datetime.timedelta(days=2)
    elif "tomorrow" in text:
        found = today + datetime.timedelta(days=1)
    elif "today" in text or "tonight" in text:
        found = today
    elif match := re.search(r"\bin (\d{1,3}) (day|days|week|weeks)\b", text):
        count = int(match.group(1))
        found = today + datetime.timedelta(days=count * (7 if match.group(2).startswith("week") else 1))
    elif weekday := next((name for name in WEEKDAYS if name in text), None):
        ahead = (WEEKDAYS.index(weekday) - today.weekday()) % 7 or 7
        found = today + datetime.timedelta(days=ahead)
    elif match := (re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?(?: of)? ([a-z]{3,9})\b", text)
                   or re.search(r"\b([a-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)?\b", text)):
        first, second = match.groups()
        day_text, month_text = (first, second) if first.isdigit() else (second, first)
        if month_text in MONTHS:
            found = _next_occurrence(MONTHS[month_text], int(day_text), today)
    elif "next week" in text or re.search(r"\b(in|within) a week\b|\ba week from\b", text):
        found = today + datetime.timedelta(days=7)

    if found is None and model_date:
        # Keep the model's month and day, but choose the year ourselves
        try:
            guess = datetime.date.fromisoformat(model_date)
            found = _next_occurrence(guess.month, guess.day, today)
        except ValueError:
            pass

    if found and today <= found <= today + datetime.timedelta(days=MAX_EVENT_DAYS):
        return found
    return None


def _names_occasion(said: str, occasion_id: str) -> bool:
    """Do their own (normalised) words name this occasion or one of its details?"""
    spec = OCCASIONS[occasion_id]
    words = {occasion_id} | set(re.findall(r"[a-z]{4,}", spec["label"].lower()))
    for question in spec["questions"].values():
        for option in question["options"]:
            words |= set(re.findall(r"[a-z]{4,}", option.lower()))
    return bool(words & set(said.split()))


def clean_photo(raw) -> Optional[dict]:
    """What the understanding step saw in the photo; None without clothes."""
    if not isinstance(raw, dict):
        return None
    items = []
    for entry in raw.get("items") or []:
        if isinstance(entry, dict) and _clean(entry.get("item"), 40):
            items.append({"item": _clean(entry.get("item"), 40), "color": _clean(entry.get("color"), 30)})
    if not items:
        return None
    change = [slot for slot in edits.SLOTS if slot in (raw.get("change") or [])]
    return {
        "items": items[:8],
        "style": _clean(raw.get("style"), 60),
        "occasion_hint": raw.get("occasion_hint") if raw.get("occasion_hint") in OCCASIONS else "none",
        "change": change,
        "keep": [slot for slot in edits.SLOTS if slot in (raw.get("keep") or []) and slot not in change],
    }


def parse(raw: str, just_asked: bool, message: str = "", current: Optional[dict] = None) -> dict:
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("not an object")

    intent = data.get("intent") if data.get("intent") in INTENTS else "stylist"

    count = data.get("count") if isinstance(data.get("count"), int) and 0 < data.get("count") <= edits.MAX_LOOKS else 0
    # An edit of the looks on screen goes to the stylist, and is acted on
    # straight away (no follow-up question)
    edit = edits.clean_plan(data, current, count)
    if edit:
        intent = "stylist"
        just_asked = True

    occasion = None
    if data.get("occasion") in OCCASIONS:
        spec = OCCASIONS[data["occasion"]]
        values = [value for value in (data.get("occasion_details") or []) if isinstance(value, str)]
        answers = {}
        # Each stated value goes to the question of this occasion that offers it
        for question, q in spec["questions"].items():
            match = next((value for value in values if value in q["options"]), None)
            if match:
                answers[question] = match
        occasion = {"id": data["occasion"], "answers": answers}

    # Remember only what the user's own newest words prove
    said = _normalized(message)
    remember = {}
    for fact in data.get("remember") or []:
        if not isinstance(fact, dict):
            continue
        field, value, quote = fact.get("field"), fact.get("value"), _normalized(fact.get("quote"))
        if field in REMEMBER_VALUES and value in REMEMBER_VALUES[field] and len(quote) >= 3 and quote in said:
            remember[field] = value

    # An event only with a real, near-future date the user's words back up.
    # The date is worked out here from their words (models get years and
    # weekdays wrong); the model's date is only a fallback for the month/day.
    event = None
    raw_event = data.get("event") if isinstance(data.get("event"), dict) else {}
    event_quote = _normalized(raw_event.get("quote"))
    if len(event_quote) >= 3 and event_quote in said:
        day = resolve_date(event_quote, str(raw_event.get("date", "")))
        if day:
            event = {"name": _clean(raw_event.get("name"), 60) or "Your event", "date": day.isoformat()}

    def budget(key: str) -> Optional[int]:
        value = data.get(key)
        return int(value) if isinstance(value, int) and 0 < value <= 1_000_000 else None

    question = "" if just_asked else _clean(data.get("follow_up_question"), 140)
    options = [_clean(option, 40) for option in (data.get("follow_up_options") or []) if _clean(option, 40)]

    # An occasion-detail question offers that detail's exact choices (not
    # made-up combinations), minus any already answered
    detail = data.get("follow_up_detail")
    if question and occasion and detail in OCCASIONS[occasion["id"]]["questions"]:
        if detail in occasion["answers"]:
            question, options = "", []
        else:
            options = OCCASIONS[occasion["id"]]["questions"][detail]["options"]
    else:
        # Only a missing detail of the occasion is worth a question; anything
        # else the model asks (a style preference for a trip) is answered directly
        question, options = "", []

    # The photo: what they're wearing, and the occasion those clothes suit
    # when they didn't name one (so the stylist doesn't need to ask)
    photo = clean_photo(data.get("photo"))
    if photo:
        if occasion is None and photo["occasion_hint"] in OCCASIONS:
            occasion = {"id": photo["occasion_hint"], "answers": {}, "from_photo": True}
        # The model often writes the photo's occasion straight into "occasion":
        # it only counts as said when their words name it
        elif occasion and not occasion["answers"] and not _names_occasion(said, occasion["id"]):
            occasion["from_photo"] = True
        if occasion is None or occasion.get("from_photo"):
            question, options = "", []

    if not question or len(options) < 2:
        question, options = "", []

    return {
        "intent": intent,
        "search_text": _clean(data.get("search_text"), 80),
        "occasion": occasion,
        "department": data.get("department") if data.get("department") in ("men", "women", "unisex") else None,
        "budget_min": budget("budget_min"),
        "budget_max": budget("budget_max"),
        "remember": remember,
        "event": event,
        "count": count,
        "edit": edit,
        "photo": photo,
        "understood": [_clean(chip, 40) for chip in (data.get("understood") or []) if _clean(chip, 40)][:MAX_UNDERSTOOD],
        "follow_up": {"question": question, "options": options[:MAX_DETAIL_OPTIONS]} if question else None,
        "reply": _clean(data.get("reply"), 400),
    }


def conversation_prompt_section(history: list[dict]) -> str:
    """What the stylist is told about the conversation, so follow-ups refine it."""
    text = history_text(history)
    if not text:
        return ""
    return f"""CONVERSATION SO FAR (the newest question may refine it):
{text}
If the new question changes an earlier answer ("darker", "cheaper", "more formal", "show more"),
apply that change to the earlier suggestions instead of starting over, and do not repeat them exactly."""


# ---------------------------------------------------------
# Advice answers (explanations, no products needed)
# ---------------------------------------------------------

ADVICE_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string"},
        "tips": {"type": "array", "maxItems": 4, "items": {"type": "string"}},
        "shop": {"type": "array", "maxItems": 4, "items": {"type": "string"}},
        "next_steps": {"type": "array", "maxItems": 3, "items": {"type": "string"}},
    },
    "required": ["answer", "tips", "shop", "next_steps"],
}


def advice_prompt(message: str, history: list[dict], profile: dict, extra_sections: str) -> str:
    return f"""You are OmniFit, a warm, expert fashion stylist for Indian shoppers.
Answer the user's fashion question clearly in 2-4 short sentences ("answer"), then up to 4 practical
"tips", and up to 4 short English shopping phrases ("shop", e.g. "linen kurta men") that would help.
Then "next_steps": 2-3 short things this person would naturally say next about this answer, in their
own words (2-7 words, no question marks), specific to it, e.g. "Show me outfits in those colours",
"What about for a wedding", "Build a look with linen".
Talk about clothes, colours, fabrics and occasions; never comment on or rate a person's body, face or
appearance, and never suggest one skin tone or body type is better than another. Answer in English.

What OmniFit knows about them: {profile_text(profile)}
{extra_sections}

Conversation so far:
{history_text(history) or "(new conversation)"}

<<<QUESTION
{message}
QUESTION>>>"""


def parse_advice(raw: str) -> dict:
    data = json.loads(raw)
    answer = _clean(data.get("answer"), 900)
    if not answer:
        raise ValueError("empty answer")
    return {
        "answer": answer,
        "tips": [_clean(tip, 200) for tip in (data.get("tips") or []) if _clean(tip, 200)][:4],
        "shop": [_clean(item, 60).lower() for item in (data.get("shop") or []) if _clean(item, 60)][:4],
        "next_steps": [_clean(step, 48).strip(" .?") for step in (data.get("next_steps") or [])
                       if len(_clean(step, 48)) >= 3][:3],
    }


# ---------------------------------------------------------
# Starters: what to ask today (the welcome screen's suggestions)
# ---------------------------------------------------------

MAX_STARTERS = 5

STARTERS_SCHEMA = {
    "type": "object",
    "properties": {
        "starters": {
            "type": "array",
            "minItems": MAX_STARTERS,
            "maxItems": MAX_STARTERS,
            "items": {
                "type": "object",
                "properties": {"icon": {"type": "string"}, "text": {"type": "string"}},
                "required": ["icon", "text"],
            },
        }
    },
    "required": ["starters"],
}


def starters_prompt(*, profile: dict, weather_section: str, festivals: list[dict], events: list[dict],
                    wardrobe_pieces: int, recent: list[str]) -> str:
    today = devtools.now()
    festival_lines = "; ".join(f"{f['name']} in {f['days_away']} days" for f in festivals[:3]) or "none soon"
    event_lines = "; ".join(f"{e['name']} in {e['days_away']} days" for e in events[:2]) or "none"
    return f"""You are OmniFit, an AI fashion stylist for Indian shoppers. Write {MAX_STARTERS} things THIS
person might want to ask you right now, to show on the welcome screen as tap-to-ask suggestions.

Each has "text": the request in the person's own words (first person, 4-9 words, no question mark needed)
and "icon": ONE emoji that fits it.
Make them timely and different from each other, using what is true today:
- It is {today.strftime('%A')}, {today.strftime('%d %B')}, {('morning' if today.hour < 12 else 'afternoon' if today.hour < 17 else 'evening')}.
- {weather_section or 'Weather: unknown.'}
- Festivals coming up: {festival_lines}.
- Their own events: {event_lines}.
- Their wardrobe in OmniFit has {wardrobe_pieces} pieces.
- They recently asked: {'; '.join(recent[:3]) or 'nothing yet'}.
- What OmniFit knows about them (Style DNA): {profile_text(profile)}
Cover a mix: something for today (weather or the day of the week), something for the nearest festival
or their event, one about work or college, one that uses their wardrobe if it has pieces (else a
budget idea), and one fashion-advice question (colours, fabrics, how to wear something).
Never assume their gender, age, body or looks beyond the Style DNA. No brands, no prices unless the
Style DNA has a budget. Start each with a capital letter and write festival names properly
("Navratri", "Diwali"). When you mention timing, use only the facts above ("in 10 days", "this
weekend"); never guess ("next month"). Write in English. Return ONLY valid JSON."""


def parse_starters(raw: str) -> list[dict]:
    data = json.loads(raw)
    starters, seen = [], set()
    for entry in data.get("starters") or []:
        if not isinstance(entry, dict):
            continue
        text = _clean(entry.get("text"), 70).rstrip(".")
        icon = _clean(entry.get("icon"), 8)
        if 8 <= len(text) and text.lower() not in seen:
            seen.add(text.lower())
            starters.append({"icon": icon or "✦", "text": text[0].upper() + text[1:]})
    if len(starters) < 3:
        raise ValueError("too few starters")
    return starters[:MAX_STARTERS]
