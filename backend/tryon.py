"""
Live Try-On, step 5: AI garment understanding.

Gemma looks at a product's photo and describes the garment: which part of
the body it covers, its shape, sleeves, collar, length, colour, texture and
which side the photo shows. The try-on engine in the browser uses this to
place the garment on the right part of the person (upper body, lower body,
or both) and to know how far the sleeves and hem reach.

Each product is read once and remembered (garment_profiles in catalog.db).
Only the garment is described: nothing about the model wearing it.
"""

import json
import re
import time
from typing import Optional

import catalog

# Which part of the body the garment goes on (what the camera must show)
REGIONS = {
    "upper": "worn on the upper body: shirt, t-shirt, top, jacket, blazer, kurta, sweater, hoodie",
    "lower": "worn on the lower body: trousers, jeans, shorts, skirt, palazzo",
    "full": "covers upper and lower body: dress, gown, jumpsuit, saree, lehenga set, kurta set, suit (jacket with trousers)",
    "head": "worn on top of the head: hat, cap, bucket hat, beanie",
    "face": "worn over the eyes: sunglasses, spectacles, eyeglass frames",
    "other": "anything else: shoes, sandals, bags, jewellery, watches, belts, scarves, socks",
}
# Not drawn in the live try-on
BLOCKED_REGION = "other"
# Raised when the regions change, so older saved readings are read again
VERSION = 2
SHAPES = ("fitted", "regular", "relaxed", "oversized", "straight", "flared", "a-line")
SLEEVES = ("none", "sleeveless", "short", "three-quarter", "long")
COLLARS = ("none", "crew neck", "v-neck", "round neck", "polo collar", "shirt collar", "mandarin collar",
           "lapel", "hooded", "turtleneck", "other")
LENGTHS = ("cropped", "waist", "hip", "thigh", "knee", "calf", "ankle", "floor")
VIEWS = ("front", "back", "side", "unclear")

SCHEMA = {
    "type": "object",
    "properties": {
        "garment": {"type": "string"},
        "region": {"type": "string", "enum": list(REGIONS)},
        "shape": {"type": "string", "enum": list(SHAPES)},
        "sleeves": {"type": "string", "enum": list(SLEEVES)},
        "collar": {"type": "string", "enum": list(COLLARS)},
        "length": {"type": "string", "enum": list(LENGTHS)},
        "color": {"type": "string"},
        "texture": {"type": "string"},
        "view": {"type": "string", "enum": list(VIEWS)},
    },
    "required": ["garment", "region", "shape", "sleeves", "collar", "length", "color", "texture", "view"],
}

TABLE = """
CREATE TABLE IF NOT EXISTS garment_profiles (
    product_id TEXT PRIMARY KEY,
    created_at REAL NOT NULL,
    data TEXT NOT NULL
);
"""

_schema_ready = False


def connect():
    global _schema_ready
    connection = catalog.connect()
    if not _schema_ready:
        connection.executescript(TABLE)
        _schema_ready = True
    return connection


def prompt(title: str) -> str:
    regions = "\n".join(f'- "{name}": {meaning}' for name, meaning in REGIONS.items())
    return f"""You are the garment understanding step of OmniFit's live try-on.
The photo shows this product from a store: "{title}". Describe the GARMENT being sold (the product in
the title), so it can be drawn on a person in a live camera view.

Fill every field:
- "garment": what it is, in two or three words ("formal blazer", "wide-leg jeans", "anarkali kurta set").
- "region": the part of the body it is worn on:
{regions}
- "shape": its overall cut: {", ".join(SHAPES)}.
- "sleeves": {", ".join(SLEEVES)} ("none" for a garment without an upper part, like trousers, and for accessories).
- "collar": {", ".join(COLLARS)} ("none" for a lower-body garment and for accessories).
- "length": where its lowest edge reaches on the body: {", ".join(LENGTHS)} ("cropped" for accessories).
- "color": its main colour, precisely ("charcoal black", "mustard yellow").
- "texture": the fabric's look in a few words ("smooth matte wool", "ribbed knit", "glossy satin").
- "view": which side of the garment this photo shows: {", ".join(VIEWS)}.

Describe only the garment. Never describe or comment on the person wearing it. Return ONLY valid JSON."""


def _text(value, limit: int) -> str:
    return re.sub(r"\s+", " ", value).strip()[:limit] if isinstance(value, str) else ""


def clean(raw: str) -> dict:
    """Gemma's answer, with every field checked against its allowed values."""
    data = json.loads(raw)
    if not isinstance(data, dict) or data.get("region") not in REGIONS:
        raise ValueError("no usable garment description")

    def pick(field: str, allowed: tuple, default: str) -> str:
        return data.get(field) if data.get(field) in allowed else default

    region = data["region"]
    no_upper = region not in ("upper", "full")
    return {
        "version": VERSION,
        "garment": _text(data.get("garment"), 40) or "garment",
        "region": region,
        "shape": pick("shape", SHAPES, "regular"),
        "sleeves": "none" if no_upper else pick("sleeves", SLEEVES, "short"),
        "collar": "none" if no_upper else pick("collar", COLLARS, "other"),
        "length": pick("length", LENGTHS, {"upper": "hip", "lower": "ankle", "full": "knee"}.get(region, "cropped")),
        "color": _text(data.get("color"), 30),
        "texture": _text(data.get("texture"), 60),
        "view": pick("view", VIEWS, "unclear"),
    }


def saved(product_id: str) -> Optional[dict]:
    with connect() as connection:
        row = connection.execute("SELECT data FROM garment_profiles WHERE product_id = ?", (product_id,)).fetchone()
    garment = json.loads(row["data"]) if row else None
    return garment if garment and garment.get("version") == VERSION else None


def save(product_id: str, garment: dict) -> None:
    with connect() as connection:
        connection.execute(
            "INSERT INTO garment_profiles (product_id, created_at, data) VALUES (?, ?, ?) "
            "ON CONFLICT(product_id) DO UPDATE SET created_at = excluded.created_at, data = excluded.data",
            (product_id, time.time(), json.dumps(garment)),
        )
