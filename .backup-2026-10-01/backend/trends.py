"""
Trends by generation: what OmniFit users actually ask for and are shown,
plus a starting style guide for each generation.

Age group is chosen by the user (My Style), never estimated from a face or
photo. A trend is shown only when at least MIN_PEOPLE different people
contributed to it, so no one's choices can be singled out.
"""

import re
import time
from collections import defaultdict
from typing import Optional

import memory
from catalog import COLOR_WORDS, color_families, garment_type

AGE_GROUPS = {
    "gen_z": {"label": "Gen Z", "ages": "12–29"},
    "millennial": {"label": "Millennials", "ages": "30–45"},
    "gen_x": {"label": "Gen X", "ages": "46–61"},
    "boomer": {"label": "Boomers", "ages": "62+"},
}

# Starting guide: broad directions per generation (Indian context), each a
# shoppable search. Shown until real OmniFit trends have enough people.
STYLE_GUIDE = {
    "gen_z": [
        "oversized graphic t-shirt", "wide leg jeans", "printed co-ord set", "cargo pants",
        "kurta with sneakers", "chunky sneakers", "baggy denim", "crop top",
    ],
    "millennial": [
        "linen shirt", "pastel kurta", "straight fit chinos", "minimal white sneakers",
        "smart casual blazer", "ethnic kurta set", "loafers", "midi dress",
    ],
    "gen_x": [
        "handloom kurta", "silk saree", "structured kurta", "tailored trousers",
        "polo t-shirt", "leather loafers", "cotton shirt", "bandhgala jacket",
    ],
    "boomer": [
        "cotton saree", "silk saree", "veshti", "classic cotton shirt",
        "comfortable kurta", "cotton trousers", "leather sandals", "shawl",
    ],
}

# Kurta "with sneakers" is two items; the guide searches for the main one
_GUIDE_QUERY = {"kurta with sneakers": "kurta"}

MIN_PEOPLE = 3
WINDOW_DAYS = (7, 30)
MAX_TRENDS = 10

_GARMENT_NAMES = {
    "tshirt": "t-shirts", "trousers": "trousers", "jeans": "jeans", "shirt": "shirts", "kurta": "kurtas",
    "dress": "dresses", "saree": "sarees", "sneakers": "sneakers", "shoes": "shoes", "chinos": "chinos",
    "joggers": "joggers", "shorts": "shorts", "skirt": "skirts", "jacket": "jackets", "blazer": "blazers",
    "hoodie": "hoodies", "sweater": "sweaters", "sweatshirt": "sweatshirts", "coord": "co-ord sets",
    "overshirt": "overshirts", "lehenga": "lehengas", "loafers": "loafers", "boots": "boots",
    "sandals": "sandals", "heels": "heels", "flats": "flats", "juttis": "juttis", "polo": "polos",
    "top": "tops", "palazzo": "palazzos", "suit": "suits", "watch": "watches", "bag": "bags",
    "earrings": "earrings", "necklace": "necklaces", "belt": "belts", "cap": "caps",
}


def _pieces(row) -> list[str]:
    """The pieces a conversation was about: what was asked, and what was suggested."""
    pieces = [row["question"]]
    for part in re.split(r"\s*\|\s*", row["suggestions"] or ""):
        # "Look title: piece, piece" -> the pieces
        part = part.split(":", 1)[-1]
        pieces.extend(piece.strip() for piece in part.split(",") if piece.strip())
    return pieces


def _label(text: str) -> Optional[tuple[str, str]]:
    """("olive chinos", "olive chinos"): a colour family + garment, or a garment alone."""
    garment = garment_type(text)
    if not garment or garment not in _GARMENT_NAMES:
        return None
    name = _GARMENT_NAMES[garment]
    # The shade as people say it ("olive", "mustard"), when there is exactly one
    colours = [word for word in re.findall(r"[a-z]+", text.lower()) if word in COLOR_WORDS]
    if len(set(colours)) == 1 and len(color_families(text)) >= 1:
        return f"{colours[0].capitalize()} {name}", f"{colours[0]} {garment}"
    return name.capitalize(), garment


def community_trends(age_group: Optional[str], department: Optional[str]) -> dict:
    """What people in this group asked for and were suggested lately."""
    for days in WINDOW_DAYS:
        since = time.time() - days * 24 * 3600
        sql = "SELECT user_id, question, suggestions FROM interactions WHERE created_at > ? AND kind != 'failed'"
        params: list = [since]
        if age_group in AGE_GROUPS:
            sql += " AND age_group = ?"
            params.append(age_group)
        if department in ("men", "women"):
            sql += " AND department IN (?, 'unisex', 'auto', 'unknown')"
            params.append(department)

        with memory.connect() as connection:
            rows = connection.execute(sql, params).fetchall()

        # Each person counts once per label, so no one person makes a trend
        people: dict[tuple, set] = defaultdict(set)
        for row in rows:
            for piece in _pieces(row):
                label = _label(piece)
                if label:
                    people[label].add(row["user_id"])

        trends = [
            {"label": label, "query": query, "people": len(users)}
            for (label, query), users in people.items()
            if len(users) >= MIN_PEOPLE
        ]
        trends.sort(key=lambda trend: -trend["people"])
        if trends:
            return {"days": days, "trends": trends[:MAX_TRENDS]}

    return {"days": WINDOW_DAYS[-1], "trends": []}


def style_guide(age_group: str) -> list[dict]:
    return [
        {"label": item[:1].upper() + item[1:], "query": _GUIDE_QUERY.get(item, item)}
        for item in STYLE_GUIDE.get(age_group, [])
    ]


def age_group_prompt_section(age_group: Optional[str]) -> str:
    if age_group not in AGE_GROUPS:
        return ""
    group = AGE_GROUPS[age_group]
    return (
        f"AGE GROUP (chosen by the user): {group['label']} ({group['ages']}). Lean gently towards styles "
        f"popular with this group; the question, occasion and photo always come first. Never mention age."
    )
