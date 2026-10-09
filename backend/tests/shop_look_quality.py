"""
"Shop this look" check: save outfit photos to a throwaway account's Style
Library, open "Shop this look" for each, and check every product with the
strict rules from match_quality.py. The test account is deleted afterwards.

Needs the backend running. Usage (from backend/):
    python tests/shop_look_quality.py photo1.jpg [photo2.jpg ...]
"""

import secrets
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from match_quality import check_product, product_row  # noqa: E402


def main() -> int:
    client = httpx.Client(base_url="http://127.0.0.1:8000", timeout=240)
    client.post("/api/auth/register", json={
        "email": f"shoptest-{secrets.token_hex(4)}@example.com",
        "password": secrets.token_urlsafe(12), "consent": True,
    }).raise_for_status()

    total = wrong = mixed_sections = 0

    try:
        for photo in map(Path, sys.argv[1:]):
            saved = client.post("/api/library", files={"image": (photo.name, photo.read_bytes(), "image/jpeg")})
            if saved.status_code != 200:
                print(f"{photo.name}: could not save ({saved.status_code}) {saved.text[:100]}")
                continue

            item = saved.json()["item"]
            shop = client.get(f"/api/library/{item['id']}/shop", params={"region": "IN"}).json()
            section = shop.get("department", "any")
            print(f"\n=== {photo.name}: {item['analysis']['summary']} (section: {section})")

            sections_seen = set()
            for piece in shop["pieces"]:
                print(f"  {piece['piece']!r} -> search {piece['search_query']!r}: {len(piece['products'])} product(s)")
                for product in piece["products"]:
                    row = product_row(product["id"])
                    faults = check_product(piece["search_query"], section, row, product.get("closest_match_without") or ())
                    total += 1
                    wrong += bool(faults)
                    if row["department"] in ("men", "women"):
                        sections_seen.add(row["department"])
                    print(f"    {'✗' if faults else '✓'} {product['store']}: {row['title'][:70]} [{row['department']}]")
                    for fault in faults:
                        print(f"        {fault}")

            if len(sections_seen) > 1:
                mixed_sections += 1
                print("  ✗ SECTION  this look mixes men's and women's products")
    finally:
        client.delete("/api/account")

    print(f"\n{total} products, {wrong} wrong, {mixed_sections} look(s) mixing sections")
    return 1 if wrong or mixed_sections else 0


if __name__ == "__main__":
    sys.exit(main())
