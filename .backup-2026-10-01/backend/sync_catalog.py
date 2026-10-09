"""
Refresh OmniFit's local product catalog from partner stores' public
Shopify catalogs.

Usage (from the backend folder, with the venv active):
    python sync_catalog.py                  # sync every store in catalog_stores.py
    python sync_catalog.py --store libas    # sync one store
    python sync_catalog.py --verify www.example.com www.other.in
                                            # check whether new stores can be added
    python sync_catalog.py --relabel        # recompute men/women sections, no downloads

Run it about once a day (Windows Task Scheduler or cron). It is deliberately
slow: one request at a time with a pause between requests, it identifies
itself, and it honours each store's robots.txt.
"""

import argparse
import logging
import os
import sys
import time
from pathlib import Path
from typing import Optional
from urllib.robotparser import RobotFileParser

import httpx
from dotenv import load_dotenv

from catalog import (
    normalize_shopify_product,
    relabel_departments,
    remove_store_products,
    replace_store_products,
)
from catalog_stores import CATALOG_STORES
from regions import REGIONS

load_dotenv(Path(__file__).with_name(".env"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger("omnifit.sync")

USER_AGENT = os.getenv("CATALOG_USER_AGENT", "OmniFitLiveCatalog/1.0")
REQUEST_DELAY_SECONDS = float(os.getenv("CATALOG_REQUEST_DELAY_SECONDS", "2"))
MAX_PAGES_PER_STORE = int(os.getenv("CATALOG_MAX_PAGES_PER_STORE", "40"))
PAGE_SIZE = 250


class StoreUnavailable(Exception):
    pass


def robots_allows(client: httpx.Client, domain: str, path: str) -> bool:
    try:
        response = client.get(f"https://{domain}/robots.txt")
    except httpx.HTTPError:
        return True  # No robots.txt reachable: nothing forbids it

    if response.status_code != 200:
        return True

    parser = RobotFileParser()
    parser.parse(response.text.splitlines())
    return parser.can_fetch(USER_AGENT, f"https://{domain}{path}")


def fetch_page(client: httpx.Client, domain: str, page: int, limit: int = PAGE_SIZE) -> list[dict]:
    try:
        response = client.get(
            f"https://{domain}/products.json",
            params={"limit": limit, "page": page}
        )
    except httpx.HTTPError as error:
        raise StoreUnavailable(type(error).__name__)

    if response.status_code != 200:
        raise StoreUnavailable(f"HTTP {response.status_code}")

    try:
        products = response.json().get("products")
    except ValueError:
        raise StoreUnavailable("not a Shopify catalog")

    if not isinstance(products, list):
        raise StoreUnavailable("not a Shopify catalog")

    return products


class CurrencyMismatch(StoreUnavailable):
    pass


def store_currency(client: httpx.Client, domain: str) -> Optional[str]:
    # Shopify publishes the catalog's base currency at /meta.json
    try:
        response = client.get(f"https://{domain}/meta.json")
        return response.json().get("currency") if response.status_code == 200 else None
    except (httpx.HTTPError, ValueError):
        return None


def check_currency(client: httpx.Client, domain: str, region: str) -> str:
    expected = REGIONS.get(region, {}).get("currency")
    currency = store_currency(client, domain)

    # Prices are shown as-is, so a store priced in another currency
    # (e.g. USD in the India region) would show wrong prices
    if expected and currency and currency != expected:
        raise CurrencyMismatch(f"priced in {currency}, region {region} uses {expected}")

    return currency or "unknown"


def sync_store(client: httpx.Client, store: dict, max_pages: int) -> int:
    if not robots_allows(client, store["domain"], "/products.json"):
        raise StoreUnavailable("robots.txt disallows the catalog")

    check_currency(client, store["domain"], store["region"])

    normalized = []

    for page in range(1, max_pages + 1):
        batch = fetch_page(client, store["domain"], page)

        normalized.extend(
            product
            for product in (normalize_shopify_product(raw, store) for raw in batch)
            if product
        )

        if len(batch) < PAGE_SIZE:
            break

        time.sleep(REQUEST_DELAY_SECONDS)

    if not normalized:
        raise StoreUnavailable("no products found")

    replace_store_products(store, normalized)
    return len(normalized)


def verify_domains(client: httpx.Client, domains: list[str]) -> None:
    for domain in domains:
        domain = domain.replace("https://", "").strip("/")

        try:
            if not robots_allows(client, domain, "/products.json"):
                raise StoreUnavailable("robots.txt disallows the catalog")

            currency = check_currency(client, domain, "IN")
            products = fetch_page(client, domain, 1, limit=5)
            store = {"id": "verify", "name": domain, "domain": domain, "region": "IN"}
            sample = next(
                (p for p in (normalize_shopify_product(raw, store) for raw in products) if p),
                None
            )

            if not sample:
                raise StoreUnavailable("no usable products")

            print(f"OK    {domain:32} {currency} e.g. {sample['title'][:50]} | {sample['price']:.0f}")

        except StoreUnavailable as error:
            print(f"SKIP  {domain:32} {error}")

        time.sleep(REQUEST_DELAY_SECONDS / 2)


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync OmniFit's product catalog.")
    parser.add_argument("--store", help="sync only this store id")
    parser.add_argument("--max-pages", type=int, default=MAX_PAGES_PER_STORE)
    parser.add_argument("--verify", nargs="+", metavar="DOMAIN", help="check candidate store domains")
    parser.add_argument("--relabel", action="store_true", help="recompute men/women sections from stored data (no downloads)")
    args = parser.parse_args()

    if args.relabel:
        for name, counts in relabel_departments(CATALOG_STORES).items():
            logger.info("%-18s %s", name, counts)
        return 0

    with httpx.Client(
        headers={"User-Agent": USER_AGENT},
        timeout=30.0,
        follow_redirects=True
    ) as client:

        if args.verify:
            verify_domains(client, args.verify)
            return 0

        stores = [
            store for store in CATALOG_STORES
            if not args.store or store["id"] == args.store
        ]

        if not stores:
            logger.error("No matching store in catalog_stores.py")
            return 1

        failures = 0

        for store in stores:
            try:
                count = sync_store(client, store, args.max_pages)
                logger.info("%-22s %6d products", store["name"], count)

            except CurrencyMismatch as error:
                failures += 1
                remove_store_products(store["id"])
                logger.warning("%-22s removed (%s)", store["name"], error)

            except StoreUnavailable as error:
                failures += 1
                logger.warning("%-22s skipped (%s); keeping previous data", store["name"], error)

            time.sleep(REQUEST_DELAY_SECONDS)

        logger.info("Done: %d stores synced, %d skipped", len(stores) - failures, failures)
        return 0


if __name__ == "__main__":
    sys.exit(main())
