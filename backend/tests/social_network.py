"""Checks the social style network against the running backend, with two
throwaway accounts (removed at the end):

  A publishes an outfit -> B discovers A -> follows -> opens the outfit
  -> saves it -> Get This Look -> Adapt This Look -> real, validated products

and the refusals: no sign-in, self-follow, duplicate follow and save,
private outfits, products not in the catalogue, a sold-out product.

  cd backend && venv\\Scripts\\python tests\\social_network.py
  ... --skip-adapt     leaves out the step that needs Gemma
"""
import http.cookiejar
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import catalog  # noqa: E402

API = "http://127.0.0.1:8000"
results = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{' - ' + detail if detail else ''}")
    return bool(ok)


class Person:
    """One browser: keeps its own session cookie."""

    def __init__(self):
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.id = None

    def call(self, method: str, path: str, body=None, timeout: int = 60):
        request = urllib.request.Request(
            f"{API}{path}", method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json"},
        )
        try:
            with self.opener.open(request, timeout=timeout) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read() or b"{}")

    def register(self, name: str):
        status, data = self.call("POST", "/api/auth/register", {
            "email": f"social-test-{name.lower()}-{time.time_ns()}@example.com",
            "password": "test-password-123", "name": name, "consent": True,
        })
        self.id = data["user"]["id"]
        self.email = data["user"]["email"]
        return status


def product_ids(question: str) -> list[str]:
    _, data = Person().call("POST", "/api/browse", {"question": question, "region": "IN", "personalize": False, "colour": "all"})
    return [product["id"] for product in data.get("products", [])]


guest, a, b = Person(), Person(), Person()
shirt, jeans, shoes = product_ids("t-shirt men")[0], product_ids("jeans men")[0], product_ids("sneakers men")[0]
real = [shirt, jeans, shoes]
outfit_body = {"title": "Weekend basics", "description": "Easy and clean", "tags": ["casual", "Weekend"],
               "items": [{"product_id": product_id} for product_id in real]}

try:
    # ---- No sign-in
    check("Follow needs sign-in", guest.call("POST", "/api/social/users/anyone/follow")[0] == 401)
    check("Publishing needs sign-in", guest.call("POST", "/api/social/outfits", outfit_body)[0] == 401)
    check("Saving needs sign-in", guest.call("POST", "/api/social/outfits/anything/save")[0] == 401)
    check("Adapting needs sign-in", guest.call("POST", "/api/social/outfits/anything/adapt", {"request": "make it cheaper"})[0] == 401)

    # ---- A publishes
    a.register("Asha")
    b.register("Bala")
    status, data = a.call("POST", "/api/social/outfits", outfit_body)
    public = data.get("outfit", {})
    check("A publishes an outfit of real products", status == 200 and [i["product_id"] for i in public["items"]] == real,
          f"{public.get('id')} categories {[i['category'] for i in public.get('items', [])]}")
    check("Each item carries the catalogue's own product", all(i["product"] and i["product"]["id"] == i["product_id"] and i["product"]["price"] > 0 for i in public["items"]))
    status, data = a.call("POST", "/api/social/outfits", {**outfit_body, "title": "Just for me", "visibility": "private"})
    private = data["outfit"]
    check("A keeps a private outfit", status == 200 and private["visibility"] == "private")

    status, data = a.call("POST", "/api/social/outfits", {**outfit_body, "items": [{"product_id": shirt}, {"product_id": "not-a-real-product"}]})
    check("A product that isn't in the catalogue is refused", status == 400, data.get("detail", ""))
    status, _ = a.call("POST", "/api/social/outfits", {**outfit_body, "items": [{"product_id": shirt}, {"product_id": shirt}]})
    check("The same product twice is not an outfit", status == 400)

    # ---- B discovers and follows A
    _, found = b.call("GET", "/api/social/discover")
    check("B discovers A's public outfit", any(o["id"] == public["id"] for o in found["recent"]))
    check("B discovers A as someone to follow", any(u["id"] == a.id for u in found["users"]))
    check("A's private outfit is not in discover", all(o["id"] != private["id"] for o in found["recent"]))
    _, seen_by_guest = guest.call("GET", "/api/social/discover")
    check("Discover works without sign-in", any(o["id"] == public["id"] for o in seen_by_guest["recent"]))

    status, data = b.call("POST", f"/api/social/users/{a.id}/follow")
    check("B follows A", status == 200 and data["is_following"] and data["followers"] == 1)
    status, data = b.call("POST", f"/api/social/users/{a.id}/follow")
    check("Following twice changes nothing", status == 200 and data["already_following"] and data["followers"] == 1)
    status, data = b.call("POST", f"/api/social/users/{b.id}/follow")
    check("Following yourself is refused", status == 400, data.get("detail", ""))
    check("Following someone who doesn't exist is refused", b.call("POST", "/api/social/users/nobody/follow")[0] == 404)

    _, data = guest.call("GET", f"/api/social/users/{a.id}/followers")
    check("A's followers: B", [u["id"] for u in data["users"]] == [b.id])
    _, data = guest.call("GET", f"/api/social/users/{b.id}/following")
    check("B's following: A", [u["id"] for u in data["users"]] == [a.id])
    _, found = b.call("GET", "/api/social/discover")
    check("A's outfit is in B's following feed", any(o["id"] == public["id"] for o in found["following"]))

    # ---- Public profile and privacy
    status, profile = b.call("GET", f"/api/social/users/{a.id}")
    check("A's public profile", status == 200 and profile["is_following"] and profile["followers"] == 1 and not profile["is_me"])
    check("The profile shows public outfits only", [o["id"] for o in profile["outfits"]] == [public["id"]])
    text = json.dumps([profile, found, seen_by_guest])
    check("No email or private data in what others see", a.email not in text and a.email.split("@")[0] not in text
          and not any(word in text for word in ("measurements", "wardrobe", "password", "taste")))
    check("B can't open A's private outfit", b.call("GET", f"/api/social/outfits/{private['id']}")[0] == 404)
    check("A guest can't open A's private outfit", guest.call("GET", f"/api/social/outfits/{private['id']}")[0] == 404)
    check("A can open their own private outfit", a.call("GET", f"/api/social/outfits/{private['id']}")[0] == 200)
    check("B can't change A's outfit", b.call("PATCH", f"/api/social/outfits/{public['id']}", {"visibility": "private"})[0] == 404)
    check("B can't delete A's outfit", b.call("DELETE", f"/api/social/outfits/{public['id']}")[0] == 404)

    # ---- B opens and saves the outfit
    status, data = b.call("GET", f"/api/social/outfits/{public['id']}")
    check("B opens the outfit", status == 200 and data["outfit"]["owner"]["id"] == a.id and not data["outfit"]["is_mine"])
    status, data = b.call("POST", f"/api/social/outfits/{public['id']}/save")
    check("B saves the outfit", status == 200 and data["saved"] and not data["already_saved"])
    status, data = b.call("POST", f"/api/social/outfits/{public['id']}/save")
    check("Saving twice changes nothing", status == 200 and data["already_saved"])
    _, mine = b.call("GET", "/api/social/me")
    check("It is in B's saved outfits, once", [o["id"] for o in mine["saved"]] == [public["id"]])
    check("B can't save A's private outfit", b.call("POST", f"/api/social/outfits/{private['id']}/save")[0] == 404)
    check("A can't save their own outfit", a.call("POST", f"/api/social/outfits/{public['id']}/save")[0] == 400)

    # ---- Get This Look
    status, look = b.call("GET", f"/api/social/outfits/{public['id']}/look?region=IN")
    check("Get This Look: every piece is the real product, in stock",
          status == 200 and [p["product"]["id"] for p in look["pieces"]] == real and all(p["available"] for p in look["pieces"]),
          f"total {look.get('total_price')}")

    # One product sells out (changed in the catalogue itself, put back after)
    with sqlite3.connect(catalog.DB_PATH) as connection:
        connection.execute("UPDATE products SET available = 0 WHERE id = ?", (shoes,))
    try:
        _, look = b.call("GET", f"/api/social/outfits/{public['id']}/look?region=IN")
        sold_out = next(p for p in look["pieces"] if p["product_id"] == shoes)
        others = catalog.products_by_id([p["id"] for p in sold_out["alternatives"]])
        check("A sold-out product is marked and comes with real alternatives",
              not sold_out["available"] and len(sold_out["alternatives"]) > 0 and len(others) == len(sold_out["alternatives"])
              and shoes not in others, ", ".join(p["title"][:30] for p in sold_out["alternatives"]))
    finally:
        with sqlite3.connect(catalog.DB_PATH) as connection:
            connection.execute("UPDATE products SET available = 1 WHERE id = ?", (shoes,))

    # ---- Adapt This Look (Gemma)
    if "--skip-adapt" in sys.argv:
        print("SKIP  Adapt This Look (--skip-adapt)")
    else:
        status, adapted = b.call("POST", f"/api/social/outfits/{public['id']}/adapt", {"request": "Make it cheaper", "region": "IN"}, timeout=240)
        if check("Adapt This Look answers", status == 200, f"HTTP {status} {adapted.get('detail', '')}"):
            new = adapted["outfit"]
            new_ids = [i["product_id"] for i in new["items"]]
            in_catalogue = catalog.products_by_id(new_ids)
            check("Every product of the new outfit is a real, in-stock catalogue product", len(in_catalogue) == len(new_ids),
                  " | ".join(i["product"]["title"][:28] for i in new["items"]))
            check("The new outfit is different, B's own, and private", new_ids != real and new["is_mine"] and new["visibility"] == "private")
            check("It is marked as inspired by the original",
                  adapted["source_outfit_id"] == public["id"] and adapted["derived_outfit_id"] == new["id"]
                  and new["inspired_by"]["id"] == public["id"] and new["inspired_by"]["owner"]["id"] == a.id)
            old_total = sum(catalog.products_by_id(real)[i]["price"] for i in real)
            check("\"Make it cheaper\" costs less", new["total_price"] < old_total, f"{old_total:.0f} -> {new['total_price']}")
            _, again = a.call("GET", f"/api/social/outfits/{public['id']}")
            check("The original outfit is unchanged", [i["product_id"] for i in again["outfit"]["items"]] == real)
            check("A can't see B's adapted outfit", a.call("GET", f"/api/social/outfits/{new['id']}")[0] == 404)

    # ---- Unfollow, unsave, make private
    status, data = b.call("DELETE", f"/api/social/users/{a.id}/follow")
    check("B unfollows A", status == 200 and data["followers"] == 0)
    a.call("PATCH", f"/api/social/outfits/{public['id']}", {"visibility": "private"})
    check("Made private: B can no longer open it", b.call("GET", f"/api/social/outfits/{public['id']}")[0] == 404)
    _, mine = b.call("GET", "/api/social/me")
    check("...and it leaves B's saved outfits", mine["saved"] == [])
finally:
    for person in (a, b):
        if person.id:
            person.call("DELETE", "/api/account")

if a.id:
    with sqlite3.connect(Path(catalog.DB_PATH).parent / "users.db") as connection:
        try:
            left = connection.execute(
                "SELECT (SELECT COUNT(*) FROM outfits WHERE owner_user_id IN (?, ?)) + (SELECT COUNT(*) FROM follows WHERE follower_id IN (?, ?))",
                (a.id, b.id, a.id, b.id),
            ).fetchone()[0]
            check("Deleting the accounts leaves no outfits or follows behind", left == 0)
        except sqlite3.OperationalError as error:
            print(f"SKIP  leftover check ({error})")

print(f"\n{sum(results)}/{len(results)} checks passed.")
sys.exit(0 if all(results) else 1)
