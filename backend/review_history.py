"""
Review what users asked and how the stylist responded (runs locally only).

Usage (from backend/, venv active):
  python review_history.py stats                      overall numbers
  python review_history.py recent [N]                 the latest N conversations
  python review_history.py search "wedding outfits"   closest in meaning, all users
  python review_history.py search "trousers" --user someone@example.com
  python review_history.py show <id>                  one conversation in full,
                                                      incl. the model's raw output
  python review_history.py failed [N]                 answers the model got wrong
"""

import argparse
import json
import sqlite3
import sys
import time
from collections import Counter

import accounts
import memory


def _emails() -> dict:
    with accounts.connect() as connection:
        return {row["id"]: row["email"] for row in connection.execute("SELECT id, email FROM users")}


def _when(timestamp: float) -> str:
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(timestamp))


def _line(row, emails: dict, distance=None) -> str:
    score = f"  [{distance:.3f}]" if distance is not None else ""
    photo = " 📷" if row["image_file"] else ""
    products = json.loads(row["products_json"]) if row["products_json"] else {}
    shown = sum(len(items) for items in products.values())
    return (
        f"{row['id'][:8]}  {_when(row['created_at'])}  {emails.get(row['user_id'], 'deleted user')}{score}\n"
        f"    {row['kind']:8} {row['question'][:90]!r}{photo}\n"
        + (f"    saw:       {row['seen'][:110]}\n" if row["seen"] else "")
        + (f"    suggested: {row['suggestions'][:110]}\n" if row["suggestions"] else "")
        + f"    {row['latency_ms'] or 0} ms, {row['attempts'] or 1} attempt(s), {shown} product(s) shown"
        + (", personalised" if row["personalized"] else "")
    )


def stats() -> None:
    with memory.connect() as connection:
        rows = connection.execute("SELECT * FROM interactions").fetchall()
    if not rows:
        print("No conversations stored yet.")
        return

    kinds = Counter(row["kind"] for row in rows)
    types = Counter(row["request_type"] for row in rows if row["kind"] == "stylist")
    stylist = [row for row in rows if row["kind"] == "stylist"]
    latencies = sorted(row["latency_ms"] for row in stylist if row["latency_ms"])
    retried = sum(1 for row in stylist if (row["attempts"] or 1) > 1)

    print(f"Conversations: {len(rows)} from {len({row['user_id'] for row in rows})} user(s)")
    print(f"  kinds: {dict(kinds)}")
    print(f"  answer types: {dict(types)}")
    print(f"  with a photo: {sum(1 for row in rows if row['image_file'])}")
    print(f"  personalised: {sum(1 for row in stylist if row['personalized'])}")
    print(f"  needed a retry: {retried}; failed: {kinds.get('failed', 0)}")
    if latencies:
        print(f"  stylist response time: median {latencies[len(latencies) // 2] / 1000:.1f} s, "
              f"slowest {latencies[-1] / 1000:.1f} s")
    no_products = sum(1 for row in stylist if row["products_json"] and not any(
        items for items in json.loads(row["products_json"]).values()))
    print(f"  answers where no product matched: {no_products}")


def recent(count: int, kind: str = None) -> None:
    emails = _emails()
    sql = "SELECT * FROM interactions" + (" WHERE kind = ?" if kind else "") + " ORDER BY created_at DESC LIMIT ?"
    with memory.connect() as connection:
        rows = connection.execute(sql, ((kind, count) if kind else (count,))).fetchall()
    for row in rows:
        print(_line(row, emails))
        if kind == "failed" and row["raw_response"]:
            print(f"    raw: {row['raw_response'][:300]!r}")
        print()


def search(text: str, email: str = None, count: int = 10) -> None:
    emails = _emails()
    user_id = None
    if email:
        user_id = next((uid for uid, mail in emails.items() if mail == email.strip().lower()), None)
        if not user_id:
            sys.exit(f"No user with email {email}")

    for row in memory.search(text, user_id=user_id, limit=count):
        print(_line(row, emails, row["distance"]))
        print()


def show(prefix: str) -> None:
    emails = _emails()
    with memory.connect() as connection:
        rows = connection.execute("SELECT * FROM interactions WHERE id LIKE ?", (prefix + "%",)).fetchall()
    if len(rows) != 1:
        sys.exit("No match" if not rows else "Several matches: use more of the id")

    row = rows[0]
    print(_line(row, emails))
    if row["image_file"]:
        print(f"\nPhoto: {accounts.UPLOADS_DIR / row['user_id'] / row['image_file']}")
    if row["recalled_ids"] and json.loads(row["recalled_ids"]):
        print(f"\nRecalled past conversations: {json.loads(row['recalled_ids'])}")
    print("\n--- Model's raw output ---")
    try:
        print(json.dumps(json.loads(row["raw_response"]), indent=2)[:6000])
    except (TypeError, ValueError):
        print(row["raw_response"] or "(none)")
    print("\n--- Products shown ---")
    for key, items in (json.loads(row["products_json"]) if row["products_json"] else {}).items():
        print(f"  {key}:")
        for item in items:
            note = f"  (closest match, not {'/'.join(item['closest_match_without'])})" if item.get("closest_match_without") else ""
            print(f"    {item['store']}: {item['title'][:70]}  {item['price']}{note}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("stats")
    p = sub.add_parser("recent"); p.add_argument("count", nargs="?", type=int, default=10)
    p = sub.add_parser("failed"); p.add_argument("count", nargs="?", type=int, default=10)
    p = sub.add_parser("search"); p.add_argument("text"); p.add_argument("--user"); p.add_argument("--limit", type=int, default=10)
    p = sub.add_parser("show"); p.add_argument("id")
    args = parser.parse_args()

    try:
        if args.command == "stats":
            stats()
        elif args.command == "recent":
            recent(args.count)
        elif args.command == "failed":
            recent(args.count, kind="failed")
        elif args.command == "search":
            search(args.text, args.user, args.limit)
        elif args.command == "show":
            show(args.id)
    except sqlite3.OperationalError as error:
        sys.exit(f"History database not ready: {error}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
