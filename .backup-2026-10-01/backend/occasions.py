"""
Occasion stylist: the occasions, their quick questions, and the styling
guidance given to the stylist for each answer.

The page shows the occasions as chips and the quick questions as choices;
only the values listed here are accepted, so nothing the user types reaches
the prompt through this route.
"""

import json
from typing import Optional

# Each occasion: a label, its quick questions (id -> label + allowed answers)
# and the guidance the stylist follows
OCCASIONS = {
    "wedding": {
        "label": "Wedding",
        "questions": {
            "function": {
                "label": "Which function?",
                "options": ["Muhurtham / ceremony", "Reception", "Sangeet", "Mehendi", "Haldi",
                            "Engagement", "Several functions"],
            },
            "role": {"label": "You are…", "options": ["Guest", "Close family"]},
            "tradition": {
                "label": "Wedding tradition",
                "options": ["Tamil", "Telugu", "Kerala", "Kannada", "North Indian", "Bengali",
                            "Gujarati / Marwari", "Christian", "Muslim", "Other / mixed"],
            },
            "style": {"label": "Style", "options": ["Traditional", "Fusion", "Modern"]},
        },
        "guide": """- Match the function: a morning muhurtham or ceremony is the most traditional (for example a silk
  veshti or dhoti with a silk shirt or kurta; a silk saree or a pavadai set). A reception is dressier
  and often later in the day (sherwani, bandhgala, Indo-western, a suit; lehenga, saree, gown,
  anarkali). Sangeet: festive and easy to dance in. Mehendi: light, bright, comfortable fabrics.
  Haldi: yellow tones and clothes the user won't mind getting stained. Engagement: festive, semi-formal.
- Follow the wedding tradition the user chose (for example Kerala weddings: off-white and gold kasavu;
  Christian weddings: guests avoid white, which is the bride's colour). For a Hindu ceremony, avoid an
  all-black or all-white outfit unless the tradition calls for it.
- A guest never upstages the couple: no bridal-red lehenga or groom-style sherwani for a guest.
  Close family can dress richer and more traditional.
- "Several functions": plan one look per function (up to 3) that re-use a bottom, footwear or
  accessories across looks to save money, and say in each reason which pieces are re-used.
- Always include footwear suited to the outfit (juttis, mojaris, kolhapuris, sandals, heels, loafers)
  and finishing accessories (jewellery, watch, clutch or potli bag, stole or dupatta).""",
    },
    "festival": {
        "label": "Festival",
        "questions": {
            "festival": {
                "label": "Which festival?",
                "options": ["Diwali", "Pongal", "Onam", "Eid", "Christmas", "Navratri", "Durga Puja",
                            "Holi", "Other"],
            },
            "style": {"label": "Style", "options": ["Traditional", "Fusion", "Modern"]},
        },
        "guide": """- Dress for the festival's customs: Onam - off-white and gold kasavu (mundu, set-mundu, saree);
  Pongal - traditional South Indian wear (veshti, saree, pavadai) in cotton or silk; Diwali - festive
  ethnic wear in rich or jewel tones; Eid - kurta pajama, pathani, sharara, anarkali, often in
  white or pastels; Christmas - festive party wear, western or fusion; Navratri - chaniya choli,
  kediyu, bright colours easy to dance in; Durga Puja - sarees and kurtas, red and white is popular;
  Holi - white or light cotton clothes the user won't mind getting coloured.
- Diwali and other festivals with lamps or fireworks: prefer cotton and silk over flowing synthetics.""",
    },
    "office": {
        "label": "Office",
        "questions": {
            "type": {"label": "What kind of day?",
                     "options": ["Daily office", "Interview", "Presentation / client meeting", "Casual Friday"]},
        },
        "guide": """- Interview and client meetings: conservative, well-fitted, formal or smart-formal; solid or subtle
  patterns; closed formal shoes.
- Daily office: smart-casual that is comfortable for a full day; easy to mix and repeat.
- Casual Friday: relaxed but neat (chinos, polos, clean sneakers or loafers); no ripped or graphic pieces.
- Indian formal wear (kurta with trousers, saree, formal kurta sets) is always office-appropriate.""",
    },
    "party": {
        "label": "Party",
        "questions": {
            "type": {"label": "What kind of party?",
                     "options": ["Birthday", "Club / night out", "Dinner", "House party", "Cocktail"]},
        },
        "guide": """- Club / night out and cocktail: dressier, darker or statement pieces, some shine or texture.
- Dinner: smart and polished. House party and birthday: relaxed but put-together.
- Footwear should be comfortable enough to stand and dance in.""",
    },
    "casual": {
        "label": "Casual / College",
        "questions": {
            "type": {"label": "Where to?",
                     "options": ["Everyday", "College", "College fest", "Weekend outing", "Brunch"]},
        },
        "guide": """- Comfortable, easy to move in, easy to repeat and mix.
- College fest: more expressive (graphic tees, co-ords, statement sneakers, Indo-western).""",
    },
    "date": {
        "label": "Date",
        "questions": {
            "time": {"label": "When?", "options": ["Daytime", "Evening"]},
            "place": {"label": "Where?", "options": ["Cafe", "Restaurant", "Movie", "Walk / outdoors"]},
        },
        "guide": """- Put-together but not overdressed for the place; comfortable enough to relax.
- Evening: slightly dressier and darker; daytime: lighter colours and fabrics.""",
    },
    "travel": {
        "label": "Travel",
        "questions": {
            "place": {"label": "Where?", "options": ["Beach", "Hill station", "City trip", "Religious / temple visit",
                                                     "Long flight or train"]},
        },
        "guide": """- Beach: breathable fabrics, shorts, linen, sandals, sunglasses and a cap.
- Hill station: layers (a light jacket or sweater), closed shoes with grip.
- City trip: comfortable walking shoes and pieces that mix into several outfits.
- Temple visit: modest, traditional clothing covering shoulders and knees; easy-to-remove footwear.
- Long journeys: soft, stretchy, wrinkle-free pieces.""",
    },
}

MAX_ANSWER_LENGTH = 40


def parse_occasion(raw: Optional[str]) -> Optional[dict]:
    """The occasion the page sent, keeping only known values."""
    if not raw:
        return None

    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return None

    if not isinstance(data, dict) or data.get("id") not in OCCASIONS:
        return None

    occasion = OCCASIONS[data["id"]]
    answers = data.get("answers") if isinstance(data.get("answers"), dict) else {}

    return {
        "id": data["id"],
        "answers": {
            question: answers[question]
            for question, spec in occasion["questions"].items()
            if isinstance(answers.get(question), str) and answers[question] in spec["options"]
        },
    }


def occasion_prompt_section(occasion: Optional[dict]) -> str:
    if not occasion:
        return ""

    spec = OCCASIONS[occasion["id"]]
    details = "; ".join(
        f"{spec['questions'][question]['label'].rstrip('?…').strip()}: {answer}"
        for question, answer in occasion["answers"].items()
    )

    source = "what their photo's clothes suit; they didn't name one" if occasion.get("from_photo") else "chosen by the user"
    return f"""OCCASION ({source}): {spec['label']}{f' - {details}' if details else ''}.
Unless the question asks for single items or a different number, return 3 complete outfits
(request_type "complete_outfits"), each a DIFFERENT direction (for example traditional, fusion, modern,
or three colour stories), each with footwear, "accessories" and an "extra" finishing piece.
Occasion guidance:
{spec['guide']}"""


def public_occasions() -> list[dict]:
    """The occasions and quick questions, for the page."""
    return [
        {
            "id": occasion_id,
            "label": spec["label"],
            "questions": [
                {"id": question, "label": q["label"], "options": q["options"]}
                for question, q in spec["questions"].items()
            ],
        }
        for occasion_id, spec in OCCASIONS.items()
    ]
