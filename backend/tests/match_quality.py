"""
Product-match quality check for OmniFit's catalog search.

Runs realistic searches (the kind of phrases the stylist writes) and checks
every returned product with rules written independently of the search code,
so the search can't "agree with itself":

  garment  the product is the requested kind of garment (title or store type)
  colour   the product's main colour is the one asked for; a specific shade
           (navy, olive, mustard, maroon...) must be that shade; "light"/"dark"
           must not be contradicted
  detail   key details asked for (linen, leather, oxford, cargo, floral,
           midi, wide leg...) appear in the product title/type
  set      a single item isn't answered with a multi-piece set
  section  men's searches never return women's/kids' items and vice versa,
           including when the product title itself says "Women"/"Men"

Usage (from backend/, with the venv active):
    python tests/match_quality.py            # faults + summary
    python tests/match_quality.py --verbose  # also every product returned
Exit code 1 if any fault is found.
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from catalog import connect, search_products  # noqa: E402

# ------------------------------------------------------------------
# Independent reference rules (deliberately not imported from catalog)
# ------------------------------------------------------------------

GARMENTS = {
    "t-shirt": {"t-shirt", "tshirt", "tee", "t shirt", "polo"},
    "polo": {"polo"},
    "shirt": {"shirt"},
    "overshirt": {"overshirt", "shacket"},
    "kurta": {"kurta", "kurti", "anarkali"},
    "jeans": {"jeans", "jean"},
    "cargo pants": {"cargo"},
    "chinos": {"chino", "chinos"},
    "trousers": {"trouser", "trousers", "pant", "pants"},
    "joggers": {"jogger", "joggers"},
    "leggings": {"legging", "leggings"},
    "hoodie": {"hoodie", "hoody"},
    "sweatshirt": {"sweatshirt"},
    "jacket": {"jacket"},
    "blazer": {"blazer"},
    "sneakers": {"sneaker", "sneakers"},
    "loafers": {"loafer", "loafers"},
    "boots": {"boot", "boots"},
    "sandals": {"sandal", "sandals"},
    "juttis": {"jutti", "juttis", "mojari"},
    "dress": {"dress"},
    "skirt": {"skirt"},
    "co-ord set": {"co-ord", "coord", "co ord", "co-ords"},
    "earrings": {"earring", "earrings", "studs", "jhumka", "hoops"},
    "necklace": {"necklace", "chain", "pendant"},
    "cap": {"cap"},
    "belt": {"belt"},
    "backpack": {"backpack"},
    "watch": {"watch"},
}

# Shade words a shopper means literally, with close equivalents
SHADES = {
    "navy": {"navy", "midnight"}, "olive": {"olive"}, "mustard": {"mustard", "ochre"},
    "maroon": {"maroon", "wine", "burgundy", "oxblood"}, "emerald": {"emerald"},
    "lemon": {"lemon"}, "khaki": {"khaki"}, "charcoal": {"charcoal"},
    "ivory": {"ivory", "cream", "off-white", "off white", "offwhite", "ecru"},
    "tan": {"tan", "camel", "cognac"},
}

BASE_COLOURS = {
    "black": {"black", "jet", "onyx", "ebony", "charcoal black"},
    "white": {"white", "ivory", "off-white", "off white", "offwhite", "cream", "ecru", "pearl"},
    "blue": {"blue", "navy", "midnight", "indigo", "cobalt", "sky", "denim blue", "teal", "turquoise", "aqua"},
    "green": {"green", "olive", "mint", "sage", "emerald", "pista", "moss", "lime", "bottle", "teal"},
    "grey": {"grey", "gray", "charcoal", "melange", "ash", "graphite", "smoke"},
    "brown": {"brown", "tan", "camel", "coffee", "chocolate", "cognac", "mocha", "taupe"},
    "beige": {"beige", "khaki", "sand", "cream", "ecru", "taupe", "oatmeal", "camel", "nude"},
    "red": {"red", "maroon", "wine", "burgundy", "crimson", "cherry", "scarlet", "oxblood"},
    "pink": {"pink", "rose", "blush", "fuchsia", "magenta", "mauve"},
    "yellow": {"yellow", "mustard", "lemon", "ochre"},
    "gold": {"gold", "golden", "brass"},
    "silver": {"silver", "chrome", "platinum"},
}

DARK_WORDS = {"dark", "navy", "deep", "midnight", "indigo", "charcoal", "chocolate", "coffee", "espresso"}
LIGHT_WORDS = {"light", "sky", "pale", "pastel", "baby", "ice", "powder"}

# Items outside the garment list must be named in the title in full
UNKNOWN_ITEM_FILLER = {"men", "women", "unisex", "and", "with", "a", "the", "for", "light", "dark", "statement"}

# Details that change what the product is; must be visible in the title/type
DETAILS = {
    "linen": {"linen"}, "leather": {"leather"}, "denim": {"denim", "jeans"},
    "oxford": {"oxford"}, "cargo": {"cargo"}, "chelsea": {"chelsea"},
    "floral": {"floral", "flower", "flowers", "botanical"},
    "embroidered": {"embroidered", "embroidery", "chikankari", "hand-embroidered"},
    "graphic": {"graphic", "print", "printed"},
    "midi": {"midi"}, "maxi": {"maxi"}, "mini": {"mini"},
    "wide": {"wide"}, "straight": {"straight"}, "slim": {"slim", "skinny"},
    "oversized": {"oversized", "oversize", "boxy"}, "chunky": {"chunky"},
    "polo": {"polo"}, "derby": {"derby"}, "brogue": {"brogue", "brogues"}, "brogues": {"brogue", "brogues"},
    "embellished": {"embellished", "embroidered", "sequin", "beaded", "mirror", "stone"},
}

DETAILS.update({
    "block": {"block"}, "stiletto": {"stiletto", "stilettos"}, "pointed": {"pointed"}, "wedge": {"wedge", "wedges"},
    "crewneck": {"crewneck", "crew neck", "crew-neck"}, "turtleneck": {"turtleneck", "turtle neck"},
    "hoop": {"hoop", "hoops", "j-hoop"},
    "strappy": {"strappy", "strap", "straps"}, "pendant": {"pendant"}, "tailored": {"tailored"},
})

GARMENTS.update({
    "tee": {"t-shirt", "tshirt", "tee", "t shirt"}, "heels": {"heel", "heels"},
    "sweater": {"sweater", "pullover", "jumper", "cardigan"},
    "flats": {"flat", "flats", "ballet", "ballerina", "ballerinas"}, "coat": {"coat", "trench"},
    "blouse": {"blouse", "top"}, "top": {"top", "blouse", "tank", "camisole"},
    "oxfords": {"oxford", "oxfords"}, "shoes": {"shoe", "shoes", "loafer", "loafers", "sneaker", "sneakers",
                                                "oxford", "oxfords", "brogue", "brogues", "derby", "boots"},
    "bangle": {"bangle", "bangles", "kada"}, "clutch": {"clutch"}, "beanie": {"beanie"},
    "pocket square": {"pocket square"}, "necktie": {"necktie", "tie"}, "tie": {"tie", "necktie"},
})

FORMAL_QUERY = re.compile(r"\bformal\b|\bdress (shirt|shoes|trousers|pants)\b|\bsuit (trousers|pants)\b")
CASUAL_TITLE = {"cargo", "jogger", "joggers", "track", "denim", "jeans", "graphic", "distressed",
                "print", "printed", "tropical", "hawaiian", "oversized", "boxy", "floral"}

SET_WORDS = re.compile(r"\b(set|sets|co-?ords?|combo)\b|\bwith\b.*\b(pants?|trousers?|palazzo|dupatta|churidar|salwar|cape|skirt|blouse)\b", re.I)


def words_in(text: str, vocabulary: set) -> bool:
    """Whole-word match, allowing a plural 's'/'es' ("Jackets" is a jacket)."""
    text = f" {text.lower()} "
    return any(re.search(rf"(?<![a-z]){re.escape(word)}(e?s)?(?![a-z])", text) for word in vocabulary)


def colours_in_order(text: str) -> list:
    """Base colours of each colour word in a title, in order of appearance.
    A word in two families (camel: brown and beige) gives a set of both."""
    lowered = text.lower()
    by_position = {}
    for base, members in BASE_COLOURS.items():
        for word in members:
            for match in re.finditer(rf"(?<![a-z]){re.escape(word)}(?![a-z])", lowered):
                by_position.setdefault(match.start(), set()).add(base)
    return [by_position[position] for position in sorted(by_position)]


def check_product(query: str, department: str, row, relaxed=()) -> list:
    # Fit words the search openly dropped (shown to users as "Closest match")
    for word in relaxed:
        query = re.sub(rf"\b{re.escape(word)}\b", "", query)

    title = f"{row['title']} {row['product_type'] or ''}"
    colour_text = title if colours_in_order(title) else (row["colors"] or "")
    # "Light Weight" describes fabric, not a light colour
    colour_text = re.sub(r"\blight[\s-]?weight\b", "lightweight", colour_text, flags=re.I)
    q = query.lower()
    faults = []

    garment = next((name for name in sorted(GARMENTS, key=len, reverse=True) if words_in(q, {name})), None)
    # What the product is comes before "for" ("Bag Charm For Backpack" is a charm)
    item_part = re.split(r"\s+for\s+", row["title"], maxsplit=1, flags=re.I)[0] + " " + (row["product_type"] or "")
    if garment and not words_in(item_part, GARMENTS[garment]):
        faults.append(f"GARMENT  not a {garment}")

    if re.search(r"\bhigh[\s-]?tops?\b", q) and not re.search(r"\bhigh[\s-]?tops?\b", title.lower()):
        faults.append("DETAIL   wanted high-top")
    if re.search(r"\blow[\s-]?tops?\b", q) and not re.search(r"\blow[\s-]?tops?\b", title.lower()):
        faults.append("DETAIL   wanted low-top")

    if garment == "boots" and words_in(title, {"boot cut", "bootcut", "boot-cut"}):
        faults.append("GARMENT  'boot cut' jeans are not boots")

    if garment == "trousers" and words_in(title, {"kurta", "kurti"}):
        faults.append("GARMENT  a kurta set, not trousers")

    if not garment:
        wanted_words = [
            word for word in re.findall(r"[a-z]+", q)
            if word not in UNKNOWN_ITEM_FILLER and not any(word in members for members in BASE_COLOURS.values())
            and word not in DETAILS
        ]
        if not wanted_words or not all(words_in(title, {word, word + "s", word.rstrip("s")}) for word in wanted_words):
            faults.append(f"GARMENT  title doesn't name the item ({' '.join(wanted_words) or 'no item in search'})")

    wanted_bases = {base for base in BASE_COLOURS if words_in(q, BASE_COLOURS[base])}
    if len(wanted_bases) == 1 and re.search(r"\b(dual|two|duo|tri|multi)[\s-]?(tone|toned|colou?r)|\bmulticolou?r", title.lower()):
        faults.append("COLOUR   multi-colour item for a single-colour search")
    if wanted_bases:
        found = colours_in_order(colour_text)
        if not found:
            faults.append("COLOUR   colour not stated")
        elif len(wanted_bases) == 1 and not found[0] & wanted_bases:
            faults.append(f"COLOUR   main colour {sorted(found[0])}, wanted {sorted(wanted_bases)}")
        elif len(wanted_bases) > 1 and not wanted_bases <= set().union(*found):
            faults.append(f"COLOUR   wanted all of {sorted(wanted_bases)}, got {sorted(set().union(*found))}")

    for shade, members in SHADES.items():
        if words_in(q, {shade}) and not words_in(colour_text, members):
            faults.append(f"SHADE    wanted {shade}")

    if words_in(q, {"light"}) and (words_in(colour_text, DARK_WORDS) or not words_in(colour_text, LIGHT_WORDS)):
        faults.append("SHADE    wanted light, product doesn't say light")
    if words_in(q, {"dark"}) and (words_in(colour_text, LIGHT_WORDS) or not words_in(colour_text, DARK_WORDS)):
        faults.append("SHADE    wanted dark, product doesn't say dark")

    if re.search(r"\b(short|half)[\s-]?sleeve", q) and re.search(r"\b(full|long)[\s-]?sleeve", title.lower()):
        faults.append("DETAIL   wanted short sleeves, product has full sleeves")

    for detail, members in DETAILS.items():
        if words_in(q, {detail}) and not words_in(title, members):
            faults.append(f"DETAIL   missing '{detail}'")

    for material in ("leather", "suede", "linen", "denim", "velvet", "silk"):
        if words_in(q, {material}) and re.search(
            rf"\b{material}\s+(sleeves?|trims?|patch(es)?|panels?|collar|details?|straps?)\b", title.lower()
        ) and not re.search(rf"\b{material}\b(?!\s+(sleeves?|trims?|patch(es)?|panels?|collar|details?|straps?))", title.lower()):
            faults.append(f"DETAIL   only a part is {material}")

    if FORMAL_QUERY.search(q) and words_in(title, CASUAL_TITLE):
        faults.append("DETAIL   casual item for a formal search")

    for kind in ("cargo", "varsity", "bomber", "puffer", "anarkali"):
        if words_in(title, {kind}) and not words_in(q, {kind}):
            faults.append(f"DETAIL   a {kind} item, which wasn't asked for")

    if not words_in(q, {"set", "co-ord", "coord"}) and SET_WORDS.search(row["title"]):
        faults.append("SET      multi-piece set for a single-item search")

    if department in ("men", "women"):
        opposite = "women" if department == "men" else "men"
        says_opposite = words_in(row["title"], {"women", "women's", "womens", "ladies"} if department == "men" else {"men", "men's", "mens"})
        if row["department"] in (opposite, "kids") or says_opposite:
            faults.append(f"SECTION  {department} search returned a {opposite}/kids item")

    return faults


# (search phrase, section) - phrasing mirrors the stylist's search_query output
CASES = [
    ("mustard yellow t-shirt", "men"), ("mustard yellow relaxed t-shirt", "any"),
    ("black oversized t-shirt", "men"), ("white crew neck t-shirt", "women"),
    ("olive green graphic t-shirt", "men"), ("navy blue polo t-shirt", "men"),
    ("light blue oxford shirt", "men"), ("white linen shirt", "men"),
    ("olive green overshirt", "men"), ("beige oversized overshirt", "men"),
    ("black formal shirt", "men"), ("pink floral shirt", "women"),
    ("maroon kurta", "men"), ("white cotton kurta", "women"),
    ("navy blue embroidered kurta", "women"), ("mustard yellow kurta", "women"),
    ("blue denim cargo pants", "men"), ("blue wide leg jeans", "women"),
    ("black slim fit jeans", "men"), ("light blue straight jeans", "men"),
    ("beige chinos", "men"), ("olive green cargo pants", "men"),
    ("black formal trousers", "men"), ("grey joggers", "men"),
    ("black leggings", "women"), ("white wide leg trousers", "women"),
    ("black hoodie", "men"), ("grey oversized hoodie", "women"),
    ("navy blue sweatshirt", "men"), ("black leather jacket", "men"),
    ("denim jacket", "men"), ("navy blazer", "men"),
    ("white sneakers", "men"), ("white chunky sneakers", "women"),
    ("brown leather loafers", "men"), ("black chelsea boots", "men"),
    ("tan sandals", "women"), ("gold juttis", "women"),
    ("black midi dress", "women"), ("red floral dress", "women"),
    ("emerald green dress", "women"), ("white maxi dress", "women"),
    ("black mini skirt", "women"), ("beige co-ord set", "women"),
    ("gold statement earrings", "women"), ("silver chain necklace", "men"),
    ("black baseball cap", "any"), ("brown leather belt", "men"),
    ("black backpack", "any"), ("silver analog watch", "men"),
    # Real phrases the stylist produced (regression cases)
    ("white dress shirt men", "men"), ("navy blue suit trousers men", "men"),
    ("light blue dress shirt men", "men"), ("light blue short sleeve linen shirt men", "men"),
    ("pocket square men", "men"), ("statement bangle set women", "women"),
    ("tan leather derby shoes men", "men"), ("embellished sandals women", "women"),
    ("cream gold clutch women", "women"), ("dark brown loafers men", "men"),
    ("charcoal grey trousers men", "men"), ("checkered plaid flannel shirt men", "men"),
    ("grey oversized graphic t-shirt men", "men"), ("gold hoop earrings women", "women"),
    ("knit beanie", "any"), ("black textured blazer men", "men"), ("cream women", "women"),
    ("navy crewneck sweater men", "men"), ("silver hoop earrings women", "women"),
    ("black puffer jacket men", "men"), ("brown leather oxfords men", "men"),
    ("block heels women", "women"),
    ("red and black plaid flannel shirt men", "men"), ("high-top sneakers", "any"),
    ("travel backpack", "any"), ("embroidered blouse women", "women"),
    ("strappy sandals women", "women"), ("gold pendant necklace women", "women"),
    ("black tailored blazer men", "men"), ("chunky sneakers", "any"),
    ("black trousers men", "men"), ("black slim trousers men", "men"), ("black jacket men", "men"),
]


def product_row(product_id: str):
    with connect() as connection:
        return connection.execute(
            "SELECT title, product_type, department, colors FROM products WHERE id = ?", (product_id,)
        ).fetchone()


def main() -> int:
    total_products = total_faults = empty = 0

    for query, department in CASES:
        result = search_products(query, region="IN", department=department)
        count = len(result["products"])
        lines = []

        titles = [(product["store"], product_row(product["id"])["title"].strip().lower()) for product in result["products"]]
        if len(titles) != len(set(titles)):
            total_faults += 1
            lines.append("      ✗ DUPLICATE  the same product is shown twice")

        for product in result["products"]:
            row = product_row(product["id"])
            relaxed = product.get("closest_match_without") or ()
            faults = check_product(query, department, row, relaxed)
            total_faults += bool(faults)
            label = f"{product['store']}: {row['title'][:70]}" + (f"  [closest match, not {'/'.join(relaxed)}]" if relaxed else "")
            if faults:
                lines.append(f"      ✗ {label}\n          " + "\n          ".join(faults))
            elif "--verbose" in sys.argv:
                lines.append(f"      ✓ {label}")

        total_products += count
        empty += count == 0
        bad = any(line.lstrip().startswith("✗") for line in lines)
        print(f"{'FAULT' if bad else 'OK   '} {query!r} ({department}): {count} product(s)")
        for line in lines:
            print(line)

    correct = total_products - total_faults
    precision = 100 * correct / total_products if total_products else 0
    print(
        f"\n{len(CASES)} searches, {total_products} products, {total_faults} wrong "
        f"({precision:.1f}% correct), {empty} search(es) with no products"
    )
    return 1 if total_faults else 0


if __name__ == "__main__":
    sys.exit(main())
