"""
Shopping regions and the stores OmniFit links to in each one.

Each store has a `url_template` for its own public search page:
  {q}    -> URL-encoded search phrase for query strings ("light+grey+oxford+shirt")
  {slug} -> hyphenated search phrase ("light-grey-oxford-shirt")

Check a new store's format in a real browser: search on the site and copy the
address it lands on.

These are public store addresses, not secrets. To add a store or region,
add an entry here; the frontend picks it up from GET /api/regions.
"""

DEFAULT_REGION = "GLOBAL"

REGIONS = {
    "IN": {
        "name": "India",
        "currency": "INR",
        # Partner-brand product cards come from the local catalog (catalog_stores.py)
        "catalog": True,
        "timezones": ["Asia/Kolkata", "Asia/Calcutta"],
        "stores": [
            {"name": "Myntra", "url_template": "https://www.myntra.com/{slug}?rawQuery={q}"},
            {"name": "Meesho", "url_template": "https://www.meesho.com/search?q={q}"},
            {"name": "Ajio", "url_template": "https://www.ajio.com/search/?text={q}"},
            {"name": "Amazon", "url_template": "https://www.amazon.in/s?k={q}"},
            {"name": "Flipkart", "url_template": "https://www.flipkart.com/search?q={q}"},
            {"name": "Nykaa Fashion", "url_template": "https://www.nykaafashion.com/catalogsearch/result/?q={q}"},
            {"name": "Tata CLiQ", "url_template": "https://www.tatacliq.com/search/?searchCategory=all&text={q}"},
            {"name": "Bewakoof", "url_template": "https://www.bewakoof.com/search?q={q}"},
            {"name": "Google Shopping", "url_template": "https://www.google.com/search?tbm=shop&gl=in&q={q}"},
        ],
    },
    "US": {
        "name": "United States",
        "currency": "USD",
        "timezones": [
            "America/New_York", "America/Chicago", "America/Denver",
            "America/Phoenix", "America/Los_Angeles", "America/Anchorage",
            "America/Detroit", "Pacific/Honolulu",
        ],
        "stores": [
            {"name": "Amazon", "url_template": "https://www.amazon.com/s?k={q}"},
            {"name": "Nordstrom", "url_template": "https://www.nordstrom.com/sr?keyword={q}"},
            {"name": "Target", "url_template": "https://www.target.com/s?searchTerm={q}"},
            {"name": "Google Shopping", "url_template": "https://www.google.com/search?tbm=shop&gl=us&q={q}"},
        ],
    },
    "GB": {
        "name": "United Kingdom",
        "currency": "GBP",
        "timezones": ["Europe/London"],
        "stores": [
            {"name": "Amazon", "url_template": "https://www.amazon.co.uk/s?k={q}"},
            {"name": "ASOS", "url_template": "https://www.asos.com/search/?q={q}"},
            {"name": "John Lewis", "url_template": "https://www.johnlewis.com/search?search-term={q}"},
            {"name": "Google Shopping", "url_template": "https://www.google.com/search?tbm=shop&gl=uk&q={q}"},
        ],
    },
    "CA": {
        "name": "Canada",
        "currency": "CAD",
        "timezones": [
            "America/Toronto", "America/Vancouver", "America/Edmonton",
            "America/Winnipeg", "America/Halifax", "America/St_Johns",
            "America/Regina",
        ],
        "stores": [
            {"name": "Amazon", "url_template": "https://www.amazon.ca/s?k={q}"},
            {"name": "Walmart", "url_template": "https://www.walmart.ca/en/search?q={q}"},
            {"name": "Google Shopping", "url_template": "https://www.google.com/search?tbm=shop&gl=ca&q={q}"},
        ],
    },
    "AU": {
        "name": "Australia",
        "currency": "AUD",
        "timezones": [
            "Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane",
            "Australia/Perth", "Australia/Adelaide", "Australia/Hobart",
            "Australia/Darwin",
        ],
        "stores": [
            {"name": "Amazon", "url_template": "https://www.amazon.com.au/s?k={q}"},
            {"name": "THE ICONIC", "url_template": "https://www.theiconic.com.au/catalog/?q={q}"},
            {"name": "ASOS", "url_template": "https://www.asos.com/au/search/?q={q}"},
            {"name": "Google Shopping", "url_template": "https://www.google.com/search?tbm=shop&gl=au&q={q}"},
        ],
    },
    "AE": {
        "name": "United Arab Emirates",
        "currency": "AED",
        "timezones": ["Asia/Dubai"],
        "stores": [
            {"name": "Amazon", "url_template": "https://www.amazon.ae/s?k={q}"},
            {"name": "Noon", "url_template": "https://www.noon.com/uae-en/search/?q={q}"},
            {"name": "Google Shopping", "url_template": "https://www.google.com/search?tbm=shop&gl=ae&q={q}"},
        ],
    },
    "DE": {
        "name": "Germany",
        "currency": "EUR",
        "timezones": ["Europe/Berlin"],
        "stores": [
            {"name": "Amazon", "url_template": "https://www.amazon.de/s?k={q}"},
            {"name": "Zalando", "url_template": "https://www.zalando.de/katalog/?q={q}"},
            {"name": "Google Shopping", "url_template": "https://www.google.com/search?tbm=shop&gl=de&q={q}"},
        ],
    },
    "GLOBAL": {
        "name": "Other countries",
        "currency": "USD",
        "timezones": [],
        "stores": [
            {"name": "Amazon", "url_template": "https://www.amazon.com/s?k={q}"},
            {"name": "ASOS", "url_template": "https://www.asos.com/search/?q={q}"},
            {"name": "Google Shopping", "url_template": "https://www.google.com/search?tbm=shop&q={q}"},
        ],
    },
}


def resolve_region(country_code: str) -> str:
    code = (country_code or "").strip().upper()

    # ISO code for the UK is GB; Nominatim returns "gb"
    if code == "UK":
        code = "GB"

    return code if code in REGIONS else DEFAULT_REGION
