"""
Face shape and skin undertone, chosen by the user in My Style (never
detected from a photo). Used only to suggest accessories, eyewear,
necklines and colours, in neutral wording.
"""

from typing import Optional

FACE_SHAPES = {
    "oval": "most earring, frame and necklace styles work; statement pieces and any frame shape",
    "round": "angular or rectangular frames, long drop or linear earrings, V-necklines and longer necklaces",
    "square": "round or oval frames, hoops and rounded earrings, scoop necklines and softer curved shapes",
    "heart": "teardrop or chandelier earrings that are fuller at the bottom, light or rimless frames, chokers",
    "long": "wide or oversized frames, studs and cluster earrings, chokers and shorter necklaces",
    "diamond": "oval or cat-eye frames, studs or teardrop earrings, collar-length necklaces",
}

UNDERTONES = {
    "warm": "gold and brass jewellery, earthy and warm colours (mustard, olive, rust, cream, coral)",
    "cool": "silver and platinum jewellery, jewel and cool colours (emerald, sapphire, fuchsia, crisp white)",
    "neutral": "both gold and silver, and most colours from both warm and cool palettes",
}


# ---------------------------------------------------------
# Style Scan: an opt-in camera estimate of face shape and undertone
# ---------------------------------------------------------

CONFIDENCE = ("high", "medium", "low")

SCAN_SCHEMA = {
    "type": "object",
    "properties": {
        "usable": {"type": "boolean"},
        "problem": {"type": "string", "enum": ["", "no_face", "multiple_faces", "too_dark", "coloured_light",
                                               "face_covered", "too_far", "blurry"]},
        "face_shape": {"type": "string", "enum": ["unsure"] + list(FACE_SHAPES)},
        "face_shape_confidence": {"type": "string", "enum": list(CONFIDENCE)},
        "undertone": {"type": "string", "enum": ["unsure"] + list(UNDERTONES)},
        "undertone_confidence": {"type": "string", "enum": list(CONFIDENCE)},
        "accessory_tip": {"type": "string"},
        "colour_tip": {"type": "string"},
    },
    "required": ["usable", "problem", "face_shape", "face_shape_confidence", "undertone",
                 "undertone_confidence", "accessory_tip", "colour_tip"],
}

SCAN_PROMPT = f"""You are OmniFit's Style Scan. The user chose to take this selfie so you can suggest
accessories and colours. Look ONLY at two things:

1. Face shape, from the outline of the face and jaw: one of {", ".join(FACE_SHAPES)}; "unsure" if the
   face is turned, covered by hair or a hand, cropped or too far away.
2. Skin undertone for choosing colours: "warm", "cool" or "neutral", from the hue of the skin (golden or
   peachy = warm, pink or bluish = cool, a mix = neutral). This is NOT about how light or dark the skin is;
   every depth of skin can be warm, cool or neutral. Use "unsure" if the light is coloured, very dim or
   harsh, a filter is visible, or it is not clear.

Set "usable" false and name the "problem" if there is no face, several faces, or the photo can't be read.
Confidence: "high" only when it is clear.
"accessory_tip": one sentence of earring/eyewear/necklace ideas that complement the face shape.
"colour_tip": one sentence of colours and jewellery metal that complement the undertone.

Never mention or estimate age, gender, ethnicity, attractiveness, weight or how light or dark the skin
is. Never say anything hides, slims or corrects a feature. Word everything neutrally and positively.
Return ONLY valid JSON."""


def clean_scan(raw: str) -> dict:
    import json

    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("not an object")

    def pick(key, allowed, default):
        value = data.get(key)
        return value if value in allowed else default

    face = pick("face_shape", list(FACE_SHAPES), None)
    tone = pick("undertone", list(UNDERTONES), None)
    usable = bool(data.get("usable")) and bool(face or tone)
    return {
        "usable": usable,
        "problem": pick("problem", SCAN_SCHEMA["properties"]["problem"]["enum"], "") if not usable else "",
        "face_shape": face,
        "face_shape_confidence": pick("face_shape_confidence", CONFIDENCE, "low") if face else None,
        "undertone": tone,
        "undertone_confidence": pick("undertone_confidence", CONFIDENCE, "low") if tone else None,
        "accessory_tip": (data.get("accessory_tip") or "")[:240] if face else "",
        "colour_tip": (data.get("colour_tip") or "")[:240] if tone else "",
    }


SCAN_PROBLEMS = {
    "no_face": "I couldn't see a face. Hold the phone at eye level, face the camera.",
    "multiple_faces": "I can see more than one person. Please scan just yourself.",
    "too_dark": "It's too dark. Face a window or a white light.",
    "coloured_light": "The light is coloured. Daylight or white light gives a true reading.",
    "face_covered": "Part of the face is covered. Move hair or hands away from the face.",
    "too_far": "Come a little closer so your face fills the circle.",
    "blurry": "The photo is blurry. Hold still for a moment.",
}


def personal_prompt_section(face_shape: Optional[str], undertone: Optional[str]) -> str:
    lines = []
    if face_shape in FACE_SHAPES:
        lines.append(f"- Face shape (chosen by the user): {face_shape}. For earrings, eyewear, necklaces and "
                     f"necklines, lean towards: {FACE_SHAPES[face_shape]}.")
    if undertone in UNDERTONES:
        lines.append(f"- Skin undertone (chosen by the user): {undertone}. For jewellery metal and colours, "
                     f"lean towards: {UNDERTONES[undertone]}.")
    if not lines:
        return ""
    return "PERSONAL STYLING PREFERENCES:\n" + "\n".join(lines) + """
Use these only for accessories, eyewear, necklines and colour choices, and only when they fit the question.
Word it neutrally ("long drop earrings complement an oval face shape"). Never say a piece hides, slims or
corrects anything, and never suggest that any face shape or skin tone is better than another."""
