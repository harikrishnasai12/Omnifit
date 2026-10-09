"""
Catalogue enrichment: Gemma reads vague product text and fills in the garment
type, colour family, fabric, fit and occasion.

Only products whose title and type don't say what they are, or what colour
they are, are sent. Answers must come from fixed word lists ("unknown" when
unsure) and are stored in product_enrichment, which the daily sync keeps.
Search uses them only where the store's own text is silent (catalog.py).

Usage (from backend/, venv active):
  python enrich_catalog.py                    # everything that needs it (hours)
  python enrich_catalog.py --limit 200        # a sample
  python enrich_catalog.py --store okhai      # one store
  python enrich_catalog.py --max-minutes 60   # stop after an hour; run again to resume
  python enrich_catalog.py --stats            # how much is enriched
"""

import argparse
import hashlib
import json
import logging
import os
import sys
import time

import httpx
from dotenv import load_dotenv

import catalog

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("enrich")

OLLAMA_URL = os.environ["OLLAMA_URL"].rstrip("/")
MODEL = "gemma4:12b"
BATCH_SIZE = 12
MAX_FAILURES_IN_A_ROW = 5

GARMENTS = catalog.GARMENT_TYPES + ["other"]
COLOURS = list(catalog.COLOR_FAMILIES) + ["multicolour", "unknown"]
FABRICS = ["cotton", "linen", "silk", "wool", "denim", "leather", "suede", "polyester", "rayon", "viscose",
           "georgette", "chiffon", "velvet", "knit", "satin", "khadi", "blend", "unknown"]
FITS = ["slim", "regular", "relaxed", "oversized", "straight", "wide", "skinny", "tapered", "unknown"]
OCCASIONS = ["casual", "formal", "party", "ethnic", "festive", "wedding", "athleisure", "loungewear",
             "beach", "unknown"]

SCHEMA = {
    "type": "object",
    "properties": {
        "products": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "n": {"type": "integer"},
                    "garment": {"type": "string", "enum": GARMENTS},
                    "colour": {"type": "string", "enum": COLOURS},
                    "fabric": {"type": "string", "enum": FABRICS},
                    "fit": {"type": "string", "enum": FITS},
                    "occasion": {"type": "string", "enum": OCCASIONS},
                },
                "required": ["n", "garment", "colour", "fabric", "fit", "occasion"],
            },
        }
    },
    "required": ["products"],
}

PROMPT = """You label products from Indian fashion stores. For each numbered product below, use ONLY
its text (title, type, tags) and choose from the allowed values:

- "garment": what the product IS. Use "other" for anything that is not clothing, footwear or a fashion
  accessory we list (home decor, curtains, innerwear, rakhis, gift cards, perfume, jewellery sets...).
  Store words mean: "drivers"/"moccasins" = loafers, "duster" = shrug, "slip on" = shoes,
  "trunks"/"briefs"/"boxers" = other.
- "colour": the main colour family of THIS product, only if its text states one colour clearly (a colour
  word in the title, or one colour tag like "Colour_Orange" or "color-black"). If the tags list several
  colours, or none, or only a collection name, use "unknown". Never guess.
- "fabric", "fit", "occasion": only if stated; otherwise "unknown".

Return ONLY valid JSON with one entry per product, using its number as "n".

Products:
{products}"""


def content_key(row) -> str:
    text = f"{row['title']}|{row['product_type'] or ''}|{row['tags'] or ''}|{row['colors'] or ''}"
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def needs_enrichment(row) -> bool:
    known_garment = catalog.product_garment_type(row["title"], row["product_type"])
    known_colour = catalog.color_families(f"{row['title']} {row['product_type'] or ''} {row['colors'] or ''}")
    return not known_garment or not known_colour


def pending(store: str = "", limit: int = 0) -> list:
    with catalog.connect() as connection:
        rows = connection.execute(
            """SELECT p.id, p.store_id, p.title, p.product_type, p.tags, p.colors, e.content_key
               FROM products p LEFT JOIN product_enrichment e ON e.product_id = p.id
               WHERE p.available = 1 AND p.department != 'kids' AND (? = '' OR p.store_id = ?)""",
            (store, store),
        ).fetchall()

    todo = [row for row in rows if needs_enrichment(row) and row["content_key"] != content_key(row)]
    return todo[:limit] if limit else todo


def describe(n: int, row) -> str:
    tags = " ".join((row["tags"] or "").split()[:40])
    return f"{n}. title: {row['title'][:120]} | type: {row['product_type'] or '-'} | tags: {tags[:400]}"


def enrich_batch(client: httpx.Client, batch: list) -> int:
    prompt = PROMPT.format(products="\n".join(describe(n, row) for n, row in enumerate(batch, start=1)))
    response = client.post(f"{OLLAMA_URL}/api/generate", json={
        "model": MODEL, "prompt": prompt, "stream": False, "format": SCHEMA, "think": False,
        "options": {"temperature": 0.1, "num_predict": 2000},
    })
    response.raise_for_status()
    answers = json.loads(response.json().get("response", "{}")).get("products", [])

    by_number = {answer.get("n"): answer for answer in answers if isinstance(answer, dict)}
    now = time.time()
    saved = 0
    with catalog.connect() as connection:
        for n, row in enumerate(batch, start=1):
            answer = by_number.get(n)
            if not answer:
                continue
            clean = {
                field: (answer.get(field) if answer.get(field) in allowed and answer.get(field) != "unknown" else None)
                for field, allowed in (("garment", GARMENTS), ("colour", COLOURS), ("fabric", FABRICS),
                                       ("fit", FITS), ("occasion", OCCASIONS))
            }
            if clean["colour"] == "multicolour":
                clean["colour"] = None
            connection.execute(
                """INSERT OR REPLACE INTO product_enrichment
                   (product_id, content_key, garment, colour, fabric, fit, occasion, enriched_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (row["id"], content_key(row), clean["garment"], clean["colour"], clean["fabric"],
                 clean["fit"], clean["occasion"], now),
            )
            saved += 1
    return saved


def stats() -> None:
    with catalog.connect() as connection:
        total = connection.execute("SELECT COUNT(*) FROM product_enrichment").fetchone()[0]
        garments = connection.execute(
            "SELECT garment, COUNT(*) n FROM product_enrichment GROUP BY garment ORDER BY n DESC LIMIT 12"
        ).fetchall()
        colours = connection.execute(
            "SELECT COUNT(*) FROM product_enrichment WHERE colour IS NOT NULL"
        ).fetchone()[0]
    print(f"Enriched products: {total} (with a colour: {colours}); still to do: {len(pending())}")
    print("Garments:", ", ".join(f"{row['garment'] or 'unknown'} {row['n']}" for row in garments))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--store", default="")
    parser.add_argument("--max-minutes", type=float, default=0)
    parser.add_argument("--stats", action="store_true")
    args = parser.parse_args()

    if args.stats:
        stats()
        return

    todo = pending(args.store, args.limit)
    log.info("%d products to enrich in batches of %d", len(todo), BATCH_SIZE)
    started, done, failures = time.time(), 0, 0

    with httpx.Client(timeout=httpx.Timeout(180, connect=10)) as client:
        for start in range(0, len(todo), BATCH_SIZE):
            if args.max_minutes and time.time() - started > args.max_minutes * 60:
                log.info("Time limit reached; run again to continue")
                break
            batch = todo[start:start + BATCH_SIZE]
            try:
                done += enrich_batch(client, batch)
                failures = 0
            except (httpx.HTTPError, ValueError) as error:
                failures += 1
                log.warning("Batch failed (%s); %d in a row", type(error).__name__, failures)
                if failures >= MAX_FAILURES_IN_A_ROW:
                    log.error("The model server keeps failing; stopping. Run again later to resume.")
                    break
                time.sleep(10 * failures)
                continue
            if (start // BATCH_SIZE) % 10 == 0:
                rate = done / max(time.time() - started, 1) * 60
                log.info("%d / %d enriched (%.0f per minute)", done, len(todo), rate)

    log.info("Finished: %d enriched in %.1f minutes", done, (time.time() - started) / 60)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
