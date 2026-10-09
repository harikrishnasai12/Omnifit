"""
The social style network: following, public profiles and structured outfits.

Every account is simply a user: there are no stylist or creator accounts.
A user can follow others, publish outfits, save other people's public
outfits, get the real products of an outfit and adapt it with Gemma.

An outfit is a list of catalogue product IDs, never a copy of the products:
titles, prices, photos and stock are read from the catalogue each time an
outfit is shown, so they are always the catalogue's own.

Public: a user's name, their follower counts and their public outfits.
Nothing else about a person is ever read here (no email, measurements,
wardrobe, saved looks or taste).

Stored in users.db beside the accounts, so deleting an account removes its
follows, outfits and saves with it. Messaging is not built: it would be one
more table keyed on two user ids, next to `follows`.
"""

import json
import re
import time
import uuid
from collections import Counter
from typing import Callable, Optional

import accounts
import catalog

MIN_ITEMS = 2
MAX_ITEMS = 8
MAX_TAGS = 5
MAX_OUTFITS_PER_USER = 200
VISIBILITIES = ("public", "private")
CATEGORIES = ("top", "layer", "bottom", "one_piece", "footwear", "accessories")
ANONYMOUS_NAME = "OmniFit member"

TABLES = """
CREATE TABLE IF NOT EXISTS follows (
    follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followed_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL,
    PRIMARY KEY (follower_id, followed_id),
    CHECK (follower_id <> followed_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows(followed_id);

CREATE TABLE IF NOT EXISTS outfits (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    tags TEXT NOT NULL,
    visibility TEXT NOT NULL,
    -- The outfit this one was adapted from ("Inspired by")
    source_outfit_id TEXT REFERENCES outfits(id) ON DELETE SET NULL,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outfits_owner ON outfits(owner_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_outfits_public ON outfits(visibility, created_at);

CREATE TABLE IF NOT EXISTS outfit_items (
    outfit_id TEXT NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    product_id TEXT NOT NULL,
    category TEXT NOT NULL,
    PRIMARY KEY (outfit_id, position)
);

CREATE TABLE IF NOT EXISTS outfit_saves (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    outfit_id TEXT NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
    created_at REAL NOT NULL,
    PRIMARY KEY (user_id, outfit_id)
);
"""


class SocialError(Exception):
    """A problem the person should see, with the HTTP status it maps to."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


_schema_ready = False


def connect():
    global _schema_ready
    connection = accounts.connect()
    if not _schema_ready:
        connection.executescript(TABLES)
        _schema_ready = True
    return connection


# ---------------------------------------------------------
# Users and following
# ---------------------------------------------------------

def _public_user(row) -> dict:
    # The name they chose, never the email it would otherwise fall back to
    return {"id": row["id"], "name": row["name"] or ANONYMOUS_NAME}


def get_user(user_id: str) -> Optional[dict]:
    with connect() as connection:
        row = connection.execute("SELECT id, name FROM users WHERE id = ?", (user_id,)).fetchone()
    return _public_user(row) if row else None


def _existing_user(user_id: str) -> dict:
    user = get_user(user_id)
    if not user:
        raise SocialError("That person isn't on OmniFit.", 404)
    return user


def follow(follower_id: str, followed_id: str) -> bool:
    """True when this is a new follow, False when they already followed."""
    if follower_id == followed_id:
        raise SocialError("You can't follow yourself.")
    _existing_user(followed_id)
    with connect() as connection:
        return bool(connection.execute(
            "INSERT OR IGNORE INTO follows (follower_id, followed_id, created_at) VALUES (?, ?, ?)",
            (follower_id, followed_id, time.time()),
        ).rowcount)


def unfollow(follower_id: str, followed_id: str) -> bool:
    with connect() as connection:
        return bool(connection.execute(
            "DELETE FROM follows WHERE follower_id = ? AND followed_id = ?", (follower_id, followed_id)
        ).rowcount)


def is_following(follower_id: Optional[str], followed_id: str) -> bool:
    if not follower_id:
        return False
    with connect() as connection:
        return bool(connection.execute(
            "SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?", (follower_id, followed_id)
        ).fetchone())


def followers(user_id: str) -> list[dict]:
    _existing_user(user_id)
    with connect() as connection:
        rows = connection.execute(
            "SELECT users.id, users.name FROM follows JOIN users ON users.id = follows.follower_id "
            "WHERE follows.followed_id = ? ORDER BY follows.created_at DESC LIMIT 200", (user_id,)
        ).fetchall()
    return [_public_user(row) for row in rows]


def following(user_id: str) -> list[dict]:
    _existing_user(user_id)
    with connect() as connection:
        rows = connection.execute(
            "SELECT users.id, users.name FROM follows JOIN users ON users.id = follows.followed_id "
            "WHERE follows.follower_id = ? ORDER BY follows.created_at DESC LIMIT 200", (user_id,)
        ).fetchall()
    return [_public_user(row) for row in rows]


def counts(user_id: str) -> dict:
    with connect() as connection:
        row = connection.execute(
            "SELECT (SELECT COUNT(*) FROM follows WHERE followed_id = :id) followers, "
            "(SELECT COUNT(*) FROM follows WHERE follower_id = :id) following, "
            "(SELECT COUNT(*) FROM outfits WHERE owner_user_id = :id AND visibility = 'public') public_outfits",
            {"id": user_id},
        ).fetchone()
    return dict(row)


def users_to_discover(viewer_id: Optional[str], limit: int = 12) -> list[dict]:
    """People with public outfits the viewer doesn't follow yet, most followed first."""
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT users.id, users.name, COUNT(outfits.id) outfits,
                   (SELECT COUNT(*) FROM follows WHERE followed_id = users.id) followers
            FROM users JOIN outfits ON outfits.owner_user_id = users.id AND outfits.visibility = 'public'
            WHERE users.id <> :viewer
              AND users.id NOT IN (SELECT followed_id FROM follows WHERE follower_id = :viewer)
            GROUP BY users.id ORDER BY followers DESC, outfits DESC, MAX(outfits.created_at) DESC LIMIT :limit
            """,
            {"viewer": viewer_id or "", "limit": limit},
        ).fetchall()
    return [{**_public_user(row), "outfits": row["outfits"], "followers": row["followers"]} for row in rows]


# ---------------------------------------------------------
# Outfits
# ---------------------------------------------------------

def _clean_tags(tags) -> list[str]:
    cleaned = []
    for tag in tags or []:
        tag = re.sub(r"[^a-z0-9 -]", "", str(tag).lower()).strip()[:24]
        if tag and tag not in cleaned:
            cleaned.append(tag)
    return cleaned[:MAX_TAGS]


def create_outfit(
    owner_id: str, title: str, items: list[dict], description: str = "", tags=None,
    visibility: str = "public", source_outfit_id: Optional[str] = None,
) -> str:
    """Stores an outfit of real catalogue products. `items`: [{"product_id", "category"?}],
    in the order to show them. Returns the new outfit's id."""
    title = " ".join((title or "").split())[:80]
    if not title:
        raise SocialError("Give your outfit a title.")
    if visibility not in VISIBILITIES:
        raise SocialError("An outfit is either public or private.")

    product_ids = list(dict.fromkeys(str(item.get("product_id", "")) for item in items))
    if not MIN_ITEMS <= len(product_ids) <= MAX_ITEMS:
        raise SocialError(f"An outfit has {MIN_ITEMS} to {MAX_ITEMS} different products.")

    # Only products that are really in the catalogue
    known = catalog.products_by_id(product_ids, available_only=False)
    if any(product_id not in known for product_id in product_ids):
        raise SocialError("One of those products isn't in the OmniFit catalogue.")

    chosen = {str(item.get("product_id")): item.get("category") for item in items}
    outfit_id = uuid.uuid4().hex[:16]
    with connect() as connection:
        owned = connection.execute("SELECT COUNT(*) FROM outfits WHERE owner_user_id = ?", (owner_id,)).fetchone()[0]
        if owned >= MAX_OUTFITS_PER_USER:
            raise SocialError(f"You have {MAX_OUTFITS_PER_USER} outfits. Delete some to add more.")
        connection.execute(
            "INSERT INTO outfits (id, owner_user_id, title, description, tags, visibility, source_outfit_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (outfit_id, owner_id, title, " ".join((description or "").split())[:300],
             json.dumps(_clean_tags(tags)), visibility, source_outfit_id, time.time()),
        )
        connection.executemany(
            "INSERT INTO outfit_items (outfit_id, position, product_id, category) VALUES (?, ?, ?, ?)",
            [
                (outfit_id, position, product_id,
                 chosen[product_id] if chosen[product_id] in CATEGORIES else catalog.outfit_slot_for(known[product_id]["title"]))
                for position, product_id in enumerate(product_ids)
            ],
        )
    return outfit_id


def _cards(rows, viewer_id: Optional[str]) -> list[dict]:
    """Outfits as shown to people: with their owner, and each item's product
    as the catalogue has it right now."""
    if not rows:
        return []
    ids = [row["id"] for row in rows]
    marks = ",".join("?" * len(ids))
    with connect() as connection:
        items = connection.execute(
            f"SELECT * FROM outfit_items WHERE outfit_id IN ({marks}) ORDER BY outfit_id, position", ids
        ).fetchall()
        saves = dict(connection.execute(
            f"SELECT outfit_id, COUNT(*) FROM outfit_saves WHERE outfit_id IN ({marks}) GROUP BY outfit_id", ids
        ).fetchall())
        mine = {row[0] for row in connection.execute(
            f"SELECT outfit_id FROM outfit_saves WHERE user_id = ? AND outfit_id IN ({marks})", [viewer_id or "", *ids]
        ).fetchall()}
        owners = {row["id"]: _public_user(row) for row in connection.execute(
            f"SELECT id, name FROM users WHERE id IN ({','.join('?' * len(rows))})", [row["owner_user_id"] for row in rows]
        ).fetchall()}
        source_ids = [row["source_outfit_id"] for row in rows if row["source_outfit_id"]]
        # "Inspired by" names its source only while that outfit is public
        sources = {
            row["id"]: {"id": row["id"], "title": row["title"],
                        "owner": {"id": row["owner_id"], "name": row["name"] or ANONYMOUS_NAME}}
            for row in connection.execute(
                "SELECT outfits.id, outfits.title, users.id AS owner_id, users.name FROM outfits "
                "JOIN users ON users.id = outfits.owner_user_id "
                f"WHERE outfits.visibility = 'public' AND outfits.id IN ({','.join('?' * len(source_ids))})", source_ids
            ).fetchall()
        } if source_ids else {}

    product_ids = list({item["product_id"] for item in items})
    known = catalog.products_by_id(product_ids, available_only=False)
    live = catalog.products_by_id(product_ids)

    cards = []
    for row in rows:
        pieces = [
            {
                "position": item["position"],
                "category": item["category"],
                "product_id": item["product_id"],
                "product": live.get(item["product_id"]) or known.get(item["product_id"]),
                "available": item["product_id"] in live,
            }
            for item in items if item["outfit_id"] == row["id"]
        ]
        cards.append({
            "id": row["id"],
            "title": row["title"],
            "description": row["description"] or "",
            "tags": json.loads(row["tags"]),
            "visibility": row["visibility"],
            "created_at": row["created_at"],
            "owner": owners[row["owner_user_id"]],
            "is_mine": row["owner_user_id"] == viewer_id,
            "inspired_by": sources.get(row["source_outfit_id"]),
            "is_adapted": bool(row["source_outfit_id"]),
            "items": pieces,
            "total_price": round(sum(piece["product"]["price"] for piece in pieces if piece["available"])),
            "saves": saves.get(row["id"], 0),
            "saved": row["id"] in mine,
        })
    return cards


def get_outfit(outfit_id: str, viewer_id: Optional[str]) -> dict:
    """The outfit, if this viewer may see it: public, or their own. A private
    outfit looks exactly like one that doesn't exist."""
    with connect() as connection:
        row = connection.execute("SELECT * FROM outfits WHERE id = ?", (outfit_id,)).fetchone()
    if not row or (row["visibility"] != "public" and row["owner_user_id"] != viewer_id):
        raise SocialError("That outfit isn't available.", 404)
    return _cards([row], viewer_id)[0]


def _own_outfit(outfit_id: str, owner_id: str):
    with connect() as connection:
        row = connection.execute(
            "SELECT * FROM outfits WHERE id = ? AND owner_user_id = ?", (outfit_id, owner_id)
        ).fetchone()
    if not row:
        raise SocialError("That outfit isn't yours to change.", 404)
    return row


def set_visibility(outfit_id: str, owner_id: str, visibility: str) -> None:
    if visibility not in VISIBILITIES:
        raise SocialError("An outfit is either public or private.")
    _own_outfit(outfit_id, owner_id)
    with connect() as connection:
        connection.execute("UPDATE outfits SET visibility = ? WHERE id = ?", (visibility, outfit_id))
        if visibility == "private":
            # Made private: it leaves everyone else's saved outfits
            connection.execute("DELETE FROM outfit_saves WHERE outfit_id = ? AND user_id <> ?", (outfit_id, owner_id))


def delete_outfit(outfit_id: str, owner_id: str) -> None:
    _own_outfit(outfit_id, owner_id)
    with connect() as connection:
        connection.execute("DELETE FROM outfits WHERE id = ?", (outfit_id,))


def outfits_of(owner_id: str, viewer_id: Optional[str]) -> list[dict]:
    """A person's outfits: all of them for the owner, the public ones for anyone else."""
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM outfits WHERE owner_user_id = ? AND (visibility = 'public' OR owner_user_id = ?) "
            "ORDER BY created_at DESC LIMIT 60", (owner_id, viewer_id or ""),
        ).fetchall()
    return _cards(rows, viewer_id)


def recent_public(viewer_id: Optional[str], limit: int = 24, prefer_section: Optional[str] = None) -> list[dict]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM outfits WHERE visibility = 'public' AND owner_user_id <> ? ORDER BY created_at DESC LIMIT ?",
            (viewer_id or "", limit),
        ).fetchall()
    cards = _cards(rows, viewer_id)
    if prefer_section in ("men", "women"):
        # The viewer's usual section first; newest first within each
        cards.sort(key=lambda card: section_of(card) not in (prefer_section, "any"))
    return cards


def from_following(viewer_id: str, limit: int = 24) -> list[dict]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT outfits.* FROM outfits JOIN follows ON follows.followed_id = outfits.owner_user_id "
            "WHERE follows.follower_id = ? AND outfits.visibility = 'public' ORDER BY outfits.created_at DESC LIMIT ?",
            (viewer_id, limit),
        ).fetchall()
    return _cards(rows, viewer_id)


def save_outfit(user_id: str, outfit_id: str) -> bool:
    """True when newly saved, False when it was saved already."""
    outfit = get_outfit(outfit_id, user_id)
    if outfit["is_mine"]:
        raise SocialError("This is your own outfit: it's already in your outfits.")
    with connect() as connection:
        return bool(connection.execute(
            "INSERT OR IGNORE INTO outfit_saves (user_id, outfit_id, created_at) VALUES (?, ?, ?)",
            (user_id, outfit_id, time.time()),
        ).rowcount)


def unsave_outfit(user_id: str, outfit_id: str) -> bool:
    with connect() as connection:
        return bool(connection.execute(
            "DELETE FROM outfit_saves WHERE user_id = ? AND outfit_id = ?", (user_id, outfit_id)
        ).rowcount)


def saved_outfits(user_id: str) -> list[dict]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT outfits.* FROM outfits JOIN outfit_saves ON outfit_saves.outfit_id = outfits.id "
            "WHERE outfit_saves.user_id = ? AND outfits.visibility = 'public' ORDER BY outfit_saves.created_at DESC LIMIT 60",
            (user_id,),
        ).fetchall()
    return _cards(rows, user_id)


def section_of(outfit: dict) -> str:
    """Men's or women's, from the outfit's own products; "any" when mixed or unknown."""
    votes = Counter(
        item["product"]["department"] for item in outfit["items"]
        if item["product"] and item["product"]["department"] in ("men", "women")
    )
    return votes.most_common(1)[0][0] if votes else "any"


# ---------------------------------------------------------
# Get This Look
# ---------------------------------------------------------

# What to search for when a product has left the catalogue altogether
_CATEGORY_SEARCH = {
    "top": "shirt", "layer": "jacket", "bottom": "trousers", "one_piece": "dress",
    "footwear": "sneakers", "accessories": "watch",
}

# search(query, max_price, section) -> the catalogue's matching products
Search = Callable[[str, Optional[float], str], list]


def _similar_queries(item: dict) -> list[str]:
    product = item["product"]
    if not product:
        return [_CATEGORY_SEARCH.get(item["category"], "shirt")]
    garment = catalog.garment_type(product["title"]) or _CATEGORY_SEARCH.get(item["category"], "")
    colour = product.get("colour_family") or ""
    return list(dict.fromkeys(query for query in (f"{colour} {garment}".strip(), garment) if query))


def look(outfit: dict, search: Search) -> list[dict]:
    """Each piece of the outfit as it can be bought now. A piece that is sold
    out or gone comes with similar products from the catalogue search."""
    section = section_of(outfit)
    shown = {item["product_id"] for item in outfit["items"]}
    pieces = []
    for item in outfit["items"]:
        alternatives = []
        if not item["available"]:
            for query in _similar_queries(item):
                alternatives = [product for product in search(query, None, section) if product["id"] not in shown][:3]
                if alternatives:
                    break
            shown.update(product["id"] for product in alternatives)
        pieces.append({**item, "alternatives": alternatives})
    return pieces


# ---------------------------------------------------------
# Adapt This Look (Gemma plans the change; the catalogue supplies the products)
# ---------------------------------------------------------

MAX_ADDITIONS = 2
_CHEAPER = re.compile(r"\b(cheap|cheaper|budget|afford\w*|less expensive|lower price|save money|under)\b", re.I)

ADAPT_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "summary": {"type": "string"},
        "pieces": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "number": {"type": "integer"},
                    "action": {"type": "string", "enum": ["keep", "replace", "remove"]},
                    "search_query": {"type": "string"},
                    "max_price": {"type": "number"},
                },
                "required": ["number", "action", "search_query", "max_price"],
            },
        },
        "additions": {
            "type": "array",
            "maxItems": MAX_ADDITIONS,
            "items": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "enum": list(CATEGORIES)},
                    "search_query": {"type": "string"},
                    "max_price": {"type": "number"},
                },
                "required": ["category", "search_query", "max_price"],
            },
        },
    },
    "required": ["title", "summary", "pieces", "additions"],
}


def adapt_prompt(outfit: dict, request: str) -> str:
    section = section_of(outfit)
    who = {"men": "men", "women": "women"}.get(section, "")
    lines = "\n".join(
        f"{number}. [{item['category']}] {item['product']['title'] if item['product'] else 'a product no longer sold'}"
        f"{' - price ' + str(round(item['product']['price'])) if item['product'] else ''}"
        for number, item in enumerate(outfit["items"], start=1)
    )
    return f"""You are OmniFit, a fashion stylist for Indian shoppers. A shopper wants to change an outfit.

The outfit "{outfit['title']}":
{lines}

The shopper's request: "{request}"

Decide what happens to EACH numbered piece: "keep" it, "replace" it, or "remove" it. Change only what
the request needs and keep everything else. For a piece you replace, write "search_query": 3 to 6
lowercase words describing the new piece to look for in a shop (colour + detail + item{' + ' + who if who else ''}),
for example "white linen shirt{' ' + who if who else ''}". Set "max_price" to the most the new piece may cost, or 0 for
no limit; when the shopper wants it cheaper, set it below that piece's price above. For "keep" and
"remove", use an empty "search_query" and 0. Use "additions" only when the request asks to add something.

You do NOT choose products. Never write a brand, a product name, a product ID, a price of a product or
whether something is in stock: the shop's own search finds the real products from your search words.

Also give a short new "title" (2 to 5 words) and a one-line "summary" of what you changed.
Talk only about clothes. Return ONLY valid JSON."""


def clean_plan(raw: str, outfit: dict) -> dict:
    """Gemma's plan, checked: one action for every piece of the outfit, and
    nothing in it but search words and price limits."""
    data = json.loads(raw)
    if not isinstance(data, dict) or not isinstance(data.get("pieces"), list):
        raise ValueError("no pieces")

    def query(value) -> str:
        return " ".join(re.findall(r"[a-z][a-z-]*", str(value or "").lower()))[:80]

    def limit(value) -> Optional[float]:
        return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0 else None

    by_number = {}
    for piece in data["pieces"]:
        if isinstance(piece, dict) and isinstance(piece.get("number"), int):
            by_number.setdefault(piece["number"], piece)

    actions = []
    for number in range(1, len(outfit["items"]) + 1):
        piece = by_number.get(number, {})
        action = piece.get("action") if piece.get("action") in ("keep", "replace", "remove") else "keep"
        search = query(piece.get("search_query"))
        if action == "replace" and not search:
            action = "keep"
        actions.append({"action": action, "search_query": search, "max_price": limit(piece.get("max_price"))})

    additions = [
        {"category": extra["category"], "search_query": query(extra.get("search_query")), "max_price": limit(extra.get("max_price"))}
        for extra in (data.get("additions") or [])[:MAX_ADDITIONS]
        if isinstance(extra, dict) and extra.get("category") in CATEGORIES and query(extra.get("search_query"))
    ]
    return {
        "title": " ".join(str(data.get("title") or "").split())[:60],
        "summary": " ".join(str(data.get("summary") or "").split())[:200],
        "pieces": actions,
        "additions": additions,
    }


def apply_plan(outfit: dict, plan: dict, request: str, search: Search) -> tuple[list[dict], list[str]]:
    """Turns the plan into real products. Returns the new outfit's items
    ([{"product_id", "category"}]) and notes on anything that couldn't be done.
    Every product comes from the catalogue search or from the original outfit."""
    section = section_of(outfit)
    cheaper = bool(_CHEAPER.search(request))
    original = {item["product_id"] for item in outfit["items"]}
    used: set[str] = set()
    items, notes = [], []
    removable = len(outfit["items"]) - MIN_ITEMS

    def name(item: dict) -> str:
        return item["product"]["title"] if item["product"] else f"the {item['category'].replace('_', ' ')}"

    def keep(item: dict) -> None:
        if item["available"] and item["product_id"] not in used:
            used.add(item["product_id"])
            items.append({"product_id": item["product_id"], "category": item["category"]})

    for item, step in zip(outfit["items"], plan["pieces"]):
        if step["action"] == "remove" and removable > 0:
            removable -= 1
            continue
        # A piece that has sold out is replaced with something like it, whatever the plan says
        wanted = step["search_query"] if step["action"] == "replace" else ""
        queries = [wanted] if wanted else ([] if item["available"] else _similar_queries(item))
        if not queries:
            keep(item)
            continue

        cap = step["max_price"]
        price = item["product"]["price"] if item["product"] else None
        if cheaper and wanted and price:
            # "Cheaper" always means cheaper than the piece it replaces
            cap = min(cap or price, price * 0.9)
        found = None
        for query in queries:
            found = next(
                (product for product in search(query, cap, section)
                 if product["id"] not in used and product["id"] not in original), None
            )
            if found:
                break
        if found:
            used.add(found["id"])
            items.append({"product_id": found["id"], "category": item["category"]})
        elif item["available"]:
            keep(item)
            notes.append(f"Nothing in the catalogue matched \"{wanted}\"{' at that price' if cap else ''}, so {name(item)} stays.")
        else:
            notes.append(f"{name(item)} has sold out and nothing similar was found.")

    for extra in plan["additions"]:
        if len(items) >= MAX_ITEMS:
            break
        found = next(
            (product for product in search(extra["search_query"], extra["max_price"], section)
             if product["id"] not in used and product["id"] not in original), None
        )
        if found:
            used.add(found["id"])
            items.append({"product_id": found["id"], "category": extra["category"]})
        else:
            notes.append(f"Nothing in the catalogue matched \"{extra['search_query']}\".")

    if len(items) < MIN_ITEMS:
        raise SocialError("Not enough of this look could be found in the catalogue. Try a different change.", 422)
    if [item["product_id"] for item in items] == [item["product_id"] for item in outfit["items"]]:
        raise SocialError("Nothing in the catalogue matched that change. Try wording it differently.", 422)
    return items, notes
