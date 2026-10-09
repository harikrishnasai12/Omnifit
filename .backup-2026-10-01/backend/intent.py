"""
Intent Engine: understanding what each person likes and is looking for.

It combines what people SAY (sizes, budget, events and dates from the chat),
what they DO (love, skip, dwell, save, try-on, product taps, cart), their
CONTEXT (time, weather, festivals, region) and what they OWN (wardrobe), into:

- a taste profile: a score and a confidence per style, colour, fit, price
  band, brand, garment and occasion. Old signals fade (half-life 30 days),
  and "Not me" corrections always win;
- active intents: an occasion, a budget, an event with a date;
- a ranked feed where every personalised card says why it is shown.

This is taste and intent understanding for shopping, nothing more: no
personality typing, no psychological profiling. Only signed-in users with
personalisation on are stored; guests' signals stay on their device.
"""

import datetime
import json
import math
import random
import time
import uuid
from typing import Optional

import accounts
import devtools

HALF_LIFE_DAYS = 30
MAX_SIGNALS_PER_USER = 5000
SIGNAL_RETENTION_DAYS = 180

DIMENSIONS = ("style", "colour", "fit", "price_band", "brand", "garment", "occasion")

# How much each action says about taste (per attribute of the look)
SIGNAL_WEIGHTS = {
    "love": 3.0,
    "save": 2.0,
    "cart": 4.0,
    "tryon": 2.0,
    "product_tap": 1.0,
    "dwell": 0.5,      # looked at a card for a while
    "skip": -1.0,
    "unlove": -3.0,
}
SIGNAL_KINDS = tuple(SIGNAL_WEIGHTS) + ("view",)
DWELL_MIN_MS = 3500

PRICE_BANDS = ((800, "budget"), (2000, "mid-range"), (5000, "premium"), (float("inf"), "luxury"))
PRICE_BAND_LABELS = {"budget": "under ₹800", "mid-range": "₹800–₹2,000", "premium": "₹2,000–₹5,000", "luxury": "₹5,000+"}

MAX_TASTE_SCORE = 8.0
MAX_FESTIVE_PER_PAGE = 2
# "A fresh office look": the reason on a card nothing personal picked
OCCASION_WORDS = {"casual": "everyday", "office": "office", "party": "party", "wedding": "wedding guest",
                  "festival": "festive", "date": "date night", "travel": "travel"}
EXPLORATION_SHARE = 0.2
PAGE_SIZE = 6
SESSION_CARDS = 30

SCHEMA = """
CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL,
    kind TEXT NOT NULL,
    look_id TEXT,
    product_id TEXT,
    value REAL,
    attrs TEXT
);
CREATE INDEX IF NOT EXISTS idx_signals_user ON signals(user_id, created_at);

CREATE TABLE IF NOT EXISTS taste_scores (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dimension TEXT NOT NULL,
    value TEXT NOT NULL,
    score REAL NOT NULL,
    evidence INTEGER NOT NULL,
    updated_at REAL NOT NULL,
    PRIMARY KEY (user_id, dimension, value)
);

CREATE TABLE IF NOT EXISTS taste_overrides (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dimension TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at REAL NOT NULL,
    PRIMARY KEY (user_id, dimension, value)
);

CREATE TABLE IF NOT EXISTS intents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intents_user ON intents(user_id, expires_at);

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    occasion TEXT,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, date);

CREATE TABLE IF NOT EXISTS shown_looks (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    look_id TEXT NOT NULL,
    shown_at REAL NOT NULL,
    PRIMARY KEY (user_id, look_id)
);

CREATE TABLE IF NOT EXISTS personalization (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    paused INTEGER NOT NULL DEFAULT 0
);
"""

_schema_ready = False


def connect():
    global _schema_ready
    connection = accounts.connect()
    if not _schema_ready:
        connection.executescript(SCHEMA)
        _schema_ready = True
    return connection


# ---------------------------------------------------------
# Look attributes (what a signal on a look says about taste)
# ---------------------------------------------------------

def price_band(price: Optional[float]) -> Optional[str]:
    if not price:
        return None
    return next(label for limit, label in PRICE_BANDS if price < limit)


def look_attributes(look: dict) -> dict[str, list[str]]:
    """{"style": ["streetwear"], "colour": ["olive", "white"], ...} for a pool look."""
    pieces = look.get("pieces") or []
    prices = [piece["product"]["price"] for piece in pieces if piece.get("product")]
    return {
        "style": list(look.get("styles") or []),
        "colour": list(dict.fromkeys(look.get("colours") or []))[:4],
        "fit": list(dict.fromkeys(look.get("fits") or []))[:3],
        "price_band": [band] if (band := price_band(sum(prices) / len(prices) if prices else None)) else [],
        "brand": list(dict.fromkeys(piece["product"]["store"] for piece in pieces if piece.get("product")))[:4],
        "garment": list(dict.fromkeys(piece.get("garment") for piece in pieces if piece.get("garment")))[:5],
        "occasion": [look["occasion"]] if look.get("occasion") else [],
    }


# ---------------------------------------------------------
# Settings
# ---------------------------------------------------------

def is_paused(user_id: str) -> bool:
    with connect() as connection:
        row = connection.execute("SELECT paused FROM personalization WHERE user_id = ?", (user_id,)).fetchone()
    return bool(row and row["paused"])


def set_paused(user_id: str, paused: bool) -> None:
    with connect() as connection:
        connection.execute(
            "INSERT INTO personalization (user_id, paused) VALUES (?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET paused = excluded.paused",
            (user_id, int(paused)),
        )


def reset(user_id: str) -> None:
    """Forget everything learned (signals, taste, intents, events, corrections)."""
    with connect() as connection:
        for table in ("signals", "taste_scores", "taste_overrides", "intents", "events", "shown_looks"):
            connection.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))


# ---------------------------------------------------------
# DID: signals
# ---------------------------------------------------------

def _decayed(score: float, updated_at: float, now: float) -> float:
    days = max(0.0, (now - updated_at) / 86400)
    return score * math.pow(0.5, days / HALF_LIFE_DAYS)


def record_signals(user_id: str, signals: list[dict], looks: dict[str, dict]) -> int:
    """Store a batch of signals and update the taste profile. Returns how many were used."""
    if is_paused(user_id):
        return 0

    now = time.time()
    used = 0
    with connect() as connection:
        for signal in signals:
            kind = signal.get("kind")
            if kind not in SIGNAL_KINDS:
                continue
            look = looks.get(signal.get("look_id") or "")
            value = signal.get("value")
            if kind == "dwell" and (not isinstance(value, (int, float)) or value < DWELL_MIN_MS):
                continue

            attrs = look_attributes(look) if look else {}
            connection.execute(
                "INSERT INTO signals (user_id, created_at, kind, look_id, product_id, value, attrs) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (user_id, now, kind, signal.get("look_id"), signal.get("product_id"),
                 value if isinstance(value, (int, float)) else None, json.dumps(signal.get("extra") or {})),
            )
            used += 1

            weight = SIGNAL_WEIGHTS.get(kind, 0.0)
            if kind == "view":
                connection.execute(
                    "INSERT INTO shown_looks (user_id, look_id, shown_at) VALUES (?, ?, ?) "
                    "ON CONFLICT(user_id, look_id) DO UPDATE SET shown_at = excluded.shown_at",
                    (user_id, signal.get("look_id"), now),
                )
                continue
            if not weight or not attrs:
                continue

            for dimension, values in attrs.items():
                for value_name in values:
                    row = connection.execute(
                        "SELECT score, evidence, updated_at FROM taste_scores WHERE user_id = ? AND dimension = ? AND value = ?",
                        (user_id, dimension, value_name),
                    ).fetchone()
                    score = _decayed(row["score"], row["updated_at"], now) if row else 0.0
                    evidence = (row["evidence"] if row else 0) + (1 if weight > 0 else 0)
                    connection.execute(
                        "INSERT INTO taste_scores (user_id, dimension, value, score, evidence, updated_at) "
                        "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, dimension, value) DO UPDATE SET "
                        "score = excluded.score, evidence = excluded.evidence, updated_at = excluded.updated_at",
                        (user_id, dimension, value_name, score + weight, evidence, now),
                    )

        # Keep the log bounded
        connection.execute(
            "DELETE FROM signals WHERE user_id = ? AND (created_at < ? OR id NOT IN "
            "(SELECT id FROM signals WHERE user_id = ? ORDER BY created_at DESC LIMIT ?))",
            (user_id, now - SIGNAL_RETENTION_DAYS * 86400, user_id, MAX_SIGNALS_PER_USER),
        )
    return used


def recently_shown_looks(user_id: str, before: float, days: int = 3) -> set[str]:
    """Looks shown in the last few days, but before this feed session started
    (so pages of the current session stay stable)."""
    with connect() as connection:
        rows = connection.execute(
            "SELECT look_id FROM shown_looks WHERE user_id = ? AND shown_at > ? AND shown_at < ?",
            (user_id, before - days * 86400, before),
        ).fetchall()
    return {row["look_id"] for row in rows}


def loved_signals(user_id: str, days: int = 60) -> list[dict]:
    """Loved looks and saved products, with the price at the time (for drops)."""
    with connect() as connection:
        rows = connection.execute(
            "SELECT kind, look_id, product_id, attrs, created_at FROM signals "
            "WHERE user_id = ? AND kind IN ('love', 'save', 'cart') AND created_at > ? ORDER BY created_at DESC",
            (user_id, time.time() - days * 86400),
        ).fetchall()
    return [{**dict(row), "extra": json.loads(row["attrs"] or "{}")} for row in rows]


# ---------------------------------------------------------
# SAID: events and intents from the chat
# ---------------------------------------------------------

def add_event(user_id: str, name: str, date: str, occasion: Optional[str]) -> Optional[dict]:
    try:
        day = datetime.date.fromisoformat(date)
    except ValueError:
        return None
    today = devtools.today()
    if not today <= day <= today + datetime.timedelta(days=365):
        return None

    with connect() as connection:
        # The same event said twice updates it instead of duplicating it
        existing = connection.execute(
            "SELECT id FROM events WHERE user_id = ? AND (lower(name) = lower(?) OR (date = ? AND occasion IS ?))",
            (user_id, name, date, occasion),
        ).fetchone()
        event_id = existing["id"] if existing else uuid.uuid4().hex
        connection.execute(
            "INSERT INTO events (id, user_id, name, date, occasion, created_at) VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET name = excluded.name, date = excluded.date, occasion = excluded.occasion",
            (event_id, user_id, name[:60], date, occasion, time.time()),
        )
    return {"id": event_id, "name": name[:60], "date": date, "occasion": occasion}


def upcoming_events(user_id: str) -> list[dict]:
    today = devtools.today()
    with connect() as connection:
        rows = connection.execute(
            "SELECT id, name, date, occasion FROM events WHERE user_id = ? AND date >= ? ORDER BY date",
            (user_id, today.isoformat()),
        ).fetchall()
    return [
        {**dict(row), "days_away": (datetime.date.fromisoformat(row["date"]) - today).days}
        for row in rows
    ]


def delete_event(user_id: str, event_id: str) -> bool:
    with connect() as connection:
        return bool(connection.execute("DELETE FROM events WHERE id = ? AND user_id = ?", (event_id, user_id)).rowcount)


def set_intent(user_id: str, kind: str, data: dict, days: int = 14, expires: Optional[float] = None) -> None:
    """One active intent per kind (a new budget replaces the old one)."""
    with connect() as connection:
        connection.execute("DELETE FROM intents WHERE user_id = ? AND kind = ?", (user_id, kind))
        connection.execute(
            "INSERT INTO intents (id, user_id, kind, data, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
            (uuid.uuid4().hex, user_id, kind, json.dumps(data), time.time(), expires or time.time() + days * 86400),
        )


def active_intents(user_id: str) -> dict[str, dict]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT kind, data FROM intents WHERE user_id = ? AND expires_at > ?", (user_id, time.time())
        ).fetchall()
    return {row["kind"]: json.loads(row["data"]) for row in rows}


def record_said(user_id: str, plan: dict) -> list[str]:
    """What the chat understood becomes intents and events. Returns short notes."""
    if is_paused(user_id):
        return []
    notes = []
    if plan.get("occasion"):
        set_intent(user_id, "occasion", plan["occasion"], days=14)
    if plan.get("budget_max") or plan.get("budget_min"):
        set_intent(user_id, "budget", {"min": plan.get("budget_min"), "max": plan.get("budget_max")}, days=30)
    event = plan.get("event")
    if event and event.get("date"):
        occasion_id = (plan.get("occasion") or {}).get("id")
        saved = add_event(user_id, event.get("name") or "Your event", event["date"], occasion_id)
        if saved:
            day = datetime.date.fromisoformat(saved["date"])
            # The occasion stays active until the day of the event
            if plan.get("occasion"):
                set_intent(user_id, "occasion", plan["occasion"],
                           expires=datetime.datetime.combine(day, datetime.time(23, 59)).timestamp())
            notes.append(f"{saved['name']} on {day.day} {day.strftime('%b')}")
    return notes


# ---------------------------------------------------------
# The taste profile
# ---------------------------------------------------------

def overrides(user_id: str) -> set[tuple[str, str]]:
    with connect() as connection:
        rows = connection.execute("SELECT dimension, value FROM taste_overrides WHERE user_id = ?", (user_id,)).fetchall()
    return {(row["dimension"], row["value"]) for row in rows}


def not_me(user_id: str, dimension: str, value: str) -> None:
    with connect() as connection:
        connection.execute(
            "INSERT OR IGNORE INTO taste_overrides (user_id, dimension, value, created_at) VALUES (?, ?, ?, ?)",
            (user_id, dimension, value, time.time()),
        )
        connection.execute(
            "DELETE FROM taste_scores WHERE user_id = ? AND dimension = ? AND value = ?", (user_id, dimension, value)
        )


def undo_not_me(user_id: str, dimension: str, value: str) -> None:
    with connect() as connection:
        connection.execute(
            "DELETE FROM taste_overrides WHERE user_id = ? AND dimension = ? AND value = ?", (user_id, dimension, value)
        )


def taste(user_id: str) -> dict[str, list[dict]]:
    """Per dimension, the liked values: score (decayed), confidence 0-1, evidence."""
    now = time.time()
    blocked = overrides(user_id)
    with connect() as connection:
        rows = connection.execute("SELECT * FROM taste_scores WHERE user_id = ?", (user_id,)).fetchall()

    profile: dict[str, list[dict]] = {dimension: [] for dimension in DIMENSIONS}
    for row in rows:
        if (row["dimension"], row["value"]) in blocked:
            continue
        score = _decayed(row["score"], row["updated_at"], now)
        if score <= 0.5:
            continue
        profile[row["dimension"]].append({
            "value": row["value"],
            "score": round(score, 2),
            "evidence": row["evidence"],
            "confidence": round(1 - math.exp(-row["evidence"] / 4), 2),
        })
    for dimension in profile:
        profile[dimension].sort(key=lambda item: -item["score"])
    return profile


def taste_from_client(client_taste: dict) -> dict[str, list[dict]]:
    """A guest's taste, summarised on their device ({dimension: {value: score}})."""
    profile: dict[str, list[dict]] = {dimension: [] for dimension in DIMENSIONS}
    for dimension, values in (client_taste or {}).items():
        if dimension not in profile or not isinstance(values, dict):
            continue
        for value, score in list(values.items())[:20]:
            if isinstance(score, (int, float)) and score > 0.5 and isinstance(value, str) and len(value) <= 40:
                profile[dimension].append({"value": value, "score": float(score), "evidence": 1, "confidence": 0.4})
        profile[dimension].sort(key=lambda item: -item["score"])
    return profile


def summary_sentence(profile: dict[str, list[dict]]) -> str:
    """"You lean towards relaxed streetwear, earthy tones, around ₹800–₹2,000 per piece." """
    def top(dimension: str, count: int = 2) -> list[str]:
        return [item["value"] for item in profile.get(dimension, []) if item["confidence"] >= 0.3][:count]

    parts = []
    styles, fits = top("style"), top("fit", 1)
    if styles:
        parts.append(" ".join(fits + [" and ".join(style.replace("-", " ") for style in styles)]))
    colours = top("colour", 3)
    if colours:
        parts.append(f"{', '.join(colours)} tones")
    bands = top("price_band", 1)
    if bands:
        parts.append(f"around {PRICE_BAND_LABELS.get(bands[0], bands[0])} per piece")
    if not parts:
        return ""
    return "You lean towards " + ", ".join(parts) + "."


def explain(dimension: str, item: dict) -> str:
    """"Why?" for one learned item, from its evidence."""
    count = item["evidence"]
    what = {"style": "looks in this style", "colour": "looks with this colour", "fit": "looks with this fit",
            "price_band": "pieces in this price range", "brand": "pieces from this brand",
            "garment": "looks with this piece", "occasion": "looks for this occasion"}[dimension]
    return f"You loved, saved or shopped {count} {what}" + (" recently." if count else ".")


# ---------------------------------------------------------
# Feed ranking
# ---------------------------------------------------------

def score_look(look: dict, profile: dict, intents: dict, context: dict) -> tuple[float, str]:
    """(score, reason): taste match + intent match + context + freshness."""
    attrs = look_attributes(look)
    reasons: list[tuple[float, str]] = []
    total = 0.0

    # Taste: how much the look's attributes match what they like (capped, so
    # something they asked for always outranks what they liked before)
    for dimension, values in attrs.items():
        liked = {item["value"]: item for item in profile.get(dimension, [])}
        for value in values:
            if value in liked:
                gain = min(liked[value]["score"], 12) * 0.25 * (0.5 + liked[value]["confidence"])
                total += gain
                if dimension in ("style", "colour", "occasion", "brand"):
                    # Evidence also counts saves and long looks, so no count
                    # here: "loved 4" would overstate what they did
                    label = value.replace("-", " ")
                    reasons.append((gain, f"Like the {label} looks you loved"
                                          if dimension != "brand" else f"You've liked pieces from {value}"))
    total = min(total, MAX_TASTE_SCORE)

    # "Not me" always wins: looks with a corrected attribute sink to the bottom
    blocked = context.get("blocked") or set()
    if any((dimension, value) in blocked for dimension, values in attrs.items() for value in values):
        total -= 20.0

    # Intent: an active occasion, event or budget
    occasion = (intents.get("occasion") or {}).get("id")
    if occasion and look.get("occasion") == occasion:
        gain = MAX_TASTE_SCORE + 2
        event = context.get("next_event")
        label = f"For your {event['name']} on {event['label']}" if event and event.get("occasion") == occasion \
            else f"For the {occasion} look you asked about"
        total += gain
        reasons.append((gain, label))
    budget = intents.get("budget") or {}
    if budget.get("max") and look.get("price_per_piece"):
        if look["price_per_piece"] <= budget["max"]:
            total += 1.5
            reasons.append((1.5, f"Within your ₹{budget['max']:,} budget"))
        else:
            total -= 3.0

    # Context: weather and festivals
    if context.get("feel") in ("hot", "warm") and look.get("breathable"):
        total += 1.0
        reasons.append((1.0, f"Breathable fabrics for today's {context.get('high', '')}°C".replace(" °C", "°C")))
    festival = context.get("festival")
    if festival and look.get("occasion") == "festival":
        total += 1.5
        reasons.append((1.5, f"Ready for {festival['name']} in {festival['days_away']} days"))

    # Freshness: newer looks first when all else is equal
    age_days = (time.time() - look.get("created_at", time.time())) / 86400
    total += max(0.0, 1.0 - age_days / 30)

    reason = max(reasons)[1] if reasons else ""
    return total, reason


def rank_feed(pool: list[dict], profile: dict, intents: dict, context: dict,
              shown: set[str], seed: str, offset: int) -> tuple[list[dict], bool]:
    """One page of cards from the look pool; about 20% explore new directions."""
    candidates = [look for look in pool if look["id"] not in shown]
    scored = []
    for look in candidates:
        score, reason = score_look(look, profile, intents, context)
        scored.append({**look, "score": round(score, 2), "reason": reason})
    scored.sort(key=lambda look: -look["score"])

    liked_styles = {item["value"] for item in profile.get("style", [])[:3]}
    explore = [look for look in scored
               if not (set(look.get("styles") or []) & liked_styles) and look["score"] > -10]
    rng = random.Random(seed)
    rng.shuffle(explore)

    # Festival looks are timely, but no more than a couple per page unless
    # the person asked about the festival themselves
    asked_festival = (intents.get("occasion") or {}).get("id") == "festival"

    def festive(look: dict) -> bool:
        return look.get("occasion") == "festival" and not asked_festival

    def pick(queue: list[dict], used: set[str], page_festive: int):
        return next((item for item in queue if item["id"] not in used
                     and (page_festive < MAX_FESTIVE_PER_PAGE or not festive(item))), None)

    ranked, used = [], set()
    while len(ranked) < SESSION_CARDS:
        page_start = len(ranked) // PAGE_SIZE * PAGE_SIZE
        page_festive = sum(1 for item in ranked[page_start:] if festive(item))
        explore_turn = profile.get("style") and (len(ranked) + 1) % round(1 / EXPLORATION_SHARE) == 0
        look = pick(explore, used, page_festive) if explore_turn else None
        take_explore = look is not None
        look = look or pick(scored, used, page_festive)
        if look is None:
            # Only capped looks are left: better a full page than an empty one
            look = next((item for item in scored if item["id"] not in used), None)
            take_explore = False
        if look is None:
            break
        used.add(look["id"])
        if take_explore:
            look = {**look, "reason": "Something new to explore", "explore": True}
        ranked.append(look)

    page = [
        look if look["reason"] else {**look, "reason": f"A fresh {OCCASION_WORDS.get(look.get('occasion'), 'everyday')} look"}
        for look in ranked[offset:offset + PAGE_SIZE]
    ]
    caught_up = offset + PAGE_SIZE >= len(ranked)
    return page, caught_up
