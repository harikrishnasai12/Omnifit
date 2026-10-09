"""
My Wardrobe: tagging the clothes a user owns, building outfits from them,
and finding the one piece that would add the most new looks.

Prompts, response formats and the checks on Gemma's answers live here;
the endpoints are in app.py.
"""

import json
import re

SLOTS = ("top", "layer", "bottom", "one_piece", "footwear", "accessory")
SLOT_LABELS = {
    "top": "Tops", "layer": "Layers", "bottom": "Bottoms", "one_piece": "Dresses & sets",
    "footwear": "Footwear", "accessory": "Accessories",
}

MAX_PIECES_PER_PHOTO = 6
MAX_WARDROBE_OUTFITS = 4
MAX_MISSING_PIECES = 3
# Pieces listed to the stylist (newest first); keeps the prompt small
MAX_PIECES_IN_PROMPT = 60

_FIELD_LIMIT = 60


def _text(value, limit: int = _FIELD_LIMIT) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


# ---------------------------------------------------------
# Tagging a photo of the user's clothes
# ---------------------------------------------------------

def tag_schema(style_tags: tuple) -> dict:
    return {
        "type": "object",
        "properties": {
            "pieces": {
                "type": "array",
                "maxItems": MAX_PIECES_PER_PHOTO,
                "items": {
                    "type": "object",
                    "properties": {
                        "item": {"type": "string"},
                        "color": {"type": "string"},
                        "pattern": {"type": "string"},
                        "fit": {"type": "string"},
                        "slot": {"type": "string", "enum": list(SLOTS)},
                        "styles": {"type": "array", "maxItems": 2,
                                   "items": {"type": "string", "enum": list(style_tags)}},
                    },
                    "required": ["item", "color", "slot"],
                },
            },
            "department": {"type": "string", "enum": ["men", "women", "unisex", "unknown"]},
        },
        "required": ["pieces", "department"],
    }


def tag_prompt(style_tags: tuple) -> str:
    return f"""You are OmniFit, a professional fashion stylist.

The user photographed clothes they OWN to add to their digital wardrobe: often one garment laid
flat or on a hanger, sometimes a few pieces, or an outfit being worn.

List each clothing item, footwear and accessory you can clearly see (at most {MAX_PIECES_PER_PHOTO}):
- "item": the garment type with its key details ("oxford shirt", "wide leg cargo jeans", "silk saree").
- "color": precise ("olive green", "navy and white").
- "pattern": "solid", "vertical stripes", "floral print"...
- "fit": "oversized", "slim", "regular", "wide leg"... if visible.
- "slot": top, layer (jacket, overshirt, blazer, shrug, cardigan), bottom, one_piece (dress, saree,
  jumpsuit, co-ord set, kurta set), footwear or accessory.
- "styles": 1-2 of: {", ".join(style_tags)}.
"department": "men", "women", "unisex" or "unknown", decided ONLY from the clothing, never from a
person's face or body.
Describe only the clothes. Ignore people, furniture and backgrounds. If there is no clothing, return
an empty "pieces" list. Return ONLY valid JSON."""


def clean_tagged_pieces(raw: str, style_tags: tuple) -> tuple[list[dict], str]:
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("not an object")

    pieces = []
    for piece in (data.get("pieces") or [])[:MAX_PIECES_PER_PHOTO]:
        if not isinstance(piece, dict):
            continue
        item, color = _text(piece.get("item")), _text(piece.get("color"))
        if not item or not color:
            continue
        pieces.append({
            "item": item,
            "color": color,
            "pattern": _text(piece.get("pattern")) or "solid",
            "fit": _text(piece.get("fit")),
            "slot": piece.get("slot") if piece.get("slot") in SLOTS else "top",
            "styles": [s for s in (piece.get("styles") or []) if s in style_tags][:2],
        })

    department = data.get("department") if data.get("department") in ("men", "women", "unisex") else "unknown"
    return pieces, department


def describe(piece: dict) -> str:
    """"olive green oversized overshirt" (solid is implied)."""
    pattern = piece.get("pattern", "")
    item, fit = piece.get("item", ""), piece.get("fit", "")
    # "wide leg" + "wide leg cargo jeans" -> said once
    if fit and fit.lower() in item.lower():
        fit = ""
    parts = [piece.get("color"), "" if pattern.lower() in ("solid", "plain", "") else pattern, fit, item]
    return " ".join(part for part in parts if part)


# ---------------------------------------------------------
# Outfits from the wardrobe + the missing piece
# ---------------------------------------------------------

OUTFITS_SCHEMA = {
    "type": "object",
    "properties": {
        "outfits": {
            "type": "array",
            "maxItems": MAX_WARDROBE_OUTFITS,
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "pieces": {"type": "array", "maxItems": 6, "items": {"type": "string"}},
                    "reason": {"type": "string"},
                },
                "required": ["title", "pieces", "reason"],
            },
        },
        "missing": {
            "type": "array",
            "maxItems": MAX_MISSING_PIECES,
            "items": {
                "type": "object",
                "properties": {
                    "item": {"type": "string"},
                    "color": {"type": "string"},
                    "unlocks": {"type": "integer"},
                    "reason": {"type": "string"},
                    "search_query": {"type": "string"},
                },
                "required": ["item", "color", "unlocks", "reason", "search_query"],
            },
        },
    },
    "required": ["outfits", "missing"],
}


def short_ids(pieces: list[dict]) -> dict[str, dict]:
    """Short labels for the prompt ("p1", "p2"...) mapped to the pieces."""
    return {f"p{index + 1}": piece for index, piece in enumerate(pieces[:MAX_PIECES_IN_PROMPT])}


def outfits_prompt(labelled: dict[str, dict], occasion_text: str, department: str, extra_sections: str) -> str:
    listing = "\n".join(
        f"{label}: {describe(piece)} [{piece['slot'].replace('_', ' ')}]" for label, piece in labelled.items()
    )
    section = {"men": "menswear", "women": "womenswear"}.get(department, "")
    return f"""You are OmniFit, a professional fashion stylist.

The user OWNS the clothes below (label: description [slot]). {f'They shop for {section}.' if section else ''}

<<<WARDROBE
{listing}
WARDROBE>>>

{f'They want outfits for: {occasion_text}' if occasion_text else 'Build versatile everyday outfits.'}

{extra_sections}

1. "outfits": up to {MAX_WARDROBE_OUTFITS} complete outfits made ONLY from the pieces above, each a
   different direction. "pieces": the labels used (e.g. ["p3", "p7", "p12"]): a top with a bottom, or a
   one-piece, plus footwear and accessories when the wardrobe has them. Never use a label that is not in
   the list. "reason": one short line on why it works (colours, occasion). If the wardrobe cannot make a
   complete outfit, return fewer or none.
2. "missing": 1-{MAX_MISSING_PIECES} pieces the user does NOT own that would create the most NEW
   outfits with what they have. "unlocks": how many new outfits it creates with their pieces (be
   honest, 1-10). "reason": which of their pieces it pairs with. "search_query": 3-6 lowercase words
   (colour + details + item) to find it in a store. Never suggest something nearly identical to a
   piece they own (same item type and colour family).
Talk only about clothes, never about the person's body. Return ONLY valid JSON."""


def clean_outfits(raw: str, labelled: dict[str, dict]) -> dict:
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("not an object")

    outfits = []
    for outfit in (data.get("outfits") or [])[:MAX_WARDROBE_OUTFITS]:
        if not isinstance(outfit, dict):
            continue
        labels = [label for label in dict.fromkeys(outfit.get("pieces") or []) if label in labelled]
        slots = {labelled[label]["slot"] for label in labels}
        # A real outfit: a one-piece, or a top/layer with a bottom
        if not ("one_piece" in slots or ({"top", "layer"} & slots and "bottom" in slots)):
            continue
        outfits.append({
            "title": _text(outfit.get("title"), 60) or "Outfit",
            "piece_ids": [labelled[label]["id"] for label in labels],
            "reason": _text(outfit.get("reason"), 240),
        })

    missing = []
    for piece in (data.get("missing") or [])[:MAX_MISSING_PIECES]:
        if not isinstance(piece, dict):
            continue
        item, color = _text(piece.get("item")), _text(piece.get("color"))
        query = re.sub(r"[^a-z0-9\s-]", " ", _text(piece.get("search_query"), 80).lower()).split()
        if not item or not query:
            continue
        unlocks = piece.get("unlocks")
        missing.append({
            "item": item,
            "color": color,
            "unlocks": max(1, min(int(unlocks), 10)) if isinstance(unlocks, int) else 1,
            "reason": _text(piece.get("reason"), 240),
            "search_query": " ".join(query[:8]),
        })

    return {"outfits": outfits, "missing": missing}


# ---------------------------------------------------------
# What the main stylist is told about the wardrobe
# ---------------------------------------------------------

def stylist_prompt_section(pieces: list[dict]) -> str:
    if not pieces:
        return ""
    listing = "; ".join(describe(piece) for piece in pieces[:MAX_PIECES_IN_PROMPT])
    return f"""USER'S WARDROBE (clothes they already own): {listing}.
- Never recommend buying something nearly identical to a piece they own (same item type and colour).
- For complete outfits: when one of their own pieces suits the question, build the look around it:
  write it in its slot exactly as listed and add that slot to "keep" (at least two slots must still be
  new pieces to buy)."""
