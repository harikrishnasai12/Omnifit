"""
Brand insights: what OmniFit's shoppers do with one partner brand's products.

Read-only, and built only from what the app already keeps:
- signals from the Home feed (seen, lingered, loved, saved, opened to shop,
  added to cart) joined to the looks they were about;
- the taste profiles those signals build (intent.py);
- the product catalogue (what the brand has in stock).

Privacy, the same rule as trends.py: a number is shown only when at least
MIN_PEOPLE different shoppers are behind it, so nobody can be singled out.
Only signed-in shoppers with personalisation on are in this data at all;
guests' activity never leaves their device.
"""

import time
from collections import Counter, defaultdict

import catalog
import intent
import lookpool
from catalog_stores import CATALOG_STORES
from trends import MIN_PEOPLE, _GARMENT_NAMES

WINDOW_DAYS = 30
MAX_ROWS = 6
MAX_DEMAND = 8
GARMENT_CACHE_SECONDS = 600

# Shoppers made by seed_demo.py, so a demo never passes as real usage
DEMO_EMAIL_DOMAIN = "@omnifit.demo"

STORES = {store["id"]: store for store in CATALOG_STORES}

# The feed funnel, in order. "cart" names the exact product; the others are
# about a whole look and count for every brand in it.
FUNNEL = (
    ("view", "Saw a look with your products"),
    ("dwell", "Stopped to look"),
    ("liked", "Loved or saved it"),
    ("product_tap", "Opened it to shop"),
    ("cart", "Added your product to cart"),
)
_STAGE = {"view": "view", "dwell": "dwell", "love": "liked", "save": "liked",
          "product_tap": "product_tap", "cart": "cart"}

AUDIENCE_DIMENSIONS = ("style", "colour", "price_band", "occasion")

_garment_cache: dict[str, tuple[float, Counter]] = {}


def _store_id(product_id: str) -> str:
    # Product ids are "<store id>:<the store's own id>" (see catalog.py)
    return (product_id or "").split(":", 1)[0]


def store_list() -> list[dict]:
    """Every partner brand with the size of its catalogue."""
    with catalog.connect() as connection:
        rows = connection.execute(
            "SELECT store_id, COUNT(*) AS products, SUM(available) AS in_stock FROM products GROUP BY store_id"
        ).fetchall()
    counts = {row["store_id"]: row for row in rows}
    return [
        {"id": store["id"], "name": store["name"], "styles": store["styles"],
         "products": counts[store["id"]]["products"], "in_stock": counts[store["id"]]["in_stock"] or 0}
        for store in CATALOG_STORES if store["id"] in counts
    ]


def _garments_in_stock(store_id: str) -> Counter:
    """How many in-stock products the brand has of each garment type."""
    cached = _garment_cache.get(store_id)
    if cached and time.time() - cached[0] < GARMENT_CACHE_SECONDS:
        return cached[1]

    with catalog.connect() as connection:
        rows = connection.execute(
            "SELECT title, product_type FROM products WHERE store_id = ? AND available = 1", (store_id,)
        ).fetchall()
    counts = Counter(
        garment for row in rows
        if (garment := catalog.product_garment_type(row["title"], row["product_type"]))
    )
    _garment_cache[store_id] = (time.time(), counts)
    return counts


def brand_insights(store_id: str, days: int = WINDOW_DAYS) -> dict:
    store = STORES[store_id]
    since = time.time() - days * 86400

    with intent.connect() as connection:
        signals = connection.execute(
            "SELECT user_id, kind, look_id, product_id FROM signals WHERE created_at > ?", (since,)
        ).fetchall()
        demo_users = {
            row["id"] for row in connection.execute(
                "SELECT id FROM users WHERE email LIKE ?", (f"%{DEMO_EMAIL_DOMAIN}",)
            )
        }
        fans = [
            row["user_id"] for row in connection.execute(
                "SELECT user_id FROM taste_scores WHERE dimension = 'brand' AND value = ? AND score > 0.5",
                (store["name"],),
            )
        ]
        audience_rows = connection.execute(
            f"SELECT dimension, value, COUNT(DISTINCT user_id) AS people FROM taste_scores "
            f"WHERE score > 0.5 AND dimension IN ({','.join('?' * len(AUDIENCE_DIMENSIONS))}) "
            f"AND user_id IN ({','.join('?' * len(fans))}) GROUP BY dimension, value",
            (*AUDIENCE_DIMENSIONS, *fans),
        ).fetchall() if fans else []
        demand_rows = connection.execute(
            "SELECT value, COUNT(DISTINCT user_id) AS people FROM taste_scores "
            "WHERE dimension = 'garment' AND score > 0.5 GROUP BY value HAVING people >= ? "
            "ORDER BY people DESC LIMIT ?",
            (MIN_PEOPLE, MAX_DEMAND),
        ).fetchall()

    # Which looks carry this brand's products
    looks = lookpool.get_looks(list({row["look_id"] for row in signals if row["look_id"]}))
    with_brand = {
        look_id for look_id, look in looks.items()
        if any(_store_id(piece["product"]["id"]) == store_id for piece in look["pieces"] if piece.get("product"))
    }

    events: Counter = Counter()
    people: dict[str, set] = defaultdict(set)
    skips = 0
    for row in signals:
        if row["kind"] == "cart":
            ours = _store_id(row["product_id"]) == store_id
        else:
            ours = row["look_id"] in with_brand
        if not ours:
            continue
        if row["kind"] == "skip":
            skips += 1
            continue
        stage = _STAGE.get(row["kind"])
        if stage:
            events[stage] += 1
            people[stage].add(row["user_id"])
            people["any"].add(row["user_id"])

    shoppers = len(people["any"])
    enough = shoppers >= MIN_PEOPLE

    audience: dict[str, list[dict]] = {dimension: [] for dimension in AUDIENCE_DIMENSIONS}
    for row in sorted(audience_rows, key=lambda row: -row["people"]):
        if row["people"] >= MIN_PEOPLE and len(audience[row["dimension"]]) < MAX_ROWS:
            label = (intent.PRICE_BAND_LABELS.get(row["value"], row["value"])
                     if row["dimension"] == "price_band" else row["value"].replace("-", " "))
            audience[row["dimension"]].append({"value": row["value"], "label": label, "people": row["people"]})

    in_stock = _garments_in_stock(store_id)

    return {
        "store": next((item for item in store_list() if item["id"] == store_id),
                      {"id": store_id, "name": store["name"], "styles": store["styles"], "products": 0, "in_stock": 0}),
        "days": days,
        "min_people": MIN_PEOPLE,
        "shoppers": shoppers,
        "demo_shoppers": len(people["any"] & demo_users),
        "enough": enough,
        # Below the threshold only the fact that there's too little is shown
        "funnel": [
            {"stage": stage, "label": label, "events": events[stage], "people": len(people[stage])}
            for stage, label in FUNNEL
        ] if enough else [],
        "skips": skips if enough else 0,
        "fans": len(fans) if len(fans) >= MIN_PEOPLE else 0,
        "audience": audience,
        "demand": [
            {"garment": row["value"], "label": _GARMENT_NAMES.get(row["value"], row["value"]),
             "people": row["people"], "in_stock": in_stock.get(row["value"], 0)}
            for row in demand_rows
        ],
    }
