"""
Conversational edits of the looks on screen.

"make it casual", "change the shoes", "I don't like the first one",
"complete the look", "show me 2 more": the page sends the looks the person
is looking at, Gemma's understanding step says what to do with them (an
edit plan), the stylist rewrites only what should change, and merge() puts
the answer back together. What must be preserved is enforced here, in code:
pieces that aren't being changed are copied exactly as they were (with
their shop searches), including the pieces from the person's own photo.
"""

import json
import re
from typing import Optional

SLOTS = ("top", "layer", "bottom", "footwear", "accessories", "extra")
SLOT_WORDS = {"top": "top", "layer": "layer", "bottom": "bottom", "footwear": "shoes",
              "accessories": "accessory", "extra": "finishing piece"}

ACTIONS = {
    "new": "a fresh request, not about the looks on screen",
    "refine": "adjust the looks in a direction ('make it casual', 'more festive', 'cheaper', 'in darker colours')",
    "swap_pieces": "change only certain pieces ('change the shoes', 'a different bag for the second one')",
    "replace_looks": "they dislike some looks and want different ones instead ('I don't like the first one')",
    "drop_looks": "remove looks without replacing them ('remove the last one', 'only keep the second')",
    "complete_look": "fill in the missing pieces of a look, keeping everything in it ('complete the look')",
    "more": "more options like these ('show me more', '2 more')",
}

MAX_LOOKS = 6
MAX_TEXT = 140
MAX_CURRENT_JSON = 16_000
LOOK_TEXT_FIELDS = ("title", "reason") + SLOTS
ITEM_TEXT_FIELDS = ("item", "color", "style", "reason", "search_query", "any_colour_query")


def _text(value, limit: int = MAX_TEXT) -> str:
    return re.sub(r"\s+", " ", value).strip()[:limit] if isinstance(value, str) else ""


def clean_current(raw: Optional[str]) -> Optional[dict]:
    """The looks on screen, as sent by the page. Untrusted: only known fields,
    short strings, a few looks. None when there's nothing usable."""
    if not raw or len(raw) > MAX_CURRENT_JSON:
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(data, dict) or not isinstance(data.get("recommendations"), list):
        return None

    items = data.get("request_type") == "item_options"
    looks = []
    for rec in data["recommendations"][:MAX_LOOKS]:
        if not isinstance(rec, dict):
            continue
        if items:
            look = {field: _text(rec.get(field)) for field in ITEM_TEXT_FIELDS if _text(rec.get(field))}
            if look.get("item") or look.get("style"):
                looks.append(look)
            continue
        look = {field: _text(rec.get(field)) for field in LOOK_TEXT_FIELDS if _text(rec.get(field))}
        for key in ("shop_queries", "any_colour_queries"):
            queries = rec.get(key) if isinstance(rec.get(key), dict) else {}
            look[key] = {slot: _text(queries[slot], 80) for slot in SLOTS if _text(queries.get(slot), 80) and look.get(slot)}
        for key in ("keep", "from_wardrobe"):
            values = rec.get(key) if isinstance(rec.get(key), list) else []
            look[key] = [slot for slot in SLOTS if slot in values and look.get(slot)]
        if sum(1 for slot in SLOTS if look.get(slot)) >= 2:
            looks.append(look)

    if not looks:
        return None
    analysis = data.get("outfit_analysis") if isinstance(data.get("outfit_analysis"), dict) else {}
    seen = [
        " ".join(filter(None, (_text(item.get("color"), 40), _text(item.get("item"), 40))))
        for item in (analysis.get("visible_items") or [])[:10] if isinstance(item, dict)
    ]
    return {
        "request_type": "item_options" if items else ("complete_outfit" if len(looks) == 1 else "complete_outfits"),
        "recommendations": looks,
        "photo_items": [item for item in seen if item],
        "photo_style": _text(analysis.get("overall_style"), 60),
        # Kept so the "what I see in your photo" panel survives an edit
        "outfit_analysis": {
            "visible_items": [
                {field: _text(item.get(field), 40) for field in ("item", "color", "pattern", "fit") if _text(item.get(field), 40)}
                for item in (analysis.get("visible_items") or [])[:10] if isinstance(item, dict) and _text(item.get("item"), 40)
            ],
            "overall_style": _text(analysis.get("overall_style"), 60),
        },
    }


def describe_looks(current: dict) -> str:
    """The looks on screen, numbered, for Gemma to refer to."""
    lines = []
    for number, look in enumerate(current["recommendations"], start=1):
        if current["request_type"] == "item_options":
            lines.append(f"Option {number}: {' '.join(filter(None, (look.get('color'), look.get('style') or look.get('item'))))}")
            continue
        pieces = "; ".join(
            f"{SLOT_WORDS[slot]}: {look[slot]}" + (" (their own)" if slot in look.get("keep", []) else "")
            for slot in SLOTS if look.get(slot)
        )
        lines.append(f"Look {number} \"{look.get('title', 'Look')}\": {pieces}")
    if current.get("photo_items"):
        lines.append(f"Their photo showed: {', '.join(current['photo_items'])}")
    return "\n".join(lines)


# ---------------------------------------------------------
# The edit plan (part of the understanding step's JSON)
# ---------------------------------------------------------

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": list(ACTIONS)},
        # Which looks, numbered as on screen; empty = all of them
        "looks": {"type": "array", "maxItems": MAX_LOOKS, "items": {"type": "integer"}},
        "change": {"type": "array", "items": {"type": "string", "enum": list(SLOTS)}},
        "keep": {"type": "array", "items": {"type": "string", "enum": list(SLOTS)}},
        # The direction in a few words: "more casual", "cheaper", "black shoes"
        "direction": {"type": "string"},
    },
    "required": ["action", "looks", "change", "keep", "direction"],
}


def understanding_prompt_section(current: Optional[dict]) -> str:
    if not current:
        return ('- "edit": there are no suggestions on screen, so action "new", looks [], change [], keep [], '
                'direction "".')
    actions = "\n".join(f'    - "{name}": {meaning}' for name, meaning in ACTIONS.items())
    return f"""- "edit": what the newest message wants done with the suggestions ON SCREEN (below):
{actions}
  "looks": the numbers of the looks it is about ("the first one" -> [1], "the last two" of 3 -> [2, 3]);
  [] means all of them. "change": the pieces to replace ("change the shoes" -> ["footwear"],
  "different jeans" -> ["bottom"], "a jacket" -> ["layer"]). "keep": pieces they said to keep ("keep
  the kurta" -> ["top"]). "direction": the change in a few English words ("more casual", "under
  ₹2,000", "black shoes"), "" if none. A message about something else entirely is "new".
  Their own pieces (from their photo, marked "their own") are kept unless they ask to change them.
  Never ask a follow-up question about an edit: act on it.

SUGGESTIONS ON SCREEN:
{describe_looks(current)}"""


def clean_plan(data: dict, current: Optional[dict], count: int) -> Optional[dict]:
    """The edit plan from the understanding step, checked against the screen."""
    raw = data.get("edit") if isinstance(data.get("edit"), dict) else {}
    action = raw.get("action") if raw.get("action") in ACTIONS else "new"
    if not current or action == "new":
        return None
    total = len(current["recommendations"])
    looks = sorted({n for n in raw.get("looks") or [] if isinstance(n, int) and 1 <= n <= total})
    change = [slot for slot in SLOTS if slot in (raw.get("change") or [])]
    keep = [slot for slot in SLOTS if slot in (raw.get("keep") or []) and slot not in change]
    if current["request_type"] == "item_options":
        change, keep = [], []
        if action in ("swap_pieces", "complete_look"):
            action = "refine"
    if action == "swap_pieces" and not change:
        action = "refine"
    if action == "drop_looks" and (not looks or len(looks) >= total):
        action = "replace_looks"
    return {
        "action": action,
        "looks": looks or list(range(1, total + 1)),
        "change": change,
        "keep": keep,
        "direction": _text(raw.get("direction"), 60),
        "count": count if action == "more" and count else (2 if action == "more" else 0),
    }


# ---------------------------------------------------------
# Telling the stylist what to do
# ---------------------------------------------------------

def stylist_prompt_section(plan: dict, current: dict) -> str:
    items = current["request_type"] == "item_options"
    unit = "option" if items else "look"
    targets = [current["recommendations"][n - 1] for n in plan["looks"]]
    numbered = "\n".join(
        f"{unit.capitalize()} {n}: " + (
            json.dumps({k: v for k, v in look.items() if k in ITEM_TEXT_FIELDS[:4]}, ensure_ascii=False)
            if items else
            json.dumps({slot: look[slot] for slot in SLOTS if look.get(slot)}, ensure_ascii=False)
        )
        for n, look in zip(plan["looks"], targets)
    )
    direction = f' Direction: "{plan["direction"]}".' if plan["direction"] else ""
    own = [slot for look in targets for slot in look.get("keep", [])]
    own_note = (f"\nPieces from their own photo ({', '.join(sorted(set(own)))}) stay exactly as they are unless "
                f"listed to change.") if own and not items else ""
    photo = f"\nTheir photo showed: {', '.join(current['photo_items'])}." if current.get("photo_items") else ""

    action = plan["action"]
    if action == "swap_pieces":
        task = (f"Return the {len(targets)} {unit}(s) below in the same order. Replace ONLY these pieces: "
                f"{', '.join(SLOT_WORDS[s] for s in plan['change'])}, with new ones that suit the rest of the "
                f"{unit} better.{direction} Copy every other piece exactly as written.")
    elif action == "refine":
        keep = (f" Keep exactly: {', '.join(SLOT_WORDS[s] for s in plan['keep'])}." if plan["keep"] else "")
        task = (f"Return the {len(targets)} {unit}(s) below in the same order, adjusted.{direction} Change only "
                f"the pieces that need it for that; keep the rest.{keep}")
    elif action == "complete_look":
        task = (f"Return the {len(targets)} {unit}(s) below in the same order, completed: keep every piece "
                f"already in it exactly as written and fill the missing ones (footwear, accessories, extra, "
                f"and a layer if it suits).{direction}")
    elif action == "replace_looks":
        task = (f"The person doesn't like the {unit}(s) below. Return {len(targets)} DIFFERENT {unit}(s) "
                f"instead, for the same request, clearly unlike these and unlike the others on screen."
                f"{direction}")
    else:  # more
        task = (f"Return {plan['count']} NEW {unit}(s) for the same request, different from every {unit} on "
                f"screen.{direction}")

    return f"""EDITING THE SUGGESTIONS ON SCREEN (this message changes them, it is not a new request):
All suggestions on screen:
{describe_looks(current)}

The {unit}(s) to work on:
{numbered}
{photo}{own_note}
TASK: {task}
Keep the same answer type ({'individual items' if items else 'complete outfits'}). Set "count" to the number of
{unit}s you return. In "next_steps", refer to {unit}s by their numbers ON SCREEN (as listed above)."""


def expected_count(plan: dict) -> int:
    return plan["count"] if plan["action"] == "more" else len(plan["looks"])


# ---------------------------------------------------------
# Putting the answer back together
# ---------------------------------------------------------

def _copy_slot(target: dict, source: dict, slot: str) -> None:
    """Slot text, searches and 'their own' flags from source into target."""
    for key in ("shop_queries", "any_colour_queries"):
        target.setdefault(key, {})
        target[key].pop(slot, None)
    for key in ("keep", "from_wardrobe"):
        target[key] = [s for s in target.get(key, []) if s != slot]
    target.pop(slot, None)
    if not source.get(slot):
        return
    target[slot] = source[slot]
    for key in ("shop_queries", "any_colour_queries"):
        if slot in (source.get(key) or {}):
            target[key][slot] = source[key][slot]
    for key in ("keep", "from_wardrobe"):
        if slot in (source.get(key) or []):
            target[key].append(slot)


def _preserve(new: dict, old: dict, slots) -> dict:
    merged = {**new, "shop_queries": dict(new.get("shop_queries") or {}),
              "any_colour_queries": dict(new.get("any_colour_queries") or {}),
              "keep": list(new.get("keep") or []), "from_wardrobe": list(new.get("from_wardrobe") or [])}
    for slot in slots:
        _copy_slot(merged, old, slot)
    return merged


def merge(plan: dict, current: dict, result: Optional[dict]) -> dict:
    """The full answer: the looks on screen with the edit applied.

    `result` is the stylist's parsed answer (None for drop_looks, which needs
    no model call). Pieces that must not change are copied from the screen.
    """
    old = current["recommendations"]
    items = current["request_type"] == "item_options"
    targets = plan["looks"]
    new = list((result or {}).get("recommendations") or [])
    action = plan["action"]

    if action == "drop_looks":
        looks = [look for n, look in enumerate(old, start=1) if n not in targets]
    elif action == "more":
        looks = old + new
    else:
        looks = list(old)
        for n, fresh in zip(targets, new):
            before = old[n - 1]
            if items or action == "replace_looks":
                looks[n - 1] = fresh
                continue
            if action == "swap_pieces":
                # Everything except the pieces to change stays as it was
                merged = _preserve(fresh, before, [s for s in SLOTS if s not in plan["change"]])
                merged["title"] = before.get("title") or fresh.get("title")
            elif action == "complete_look":
                merged = _preserve(fresh, before, [s for s in SLOTS if before.get(s)])
                merged["title"] = before.get("title") or fresh.get("title")
            else:  # refine: the model decides, but kept and own pieces stay
                own = [s for s in before.get("keep", []) if s not in plan["change"]]
                merged = _preserve(fresh, before, list(dict.fromkeys(plan["keep"] + own)))
            looks[n - 1] = merged

    looks = [look for look in looks if look]
    base = dict(result) if result else {"colour_pairings": [], "colour_requested": False}
    # The photo the looks were built on stays on screen
    if current["outfit_analysis"]["visible_items"]:
        base["outfit_analysis"] = current["outfit_analysis"]
    base.setdefault("outfit_analysis", {"visible_items": [], "overall_style": ""})
    base["recommendations"] = looks
    base["count"] = len(looks)
    base["request_type"] = "item_options" if items else ("complete_outfit" if len(looks) == 1 else "complete_outfits")
    base["edit"] = {"action": action, "looks": targets, "note": edit_note(plan, current, len(new))}
    return base


def edit_note(plan: dict, current: dict, returned: int) -> str:
    """One line for the chat: what was changed and what was kept."""
    unit = "option" if current["request_type"] == "item_options" else "look"
    total = len(current["recommendations"])
    which = ("all " + (f"{total} {unit}s" if total > 1 else unit)) if len(plan["looks"]) == total \
        else " and ".join(f"{unit} {n}" for n in plan["looks"])
    direction = f" {plan['direction']}" if plan["direction"] else ""
    action = plan["action"]
    if action == "swap_pieces":
        return f"Changed the {', '.join(SLOT_WORDS[s] for s in plan['change'])} in {which}; kept everything else."
    if action == "refine":
        kept = f"; kept your {', '.join(SLOT_WORDS[s] for s in plan['keep'])}" if plan["keep"] else ""
        return f"Adjusted {which}{(' to be' + direction) if direction else ''}{kept}."
    if action == "complete_look":
        return f"Completed {which}, keeping every piece you had."
    if action == "replace_looks":
        return f"Swapped {which} for something different."
    if action == "drop_looks":
        return f"Removed {which}."
    return f"Added {returned} more {unit}{'s' if returned != 1 else ''}{(' ' + direction.strip()) if direction else ''}."
