"""
End-to-end product-match check: real questions -> Gemma -> product search.

Asks the running backend real styling questions (and optional outfit photos),
collects every search phrase Gemma produces, fetches the products shown to
users (/api/products) and checks each one with the strict rules from
match_quality.py.

Needs the backend running (uvicorn on 127.0.0.1:8000). Takes a few minutes.

Usage (from backend/, with the venv active):
    python tests/pipeline_quality.py [photo.jpg ...]
"""

import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from match_quality import check_product, product_row  # noqa: E402

BASE = "http://127.0.0.1:8000"

QUESTIONS = [
    ("Give me 3 casual shirt suggestions for a college student", "men"),
    ("What should I wear to a friend's wedding?", "men"),
    ("Suggest a festive outfit for Diwali", "women"),
    ("Give me 3 shoe options for office wear", "men"),
    ("I need an outfit for a first date", "women"),
    ("Give me 2 complete streetwear outfits", "auto"),
    ("Suggest 3 jeans styles that are trending", "women"),
    ("What accessories go with a black dress?", "women"),
    ("Give me a smart casual outfit for a job interview", "men"),
    ("Suggest a comfortable airport outfit", "auto"),
]


def queries_from(answer: dict) -> list[str]:
    queries = []
    for recommendation in answer.get("recommendations", []):
        if recommendation.get("search_query"):
            queries.append(recommendation["search_query"])
        queries.extend((recommendation.get("shop_queries") or {}).values())
    return queries


def main() -> int:
    client = httpx.Client(base_url=BASE, timeout=240)
    asks = [(question, department, None) for question, department in QUESTIONS]
    asks += [("What can I wear with this?", "auto", Path(photo)) for photo in sys.argv[1:]]

    total = wrong = empty = 0

    for question, department, photo in asks:
        files = {"image": (photo.name, photo.read_bytes(), "image/jpeg")} if photo else None
        response = client.post("/api/fashion/analyze", data={"question": question, "department": department}, files=files)

        if response.status_code != 200:
            print(f"ERROR {question!r}: HTTP {response.status_code} {response.text[:120]}")
            continue

        answer = response.json()
        section = answer["profile"]["department"]
        section = section if section != "unknown" else "any"
        queries = queries_from(answer)

        if not queries:
            print(f"\n=== {question!r}: no product searches in this answer")
            continue

        products = client.post("/api/products", json={
            "queries": [{"id": str(index), "query": query} for index, query in enumerate(queries)],
            "region": "IN",
            "department": section,
        }).json()["results"]

        print(f"\n=== {question!r}{' + ' + photo.name if photo else ''} (section: {section})")

        for index, query in enumerate(queries):
            found = products.get(str(index), {}).get("products", [])
            total += len(found)
            empty += not found
            print(f"  {query!r}: {len(found)} product(s)")

            for product in found:
                row = product_row(product["id"])
                faults = check_product(query, section, row, product.get("closest_match_without") or ())
                wrong += bool(faults)
                mark = "✗" if faults else "✓"
                print(f"    {mark} {product['store']}: {row['title'][:70]}")
                for fault in faults:
                    print(f"        {fault}")

    precision = 100 * (total - wrong) / total if total else 0
    print(f"\n{total} products shown, {wrong} wrong ({precision:.1f}% correct), {empty} search(es) with no products")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
