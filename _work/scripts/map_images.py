#!/usr/bin/env python3
"""Map every plant in latest_products.xlsx (Plant data tab) to its best ORIGINAL
image(s) in the WordPress uploads backup.

Order of evidence:
  1. old WooCommerce CSV product match (Images gallery column, same URLs as catalog.json img)
  2. fuzzy filename match over original (non-thumbnail) images in the backup

Run:  python3 _work/scripts/map_images.py
Out:  _work/image-map.json   (+ a review table on stdout)
"""
import csv, io, json, os, re, subprocess, sys
from collections import defaultdict
from urllib.parse import unquote

import openpyxl
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
UP = os.path.join(ROOT, "images", "wordpress uploads")
SITE = os.path.join(ROOT, "images")
OUT = os.path.join(ROOT, "_work", "image-map.json")
CSV_NAME = "wc-product-export-16-10-2026-1792136471168.csv"

# Folders that hold product / content photos. Everything else is plugin cache,
# optimiser derivatives (al_opt_content), theme kits, logs or an image sequence (s1).
SEARCH_DIRS = ["2020", "2021", "2022", "2023", "2024", "2025", "2026", "hasiruimages"]
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}
THUMB = re.compile(r"(-\d{2,4}x\d{2,4}|-scaled|-e\d{10,13}|-rotated)$", re.I)

# Token synonyms: spelling variants in the client sheet, CSV and filenames collapse to one token.
SYN = {
    "chickoo": "chikku", "chikoo": "chikku", "chiku": "chikku", "sapota": "chikku", "chickoo": "chikku",
    "alphonoso": "alphonso", "mosumbi": "mosambi", "musambi": "mosambi", "mosumbie": "mosambi",
    "mosambie": "mosambi", "achacha": "achachairu", "achachiru": "achachairu", "longon": "longan",
    "lychee": "litchi", "lichi": "litchi", "mahagony": "mahogany", "celyon": "ceylon", "vetiever": "vetiver",
    "verigated": "variegated", "varigated": "variegated", "varigatd": "variegated",
    "tirthalli": "thirthahalli", "tirthahalli": "thirthahalli", "hrmn": "hariman", "chakota": "pomelo",
    "hongae": "honge", "pongamia": "honge", "lakshmanphal": "soursop", "lakshmana": "soursop",
    "lakshman": "soursop", "anjeer": "fig", "anjir": "fig", "bagwa": "bhagwa", "spices": "spice",
    "allspice": "allspice", "dragonfruit": "dragon", "jumbo": "jumbo", "areca": "arecanut",
    "jaboticaba": "jabuticaba", "babugosha": "babugosha", "macadamia": "macadamia", "nuts": "nut",
    "leaves": "leaf", "beans": "bean", "panneralu": "roseapple", "ana": "anna",
    "chandan": "sandalwood", "sandal": "sandalwood", "shahi": "shahi", "kagzi": "kagzi",
    "gratfed": "grafted", "grafed": "grafted", "safeda": "safeda", "pachbaale": "robusta",
    "elakki": "yelakki", "haas": "hass", "cashewnut": "cashew", "breadfruit": "bread", "starfruit": "star", "lilly": "lilli", "pilly": "pilli",
}
STOP = {"hasiru", "agro", "hasiruagro", "image", "images", "plant", "plants", "sapling", "saplings",
        "wholesale", "saplingmart", "the", "of", "and", "with", "fruit", "fruits", "tree", "trees",
        "f", "l", "lam", "roxb", "ex", "dc", "none", "variety", "1", "2", "3", "png", "jpg", "new"}


def toks(s):
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", unquote(str(s or "")))   # GuavaTaiwan -> Guava Taiwan
    s = s.lower().replace("&", " ")
    s = re.sub(r"([a-z])(plant|fruit)\b", r"\1 \2", s)            # sapotaplant -> sapota plant
    s = re.sub(r"([a-z])([0-9])", r"\1 \2", s)          # l49 -> l 49, hrmn99 -> hrmn 99
    out = []
    for t in re.split(r"[^a-z0-9]+", s):
        if not t:
            continue
        t = SYN.get(t, t)
        if t not in STOP:
            out.append(t)
    return out


def tset(s):
    return set(toks(s))


# Per plant row: (scientific name, English common name, [alternative species phrases], [exclude tokens]).
# Phrases are matched as token sets; every token of one phrase must be present.
A = {
    "amla": ("Phyllanthus emblica", "Indian gooseberry", ["amla", "gooseberry", "nelli"], ["red"]),
    "anjeer (fig)": ("Ficus carica", "Fig", ["fig"], []),
    "apple": ("Malus domestica", "Apple", ["apple"], ["custard", "wood", "rose", "water", "velvet", "ber",
                                                     "litchi", "star", "malayan", "sugar", "cashew", "milk", "disco", "pink"]),
    "arecanut": ("Areca catechu", "Areca nut palm", ["arecanut"], []),
    "ber (bore hannu)": ("Ziziphus mauritiana", "Indian jujube (Ber)", ["ber"], []),
    "cashewnut": ("Anacardium occidentale", "Cashew", ["cashew", "kaju"], []),
    "sapota / chikku": ("Manilkara zapota", "Sapodilla (Chikoo)", ["chikku"], []),
    "coconut": ("Cocos nucifera", "Coconut palm", ["coconut"], []),
    "custard apple": ("Annona squamosa", "Custard apple", ["custard apple", "sitaphal"], []),
    "guava": ("Psidium guajava", "Guava", ["guava"], ["strawberry", "spicy"]),
    "hog plum (amatekai)": ("Spondias pinnata", "Hog plum (Amate)", ["amate", "hog plum", "indian olive"], []),
    "jackfruit": ("Artocarpus heterophyllus", "Jackfruit", ["jackfruit"], []),
    "jamun (jambu nerale)": ("Syzygium cumini", "Jamun", ["jamun"], ["white", "seedless", "dwarf"]),
    "jamun gratfed": ("Syzygium cumini", "Jamun (grafted)", ["jamun"], ["white"]),
    "karonda": ("Carissa carandas", "Karonda", ["karonda", "carissa"], []),
    "lemon all season": ("Citrus aurantiifolia", "Kagzi lime", ["lemon"], []),
    "lemon": ("Citrus limon", "Lemon", ["lemon"], []),
    "mango": ("Mangifera indica", "Mango", ["mango"], []),
    "monkey jack": ("Artocarpus lacucha", "Monkey jack (Lakuchi)", ["monkey jack", "lakuchi", "wild jack"], []),
    "mosumbi": ("Citrus limetta", "Sweet lime (Mosambi)", ["mosambi"], ["variegated", "vietnam"]),
    "litchi": ("Litchi chinensis", "Litchi", ["litchi"], ["apple", "bombay"]),
    "orange": ("Citrus reticulata", "Nagpur orange", ["orange"], []),
    "nutmeg grafted": ("Myristica fragrans", "Nutmeg (grafted)", ["nutmeg"], []),
    "nutmeg seeded": ("Myristica fragrans", "Nutmeg (seeded)", ["nutmeg"], []),
    "papaya": ("Carica papaya", "Papaya", ["papaya"], []),
    "peanut butter": ("Bunchosia argentea", "Peanut butter fruit", ["peanut butter"], []),
    "pepper": ("Piper nigrum", "Black pepper vine", ["pepper"], []),
    "pomelo (chakota)": ("Citrus maxima", "Pomelo", ["pomelo"], []),
    "pomegranate": ("Punica granatum", "Pomegranate", ["pomegranate"], []),
    "rose apple (panneralu)": ("Syzygium jambos", "Rose apple", ["roseapple", "rose apple"], ["water"]),
    "soursop (lakshmanphal)": ("Annona muricata", "Soursop (Lakshman phal)", ["soursop"], []),
    "starfruit": ("Averrhoa carambola", "Star fruit (Carambola)", ["star"], ["apple"]),
    "sweet tamarind": ("Tamarindus indica", "Sweet tamarind", ["sweet tamarind"], []),
    "water apple red": ("Syzygium samarangense", "Red water apple", ["water apple red", "red water apple"], ["pink", "white"]),
    "jackfruit (hebbalasu)": ("Artocarpus hirsutus", "Wild jack (Hebbalasu)", ["hebbalasu", "wild jack", "artocarpus hirsutus"], []),
    "wood apple": ("Limonia acidissima", "Wood apple", ["wood apple", "bela"], []),
    "banana": ("Musa acuminata", "Banana", ["banana"], ["sapota", "chikku", "mango"]),
    "abiu": ("Pouteria caimito", "Abiu", ["abiu"], []),
    "achachiru": ("Garcinia humilis", "Achachairu", ["achachairu"], []),
    "avocado": ("Persea americana", "Avocado", ["avocado"], []),
    "baraba": ("", "Baraba fruit", ["baraba"], []),
    "bread fruit": ("Artocarpus altilis", "Breadfruit", ["bread"], []),
    "dragonfruit": ("Selenicereus undatus", "Dragon fruit", ["dragon"], []),
    "egg fruit": ("Pouteria campechiana", "Canistel (Egg fruit)", ["egg"], []),
    "ice cream beans": ("Inga edulis", "Ice cream bean", ["ice cream bean"], []),
    "jaboticaba sabara": ("Plinia cauliflora", "Jabuticaba", ["jabuticaba"], []),
    "longon": ("Dimocarpus longan", "Longan", ["longan"], []),
    "macadamia nuts grafted": ("Macadamia integrifolia", "Macadamia (grafted)", ["macadamia"], []),
    "macadamia nuts seeded": ("Macadamia integrifolia", "Macadamia (seeded)", ["macadamia"], []),
    "mangosteen": ("Garcinia mangostana", "Mangosteen", ["mangosteen"], []),
    "matoa": ("Pometia pinnata", "Matoa", ["matoa"], []),
    "milk fruit/ star apple": ("Chrysophyllum cainito", "Star apple (Milk fruit)", ["milk", "star apple"], []),
    "miracle fruit": ("Synsepalum dulcificum", "Miracle fruit", ["miracle"], []),
    "olive": ("Olea europaea", "Olive", ["olive"], ["indian", "amate"]),
    "passion fruit": ("Passiflora edulis", "Passion fruit", ["passion"], []),
    "rain forest plum": ("Eugenia candolleana", "Rainforest plum", ["rain forest plum", "rainforest plum"], []),
    "rambutan": ("Nephelium lappaceum", "Rambutan", ["rambutan"], []),
    "salak": ("Salacca zalacca", "Salak (Snake fruit)", ["salak"], []),
    "velvet apple": ("Diospyros blancoi", "Velvet apple (Mabolo)", ["velvet apple", "mabolo"], []),
    "all spice": ("Pimenta dioica", "Allspice", ["allspice", "all spice"], []),
    "cardamom": ("Elettaria cardamomum", "Cardamom", ["cardamom"], []),
    "cinnamon": ("Cinnamomum verum", "Ceylon cinnamon", ["cinnamon"], []),
    "clove": ("Syzygium aromaticum", "Clove", ["clove"], []),
    "curry leaves": ("Murraya koenigii", "Curry leaf", ["curry leaf", "murraya"], []),
    "bamboo": ("Bambusa", "Bamboo", ["bamboo"], []),
    "mahagony": ("Swietenia macrophylla", "Mahogany", ["mahogany"], []),
    "neem": ("Azadirachta indica", "Neem", ["neem", "azadirachta"], ["malabar"]),
    "pongamia (honge)": ("Pongamia pinnata", "Pongamia (Honge)", ["honge"], []),
    "red sandal": ("Pterocarpus santalinus", "Red sanders", ["red sandalwood", "red sanders", "rakta"], []),
    "sandalwood": ("Santalum album", "Indian sandalwood", ["sandalwood"], ["red"]),
    "soapnut (antwala)": ("Sapindus emarginatus", "Soapnut", ["soapnut", "soap nut", "antwala", "reetha"], []),
    "teak": ("Tectona grandis", "Teak", ["teak"], []),
    "sesbania": ("Sesbania grandiflora", "Sesbania (Agathi)", ["sesbania", "agase", "agathi"], []),
    "gliricidia": ("Gliricidia sepium", "Gliricidia", ["gliricidia"], []),
    "moringa": ("Moringa oleifera", "Moringa (Drumstick)", ["moringa", "drumstick"], []),
    "lemongrass": ("Cymbopogon citratus", "Lemongrass", ["lemongrass", "lemon grass"], []),
    "vetiever grass": ("Chrysopogon zizanioides", "Vetiver grass", ["vetiver"], []),
    "marigold": ("Tagetes erecta", "Marigold", ["marigold"], []),
    "mexican sunflower": ("Tithonia diversifolia", "Mexican sunflower", ["mexican sunflower", "tithonia"], []),
    "mulberry": ("Morus alba", "Mulberry", ["mulberry"], []),
}
# Rows named by botanical name: English common name and alias phrases.
SCI = {
    "adansonia digitata": ("Baobab", ["baobab", "adansonia"]),
    "aegle marmelos": ("Bael (Bilva)", ["bael", "bilva", "aegle"]),
    "alangium salviifolium": ("Sage-leaved alangium (Ankole)", ["alangium", "ankole"]),
    "albizia amara": ("Krishna siris", ["albizia amara"]),
    "albizia lebbeck": ("Siris tree", ["albizia lebbeck", "lebbeck"]),
    "bauhinia racemosa": ("Bidi leaf tree (Apta)", ["bauhinia racemosa"]),
    "bombax ceiba": ("Red silk cotton tree", ["bombax", "silk cotton"]),
    "butea monosperma": ("Flame of the forest (Palash)", ["butea monosperma", "palash", "flame forest"]),
    "butea superba": ("Climbing palash", ["butea superba"]),
    "capparis moonii": ("Rudanti", ["capparis"]),
    "careya arborea": ("Kumbhi (Wild guava)", ["careya"]),
    "carissa carandas": ("Karonda (hedge)", ["carissa", "karonda"]),
    "cassia fistula": ("Golden shower tree (Amaltas)", ["cassia fistula", "golden shower", "amaltas"]),
    "chloroxylon swietenia": ("East Indian satinwood", ["chloroxylon", "satinwood"]),
    "cochlospermum religiosum": ("Buttercup tree (Yellow silk cotton)", ["cochlospermum", "buttercup"]),
    "cordia dichotoma": ("Indian cherry (Lasora)", ["cordia"]),
    "dalbergia latifolia": ("Indian rosewood (Beete)", ["dalbergia latifolia", "rosewood", "rose wood", "beete"]),
    "dalbergia sissoo": ("Shisham", ["sissoo", "shisham"]),
    "dendrocalamus strictus": ("Male bamboo", ["dendrocalamus", "bamboo"]),
    "diospyros melanoxylon": ("Tendu (Coromandel ebony)", ["melanoxylon", "tendu"]),
    "diospyros montana": ("Bombay ebony", ["diospyros montana"]),
    "dodonaea viscosa": ("Hopbush", ["dodonaea", "hopbush"]),
    "dolichandrone falcata": ("Medshingi", ["dolichandrone"]),
    "ehretia aspera": ("Ehretia", ["ehretia"]),
    "flacourtia indica": ("Governor's plum", ["flacourtia"]),
    "hardwickia binata": ("Anjan tree", ["hardwickia"]),
    "helicteres isora": ("Indian screw tree", ["helicteres"]),
    "heterophragma quadriloculare": ("Heterophragma", ["heterophragma"]),
    "holarrhena pubescens": ("Kurchi (Bitter oleander)", ["holarrhena"]),
    "holoptelea integrifolia": ("Indian elm", ["holoptelea"]),
    "kydia calycina": ("Kydia", ["kydia"]),
    "lagerstroemia parviflora": ("Small-flowered crape myrtle", ["lagerstroemia"]),
    "lannea coromandelica": ("Indian ash tree (Jhingan)", ["lannea"]),
    "lawsonia inermis": ("Henna", ["henna", "lawsonia", "mehendi"]),
    "madhuca longifolia": ("Mahua (Ippe)", ["madhuca", "mahua", "ippe"]),
    "melia dubia": ("Malabar neem (Hebbevu)", ["melia", "malabar neem", "hebbevu"]),
    "phyllanthus emblica": ("Amla (wild)", ["phyllanthus", "amla"]),
    "pithecellobium dulce": ("Manila tamarind", ["pithecellobium", "manila tamarind", "seeme hunise"]),
    "prosopis cineraria": ("Khejri (Banni)", ["prosopis cineraria", "khejri", "banni"]),
    "pterocarpus marsupium": ("Indian kino (Honne)", ["marsupium", "honne", "indian kino"]),
    "pterocarpus santalinus": ("Red sanders", ["red sandalwood", "red sanders", "pterocarpus santalinus"]),
    "santalum album": ("Indian sandalwood", ["sandalwood", "santalum"]),
    "sapindus emarginatus": ("Soapnut", ["sapindus", "soapnut", "soap nut"]),
    "schleichera oleosa": ("Kusum tree", ["schleichera", "kusum"]),
    "senegalia catechu": ("Khair (Cutch tree)", ["catechu", "khair"]),
    "sterculia foetida": ("Wild almond (Java olive)", ["sterculia foetida"]),
    "sterculia urens": ("Karaya gum tree", ["sterculia urens"]),
    "syzygium cumini": ("Jamun (wild)", ["syzygium cumini", "jamun"]),
    "tamarindus indica": ("Tamarind", ["tamarind"]),
    "tecomella undulata": ("Rohida (Desert teak)", ["tecomella", "rohida"]),
    "terminalia bellirica": ("Bahera", ["bellirica", "bahera"]),
    "vitex negundo": ("Nirgundi", ["vitex", "nirgundi"]),
    "wrightia arborea": ("Wrightia arborea", ["wrightia arborea"]),
    "wrightia tinctoria": ("Pala indigo (Sweet indrajao)", ["wrightia tinctoria"]),
    "ziziphus mauritiana": ("Ber (Indian jujube)", ["ziziphus", "ber"]),
}
# Variety words that are generic or redundant, not identity (do not require them).
# Colour / form words: sharing only these with a product is not a variety match.
WEAK = {"red", "white", "pink", "black", "yellow", "all", "season", "sweet", "super", "early", "dwarf",
        "grafted", "seeded", "tall", "gold", "honey"}
GENERIC_VARIETY = {"hedge", "wild", "mexican", "mozaffarpur", "muzaffarpur", "var"}
# Alias-level matches for botanical rows that only approximate the species (cultivar or look-alike photo).
CONF_CAP = {"dendrocalamus strictus": "low", "tamarindus indica": "medium", "ziziphus mauritiana": "medium",
            "phyllanthus emblica": "medium", "syzygium cumini": "medium", "ber (bore hannu)": "medium"}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def norm_name(n):
    return re.sub(r"\s+", " ", str(n).strip()).lower()


def plant_rows():
    ws = openpyxl.load_workbook(os.path.join(ROOT, "latest_products.xlsx"), read_only=True, data_only=True)["Plant data"]
    rows = []
    for r in ws.iter_rows(min_row=4, values_only=True):
        if not r[1]:
            continue
        name, variety, kn = str(r[1]).strip(), (str(r[2]).strip() if r[2] else ""), r[3] or ""
        key = slug(name + (" " + variety if variety else ""))
        n = norm_name(name)
        sci_key = " ".join(n.split()[:2])
        if n in A:
            sci, en, phrases, excl = A[n]
        elif sci_key in SCI:
            en, phrases = SCI[sci_key]
            sci, excl = name, []
        else:
            sci, en, phrases, excl = "", name, [name], []
        ph = [tset(x) for x in phrases]
        # qualifiers in the common name itself ("Nutmeg seeded", "Jamun grafted") act like a variety
        extra = set() if sci_key in SCI else tset(re.sub(r"\(.*?\)", "", name)) - set().union(*ph)
        vt = (tset(variety) | extra) - GENERIC_VARIETY
        rows.append(dict(key=key, name=name, variety=variety, kannada=kn, sci=sci, en=en,
                         category=r[5], phrases=ph, excl=tset(" ".join(excl)) - vt, vtoks=vt,
                         cap=CONF_CAP.get(n if n in CONF_CAP else sci_key)))
    # de-duplicate keys (sheet repeats a few names)
    seen = defaultdict(int)
    for p in rows:
        seen[p["key"]] += 1
        if seen[p["key"]] > 1:
            p["key"] += f"-{seen[p['key']]}"
    return rows


def wc_products():
    raw = subprocess.run(["git", "-C", ROOT, "show", f"HEAD:{CSV_NAME}"], capture_output=True, text=True, check=True).stdout
    f = io.StringIO(raw)
    next(f)  # first line is blank, header on line 2
    out = []
    for r in csv.DictReader(f):
        urls = [u.strip() for u in r.get("Images", "").split(",") if u.strip()]
        out.append(dict(sku=r["SKU"], name=r["Name"], toks=tset(r["Name"]), urls=urls))
    return out


def group_key(path):
    d, b = os.path.split(path)
    stem, _ = os.path.splitext(b)
    stem = re.sub(r"\.(jpe?g|png)$", "", stem, flags=re.I)   # foo.jpg.webp
    while True:
        s2 = THUMB.sub("", stem)
        if s2 == stem:
            break
        stem = s2
    return os.path.join(d, stem.lower())


_dims = {}


def dims(path):
    if path not in _dims:
        try:
            with Image.open(path) as im:
                _dims[path] = im.size
        except Exception:
            _dims[path] = (0, 0)
    return _dims[path]


def build_index():
    groups = defaultdict(list)
    for d in SEARCH_DIRS:
        for dp, _, fs in os.walk(os.path.join(UP, d)):
            for f in fs:
                if os.path.splitext(f)[1].lower() in IMG_EXT:
                    p = os.path.join(dp, f)
                    groups[group_key(p)].append(p)
    best = {}
    for k, ps in groups.items():
        # cheap pass: prefer files without a thumb suffix, then measure only those
        clean = [p for p in ps if not THUMB.search(re.sub(r"\.(jpe?g|png)$", "", os.path.splitext(os.path.basename(p))[0], flags=re.I))]
        cands = clean or ps
        best[k] = max(cands, key=lambda p: (dims(p)[0] * dims(p)[1], not p.lower().endswith(".webp"), os.path.getsize(p)))
    return best


def role_of(path):
    """plant_with_fruit = in-situ photo (tree/plant outdoors); fruit = produce cut-out on white
    (fruit, nuts, logs, seeds); sapling = potted sapling on white (what the buyer receives).
    Filenames are inconsistent (2024 '-plant-' files show fruit), so pixels decide first."""
    with Image.open(path) as im:
        g = im.convert("L").resize((100, 100))
    px = g.load()
    white = sum(px[x, y] > 235 for x in range(100) for y in range(100)) / 1e4
    if white < 0.3:
        return "plant_with_fruit"
    b = os.path.splitext(os.path.basename(path))[0].lower()
    if "fruit" in b or re.search(r"-[fs](-|$)", b):
        return "fruit"
    if "/2023/03/" in path and b.endswith("-hasiru-agro"):   # 2023 upload convention: potted sapling
        return "sapling"
    # ponytail: dark-pot heuristic, mislabels seeds/round crops; visual review covers it
    pot = [px[x, y] for x in range(30, 70) for y in range(65, 98)]
    return "sapling" if sum(v < 70 for v in pot) / len(pot) > 0.05 else "fruit"


def rel(p):
    return os.path.relpath(p, ROOT)


def info(p):
    w, h = dims(p)
    return dict(path=rel(p), role=role_of(p), w=w, h=h, kb=round(os.path.getsize(p) / 1024),
                fmt=os.path.splitext(p)[1].lower().lstrip("."),
                third_party_brand="saplingmart" in os.path.basename(p).lower())


def resolve_url(url, index, by_base):
    m = re.search(r"/wp-content/uploads/(.+)$", unquote(url))
    if not m:
        return None
    p = os.path.join(UP, m.group(1))
    k = group_key(p)
    if k in index:
        return index[k]
    alt = by_base.get(os.path.basename(k))
    return index[alt[0]] if alt else None


def phrase_hit(p, tokens):
    return any(ph and ph <= tokens for ph in p["phrases"]) and not (p["excl"] & tokens)


def match_csv(p, products):
    hits = [x for x in products if phrase_hit(p, x["toks"])]
    if not hits:
        return None, None
    if p["vtoks"]:
        v = [x for x in hits if p["vtoks"] <= x["toks"]]
        if v:
            return min(v, key=lambda x: len(x["toks"])), "variety"
        part = [x for x in hits if (p["vtoks"] & x["toks"]) - WEAK]
        if part:
            return min(part, key=lambda x: len(x["toks"])), "variety_partial"
        return min(hits, key=lambda x: len(x["toks"])), "species"
    return min(hits, key=lambda x: len(x["toks"])), "species"


def match_files(p, index, n=4):
    scored = []
    for k, path in index.items():
        t = tset(os.path.basename(k))
        if not phrase_hit(p, t):
            continue
        v = len((p["vtoks"] & t) - WEAK) if p["vtoks"] else 0
        product_dir = bool(re.search(r"/(2023|hasiruimages)/", path))
        w, h = dims(path)
        scored.append((v, product_dir, -len(t), w * h, path))
    scored.sort(reverse=True)
    if not scored:
        return [], None
    top_v = scored[0][0]
    level = "variety" if (p["vtoks"] and top_v >= len(p["vtoks"])) else ("variety_partial" if top_v else "species")
    return [s[-1] for s in scored[:n] if s[3] >= 300 * 300], level


ROLE_ORDER = {"plant_with_fruit": 0, "fruit": 1, "sapling": 2, "other": 3}


def main():
    index = build_index()
    by_base = defaultdict(list)
    for k in index:
        by_base[os.path.basename(k)].append(k)
    products = wc_products()
    plants = plant_rows()
    result, missing = {}, []
    for p in plants:
        files, method, level, sku = [], None, None, None
        prod, level = match_csv(p, products)
        if prod:
            files = [f for f in (resolve_url(u, index, by_base) for u in prod["urls"]) if f]
            files = list(dict.fromkeys(files))
            if files:
                method, sku = "csv_gallery", prod["sku"]
        if not files:
            files, level = match_files(p, index)
            method = "filename_fuzzy" if files else None
        if not files:
            missing.append(p)
            result[p["key"]] = dict(name=p["name"], variety=p["variety"], primary=None, gallery=[],
                                    match_method=None, confidence="none")
            continue
        imgs = sorted((info(f) for f in files), key=lambda i: (i["third_party_brand"], ROLE_ORDER[i["role"]], -(i["w"] * i["h"])))
        # species-level photo for a variety-specific row = a different cultivar's photo -> low
        conf = {("csv_gallery", "variety"): "high", ("csv_gallery", "species"): "high" if not p["vtoks"] else "low",
                ("csv_gallery", "variety_partial"): "medium", ("filename_fuzzy", "variety"): "medium",
                ("filename_fuzzy", "variety_partial"): "low", ("filename_fuzzy", "species"): "medium" if not p["vtoks"] else "low"}[(method, level)]
        rank = ["low", "medium", "high"]
        if p["cap"] and rank.index(conf) > rank.index(p["cap"]):
            conf = p["cap"]
        result[p["key"]] = dict(name=p["name"], variety=p["variety"], sku_match=sku,
                                csv_name=prod["name"] if method == "csv_gallery" else None,
                                primary=imgs[0]["path"], gallery=imgs, match_method=method,
                                match_level=level, confidence=conf)
    for p in plants:
        result[p["key"]]["search"] = dict(common=p["en"], scientific=p["sci"], kannada=p["kannada"])
    json.dump(dict(plants=result, missing=[m["key"] for m in missing]), open(OUT, "w"), indent=1, ensure_ascii=False)
    for k, v in result.items():
        print(f"{v['confidence']:6} {str(v['match_method']):14} {k:45} <- {v.get('csv_name') or ''} | {v['primary'] or '-'}")
    print(f"\n{len(plants)} plants, {len(plants) - len(missing)} with image, {len(missing)} missing")


def _selftest():
    assert group_key("/a/Foo-Bar-300x300.jpg") == group_key("/a/Foo-Bar.jpg") == group_key("/a/Foo-Bar-scaled.jpg")
    assert group_key("/a/foo.jpg.webp") == "/a/foo"
    assert tset("Chickoo-Cricket-Ball-1-Hasiru-Agro") == {"chikku", "cricket", "ball"}
    assert tset("Guava-L49") == {"guava", "49"}
    assert "chikku" in tset("banana-sapotaplant-with-fruit-image")
    assert tset("GuavaTaiwan Pink") == {"guava", "taiwan", "pink"}


if __name__ == "__main__":
    _selftest()
    main()
