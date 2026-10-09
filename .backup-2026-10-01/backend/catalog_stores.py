"""
Partner stores whose public Shopify catalogs are copied into OmniFit's
local product index by sync_catalog.py.

Fields:
  id          short unique id
  name        shown on product cards
  domain      store website
  region      shopping region the store serves (see regions.py)
  department  default section when a product doesn't say: "men", "women",
              "unisex", or "" if the store sells both
  styles      style tags used to personalise ranking; must come from
              STYLE_TAGS in app.py

To add a store, check it first:
    python sync_catalog.py --verify www.example.com
Remove any store that asks not to be included.
"""

CATALOG_STORES = [
    # Streetwear and casual
    {"id": "powerlook", "name": "Powerlook", "domain": "www.powerlook.in", "region": "IN", "department": "men", "styles": ["streetwear", "casual", "smart-casual"]},
    {"id": "snitch", "name": "Snitch", "domain": "www.snitch.co.in", "region": "IN", "department": "men", "styles": ["casual", "smart-casual", "streetwear"]},
    {"id": "bonkerscorner", "name": "Bonkers Corner", "domain": "www.bonkerscorner.com", "region": "IN", "department": "unisex", "styles": ["streetwear", "casual"]},
    {"id": "urbanmonkey", "name": "Urban Monkey", "domain": "www.urbanmonkey.com", "region": "IN", "department": "unisex", "styles": ["streetwear"]},
    {"id": "nobero", "name": "Nobero", "domain": "www.nobero.com", "region": "IN", "department": "unisex", "styles": ["streetwear", "casual"]},
    {"id": "jaywalking", "name": "Jaywalking", "domain": "www.jaywalking.in", "region": "IN", "department": "unisex", "styles": ["streetwear", "party"]},
    {"id": "bluorng", "name": "Bluorng", "domain": "www.bluorng.com", "region": "IN", "department": "unisex", "styles": ["streetwear"]},
    {"id": "fugazee", "name": "Fugazee", "domain": "www.fugazee.com", "region": "IN", "department": "unisex", "styles": ["streetwear"]},
    {"id": "veirdo", "name": "Veirdo", "domain": "www.veirdo.in", "region": "IN", "department": "unisex", "styles": ["streetwear", "casual"]},
    {"id": "campussutra", "name": "Campus Sutra", "domain": "www.campussutra.com", "region": "IN", "department": "unisex", "styles": ["casual", "streetwear"]},
    {"id": "dennislingo", "name": "Dennis Lingo", "domain": "www.dennislingo.com", "region": "IN", "department": "men", "styles": ["casual", "smart-casual"]},
    {"id": "spykar", "name": "Spykar", "domain": "www.spykar.com", "region": "IN", "department": "", "styles": ["casual", "streetwear"]},
    {"id": "lovegen", "name": "LoveGen", "domain": "www.lovegen.com", "region": "IN", "department": "", "styles": ["casual"]},

    # Smart casual and formal
    {"id": "rarerabbit", "name": "Rare Rabbit", "domain": "www.thehouseofrare.com", "region": "IN", "department": "men", "styles": ["smart-casual", "classic", "minimal"]},
    {"id": "thebearhouse", "name": "The Bear House", "domain": "www.thebearhouse.com", "region": "IN", "department": "men", "styles": ["smart-casual", "classic", "formal"]},
    {"id": "thepantproject", "name": "The Pant Project", "domain": "www.thepantproject.com", "region": "IN", "department": "men", "styles": ["smart-casual", "formal", "minimal"]},

    # Ethnic and festive
    {"id": "libas", "name": "Libas", "domain": "www.libas.in", "region": "IN", "department": "women", "styles": ["ethnic", "casual", "festive"]},
    {"id": "aachho", "name": "Aachho", "domain": "www.aachho.com", "region": "IN", "department": "women", "styles": ["ethnic", "casual"]},
    {"id": "tistabene", "name": "Tistabene", "domain": "www.tistabene.com", "region": "IN", "department": "women", "styles": ["ethnic", "casual"]},
    {"id": "suta", "name": "Suta", "domain": "www.suta.in", "region": "IN", "department": "women", "styles": ["ethnic", "festive"]},
    {"id": "okhai", "name": "Okhai", "domain": "www.okhai.org", "region": "IN", "department": "women", "styles": ["ethnic"]},
    {"id": "bunaai", "name": "Bunaai", "domain": "www.bunaai.com", "region": "IN", "department": "women", "styles": ["ethnic", "casual"]},
    {"id": "qurvii", "name": "Qurvii", "domain": "www.qurvii.com", "region": "IN", "department": "women", "styles": ["ethnic", "festive"]},
    {"id": "houseofmasaba", "name": "House of Masaba", "domain": "www.houseofmasaba.com", "region": "IN", "department": "women", "styles": ["festive", "ethnic", "party"]},
    {"id": "vastramay", "name": "Vastramay", "domain": "www.vastramay.com", "region": "IN", "department": "men", "styles": ["ethnic", "festive"]},
    {"id": "mydesignation", "name": "MyDesignation", "domain": "www.mydesignation.com", "region": "IN", "department": "", "styles": ["ethnic", "festive"]},

    # Athleisure
    {"id": "blissclub", "name": "BlissClub", "domain": "www.blissclub.com", "region": "IN", "department": "women", "styles": ["athleisure"]},

    # Footwear
    {"id": "neemans", "name": "Neeman's", "domain": "www.neemans.com", "region": "IN", "department": "unisex", "styles": ["casual", "athleisure"]},
    {"id": "baccabucci", "name": "Bacca Bucci", "domain": "www.baccabucci.com", "region": "IN", "department": "men", "styles": ["casual", "streetwear"]},

    # Accessories and jewellery
    {"id": "giva", "name": "GIVA", "domain": "www.giva.co", "region": "IN", "department": "women", "styles": ["classic", "minimal"]},
    {"id": "salty", "name": "Salty", "domain": "www.salty.co.in", "region": "IN", "department": "women", "styles": ["party", "minimal"]},
    {"id": "mokobara", "name": "Mokobara", "domain": "www.mokobara.com", "region": "IN", "department": "unisex", "styles": ["minimal"]},
]
