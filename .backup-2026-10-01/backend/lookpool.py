"""
The look pool: complete looks with real products, built ahead of time.

A background job (build_looks.py) asks Gemma for looks across sections,
occasions and styles, then attaches a real catalogue product to each piece.
The Home feed ranks these instantly (intent.py) instead of generating a look
on every scroll. Looks are rechecked against live stock when served.
"""

import json
import re
import time
import uuid
from typing import Optional

import catalog

SLOTS = ("top", "layer", "bottom", "one_piece", "footwear", "accessory")
BREATHABLE = re.compile(r"\b(linen|cotton|khadi|chambray|seersucker|mul|muslin|chikankari)\b", re.I)
FIT_WORDS = ("oversized", "relaxed", "slim", "regular", "wide", "straight", "tapered", "boxy", "cropped", "flared")

SCHEMA = """
CREATE TABLE IF NOT EXISTS looks (
    id TEXT PRIMARY KEY,
    created_at REAL NOT NULL,
    section TEXT NOT NULL,
    occasion TEXT,
    styles TEXT NOT NULL,
    colours TEXT NOT NULL,
    fits TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    breathable INTEGER NOT NULL,
    price_per_piece REAL,
    total_price REAL,
    pieces TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_looks_section ON looks(section, active);
"""

_schema_ready = False


def connect():
    global _schema_ready
    connection = catalog.connect()
    if not _schema_ready:
        connection.executescript(SCHEMA)
        _schema_ready = True
    return connection


def _row_to_look(row) -> dict:
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "section": row["section"],
        "occasion": row["occasion"],
        "styles": json.loads(row["styles"]),
        "colours": json.loads(row["colours"]),
        "fits": json.loads(row["fits"]),
        "title": row["title"],
        "description": row["description"],
        "breathable": bool(row["breathable"]),
        "price_per_piece": row["price_per_piece"],
        "total_price": row["total_price"],
        "pieces": json.loads(row["pieces"]),
    }


def pool(section: Optional[str] = None) -> list[dict]:
    """Active looks for a section ("men", "women"); both when unknown."""
    with connect() as connection:
        if section in ("men", "women"):
            rows = connection.execute(
                "SELECT * FROM looks WHERE active = 1 AND section IN (?, 'unisex')", (section,)
            ).fetchall()
        else:
            rows = connection.execute("SELECT * FROM looks WHERE active = 1").fetchall()
    return [_row_to_look(row) for row in rows]


def get_looks(ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    with connect() as connection:
        rows = connection.execute(
            f"SELECT * FROM looks WHERE id IN ({','.join('?' * len(ids))})", ids
        ).fetchall()
    return {row["id"]: _row_to_look(row) for row in rows}


def refresh_stock(looks: list[dict]) -> list[dict]:
    """Current price and stock for every product in these looks; pieces that
    sold out are dropped, and looks left with fewer than 2 pieces are skipped."""
    ids = [piece["product"]["id"] for look in looks for piece in look["pieces"] if piece.get("product")]
    if not ids:
        return looks
    with connect() as connection:
        rows = connection.execute(
            f"SELECT id, price, compare_at, available, sizes_in_stock FROM products WHERE id IN ({','.join('?' * len(ids))})",
            ids,
        ).fetchall()
    live = {row["id"]: row for row in rows}

    fresh = []
    for look in looks:
        pieces = []
        for piece in look["pieces"]:
            product = piece.get("product")
            row = live.get(product["id"]) if product else None
            if not row or not row["available"]:
                continue
            pieces.append({**piece, "product": {
                **product,
                "price": row["price"],
                "compare_at": row["compare_at"],
                "sizes": sorted((row["sizes_in_stock"] or "").split("|"), key=catalog.size_sort_key)[:8]
                if row["sizes_in_stock"] else product.get("sizes", []),
            }})
        if len(pieces) >= 2:
            fresh.append({**look, "pieces": pieces,
                          "total_price": round(sum(p["product"]["price"] for p in pieces))})
    return fresh


# ---------------------------------------------------------
# Building looks (used by build_looks.py)
# ---------------------------------------------------------

def look_schema(style_tags: tuple) -> dict:
    return {
        "type": "object",
        "properties": {
            "looks": {
                "type": "array",
                "minItems": 3,
                "maxItems": 4,
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "styles": {"type": "array", "maxItems": 2, "items": {"type": "string", "enum": list(style_tags)}},
                        "description": {"type": "string"},
                        "pieces": {
                            "type": "array",
                            "minItems": 3,
                            "maxItems": 5,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "slot": {"type": "string", "enum": list(SLOTS)},
                                    "name": {"type": "string"},
                                    "search_query": {"type": "string"},
                                },
                                "required": ["slot", "name", "search_query"],
                            },
                        },
                    },
                    "required": ["title", "styles", "description", "pieces"],
                },
            }
        },
        "required": ["looks"],
    }


def look_prompt(section: str, occasion: str, occasion_label: str, style: str, avoid: list[str]) -> str:
    who = {"men": "menswear", "women": "womenswear"}[section]
    return f"""You are OmniFit, a professional fashion stylist for Indian shoppers. Create 4 complete,
distinct {who} looks for: {occasion_label}, in a {style.replace('-', ' ')} direction.

Each look: "title" (2-4 words), "styles" (1-2 tags), "description" (one line on why it works),
and 3-5 "pieces": a top with a bottom (or a one-piece like a dress, saree or kurta set), footwear,
and 1-2 accessories. Each piece: "slot", "name" (colour + fabric/fit + item, e.g. "olive linen
relaxed shirt") and "search_query" (3-6 lowercase words: colour + details + item + {"men" if section == "men" else "women"}).
Use realistic pieces an Indian D2C brand sells. Vary colours across the 4 looks.
{f"Avoid repeating these recent titles: {', '.join(avoid[-12:])}." if avoid else ""}
Talk only about clothes. Return ONLY valid JSON."""


def piece_attributes(name: str) -> dict:
    lower = name.lower()
    return {
        "garment": catalog.garment_type(name),
        "colours": [family for family in catalog.COLOR_FAMILIES if family in catalog.color_families(name)],
        "fits": [word for word in FIT_WORDS if word in lower],
        "breathable": bool(BREATHABLE.search(name)),
    }


def save_look(section: str, occasion: str, look: dict, pieces: list[dict]) -> str:
    prices = [piece["product"]["price"] for piece in pieces]
    colours, fits, breathable = [], [], False
    for piece in pieces:
        attrs = piece_attributes(piece["name"] + " " + piece["product"]["title"])
        colours += attrs["colours"]
        fits += attrs["fits"]
        breathable = breathable or attrs["breathable"]
        piece["garment"] = piece.get("garment") or attrs["garment"]

    look_id = uuid.uuid4().hex[:16]
    with connect() as connection:
        connection.execute(
            """INSERT INTO looks (id, created_at, section, occasion, styles, colours, fits, title, description,
                   breathable, price_per_piece, total_price, pieces, active)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
            (look_id, time.time(), section, occasion, json.dumps(look["styles"]),
             json.dumps(list(dict.fromkeys(colours))[:4]), json.dumps(list(dict.fromkeys(fits))[:3]),
             look["title"][:60], look.get("description", "")[:240], int(breathable),
             round(sum(prices) / len(prices)), round(sum(prices)), json.dumps(pieces)),
        )
    return look_id


def stats() -> dict:
    with connect() as connection:
        rows = connection.execute(
            "SELECT section, occasion, COUNT(*) n FROM looks WHERE active = 1 GROUP BY section, occasion"
        ).fetchall()
    return {f"{row['section']}/{row['occasion']}": row["n"] for row in rows}
