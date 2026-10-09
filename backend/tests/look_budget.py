"""Checks POST /api/products look_budget against the running backend."""
import itertools
import json
import sys
import urllib.request

LOOK = {
    "top": "white linen shirt men",
    "bottom": "navy chinos men",
    "footwear": "brown leather loafers men",
    "accessories": "leather strap watch men",
    "extra": "brown leather belt men",
}


def ask(body: dict) -> dict:
    request = urllib.request.Request(
        "http://127.0.0.1:8000/api/products",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def queries(looks: int) -> list[dict]:
    return [{"id": f"look-{n}-{piece}", "query": query} for n in range(looks) for piece, query in LOOK.items()]


failures = 0
for budget in (1500, 2500, 4000, 8000):
    data = ask({"queries": queries(2), "region": "IN", "department": "men", "look_budget": budget, "personalize": False})
    for n in range(2):
        options = [
            [product["price"] for product in data["results"][f"look-{n}-{piece}"]["products"]] for piece in LOOK
        ]
        filled = [prices for prices in options if prices]
        first = sum(prices[0] for prices in filled)
        worst = max((sum(combo) for combo in itertools.product(*filled)), default=0)
        ok = worst <= budget
        failures += not ok
        print(f"budget {budget:>5} look {n}: {len(filled)}/{len(LOOK)} pieces, first picks {first:>7.0f}, "
              f"dearest combination {worst:>7.0f} {'OK' if ok else 'OVER BUDGET'}")

# Without look_budget the old per-product behaviour is unchanged
old = ask({"queries": queries(1), "region": "IN", "department": "men", "max_price": 4000, "personalize": False})
prices = [p["price"] for found in old["results"].values() for p in found["products"]]
print(f"no look_budget, max_price 4000: {len(prices)} products, dearest {max(prices):.0f}, "
      f"first-pick total {sum(found['products'][0]['price'] for found in old['results'].values() if found['products']):.0f}")
failures += max(prices) > 4000

# Item suggestions are never treated as a look
items = ask({"queries": [{"id": "item-0", "query": "white linen shirt men"}], "region": "IN",
             "department": "men", "look_budget": 500, "personalize": False})
print("item-0 with look_budget 500 (ignored):", len(items["results"]["item-0"]["products"]), "products")

sys.exit(1 if failures else 0)
