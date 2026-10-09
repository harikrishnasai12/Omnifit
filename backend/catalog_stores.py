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

    {"id": "peachmode", "name": "Peachmode", "domain": "www.peachmode.com", "region": "IN", "department": "women", "styles": ["ethnic", "festive"]},
    {"id": "janasya", "name": "Janasya", "domain": "www.janasya.com", "region": "IN", "department": "women", "styles": ["ethnic", "casual"]},
    {"id": "juniper", "name": "Juniper", "domain": "www.juniperfashion.com", "region": "IN", "department": "women", "styles": ["ethnic", "festive"]},
    {"id": "wforwoman", "name": "W for Woman", "domain": "www.wforwoman.com", "region": "IN", "department": "women", "styles": ["ethnic", "casual"]},
    {"id": "lashkaraa", "name": "Lashkaraa", "domain": "www.lashkaraa.in", "region": "IN", "department": "", "styles": ["festive", "ethnic", "party"]},
    {"id": "tjori", "name": "Tjori", "domain": "www.tjori.com", "region": "IN", "department": "women", "styles": ["ethnic", "casual"]},
    {"id": "ethnicplus", "name": "Ethnic Plus", "domain": "www.ethnicplus.in", "region": "IN", "department": "women", "styles": ["festive", "ethnic"]},
    {"id": "rustorange", "name": "Rustorange", "domain": "www.rustorange.com", "region": "IN", "department": "women", "styles": ["ethnic", "casual"]},
    {"id": "pinklay", "name": "Pinklay", "domain": "www.pinklay.com", "region": "IN", "department": "women", "styles": ["ethnic", "casual"]},
    {"id": "houseofchikankari", "name": "House of Chikankari", "domain": "www.houseofchikankari.in", "region": "IN", "department": "women", "styles": ["ethnic", "festive"]},

    # South Indian silks, sarees, veshtis and dhotis
    {"id": "ramraj", "name": "Ramraj Cotton", "domain": "www.ramrajcotton.in", "region": "IN", "department": "", "styles": ["ethnic", "festive", "classic"]},
    {"id": "mcr", "name": "MCR", "domain": "www.mcrshopping.com", "region": "IN", "department": "men", "styles": ["ethnic", "festive", "formal"]},
    {"id": "uathayam", "name": "Uathayam", "domain": "www.uathayam.in", "region": "IN", "department": "men", "styles": ["ethnic", "formal", "classic"]},
    {"id": "pothys", "name": "Pothys", "domain": "www.pothys.com", "region": "IN", "department": "", "styles": ["ethnic", "festive"]},
    {"id": "nalli", "name": "Nalli", "domain": "www.nalli.com", "region": "IN", "department": "women", "styles": ["ethnic", "festive", "classic"]},
    {"id": "kankatala", "name": "Kankatala", "domain": "www.kankatala.com", "region": "IN", "department": "women", "styles": ["ethnic", "festive"]},
    {"id": "sundarisilks", "name": "Sundari Silks", "domain": "www.sundarisilks.com", "region": "IN", "department": "women", "styles": ["ethnic", "festive"]},
    {"id": "kalyansilks", "name": "Kalyan Silks", "domain": "www.kalyansilks.com", "region": "IN", "department": "", "styles": ["ethnic", "festive"]},
    {"id": "rmkv", "name": "RmKV", "domain": "www.rmkv.com", "region": "IN", "department": "women", "styles": ["ethnic", "festive", "classic"]},

    # Western wear
    {"id": "thelabellife", "name": "The Label Life", "domain": "www.thelabellife.com", "region": "IN", "department": "women", "styles": ["smart-casual", "minimal", "party"]},
    {"id": "sassafras", "name": "SASSAFRAS", "domain": "www.sassafras.in", "region": "IN", "department": "women", "styles": ["casual", "party", "streetwear"]},
    {"id": "londonrag", "name": "London Rag", "domain": "www.londonrag.in", "region": "IN", "department": "women", "styles": ["casual", "party"]},
    {"id": "rigo", "name": "Rigo", "domain": "www.rigo.in", "region": "IN", "department": "", "styles": ["casual", "streetwear"]},
    {"id": "cottonworld", "name": "Cottonworld", "domain": "www.cottonworld.net", "region": "IN", "department": "", "styles": ["casual", "minimal"]},
    {"id": "andamen", "name": "Andamen", "domain": "www.andamen.com", "region": "IN", "department": "men", "styles": ["smart-casual", "classic", "formal"]},
    {"id": "jadeblue", "name": "JadeBlue", "domain": "www.jadeblue.com", "region": "IN", "department": "men", "styles": ["formal", "classic", "ethnic"]},
    {"id": "thejodilife", "name": "The Jodi Life", "domain": "www.thejodilife.com", "region": "IN", "department": "", "styles": ["party", "streetwear"]},

    # Athleisure
    {"id": "blissclub", "name": "BlissClub", "domain": "www.blissclub.com", "region": "IN", "department": "women", "styles": ["athleisure"]},

    # Footwear
    {"id": "neemans", "name": "Neeman's", "domain": "www.neemans.com", "region": "IN", "department": "unisex", "styles": ["casual", "athleisure"]},
    {"id": "baccabucci", "name": "Bacca Bucci", "domain": "www.baccabucci.com", "region": "IN", "department": "men", "styles": ["casual", "streetwear"]},
    {"id": "monrow", "name": "Monrow", "domain": "www.monrow.in", "region": "IN", "department": "women", "styles": ["casual", "party"]},
    {"id": "thecaistore", "name": "The Cai Store", "domain": "www.thecaistore.com", "region": "IN", "department": "women", "styles": ["casual", "minimal"]},
    {"id": "inc5", "name": "Inc.5", "domain": "www.inc5shop.com", "region": "IN", "department": "women", "styles": ["party", "casual", "formal"]},
    {"id": "fizzygoblet", "name": "Fizzy Goblet", "domain": "www.fizzygoblet.com", "region": "IN", "department": "", "styles": ["ethnic", "festive"]},
    {"id": "needledust", "name": "Needledust", "domain": "www.needledust.com", "region": "IN", "department": "", "styles": ["ethnic", "festive"]},
    {"id": "monkstory", "name": "Monkstory", "domain": "www.monkstory.com", "region": "IN", "department": "", "styles": ["formal", "smart-casual", "classic"]},
    {"id": "tresmode", "name": "Tresmode", "domain": "www.tresmode.com", "region": "IN", "department": "", "styles": ["formal", "party", "classic"]},
    {"id": "thelagaadi", "name": "Thela Gaadi", "domain": "www.thelagaadi.com", "region": "IN", "department": "unisex", "styles": ["streetwear", "casual"]},

    # Eyewear
    {"id": "johnjacobs", "name": "John Jacobs", "domain": "www.johnjacobseyewear.com", "region": "IN", "department": "unisex", "styles": ["classic", "minimal"]},
    {"id": "specsmakers", "name": "Specsmakers", "domain": "www.specsmakers.in", "region": "IN", "department": "unisex", "styles": ["classic", "casual"]},
    {"id": "eyewearlabs", "name": "Eyewearlabs", "domain": "www.eyewearlabs.com", "region": "IN", "department": "unisex", "styles": ["streetwear", "casual"]},

    # Accessories and jewellery
    {"id": "jokerandwitch", "name": "Joker & Witch", "domain": "www.jokerandwitch.com", "region": "IN", "department": "", "styles": ["party", "minimal"]},
    {"id": "zouk", "name": "Zouk", "domain": "www.zouk.co.in", "region": "IN", "department": "women", "styles": ["ethnic", "casual"]},
    {"id": "voylla", "name": "Voylla", "domain": "www.voylla.com", "region": "IN", "department": "women", "styles": ["ethnic", "festive"]},
    {"id": "rubans", "name": "Rubans", "domain": "www.rubans.in", "region": "IN", "department": "women", "styles": ["ethnic", "festive", "party"]},
    {"id": "giva", "name": "GIVA", "domain": "www.giva.co", "region": "IN", "department": "women", "styles": ["classic", "minimal"]},
    {"id": "salty", "name": "Salty", "domain": "www.salty.co.in", "region": "IN", "department": "women", "styles": ["party", "minimal"]},
    {"id": "mokobara", "name": "Mokobara", "domain": "www.mokobara.com", "region": "IN", "department": "unisex", "styles": ["minimal"]},
]
