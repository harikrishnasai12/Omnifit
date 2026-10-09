"""
Demo shoppers for the Brand insights page.

OmniFit only shows a number when several different people are behind it, so
a fresh install has nothing to show. This adds made-up shoppers who browse the
Home feed the way real ones do (through the same Intent Engine code), so the
page can be demonstrated. They are clearly marked: every one has an
"@omnifit.demo" email, can't sign in (no password), and the page says how
many of the shoppers it counts are demo ones.

Usage (from the backend folder, with the venv active):
    python seed_demo.py              # add 12 demo shoppers
    python seed_demo.py --shoppers 30
    python seed_demo.py --clear      # remove every demo shopper and their data
"""

import argparse
import random
import sys
import time
import uuid

import accounts
import intent
import lookpool
from insights import DEMO_EMAIL_DOMAIN

LOOKS_PER_SHOPPER = 30

# (section, styles they lean towards)
PERSONAS = [
    ("men", ["streetwear", "casual"]),
    ("men", ["smart-casual", "classic"]),
    ("men", ["ethnic", "festive"]),
    ("women", ["ethnic", "festive"]),
    ("women", ["casual", "minimal"]),
    ("women", ["party", "smart-casual"]),
]


def demo_user_ids() -> list[str]:
    with accounts.connect() as connection:
        return [row["id"] for row in connection.execute(
            "SELECT id FROM users WHERE email LIKE ?", (f"%{DEMO_EMAIL_DOMAIN}",)
        )]


def clear() -> int:
    ids = demo_user_ids()
    for user_id in ids:
        # Their signals, taste and shown looks go with them (ON DELETE CASCADE)
        accounts.delete_user(user_id)
    return len(ids)


def browse(rng: random.Random, user_id: str, section: str, styles: list[str]) -> int:
    """One shopper scrolling the feed: lingers on, loves and shops looks in
    their styles more often than the rest."""
    pool = lookpool.pool(section)
    if not pool:
        return 0

    signals = []
    for look in rng.sample(pool, min(LOOKS_PER_SHOPPER, len(pool))):
        match = bool(set(look["styles"]) & set(styles))
        signals.append({"kind": "view", "look_id": look["id"]})

        if rng.random() < (0.75 if match else 0.2):
            signals.append({"kind": "dwell", "look_id": look["id"], "value": rng.randint(4000, 15000)})
        else:
            if rng.random() < 0.3:
                signals.append({"kind": "skip", "look_id": look["id"]})
            continue

        product = rng.choice(look["pieces"])["product"]
        if rng.random() < (0.5 if match else 0.1):
            signals.append({"kind": rng.choice(["love", "save"]), "look_id": look["id"],
                            "product_id": product["id"], "extra": {"price": product["price"]}})
        if rng.random() < (0.4 if match else 0.08):
            signals.append({"kind": "product_tap", "look_id": look["id"], "product_id": product["id"]})
            if rng.random() < 0.35:
                signals.append({"kind": "cart", "look_id": look["id"], "product_id": product["id"],
                                "extra": {"price": product["price"]}})

    looks = lookpool.get_looks(list({signal["look_id"] for signal in signals}))
    return intent.record_signals(user_id, signals, looks)


def seed(count: int) -> tuple[int, int]:
    rng = random.Random(2026)
    existing = len(demo_user_ids())
    total = 0

    for number in range(existing + 1, existing + count + 1):
        user_id = uuid.uuid4().hex
        with accounts.connect() as connection:
            connection.execute(
                "INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)",
                (user_id, f"shopper-{number:03d}{DEMO_EMAIL_DOMAIN}", f"Demo shopper {number}", time.time()),
            )
        section, styles = PERSONAS[number % len(PERSONAS)]
        total += browse(rng, user_id, section, styles)

    return count, total


def main() -> int:
    parser = argparse.ArgumentParser(description="Add or remove OmniFit demo shoppers.")
    parser.add_argument("--shoppers", type=int, default=12)
    parser.add_argument("--clear", action="store_true", help="remove every demo shopper and their data")
    args = parser.parse_args()

    if args.clear:
        print(f"Removed {clear()} demo shoppers.")
        return 0

    if not lookpool.pool():
        print("The look pool is empty. Run build_looks.py first.")
        return 1

    shoppers, signals = seed(args.shoppers)
    print(f"Added {shoppers} demo shoppers ({signals} feed signals). Remove them with: python seed_demo.py --clear")
    return 0


if __name__ == "__main__":
    sys.exit(main())
