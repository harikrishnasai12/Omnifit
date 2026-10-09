"""
OmniFit product catalog: a local, searchable copy of partner stores'
public product catalogs (see catalog_stores.py and sync_catalog.py).

Searching happens entirely against the local SQLite database, so user
requests never hit store websites.
"""

import os
import re
import sqlite3
import time
from itertools import combinations
from pathlib import Path
from typing import Iterable, Optional

DB_PATH = Path(
    os.getenv("CATALOG_DB_PATH", str(Path(__file__).with_name("data") / "catalog.db"))
)

DEPARTMENTS = ("men", "women", "unisex")

SCHEMA = """
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    store_name TEXT NOT NULL,
    region TEXT NOT NULL,
    title TEXT NOT NULL,
    product_type TEXT,
    tags TEXT,
    department TEXT,
    price REAL NOT NULL,
    compare_at REAL,
    available INTEGER NOT NULL,
    image TEXT,
    url TEXT NOT NULL,
    synced_at REAL NOT NULL,
    size_kind TEXT,
    sizes_in_stock TEXT,
    colors TEXT
);

CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);

CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
    title, product_type, tags,
    content='products', content_rowid='rowid',
    tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS products_ai AFTER INSERT ON products BEGIN
    INSERT INTO products_fts(rowid, title, product_type, tags)
    VALUES (new.rowid, new.title, new.product_type, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS products_ad AFTER DELETE ON products BEGIN
    INSERT INTO products_fts(products_fts, rowid, title, product_type, tags)
    VALUES ('delete', old.rowid, old.title, old.product_type, old.tags);
END;

-- Details Gemma read from vague product text (enrich_catalog.py). Kept
-- apart from products so the daily sync, which replaces products, keeps them;
-- content_key notices when the store changes the product's text.
CREATE TABLE IF NOT EXISTS product_enrichment (
    product_id TEXT PRIMARY KEY,
    content_key TEXT NOT NULL,
    garment TEXT,
    colour TEXT,
    fabric TEXT,
    fit TEXT,
    occasion TEXT,
    enriched_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_enrichment_garment ON product_enrichment(garment);

CREATE TABLE IF NOT EXISTS stores (
    store_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    product_count INTEGER NOT NULL,
    median_price REAL,
    synced_at REAL NOT NULL
);
"""


# ---------------------------------------------------------
# Database
# ---------------------------------------------------------

_schema_ready = False


def connect() -> sqlite3.Connection:
    global _schema_ready

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row

    # Schema setup once per process: re-running it on every call would wait
    # on the daily sync's write lock
    if not _schema_ready:
        # WAL lets searches keep reading while the daily sync is writing
        connection.execute("PRAGMA journal_mode=WAL")
        connection.executescript(SCHEMA)
        _add_missing_columns(connection)
        _schema_ready = True

    return connection


def _add_missing_columns(connection: sqlite3.Connection) -> None:
    # Databases created before sizes were tracked get the new columns
    existing = {row["name"] for row in connection.execute("PRAGMA table_info(products)")}

    for column in ("size_kind", "sizes_in_stock", "colors"):
        if column not in existing:
            connection.execute(f"ALTER TABLE products ADD COLUMN {column} TEXT")


def catalog_ready() -> bool:
    if not DB_PATH.exists():
        return False

    with connect() as connection:
        return connection.execute("SELECT 1 FROM products LIMIT 1").fetchone() is not None


# ---------------------------------------------------------
# Normalizing store data
# ---------------------------------------------------------

_KIDS = re.compile(r"\b(kids?|boys?|girls?|infants?|baby|babies|toddlers?|junior)\b")
_WOMEN = re.compile(r"\b(women|womens|woman|ladies|female|her)\b")
_MEN = re.compile(r"\b(men|mens|man|male|his)\b")
_UNISEX = re.compile(r"\bunisex\b")

# Garments that are almost always sold as womenswear
_WOMENSWEAR_ITEMS = re.compile(
    r"\b(kurti|kurtis|saree|sarees|lehenga|lehengas|dupatta|blouse|anarkali|"
    r"dress|dresses|skirt|skirts|bra|bralette|leggings|palazzo|sharara|gown)\b"
)


def infer_department(text: str) -> Optional[str]:
    # Only what the product itself says; None when it doesn't say
    text = text.lower().replace("'", "")

    if _KIDS.search(text):
        return "kids"

    if _UNISEX.search(text):
        return "unisex"

    is_women = bool(_WOMEN.search(text))
    is_men = bool(_MEN.search(text))

    if is_women and not is_men:
        return "women"

    if is_men and not is_women:
        return "men"

    if _WOMENSWEAR_ITEMS.search(text):
        return "women"

    return None


# A store "clearly sells one section" when at least this share of its
# labelled products belong to it
MAJORITY_SHARE = 0.85
# Below this share of labelled products, a store is treated as not labelling
# by section at all (typical of genuinely unisex brands)
LABELLED_SHARE = 0.05


def resolve_unlabelled_departments(products: list[dict], store_department: str) -> None:
    """
    Decide the section of products whose title/tags don't say it.

    Single-section stores (department "men"/"women") use that section.
    Mixed stores: if 85%+ of labelled products are one section, unlabelled
    ones are that section too (Veirdo labels only its women's range, so
    unlabelled Veirdo items are menswear). Stores that almost never label
    use their configured default. Otherwise the section stays "unknown".
    """
    unlabelled = [product for product in products if product["department"] is None]

    if not unlabelled:
        return

    if store_department in ("men", "women"):
        resolved = store_department
    else:
        men = sum(1 for product in products if product["department"] == "men")
        women = sum(1 for product in products if product["department"] == "women")
        labelled = men + women

        if labelled < LABELLED_SHARE * len(products):
            resolved = store_department or "unknown"
        elif men >= MAJORITY_SHARE * labelled:
            resolved = "men"
        elif women >= MAJORITY_SHARE * labelled:
            resolved = "women"
        else:
            resolved = "unknown"

    for product in unlabelled:
        product["department"] = resolved


def _to_float(value) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None

    return number if number > 0 else None


def normalize_shopify_product(raw: dict, store: dict) -> Optional[dict]:
    title = (raw.get("title") or "").strip()
    handle = raw.get("handle")
    product_type = (raw.get("product_type") or "").strip()

    if not title or not handle or "gift card" in f"{title} {product_type}".lower():
        return None

    tags = raw.get("tags") or []
    if isinstance(tags, str):
        tags = [tag.strip() for tag in tags.split(",")]

    variants = raw.get("variants") or []
    available_variants = [variant for variant in variants if variant.get("available")]

    prices = [
        price
        for price in (_to_float(variant.get("price")) for variant in (available_variants or variants))
        if price
    ]

    if not prices:
        return None

    price = min(prices)
    compare_at = max(
        (_to_float(variant.get("compare_at_price")) or 0 for variant in variants),
        default=0
    )

    images = raw.get("images") or []
    image = images[0].get("src") if images else None

    # Which variant option is the size ("option1", "option2", ...)
    size_option = next(
        (
            f"option{option.get('position') or index + 1}"
            for index, option in enumerate(raw.get("options") or [])
            if isinstance(option, dict) and re.search(r"size", str(option.get("name", "")), re.I)
        ),
        None
    )

    # The store's own colour option, trusted only when the product comes in a
    # single colour (with several, the photo may show a different one)
    color_option = next(
        (
            f"option{option.get('position') or index + 1}"
            for index, option in enumerate(raw.get("options") or [])
            if isinstance(option, dict) and re.search(r"colou?r|shade", str(option.get("name", "")), re.I)
        ),
        None
    )
    colors = None
    if color_option:
        color_values = {str(variant.get(color_option)).strip() for variant in variants if variant.get(color_option)}
        if len(color_values) == 1:
            colors = color_values.pop()[:60]

    sizes_in_stock = None
    if size_option:
        labels = dict.fromkeys(
            str(variant.get(size_option)).strip()
            for variant in available_variants
            if variant.get(size_option)
        )
        sizes_in_stock = "|".join(labels) or None

    tag_text = " ".join(tags)
    # None here is resolved per store by resolve_unlabelled_departments
    department = infer_department(f"{title} {product_type} {tag_text}")

    return {
        "id": f"{store['id']}:{raw.get('id') or handle}",
        "store_id": store["id"],
        "store_name": store["name"],
        "region": store["region"],
        "title": title,
        "product_type": product_type,
        "tags": tag_text,
        "department": department,
        "price": price,
        "compare_at": compare_at if compare_at > price else None,
        "available": 1 if available_variants else 0,
        "image": image,
        "url": f"https://{store['domain']}/products/{handle}",
        "synced_at": time.time(),
        "size_kind": size_kind_for(f"{title} {product_type}") if size_option else None,
        "sizes_in_stock": sizes_in_stock,
        "colors": colors,
    }


def relabel_departments(stores: list[dict]) -> dict:
    """Recompute every product's section from stored data, without re-downloading."""
    counts = {}

    with connect() as connection:
        for store in stores:
            rows = connection.execute(
                "SELECT id, title, product_type, tags FROM products WHERE store_id = ?",
                (store["id"],)
            ).fetchall()

            products = [
                {
                    "id": row["id"],
                    "department": infer_department(f"{row['title']} {row['product_type']} {row['tags']}"),
                }
                for row in rows
            ]

            resolve_unlabelled_departments(products, store.get("department", ""))

            connection.executemany(
                "UPDATE products SET department = :department WHERE id = :id",
                products
            )

            counts[store["name"]] = {
                department: sum(1 for product in products if product["department"] == department)
                for department in ("men", "women", "unisex", "unknown", "kids")
            }

    return counts


def remove_store_products(store_id: str) -> None:
    with connect() as connection:
        connection.execute("DELETE FROM products WHERE store_id = ?", (store_id,))
        connection.execute("DELETE FROM stores WHERE store_id = ?", (store_id,))


def replace_store_products(store: dict, products: list[dict]) -> None:
    resolve_unlabelled_departments(products, store.get("department", ""))

    # Swap a store's products in one transaction, so a failed sync never
    # leaves the store half-updated
    with connect() as connection:
        connection.execute("DELETE FROM products WHERE store_id = ?", (store["id"],))

        connection.executemany(
            """
            INSERT OR REPLACE INTO products
            (id, store_id, store_name, region, title, product_type, tags, department,
             price, compare_at, available, image, url, synced_at, size_kind, sizes_in_stock, colors)
            VALUES
            (:id, :store_id, :store_name, :region, :title, :product_type, :tags, :department,
             :price, :compare_at, :available, :image, :url, :synced_at, :size_kind, :sizes_in_stock, :colors)
            """,
            products
        )

        prices = sorted(product["price"] for product in products)

        connection.execute(
            """
            INSERT OR REPLACE INTO stores (store_id, name, product_count, median_price, synced_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                store["id"],
                store["name"],
                len(products),
                prices[len(prices) // 2] if prices else None,
                time.time(),
            )
        )


# ---------------------------------------------------------
# Search
# ---------------------------------------------------------

_STOP_WORDS = {
    "a", "an", "and", "the", "for", "with", "of", "in", "on", "to", "or",
    "men", "mens", "man", "women", "womens", "woman", "ladies", "unisex",
}

# Colour words grouped into families a shopper would accept as "that colour":
# mustard is a yellow, navy is a blue. A word can belong to two families
# (teal is blue-green).
COLOR_FAMILIES = {
    "black": {"black", "jet", "onyx", "ebony"},
    # Not "snow": it's often a product name ("Mountain Snow ... Indigo dress")
    "white": {"white", "ivory", "offwhite", "pearl"},
    # Not colours despite appearances: "denim" (a fabric), "stone" (stone-washed),
    # "royal" (Urban Monkey's "Royal Enfield" range)
    "beige": {"beige", "cream", "ecru", "sand", "khaki", "oatmeal", "nude", "camel", "taupe", "fawn"},
    "brown": {"brown", "tan", "camel", "coffee", "chocolate", "mocha", "cognac", "walnut", "chestnut", "taupe"},
    "grey": {"grey", "gray", "charcoal", "ash", "slate", "smoke", "graphite", "melange"},
    "blue": {"blue", "navy", "midnight", "indigo", "cobalt", "azure", "sky", "teal", "turquoise", "aqua"},
    "green": {"green", "olive", "mint", "sage", "emerald", "bottle", "teal", "forest", "lime", "pista", "pistachio", "moss", "jade"},
    "yellow": {"yellow", "mustard", "lemon", "canary", "ochre"},
    "orange": {"orange", "rust", "peach", "coral", "terracotta", "tangerine", "apricot"},
    "red": {"red", "maroon", "burgundy", "wine", "crimson", "cherry", "scarlet", "brick", "oxblood"},
    "pink": {"pink", "rose", "blush", "fuchsia", "magenta", "salmon", "mauve"},
    "purple": {"purple", "lavender", "lilac", "violet", "mauve", "plum", "orchid", "grape"},
    # Gold and silver jewellery are not interchangeable
    # Not "champagne": usually a product name ("Champagne Wishes Studs")
    "gold": {"gold", "golden", "brass", "bronze", "copper"},
    # Not "steel": a material, often gold-plated in jewellery
    "silver": {"silver", "chrome", "platinum"},
}

# Specific shades a shopper means literally: asking for "navy" rules out
# sky blue, "olive" rules out lime. Each set lists acceptable equivalents.
SHADE_GROUPS = [
    {"navy", "midnight"}, {"olive"}, {"mustard", "ochre"},
    {"maroon", "wine", "burgundy", "oxblood"}, {"emerald"}, {"lemon", "canary"},
    {"khaki"}, {"charcoal", "graphite"}, {"ivory", "cream", "offwhite", "ecru"},
    {"tan", "camel", "cognac"}, {"mint"}, {"sage"}, {"lime"}, {"pista", "pistachio"},
    {"teal"}, {"turquoise", "aqua"}, {"cobalt"}, {"indigo"}, {"sky"}, {"coral"},
    {"rust", "terracotta"}, {"peach", "apricot"}, {"lavender", "lilac"}, {"mauve"},
    {"plum"}, {"fuchsia", "magenta"}, {"coffee", "chocolate", "mocha"}, {"taupe"},
    {"sand"}, {"blush"}, {"crimson", "scarlet"},
]

# "light blue" / "dark brown" need evidence in the product's own colour name
DARK_SHADE_WORDS = {"dark", "navy", "deep", "midnight", "indigo", "charcoal", "graphite",
                    "chocolate", "coffee", "espresso", "mocha", "walnut", "bottle", "forest", "wine", "oxblood"}
LIGHT_SHADE_WORDS = {"light", "sky", "pale", "pastel", "baby", "ice", "powder", "mint", "lemon", "blush"}

COLOR_WORDS = set().union(*COLOR_FAMILIES.values())


def color_families(text: str) -> set[str]:
    """Colour families named in a text: "Mustard Plain Tee" -> {"yellow"}."""
    words = set(re.findall(r"[a-z]+", (text or "").lower().replace("off-white", "offwhite").replace("off white", "offwhite")))
    return {family for family, members in COLOR_FAMILIES.items() if words & members}


CANDIDATE_LIMIT = 200

# Garment nouns, with equivalent names mapped to one canonical type.
# A product's garment is the LAST garment noun in its title
# ("Shirt Dress" is a dress; "Oxford T-shirt" is a t-shirt).
_GARMENT_TYPES = {
    "shirt": "shirt", "overshirt": "overshirt", "shacket": "overshirt",
    "tshirt": "tshirt", "tee": "tshirt", "polo": "polo",
    "top": "top", "blouse": "top", "tank": "top", "crop": "top",
    "kurta": "kurta", "kurti": "kurta", "tunic": "kurta",
    "suit": "suit", "coord": "coord", "fabric": "fabric", "dupatta": "dupatta",
    "dress": "dress", "gown": "dress",
    "jean": "jeans", "denim": "jeans",
    "trouser": "trousers", "pant": "trousers", "chino": "chinos", "slack": "trousers",
    "jogger": "joggers", "trackpant": "joggers", "sweatpant": "joggers",
    "legging": "leggings", "pyjama": "trousers", "pajama": "trousers",
    "salwar": "trousers", "churidar": "trousers",
    "shrug": "shrug", "waistcoat": "jacket",
    "short": "shorts", "skirt": "skirt", "saree": "saree", "sari": "saree",
    "lehenga": "lehenga", "palazzo": "palazzo",
    "jacket": "jacket", "blazer": "blazer", "coat": "coat",
    "hoodie": "hoodie", "sweatshirt": "sweatshirt", "sweater": "sweater", "cardigan": "sweater",
    "sneaker": "sneakers", "shoe": "shoes", "loafer": "loafers", "boot": "boots",
    "sandal": "sandals", "slider": "sandals", "jutti": "juttis", "mojari": "juttis",
    "heel": "heels", "flat": "flats",
    # Named shoe styles ("brown leather oxfords"); "oxford shirt" stays a shirt
    # because the last garment word wins
    "oxford": "shoes", "brogue": "shoes", "derby": "shoes", "monk": "shoes",
    "watch": "watch", "bag": "bag", "backpack": "backpack", "tote": "bag", "duffle": "bag",
    "belt": "belt",
    "earring": "earrings", "jhumka": "earrings", "stud": "earrings", "hoop": "earrings",
    "necklace": "necklace", "chain": "necklace", "pendant": "necklace",
    "bracelet": "bracelet", "ring": "ring", "cap": "cap",
    "bangle": "bangle", "kada": "bangle", "clutch": "clutch", "beanie": "beanie", "charm": "charm",
    "necktie": "tie", "tie": "tie", "pocketsquare": "pocketsquare", "scarf": "scarf", "stole": "scarf",
}

# A search for the left type also accepts the right types (one direction
# only: "shoes" accepts loafers, but "loafers" doesn't accept sneakers)
_ACCEPTS = {
    "shoes": {"sneakers", "loafers", "boots"},
    "tshirt": {"polo"},
    "trousers": {"chinos"},
    "bag": {"backpack"},
}


def _normalize_garment_text(text: str) -> str:
    text = re.sub(r"\bt[\s-]?shirts?\b", "tshirt", text.lower())
    # "Boot Cut" jeans are jeans, not boots
    text = re.sub(r"\bboot[\s-]?cut\b", "bootcut", text)
    # "Pocket square" is one item (not a pocket, not a square)
    text = re.sub(r"\bpocket[\s-]?squares?\b", "pocketsquare", text)
    # Necklines are two words; "Skate Crew" alone is a collection name
    text = re.sub(r"\bcrew[\s-]?neck\b", "crewneck", text)
    # Stores also call a turtleneck a "polo neck" or "high neck"
    text = re.sub(r"\b(turtle|polo|high)[\s-]?neck\b", "turtleneck", text)
    # "High-top" / "low-top" sneakers ("top" here isn't a garment)
    text = re.sub(r"\b(high|low|mid)[\s-]?tops?\b", r"\1top", text)
    return re.sub(r"\bco[\s-]?ords?\b", "coord", text)


# Generic words that only say the kind of thing ("clutch bag", "loafer shoes");
# a more specific garment named alongside them wins
_GENERIC_TYPES = {"bag", "shoes"}


def garment_type(text: str) -> Optional[str]:
    found = None

    for word in re.findall(r"[a-z]+", _normalize_garment_text(text)):
        singular = word if word.endswith("ss") else word.rstrip("s")
        current = _GARMENT_TYPES.get(word) or _GARMENT_TYPES.get(singular)

        # The last garment word wins ("shirt dress" is a dress), except that
        # a generic word never replaces a specific one ("clutch bag")
        if current and not (current in _GENERIC_TYPES and found and found not in _GENERIC_TYPES):
            found = current

    return found


def types_compatible(wanted: str, found: str) -> bool:
    return wanted == found or found in _ACCEPTS.get(wanted, set())


def product_garment_type(title: str, product_type: Optional[str] = "") -> Optional[str]:
    """A product's garment: from its title, else from the store's product type.

    Words after "for" describe use, not the item: "Bag Charm For Backpack"
    is a charm, "Sneakers for Men" are sneakers.
    """
    item_part = re.split(r"\s+for\s+", title or "", maxsplit=1, flags=re.I)[0]
    return garment_type(item_part) or garment_type(product_type or "")


GARMENT_TYPES = sorted(set(_GARMENT_TYPES.values()))


def garment_matches(query: str, title: str, product_type: Optional[str] = "", hint: Optional[str] = None) -> bool:
    """Is this product the kind of garment the search asks for?

    Denim is special: "blue denim cargo pants" should find cargo jeans and
    denim cargo pants, but "black trousers" must not return jeans.
    `hint`: the garment Gemma read from the product's tags (enrich_catalog.py),
    used only when the title and product type don't say.
    """
    wanted = garment_type(query)
    if not wanted:
        return True

    found = product_garment_type(title, product_type) or (hint if hint in GARMENT_TYPES else None)
    if not found:
        return False

    if types_compatible(wanted, found):
        return True

    wants_denim = "denim" in query.lower() or wanted == "jeans"
    is_denim = found == "jeans" or "denim" in title.lower()
    return wants_denim and is_denim and {wanted, found} <= {"jeans", "trousers"}


# ---------------------------------------------------------
# Strict match rules: colour, shade, details, sets, section
# ---------------------------------------------------------

# Details that change what a product is. Asked for -> must be in the title.
HARD_DETAILS = {
    "linen": {"linen"}, "leather": {"leather"}, "suede": {"suede"}, "silk": {"silk"},
    "satin": {"satin"}, "velvet": {"velvet"}, "corduroy": {"corduroy"},
    "denim": {"denim", "jeans", "jean"}, "wool": {"wool", "woollen", "woolen", "merino"},
    "chiffon": {"chiffon"}, "georgette": {"georgette"}, "knit": {"knit", "knitted"},
    "oxford": {"oxford"}, "oxfords": {"oxford", "oxfords"}, "derbies": {"derby", "derbies"},
    "cargo": {"cargo"}, "chelsea": {"chelsea"}, "bomber": {"bomber"},
    "puffer": {"puffer"}, "varsity": {"varsity"}, "henley": {"henley"}, "polo": {"polo"},
    "floral": {"floral", "flower", "flowers", "botanical"},
    "striped": {"striped", "stripe", "stripes"},
    "checked": {"check", "checks", "checked", "plaid", "gingham", "tartan"},
    "plaid": {"check", "checks", "checked", "plaid", "tartan"},
    "embroidered": {"embroidered", "embroidery", "chikankari"},
    "graphic": {"graphic", "print", "printed"},
    "printed": {"print", "printed", "graphic"},
    "sequin": {"sequin", "sequins", "sequinned", "sequined"},
    "embellished": {"embellished", "embroidered", "sequin", "sequins", "beaded", "mirror", "stone", "stones", "gotapatti", "zari"},
    "derby": {"derby", "derbies"}, "brogue": {"brogue", "brogues"}, "brogues": {"brogue", "brogues"},
    "wrap": {"wrap"}, "pleated": {"pleated", "pleats"},
    # Necklines: a crewneck search must not return a turtleneck or a zipper
    "crewneck": {"crewneck"}, "turtleneck": {"turtleneck"}, "mandarin": {"mandarin"}, "henley": {"henley"},
    "hoop": {"hoop", "hoops"}, "stud": {"stud", "studs"}, "jhumka": {"jhumka", "jhumkas", "jhumki"},
    "pendant": {"pendant"}, "strappy": {"strappy", "strap", "straps"}, "tailored": {"tailored"},
    "hightop": {"hightop"}, "lowtop": {"lowtop"}, "midtop": {"midtop"},
    "block": {"block"}, "stiletto": {"stiletto", "stilettos"}, "pointed": {"pointed"},
    "wedge": {"wedge", "wedges"}, "kitten": {"kitten"},
    "midi": {"midi"}, "maxi": {"maxi"}, "mini": {"mini"},
    "wide": {"wide"}, "straight": {"straight"}, "slim": {"slim", "skinny"}, "skinny": {"skinny"},
    "baggy": {"baggy"}, "bootcut": {"bootcut"}, "flared": {"flared", "flare"},
    "tapered": {"tapered"}, "oversized": {"oversized", "oversize", "boxy"},
    "cropped": {"cropped", "crop"}, "chunky": {"chunky"}, "anarkali": {"anarkali"},
}

# A formal search ("formal", "dress shirt", "suit trousers") must not return
# these casual pieces
_CASUAL_WORDS = {"cargo", "jogger", "joggers", "track", "denim", "jeans", "graphic", "distressed",
                 "ripped", "sweat", "print", "printed", "tropical", "hawaiian", "camp", "oversized", "boxy",
                 "floral", "sanganeri"}

# Words that make an item a distinct kind, only returned when asked for
_DISTINCT_KINDS = {"cargo", "varsity", "bomber", "puffer", "anarkali"}

_SHORT_SLEEVE = re.compile(r"\b(short|half)[\s-]?sleeves?\b")
_LONG_SLEEVE = re.compile(r"\b(full|long)[\s-]?sleeves?\b")


def is_formal_search(query: str) -> bool:
    words = set(_title_words(query))
    wanted = garment_type(query)
    return (
        "formal" in words
        or ("dress" in words and wanted not in ("dress", None))
        or ("suit" in words and wanted not in ("suit", None))
    )

_SET_PATTERN = re.compile(
    r"\b(set|sets|coord|coords|combo)\b"
    r"|\bwith\b.*\b(pants?|trousers?|palazzos?|dupattas?|churidars?|salwars?|capes?|skirts?|blouses?)\b"
)
_SET_QUERY_WORDS = {"set", "sets", "coord", "coords", "suit", "combo"}

_MEN_TITLE = re.compile(r"\b(men|mens|men's|male|boys?)\b")
_WOMEN_TITLE = re.compile(r"\b(women|womens|women's|ladies|female|girls?)\b")


def _title_words(text: str) -> list[str]:
    text = (text or "").lower().replace("off-white", "offwhite").replace("off white", "offwhite")
    # "Light Weight" is about the fabric, not a light colour
    text = re.sub(r"\blight[\s-]?weight\b", "lightweight", text)
    return re.findall(r"[a-z]+", _normalize_garment_text(text))


def _colour_sequence(text: str) -> list[set[str]]:
    """Colour families of each colour word in a title, in order of appearance."""
    return [
        {family for family, members in COLOR_FAMILIES.items() if word in members}
        for word in _title_words(text)
        if word in COLOR_WORDS
    ]


def without_colours(query: str) -> str:
    """The same search in any colour: "beige high waist wide leg trousers
    women" -> "high waist wide leg trousers women"."""
    words = [
        word for word in re.findall(r"[a-z0-9-]+", (query or "").lower())
        if word not in COLOR_WORDS and word not in {"light", "dark", "and"}
        and not any(word in group for group in SHADE_GROUPS)
    ]
    return " ".join(words)


def colour_matches(query: str, title: str, product_type: str, option_colors: str) -> bool:
    """Right colour family as the MAIN colour, the exact shade if one was
    named, and no light/dark contradiction."""
    query_words = set(_title_words(query))
    wanted = color_families(query)
    if not wanted:
        return True

    # Colour as the product states it: title and type, else the store's
    # single-colour option. Tags are never used (they list other variants).
    text = f"{title} {product_type or ''}"

    # "Dual Tone" / "Multicolour" items aren't one colour: only a search that
    # names several colours may return them
    if len(wanted) == 1 and re.search(r"\b(dual|two|duo|tri|multi)[\s-]?(tone|toned|colou?r(ed)?)\b|\bmulticolou?r", text.lower()):
        return False

    sequence = _colour_sequence(text)
    if not sequence:
        text = option_colors or ""
        sequence = _colour_sequence(text)
    if not sequence:
        return False

    # Multi-colour titles ("Charcoal Black & Ivory White Check") must LEAD
    # with the wanted colour; a search naming several colours ("red and black
    # plaid") needs all of them
    found = set().union(*sequence)
    if len(wanted) == 1 and not sequence[0] & wanted:
        return False
    if len(wanted) > 1 and not wanted <= found:
        return False
    if not found & wanted:
        return False

    words = set(_title_words(text))

    # Specific shades are literal: "navy" rules out sky blue
    for group in SHADE_GROUPS:
        if query_words & group and not words & group:
            return False

    # "Light blue" must say light (light / sky / pale...), not just "blue";
    # "dark brown" must say dark (dark / chocolate / coffee...)
    if "light" in query_words and (words & DARK_SHADE_WORDS or not words & LIGHT_SHADE_WORDS):
        return False
    if "dark" in query_words and (words & LIGHT_SHADE_WORDS or not words & DARK_SHADE_WORDS):
        return False

    return True


# "Leather Sleeves Varsity Jacket" is not a leather jacket: a material word
# followed by one of these describes only a part of the product
_PART_WORDS = {"sleeve", "sleeves", "trim", "trims", "patch", "patches", "panel", "panels",
               "collar", "detail", "details", "detailing", "strap", "straps", "piping", "yoke"}
_MATERIAL_DETAILS = {"linen", "leather", "suede", "silk", "satin", "velvet", "corduroy", "denim", "wool"}


def details_match(query: str, title: str, product_type: str) -> bool:
    query_words = set(_title_words(query))
    title_words = _title_words(f"{title} {product_type or ''}")
    words = set(title_words)

    for detail, accepted in HARD_DETAILS.items():
        if detail not in query_words:
            continue

        if detail in _MATERIAL_DETAILS:
            # The material must describe the whole product, not a part of it
            whole = [
                index for index, word in enumerate(title_words)
                if word in accepted and (index + 1 >= len(title_words) or title_words[index + 1] not in _PART_WORDS)
            ]
            if not whole:
                return False
        elif not words & accepted:
            return False

    if is_formal_search(query) and words & _CASUAL_WORDS:
        return False

    # A different KIND of the same garment: plain "trousers" must not return
    # cargo pants, a plain "jacket" not a varsity or bomber
    for kind in _DISTINCT_KINDS:
        if kind in words and kind not in query_words:
            return False

    # Sleeve length asked for must not be contradicted
    lowered_query = query.lower()
    lowered_title = f"{title} {product_type or ''}".lower()
    if _SHORT_SLEEVE.search(lowered_query) and _LONG_SLEEVE.search(lowered_title):
        return False
    if _LONG_SLEEVE.search(lowered_query) and _SHORT_SLEEVE.search(lowered_title):
        return False

    # Items OmniFit doesn't know as a garment ("pocket square", "bangle"):
    # every word naming the item must be in the title, so "pocket square"
    # never returns a "Double Pocket Overshirt"
    if garment_type(query) is None:
        item_words = [
            word for word in query_words
            if word not in COLOR_WORDS and word not in _STOP_WORDS
            and word not in HARD_DETAILS and word not in {"light", "dark", "statement"}
        ]
        def stem(word: str) -> str:
            return word if word.endswith("ss") else word.rstrip("s")

        if not item_words or not {stem(word) for word in item_words} <= {stem(word) for word in words}:
            return False

    return True


def is_multi_piece_set(query: str, title: str) -> bool:
    """A kurta-with-pants set answering a search for pants, for example."""
    if set(_title_words(query)) & _SET_QUERY_WORDS:
        return False
    return bool(_SET_PATTERN.search(" ".join(_title_words(title))))


def section_matches(department: str, row_department: str, title: str) -> bool:
    if department not in ("men", "women"):
        return row_department != "kids"

    # The title's own words win over tags ("... Oversized Fit Women Tee")
    lowered = (title or "").lower()
    if department == "men" and _WOMEN_TITLE.search(lowered):
        return False
    if department == "women" and _MEN_TITLE.search(lowered):
        return False

    return row_department in (department, "unisex")


# ---------------------------------------------------------
# Sizes
# ---------------------------------------------------------

SIZE_KINDS = ("top", "bottom", "footwear")
FREE_SIZE = "FREE"

_BOTTOM_TYPES = {"jeans", "trousers", "chinos", "joggers", "shorts", "skirt", "palazzo", "leggings"}
_FOOTWEAR_TYPES = {"shoes", "sneakers", "loafers", "boots", "sandals", "juttis", "heels", "flats"}
_UNSIZED_TYPES = {
    "watch", "bag", "backpack", "belt", "earrings", "necklace", "bracelet", "ring", "cap",
    "bangle", "clutch", "beanie", "tie", "pocketsquare", "scarf",
    "fabric", "dupatta", "saree",
}

_LETTER_SIZES = {"XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "XXXXL"}
_LETTER_ALIASES = {
    "2XL": "XXL", "3XL": "XXXL", "4XL": "XXXXL",
    "SMALL": "S", "MEDIUM": "M", "LARGE": "L",
}
_FREE_LABELS = {"FREE", "FREESIZE", "ONESIZE", "OS", "ONESIZEFITSALL"}


_LAYER_TYPES = {"overshirt", "jacket", "blazer", "coat", "sweater", "shrug"}


def outfit_slot_for(item_text: str) -> str:
    """Which outfit slot a garment belongs in: top, layer, bottom, footwear or accessories."""
    garment = garment_type(item_text)

    if garment in _FOOTWEAR_TYPES:
        return "footwear"
    if garment in _BOTTOM_TYPES:
        return "bottom"
    if garment in _LAYER_TYPES:
        return "layer"
    if garment is None or garment in _UNSIZED_TYPES:
        return "accessories"

    return "top"


def size_kind_for(title: str) -> Optional[str]:
    """Which of the user's sizes applies to a product: top, bottom, footwear or none."""
    garment = garment_type(title)

    if garment in _FOOTWEAR_TYPES:
        return "footwear"
    if garment in _BOTTOM_TYPES:
        return "bottom"
    if garment in _UNSIZED_TYPES:
        return None

    return "top"


def normalize_size(label: str) -> Optional[str]:
    """Map store size labels to one form: "M", "XXL", "32", "8" or FREE.

    Returns None for labels that can't be compared (e.g. EU shoe sizes).
    """
    text = re.sub(r"[\s-]+", "", (label or "").upper())

    if text in _FREE_LABELS:
        return FREE_SIZE

    if text.startswith("EU") or text.endswith("EU"):
        return None

    text = re.sub(r"^(UK|IND|IN)", "", text)
    text = _LETTER_ALIASES.get(text, text)

    number = re.fullmatch(r"(\d{1,2})(W|UK|IN)?", text)
    if number:
        return number.group(1)

    if text in _LETTER_SIZES:
        return text

    # "M/38", "L(40)": keep the letter size
    letter = re.match(r"^(XXS|XS|XXXL|XXL|XL|S|M|L)[/(]", text)
    return letter.group(1) if letter else None


_LETTER_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "XXXXL"]


def size_sort_key(label: str) -> tuple:
    """Sort sizes the way shoppers expect: XS, S, M, L, XL... or 28, 30, 32..."""
    size = normalize_size(label)

    if size and size.isdigit():
        return (1, int(size), label)
    if size in _LETTER_ORDER:
        return (0, _LETTER_ORDER.index(size), label)

    return (2, 0, label)


def size_status(size_kind: Optional[str], sizes_in_stock: Optional[str], my_sizes: Optional[dict]) -> Optional[str]:
    """"fits" if the user's size is in stock, "not_in_size" if it isn't,
    None when it can't be told (no sizes known, or a different size system)."""
    if not size_kind or not sizes_in_stock or not my_sizes:
        return None

    stock = {normalize_size(label) for label in sizes_in_stock.split("|")} - {None}

    if FREE_SIZE in stock:
        return "fits"

    numbers = {size for size in stock if size.isdigit()}
    letters = stock - numbers

    wanted_number = normalize_size(my_sizes.get("footwear" if size_kind == "footwear" else "bottom") or "")
    wanted_letter = normalize_size(my_sizes.get("top") or "")

    # Waist / shoe numbers first; letter-sized bottoms (joggers S/M/L) use the top size
    if size_kind in ("footwear", "bottom") and numbers and wanted_number and wanted_number.isdigit():
        return "fits" if wanted_number in numbers else "not_in_size"

    if size_kind in ("top", "bottom") and letters and wanted_letter and not wanted_letter.isdigit():
        return "fits" if wanted_letter in letters else "not_in_size"

    return None


def _tokens(query: str) -> list[str]:
    return [
        token
        for token in re.findall(r"[a-z0-9]+", query.lower())
        if token not in _STOP_WORDS and len(token) > 1
    ]


def _fts_query(tokens: list[str], require_descriptor: bool) -> str:
    # The last word is the item type ("oxford shirt" -> "shirt"); it must match.
    category, descriptors = tokens[-1], tokens[:-1]
    query = f'"{category}"'

    if descriptors and require_descriptor:
        query += " AND (" + " OR ".join(f'"{word}"' for word in descriptors) + ")"

    return query


def _price_range(prices: list[float]) -> Optional[dict]:
    if len(prices) < 3:
        return None

    prices = sorted(prices)

    def at(fraction: float) -> int:
        value = prices[min(len(prices) - 1, int(fraction * (len(prices) - 1)))]
        return int(round(value / 50.0) * 50) or int(value)

    return {
        "min": int(prices[0]),
        "max": int(prices[-1]),
        "typical_low": at(0.25),
        "typical_high": at(0.75),
    }


# Items a stylist commonly suggests. not_sold() checks which of them no
# partner brand has, so the stylist can suggest the nearest thing that exists.
COMMONLY_SUGGESTED = (
    "sunglasses", "eyeglasses", "watch", "belt", "wallet", "tie", "pocket square", "cufflinks", "scarf", "stole",
    "dupatta", "handbag", "tote bag", "backpack", "clutch", "potli bag", "crossbody bag", "cap", "beanie", "hat",
    "gloves", "socks", "sandals", "heels", "boots", "hiking boots", "loafers", "sneakers", "juttis", "mojaris",
    "kolhapuri sandals", "flip flops", "jacket", "windbreaker", "raincoat", "puffer jacket", "thermal top",
    "sweater", "hoodie", "blazer", "suit", "sherwani", "kurta", "saree", "lehenga", "anarkali", "dress", "skirt",
    "jeans", "trousers", "shorts", "swimsuit", "bangles", "necklace", "earrings", "ring", "bracelet", "anklet",
    "maang tikka", "hair clip", "brooch", "umbrella", "hydration pack", "trekking pole", "fanny pack",
)

_not_sold_cache: dict[tuple, list[str]] = {}


def not_sold(region: str) -> list[str]:
    """Commonly suggested items that no partner brand sells in this region
    right now. Worked out from the catalogue itself, once a day."""
    key = (region, time.strftime("%Y-%m-%d"))
    if key not in _not_sold_cache:
        _not_sold_cache.clear()
        _not_sold_cache[key] = [
            item for item in COMMONLY_SUGGESTED
            if not search_products(item, region=region, department="any", limit=1)["products"]
        ] if DB_PATH.exists() else []
    return _not_sold_cache[key]


def spectacle_frames_sold(region: str) -> int:
    """How many spectacle frames (not sunglasses) the partner brands have."""
    if not DB_PATH.exists():
        return 0
    with connect() as connection:
        return connection.execute(
            "SELECT COUNT(*) FROM products WHERE available = 1 AND region = ? AND "
            "(lower(product_type) LIKE '%eyeglass%' OR lower(product_type) LIKE '%optical%' "
            "OR lower(title) LIKE '%eyeglass%' OR lower(product_type) LIKE '%spectacle frame%')",
            (region,),
        ).fetchone()[0]


# What shoppers and the stylist call eyewear; the partner stores list theirs
# as "sunglasses" (and a few "eyeglasses")
_EYEWEAR_QUERY_WORDS = {"frames", "frame", "glasses", "eyeglasses", "eyeglass", "spectacles", "spectacle", "eyewear"}
# Asking for these means spectacle frames first, sunglasses after
_OPTICAL_WORDS = {"eyeglasses", "eyeglass", "spectacles", "spectacle"}
# Shape and style words the stores do put in sunglasses titles
_EYEWEAR_SHAPES = {"round", "oval", "square", "rectangular", "rectangle", "cat", "eye", "aviator", "aviators",
                   "wayfarer", "rimless", "oversized", "polarized", "butterfly", "hexagon", "hexagonal", "geometric"}


def _store_wording(query: str) -> str:
    """The same search in the words the partner stores use.

    "round metal frames" -> "round metal sunglasses" (same shape and colour);
    a bare "anarkali" -> "anarkali suit" (stores sell anarkalis as suit sets).
    """
    words = query.lower().split()
    if _EYEWEAR_QUERY_WORDS & set(words) and "sunglasses" not in words:
        # Words after "for" say who it's for, not the item: in "angular frames
        # for round face" the face is round, the frames are not
        if "for" in words:
            words = words[:words.index("for")]
        return " ".join("sunglasses" if word in _EYEWEAR_QUERY_WORDS else word for word in words)
    if "anarkali" in words and not garment_type(query):
        return " ".join("anarkali suit" if word == "anarkali" else word for word in words)
    return query


def search_products(
    query: str,
    region: str,
    department: str = "any",
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    limit: int = 3,
    store_boosts: Optional[dict] = None,
    my_sizes: Optional[dict] = None,
    seen_ids: Optional[set] = None,
) -> dict:
    asked = set(query.lower().split())
    # Asked for frames / glasses / spectacles (not for sunglasses by name)
    eyewear = bool(_EYEWEAR_QUERY_WORDS & asked) and "sunglasses" not in asked
    query = _store_wording(query)
    tokens = _tokens(query)

    if not tokens or not DB_PATH.exists():
        return {"products": [], "price_range": None}

    def strict(text: str) -> dict:
        return _search_strict(
            text, _tokens(text), region, department, min_price, max_price, limit,
            store_boosts, my_sizes, seen_ids,
        )

    result = strict(query)

    if eyewear:
        # No store uses some eyewear words ("metal", "tortoiseshell"): keep the
        # shape and colour, drop the rest, and say it is the closest match
        words = query.split()
        kept = [word for word in words if word in _EYEWEAR_SHAPES or word in COLOR_WORDS or word in ("sunglasses", "men", "women")]
        for looser in (kept, [word for word in kept if word not in COLOR_WORDS]):
            if result["products"] or looser == words:
                break
            result = strict(" ".join(looser))
            dropped = [word for word in words if word not in looser]
            for product in result["products"]:
                product["closest_match_without"] = _missing_details(dropped, product["title"])

        # Spectacle frames too: the stores' few eyeglasses come first when
        # that is what was asked for, else fill what the sunglasses leave free
        optical = strict(query.replace("sunglasses", "eyeglasses"))["products"]
        if asked & _OPTICAL_WORDS:
            shown = {product["id"] for product in optical}
            result["products"] = (optical + [p for p in result["products"] if p["id"] not in shown])[:limit]
        else:
            shown = {product["id"] for product in result["products"]}
            result["products"] += [p for p in optical if p["id"] not in shown][:limit - len(result["products"])]
        return result

    # Nothing matches exactly: step by step drop the fit words, then the other
    # style details (materials, patterns, necklines, cuts), and label the
    # results as the closest match. Garment, colour, section and the details
    # that define what kind of item it is are never dropped.
    words = _title_words(query)
    fit_words = [word for word in words if word in RELAXABLE_FIT_WORDS]
    style_words = [
        word for word in words
        if word in HARD_DETAILS and word not in NEVER_RELAXED_DETAILS and word not in RELAXABLE_FIT_WORDS
    ]

    # Drop as FEW details as possible: fit words alone first, then one style
    # detail at a time, then two, ... (bounded, so a search stays fast)
    attempts = []
    if fit_words:
        attempts.append(fit_words)
    for count in range(1, len(style_words) + 1):
        for combination in combinations(style_words, count):
            attempts.append(fit_words + list(combination))
    attempts = attempts[:MAX_RELAXED_ATTEMPTS]

    for dropped in attempts:
        if result["products"]:
            break

        looser = " ".join(word for word in words if word not in dropped)
        result = _search_strict(
            looser, _tokens(looser), region, department, min_price, max_price, limit,
            store_boosts, my_sizes, seen_ids,
        )
        for product in result["products"]:
            # Only name details this product really lacks
            product["closest_match_without"] = _missing_details(dropped, product["title"])

    return result


MAX_RELAXED_ATTEMPTS = 8


def _missing_details(dropped: list[str], title: str) -> list[str]:
    title_words = set(_title_words(title))
    missing = []
    for word in dict.fromkeys(dropped):
        accepted = HARD_DETAILS.get(word, {word})
        if word == "oversized":
            accepted = HARD_DETAILS["oversized"]
        if not title_words & accepted:
            missing.append(word)
    return missing


# Details that define what kind of item it is: relaxing them would return a
# different item, not a close one
NEVER_RELAXED_DETAILS = {
    "cargo", "polo", "bomber", "puffer", "varsity", "anarkali", "chelsea", "henley",
    "derby", "derbies", "brogue", "brogues", "oxfords", "hightop", "lowtop", "midtop",
}


# Fit words that may be dropped when nothing matches exactly
RELAXABLE_FIT_WORDS = {"oversized", "oversize", "chunky", "baggy", "relaxed", "boxy"}


def _search_strict(
    query: str,
    tokens: list[str],
    region: str,
    department: str,
    min_price: Optional[float],
    max_price: Optional[float],
    limit: int,
    store_boosts: Optional[dict],
    my_sizes: Optional[dict],
    seen_ids: Optional[set],
) -> dict:
    if not tokens:
        return {"products": [], "price_range": None}

    store_boosts = store_boosts or {}
    color_words = {token for token in tokens if token in COLOR_WORDS}
    wanted_colors = color_families(query)
    category = tokens[-1]
    descriptors = {token for token in tokens[:-1] if token not in COLOR_WORDS}

    # Section is strict: a men's search never shows women's items or items
    # whose section is unknown (and vice versa). Kids' items never appear.
    departments = None
    if department in ("men", "women"):
        departments = (department, "unisex")
    elif department == "unisex":
        departments = ("unisex", "men", "women")

    # Enrichment hints (garment / colour family Gemma read from the tags)
    # join every candidate; they count only where the title is silent
    sql = """
        SELECT p.*, bm25(products_fts, 10.0, 4.0, 2.0) AS rank,
               e.garment AS hint_garment, e.colour AS hint_colour
        FROM products_fts
        JOIN products p ON p.rowid = products_fts.rowid
        LEFT JOIN product_enrichment e ON e.product_id = p.id
        WHERE products_fts MATCH ?
          AND p.region = ?
          AND p.available = 1
          AND p.department != 'kids'
    """
    params: list = [region]

    section_sql = ""
    if departments:
        section_sql = f" AND p.department IN ({','.join('?' * len(departments))})"
        sql += section_sql
        params.extend(departments)

    sql += " ORDER BY rank LIMIT ?"
    params.append(CANDIDATE_LIMIT)

    def passes(row: sqlite3.Row) -> bool:
        # Every rule must hold; a product that can't be verified is left out
        # rather than guessed. An empty result falls back to the store links.
        title, product_type = row["title"], row["product_type"]
        # A colour family from enrichment stands in only when the store gave
        # no colour at all (it never satisfies a specific shade like "navy")
        colours = row["colors"] or (row["hint_colour"] if row["hint_colour"] in COLOR_FAMILIES else None)
        return (
            garment_matches(query, title, product_type, row["hint_garment"])
            and colour_matches(query, title, product_type, colours)
            and details_match(query, title, product_type)
            and not is_multi_piece_set(query, title)
            and section_matches(department, row["department"], title)
        )

    def any_of(words) -> str:
        return "(" + " OR ".join(f'"{word}"' for word in sorted(words)) + ")"

    # What the search asks for, as full-text clauses
    query_words = set(tokens)
    shade_words = set().union(*(group for group in SHADE_GROUPS if query_words & group))
    colour_words_wanted = shade_words or (
        set().union(*(COLOR_FAMILIES[family] for family in wanted_colors)) if wanted_colors else set()
    )
    colour_clause = any_of(colour_words_wanted) if colour_words_wanted else None
    detail_clauses = [
        any_of(accepted) for detail, accepted in HARD_DETAILS.items() if detail in query_words
    ]

    # Candidate searches from most to least specific; every candidate still
    # has to pass all the rules above
    fts_queries = []
    for use_colour, use_details in ((True, True), (True, False), (False, True)):
        clauses = [f'"{category}"']
        if use_colour and colour_clause:
            clauses.append(colour_clause)
        if use_details:
            clauses.extend(detail_clauses)
        if len(clauses) > 1:
            fts_queries.append(" AND ".join(clauses))
    if descriptors:
        fts_queries.append(_fts_query(tokens, require_descriptor=True))
    fts_queries.append(_fts_query(tokens, require_descriptor=False))
    fts_queries = list(dict.fromkeys(fts_queries))

    rows: list[sqlite3.Row] = []
    seen_rows: set[str] = set()

    with connect() as connection:
        for fts_query in fts_queries:
            for row in connection.execute(sql, [fts_query, *params]).fetchall():
                if row["id"] not in seen_rows and passes(row):
                    seen_rows.add(row["id"])
                    rows.append(row)

            if len(rows) >= limit * 4:
                break

        # Products whose garment only enrichment knows ("Nexar Leather
        # Drivers" -> loafers): the text search can't find them by that word.
        # They rank after text matches (rank 0) and still pass every rule.
        wanted = garment_type(query)
        if wanted and len(rows) < limit * 4:
            accepted = sorted({wanted} | _ACCEPTS.get(wanted, set()))
            extra_sql = f"""
                SELECT p.*, 0.0 AS rank, e.garment AS hint_garment, e.colour AS hint_colour
                FROM product_enrichment e
                JOIN products p ON p.id = e.product_id
                WHERE e.garment IN ({','.join('?' * len(accepted))})
                  AND p.region = ? AND p.available = 1 AND p.department != 'kids'
                  {section_sql}
                LIMIT ?
            """
            extra_params = [*accepted, region, *(departments or ()), CANDIDATE_LIMIT]
            for row in connection.execute(extra_sql, extra_params).fetchall():
                if row["id"] not in seen_rows and passes(row):
                    seen_rows.add(row["id"])
                    rows.append(row)

    # Price guidance comes from all correct matches, before the budget filter
    price_range = _price_range([row["price"] for row in rows])

    scored = []

    for row in rows:
        if min_price is not None and row["price"] < min_price:
            continue
        if max_price is not None and row["price"] > max_price:
            continue

        title_words = set(re.findall(r"[a-z0-9]+", f"{row['title']} {row['product_type']}".lower()))
        score = -row["rank"]

        # The exact shade asked for ("light blue", not just any blue) first
        if color_words & title_words:
            score += 3.0

        # Details the user asked for ("oxford", "cargo", "oversized") in the title
        score += 1.5 * len(descriptors & title_words)

        # Exact section before unisex
        if department in ("men", "women") and row["department"] == department:
            score += 3.0

        # Without a budget, favour everyday prices over luxury outliers
        if price_range and min_price is None and max_price is None:
            if row["price"] <= price_range["typical_high"] * 1.5:
                score += 2.0

        # Products the user can actually buy in their size come first
        fit = size_status(row["size_kind"], row["sizes_in_stock"], my_sizes)
        if fit == "fits":
            score += 3.0
        elif fit == "not_in_size":
            score -= 3.0

        # Products this user was already shown for earlier questions step
        # aside so each answer brings something new
        if seen_ids and row["id"] in seen_ids:
            score -= 2.5

        score += store_boosts.get(row["store_id"], 0.0)
        scored.append((score, row, fit))

    scored.sort(key=lambda item: item[0], reverse=True)

    # One product per store keeps results varied and brand-neutral. Products
    # not available in the user's size, then a second product from the same
    # store, only fill slots that would otherwise stay empty.
    picked, picked_ids, seen_stores = [], set(), set()
    # Stores sometimes list the same product twice under different ids
    picked_titles = set()

    for allow_not_in_size, allow_same_store in ((False, False), (True, False), (True, True)):
        for _score, row, fit in scored:
            if len(picked) == limit:
                break

            title_key = (row["store_id"], row["title"].strip().lower())
            if row["id"] in picked_ids or title_key in picked_titles:
                continue

            if row["store_id"] in seen_stores and not allow_same_store:
                continue

            if fit == "not_in_size" and not allow_not_in_size:
                continue

            seen_stores.add(row["store_id"])
            picked_ids.add(row["id"])
            picked_titles.add(title_key)
            picked.append(_public_product(row, fit))

    return {"products": picked, "price_range": price_range}


def _thumbnail(url: Optional[str]) -> Optional[str]:
    if not url or "cdn.shopify.com" not in url:
        return url

    return f"{url}{'&' if '?' in url else '?'}width=360"


MAX_SIZES_SHOWN = 8


def _public_product(row: sqlite3.Row, fit: Optional[str] = None) -> dict:
    compare_at = row["compare_at"]
    discount = (
        int(round((1 - row["price"] / compare_at) * 100))
        if compare_at and compare_at > row["price"]
        else None
    )

    sizes = (
        sorted(row["sizes_in_stock"].split("|"), key=size_sort_key)[:MAX_SIZES_SHOWN]
        if row["sizes_in_stock"]
        else []
    )

    return {
        "id": row["id"],
        "department": row["department"],
        "sizes": sizes,
        "size_kind": row["size_kind"],
        "size_status": fit,
        "title": row["title"],
        "store": row["store_name"],
        "price": row["price"],
        "compare_at": compare_at,
        "discount_percent": discount,
        "image": _thumbnail(row["image"]),
        "url": row["url"],
        "colour_family": main_colour_family(row["title"], row["product_type"], row["colors"]),
    }


def main_colour_family(title: str, product_type: str, option_colors: str) -> Optional[str]:
    """The product's main colour family, from the first colour word in its
    title, else its single colour option."""
    sequence = _colour_sequence(f"{title} {product_type or ''}")
    families = sequence[0] if sequence else color_families(option_colors or "")
    return next((family for family in COLOR_FAMILIES if family in families), None)


# ---------------------------------------------------------
# Browse: plain item searches ("wide leg trousers") skip the stylist
# ---------------------------------------------------------

# Words a plain item search may contain besides garments, colours and details.
# Anything else (occasions, "suggest", "with", numbers) goes to the stylist.
_BROWSE_WORDS = {
    "a", "an", "the", "some", "pair", "pairs", "of", "in", "and", "for",
    "show", "me", "find", "i", "want", "need", "looking", "buy", "shop", "get",
    "men", "mens", "man", "women", "womens", "woman", "ladies", "unisex", "boys", "girls",
    "light", "dark", "pastel", "plain", "solid",
    "high", "mid", "low", "waist", "waisted", "rise", "leg", "legged", "fit", "fitted",
    "regular", "relaxed", "loose", "long", "short", "half", "full", "sleeve", "sleeves",
    "sleeveless", "neck", "collar", "zip", "button", "down", "hooded", "cotton",
    "running", "casual", "formal",
}

MAX_BROWSE_WORDS = 8


def browse_query(text: str) -> Optional[str]:
    """The search, when the text is just an item to shop for; None when it's
    a styling question the stylist should answer."""
    text = (text or "").strip().lower()
    if not text or re.search(r"[0-9?]", text):
        return None

    words = _title_words(text)
    if not words or len(words) > MAX_BROWSE_WORDS or not garment_type(text):
        return None

    # Colour combinations ("black and white sneakers") need the stylist's
    # stricter multi-colour handling
    if len(color_families(text)) > 1:
        return None

    detail_words = set(HARD_DETAILS).union(*HARD_DETAILS.values())
    for word in words:
        singular = word if word.endswith("ss") else word.rstrip("s")
        known = (
            word in _BROWSE_WORDS or word in COLOR_WORDS or word in detail_words
            or word in _GARMENT_TYPES or singular in _GARMENT_TYPES
            or (word.endswith("es") and word[:-2] in _GARMENT_TYPES)
            or word in ("tshirt", "tshirts", "hightop", "lowtop", "midtop", "bootcut", "crewneck", "turtleneck", "coord")
        )
        if not known:
            return None

    filler = {"show", "me", "find", "i", "want", "need", "looking", "buy", "shop", "get", "some", "a", "an", "the", "pair", "pairs", "of"}
    return " ".join(word for word in re.findall(r"[a-z-]+", text) if word not in filler)


BROWSE_LIMIT = 24
BROWSE_FACET_LIMIT = 60


def browse_products(query: str, region: str, colour: Optional[str] = None, **options) -> dict:
    """Every colour and model of an item: products plus the colours available.

    The colour chips come from the search without any colour, so they stay
    the same while the shopper switches between them.
    """
    base = without_colours(query)
    everything = search_products(base, region, limit=BROWSE_FACET_LIMIT, **options)

    counts: dict[str, int] = {}
    for product in everything["products"]:
        family = product.get("colour_family")
        if family:
            counts[family] = counts.get(family, 0) + 1
    colours = [{"colour": family, "count": count}
               for family, count in sorted(counts.items(), key=lambda item: -item[1])]

    if colour in COLOR_FAMILIES:
        found = search_products(f"{colour} {base}", region, limit=BROWSE_LIMIT, **options)
    else:
        found = {"products": everything["products"][:BROWSE_LIMIT], "price_range": everything["price_range"]}

    return {
        "query": base,
        "products": found["products"],
        "colours": colours,
        "price_range": everything["price_range"],
    }


def products_by_id(product_ids: list[str]) -> dict[str, dict]:
    """Available products by id, as shown to shoppers (current price and sizes)."""
    if not product_ids or not DB_PATH.exists():
        return {}

    with connect() as connection:
        rows = connection.execute(
            f"SELECT * FROM products WHERE available = 1 AND id IN ({','.join('?' * len(product_ids))})",
            list(product_ids),
        ).fetchall()
    return {row["id"]: _public_product(row) for row in rows}


def get_product(product_id: str) -> Optional[dict]:
    if not DB_PATH.exists():
        return None

    with connect() as connection:
        row = connection.execute(
            "SELECT id, store_id, title, url FROM products WHERE id = ?", (product_id,)
        ).fetchone()

    return dict(row) if row else None


def store_summaries(store_ids: Iterable[str]) -> dict:
    if not DB_PATH.exists():
        return {}

    ids = list(store_ids)

    with connect() as connection:
        rows = connection.execute(
            f"SELECT * FROM stores WHERE store_id IN ({','.join('?' * len(ids))})",
            ids
        ).fetchall()

    return {row["store_id"]: dict(row) for row in rows}
