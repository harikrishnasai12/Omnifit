"""
Build the look pool for the Home feed (see lookpool.py).

For each section x occasion x style direction, Gemma writes 4 looks and each
piece gets a real product from the catalogue. Incomplete looks (no top and
bottom, or a one-piece with nothing to style it) are dropped. Safe to re-run: it adds looks until each combination has
enough, and can stop and resume.

Usage (from backend/, venv active):
  python build_looks.py                 # fill every combination (~40 Gemma calls)
  python build_looks.py --per-combo 8   # more looks per combination
  python build_looks.py --stats
  python build_looks.py --max-minutes 30
"""

import argparse
import json
import logging
import os
import sys
import time

import httpx
from dotenv import load_dotenv

import catalog
import lookpool

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("looks")

OLLAMA_URL = os.environ["OLLAMA_URL"].rstrip("/")
MODEL = "gemma4:12b"
REGION = "IN"

STYLE_TAGS = ("casual", "streetwear", "smart-casual", "formal", "classic", "minimal",
              "ethnic", "festive", "party", "athleisure")

# occasion id -> (label, style directions that suit it)
OCCASIONS = {
    "casual": ("everyday casual and college", ("casual", "streetwear", "minimal")),
    "office": ("the office", ("smart-casual", "formal", "minimal")),
    "party": ("a party or night out", ("party", "streetwear", "classic")),
    "wedding": ("an Indian wedding (guest)", ("ethnic", "festive", "classic")),
    "festival": ("Indian festivals like Diwali and Navratri", ("ethnic", "festive", "casual")),
    "date": ("a date", ("smart-casual", "classic", "minimal")),
    "travel": ("travel and weekend trips", ("casual", "athleisure", "minimal")),
}
SECTIONS = ("men", "women")


def existing_counts() -> dict:
    with lookpool.connect() as connection:
        rows = connection.execute(
            "SELECT section, occasion, styles FROM looks WHERE active = 1"
        ).fetchall()
    counts = {}
    for row in rows:
        for style in json.loads(row["styles"]):
            key = (row["section"], row["occasion"], style)
            counts[key] = counts.get(key, 0) + 1
    return counts


def recent_titles(section: str, occasion: str) -> list[str]:
    with lookpool.connect() as connection:
        rows = connection.execute(
            "SELECT title FROM looks WHERE section = ? AND occasion = ? ORDER BY created_at DESC LIMIT 12",
            (section, occasion),
        ).fetchall()
    return [row["title"] for row in rows]


def query_ladder(query: str, section: str) -> list[str]:
    """The model's exact words first, then any colour, then just the core item
    ("emerald green georgette sharara set women" -> "georgette sharara set women")."""
    words = [word for word in query.split() if word not in ("men", "women")]
    ladder = [query, catalog.without_colours(query)]
    if len(words) > 3:
        ladder.append(" ".join(words[-3:] + [section]))
    return list(dict.fromkeys(q for q in ladder if q))


def product_for(query: str, section: str, used: set[str]) -> dict | None:
    for attempt in query_ladder(query, section):
        found = catalog.search_products(attempt, region=REGION, department=section, limit=6)["products"]
        for product in found:
            if product["id"] not in used and not product.get("closest_match_without"):
                return product
    return None


def build(client: httpx.Client, section: str, occasion: str, style: str, used: set[str]) -> int:
    label, _styles = OCCASIONS[occasion]
    response = client.post(f"{OLLAMA_URL}/api/generate", json={
        "model": MODEL,
        "prompt": lookpool.look_prompt(section, occasion, label, style, recent_titles(section, occasion)),
        "stream": False,
        "format": lookpool.look_schema(STYLE_TAGS),
        "think": False,
        "options": {"temperature": 0.7, "num_predict": 2500},
    })
    response.raise_for_status()
    looks = json.loads(response.json().get("response", "{}")).get("looks", [])

    saved = 0
    for look in looks:
        pieces = []
        for piece in look.get("pieces", [])[:5]:
            query = " ".join(str(piece.get("search_query", "")).lower().split()[:8])
            if not query:
                continue
            product = product_for(query, section, used)
            if product:
                used.add(product["id"])
                pieces.append({
                    "slot": piece.get("slot") if piece.get("slot") in lookpool.SLOTS else "top",
                    "name": str(piece.get("name", ""))[:80],
                    "query": query,
                    "product": {key: product.get(key) for key in (
                        "id", "title", "store", "price", "compare_at", "image", "url", "sizes", "size_kind", "department"
                    )},
                })
        slots = {piece["slot"] for piece in pieces}
        # A top with a bottom and one more piece, or a one-piece (saree,
        # dress, kurta set) with at least one piece to style it
        complete = ({"top", "bottom"} <= slots and len(pieces) >= 3) or ("one_piece" in slots and len(pieces) >= 2)
        if complete:
            look["styles"] = [s for s in look.get("styles", []) if s in STYLE_TAGS][:2] or [style]
            lookpool.save_look(section, occasion, look, pieces)
            saved += 1
    return saved


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--per-combo", type=int, default=3, help="looks wanted per section/occasion/style")
    parser.add_argument("--max-minutes", type=float, default=0)
    parser.add_argument("--stats", action="store_true")
    args = parser.parse_args()

    if args.stats:
        print(json.dumps(lookpool.stats(), indent=1))
        return

    counts = existing_counts()
    todo = [
        (section, occasion, style)
        for section in SECTIONS
        for occasion, (_label, styles) in OCCASIONS.items()
        for style in styles
        if counts.get((section, occasion, style), 0) < args.per_combo
    ]
    log.info("%d combinations need looks", len(todo))

    # Products already used in the pool, so looks don't all share the same items
    with lookpool.connect() as connection:
        used = {
            piece["product"]["id"]
            for row in connection.execute("SELECT pieces FROM looks WHERE active = 1")
            for piece in json.loads(row["pieces"])
        }

    started, total, failures = time.time(), 0, 0
    with httpx.Client(timeout=httpx.Timeout(240, connect=10)) as client:
        for section, occasion, style in todo:
            if args.max_minutes and time.time() - started > args.max_minutes * 60:
                log.info("Time limit reached; run again to continue")
                break
            try:
                saved = build(client, section, occasion, style, used)
                total += saved
                failures = 0
                log.info("%s / %s / %s: %d looks saved", section, occasion, style, saved)
            except (httpx.HTTPError, ValueError) as error:
                failures += 1
                log.warning("%s / %s / %s failed: %s", section, occasion, style, type(error).__name__)
                if failures >= 5:
                    log.error("The model server keeps failing; stopping. Run again later to resume.")
                    break
                time.sleep(10 * failures)

    log.info("Done: %d new looks in %.1f minutes. Pool: %s", total, (time.time() - started) / 60, lookpool.stats())


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
