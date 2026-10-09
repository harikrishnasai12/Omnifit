"""
Explain why a search returns what it does (or nothing).

For each phrase: the products returned, then how many catalog candidates
each strict rule rejected, with examples. Helps tell "no such product in the
partner brands" apart from "a rule is too strict".

Usage (from backend/):  python tests/explain_search.py "cream turtleneck sweater" women
"""

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from catalog import (  # noqa: E402
    colour_matches,
    connect,
    details_match,
    garment_matches,
    garment_type,
    is_multi_piece_set,
    search_products,
    section_matches,
)


def explain(query: str, department: str) -> None:
    result = search_products(query, region="IN", department=department)
    print(f"\n=== {query!r} ({department}): {len(result['products'])} product(s)")
    for product in result["products"]:
        note = f"  [closest match, not {'/'.join(product['closest_match_without'])}]" if product.get("closest_match_without") else ""
        print(f"    ✓ {product['store']}: {product['title'][:70]}{note}")

    garment = garment_type(query)
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM products WHERE region = 'IN' AND available = 1 AND department != 'kids'"
        ).fetchall()

    rejected = Counter()
    examples = {}
    passing = 0
    for row in rows:
        if garment and not garment_matches(query, row["title"], row["product_type"]):
            continue  # a different garment: not interesting here
        checks = [
            ("colour", colour_matches(query, row["title"], row["product_type"], row["colors"])),
            ("details", details_match(query, row["title"], row["product_type"])),
            ("set", not is_multi_piece_set(query, row["title"])),
            ("section", section_matches(department, row["department"], row["title"])),
        ]
        failed = [name for name, ok in checks if not ok]
        if not failed:
            passing += 1
        for name in failed:
            rejected[name] += 1
            examples.setdefault(name, []).append(row["title"][:60])

    print(f"  garment '{garment}': candidates passing every rule: {passing}")
    for name, count in rejected.most_common():
        print(f"    rejected by {name:8} {count:5}  e.g. {examples[name][:3]}")


if __name__ == "__main__":
    explain(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "any")
