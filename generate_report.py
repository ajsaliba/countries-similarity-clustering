import json
import os
import re
from collections import defaultdict

DATA_DIR = "c:/Users/ASUS/Desktop/IDPA1/countries-similarity-clustering/Data/Wiki Infobox/JSON"
OUTPUT_TXT = "c:/Users/ASUS/Desktop/IDPA1/Missing_Metrics_Countries.txt"

# ============================================================
# Normalizers — map raw Wikipedia key names to canonical names
# ============================================================
def norm_general(k):
    k = k.strip().lower()
    if "capital" in k and "largest" in k:
        return "Capital and largest city"
    if k in ("capital", "federal city", "administrative center", "capital administrative center"):
        return "Capital"
    if "largest city" in k or "largest settlement" in k or "largest municipality" in k or "largest quarter" in k or "largest planning area" in k or "largest metropolitan" in k:
        return "Largest city"
    if re.match(r"official language", k):
        return "Official language(s)"
    if "national language" in k:
        return "National language(s)"
    if any(x in k for x in [
        "regional language", "minority language", "recognised", "recognized",
        "co-official", "vernacular", "lingua franca", "foreign language",
        "native language", "indigenous", "other language", "other spoken",
        "common language", "language spoken", "dialect", "languages in official"
    ]):
        return "Other/regional languages"
    if re.match(r"ethnic group", k):
        return "Ethnic groups"
    if re.match(r"nationality", k):
        return "Nationality"
    if re.match(r"religion", k):
        return "Religion"
    if k in ("demonym", "demonyms"):
        return "Demonym"
    if "official script" in k:
        return "Official script"
    # Heads of state that sometimes appear in General
    if k in ("monarch", "emperor", "king", "queen", "queen mother", "sultan", "emir",
             "pope", "grand duke", "o le ao o le malo", "captains regent",
             "regent and heir apparent", "crown prince", "crown prince and senior minister"):
        return "Head of state (Gen)"
    if k in ("governor-general", "governor general"):
        return "Governor-General"
    if k in ("president", "premier", "prime minister", "chancellor", "federal chancellor",
             "chief minister", "minister of state"):
        return "Head of government (Gen)"
    if "speaker" in k or "chairman" in k or "chairperson" in k or "chairwoman" in k:
        return "Legislative leader (Gen)"
    # Known language names as standalone keys
    known_langs = {"arabic", "french", "german", "italian", "latin", "basque",
                   "catalan / valencian", "galician", "occitan/aranese",
                   "quechua", "aymara", "bambara", "fula", "hausa", "igbo",
                   "yoruba", "oromo", "afar", "afrikaans", "chewa", "luganda",
                   "lumasaba", "lusoga", "pedi", "ndebele", "ndau",
                   "khoekhoegowab", "oshiwambo", "otjiherero",
                   "hassaniya", "kven", "lule sami", "northern sami"}
    if k in known_langs:
        return "Other/regional languages"
    return None

def norm_government(k):
    k = k.strip().lower()
    if k == "government":
        return "Government type"
    if k in ("president", "monarch", "emperor", "king", "queen", "sultan", "emir",
             "pope", "grand duke", "o le ao o le malo", "captains regent",
             "governor-general", "governor general"):
        return "Head of state"
    if "prime minister" in k or k in ("premier", "chancellor", "federal chancellor",
                                       "chief minister", "minister of state",
                                       "chief of the cabinet of ministers"):
        return "Head of government"
    if k in ("vice president", "deputy prime minister"):
        return "Deputy leader"
    if k in ("legislature", "parliament"):
        return "Legislature"
    if k in ("upper house", "lower house", "senate"):
        return "Legislative chamber"
    if "speaker" in k or "chairman" in k or "chairperson" in k or "president of the" in k:
        return "Legislative/judicial leader"
    if "chief justice" in k or "supreme court" in k:
        return "Judiciary"
    return "Historical/other"

def norm_area(k):
    k = k.strip().lower()
    if k in ("total", "total area", "total land area"):
        return "Total area"
    if "water" in k:
        return "Water (%)"
    if "land" in k:
        return "Land area"
    return None

def norm_population(k):
    k = k.strip().lower()
    if "estimate" in k:
        return "Population estimate"
    if "census" in k:
        return "Population census"
    if "density" in k:
        return "Density"
    if "date format" in k:
        return "Date format"
    return None

def norm_economy(k):
    k = k.strip().lower()
    if "gdp" in k and "ppp" in k:
        return "GDP (PPP)"
    if "gdp" in k and "nominal" in k:
        return "GDP (nominal)"
    if k.startswith("gini"):
        return "Gini"
    if k.startswith("hdi"):
        return "HDI"
    if k == "currency":
        return "Currency"
    return None

def norm_time(k):
    k = k.strip().lower()
    if "time zone" in k:
        return "Time zone"
    if "summer" in k or "dst" in k:
        return "Summer (DST)"
    return None

def norm_codes(k):
    k = k.strip().lower()
    if "calling" in k:
        return "Calling code"
    if "iso" in k:
        return "ISO 3166 code"
    if "internet" in k or "tld" in k:
        return "Internet TLD"
    return None

SECTIONS = ["General", "Government", "Area", "Population", "Economy", "Time", "Codes"]
NORMALIZERS = {
    "General": norm_general,
    "Government": norm_government,
    "Area": norm_area,
    "Population": norm_population,
    "Economy": norm_economy,
    "Time": norm_time,
    "Codes": norm_codes,
}

# ============================================================
# Load all countries
# ============================================================
countries = {}
for fname in sorted(os.listdir(DATA_DIR)):
    if fname == "all_countries.json" or not fname.endswith(".json"):
        continue
    with open(os.path.join(DATA_DIR, fname), "r", encoding="utf-8") as f:
        countries[fname] = json.load(f)

print(f"Loaded {len(countries)} countries")

# ============================================================
# Normalize all keys
# ============================================================
country_norm = {}  # fname -> {section -> set of normalized keys}
metric_counts = defaultdict(lambda: defaultdict(int))

for fname, data in countries.items():
    infobox = data.get("infobox", {})
    norm = {}
    for sec in SECTIONS:
        if sec not in infobox or not isinstance(infobox[sec], dict):
            continue
        normalizer = NORMALIZERS[sec]
        keys = set()
        for raw_key in infobox[sec]:
            nk = normalizer(raw_key)
            if nk:
                keys.add(nk)
        norm[sec] = keys
        for k in keys:
            metric_counts[sec][k] += 1
    country_norm[fname] = norm

# ============================================================
# Expected metrics (50%+ of countries have them)
# ============================================================
expected = {}
for sec in SECTIONS:
    expected[sec] = {mk for mk, cnt in metric_counts[sec].items() if cnt >= len(countries) * 0.5}

# ============================================================
# Find missing per country (SINGLE source of truth)
# ============================================================
missing_report = {}  # fname -> list of "Section: metric" strings
for fname in sorted(countries.keys()):
    norm = country_norm[fname]
    missing_items = []
    for sec in SECTIONS:
        if sec not in norm:
            for mk in sorted(expected.get(sec, [])):
                missing_items.append(f"{mk} ({sec})")
        else:
            for mk in sorted(expected[sec] - norm[sec]):
                missing_items.append(f"{mk} ({sec})")
    if missing_items:
        missing_report[fname] = missing_items

complete_countries = sorted(
    [countries[fn].get("country", fn) for fn in countries if fn not in missing_report]
)

print(f"Countries with missing metrics: {len(missing_report)}")
print(f"Countries with ALL expected metrics: {len(complete_countries)}: {complete_countries}")

# ============================================================
# Write report
# ============================================================
with open(OUTPUT_TXT, "w", encoding="utf-8") as f:
    f.write("MISSING METRICS REPORT\n")
    f.write("======================\n\n")
    f.write("195 countries analyzed.\n\n")
    f.write("HOW TO READ THIS FILE:\n")
    f.write("- I compared all 195 country JSON files from Wikipedia infoboxes\n")
    f.write("- Wikipedia uses different key names for the same thing\n")
    f.write('  (e.g., "Gini (2011)" in Lebanon vs "Gini (2024)" in USA)\n')
    f.write('- So I grouped them: any "Gini (XXXX)" = "Gini", any "Religion (XXXX)" = "Religion", etc.\n')
    f.write("- Then I checked which countries are MISSING a metric that most (50%+) others have\n\n\n")

    # SECTION 1
    f.write("=" * 50 + "\n")
    f.write("SECTION 1: METRIC COVERAGE SUMMARY\n")
    f.write("=" * 50 + "\n\n")
    f.write("Each metric + how many countries have it out of 195.\n")
    f.write("Metrics marked with [COMMON] are in ALL 195 countries.\n")
    f.write("Metrics marked with [EXPECTED] are in 50%+ of countries.\n\n")

    for sec in SECTIONS:
        f.write(f"[{sec}]\n")
        for mk in sorted(metric_counts[sec], key=lambda x: -metric_counts[sec][x]):
            cnt = metric_counts[sec][mk]
            tag = ""
            if cnt == len(countries):
                tag = " [COMMON]"
            elif cnt >= len(countries) * 0.5:
                tag = " [EXPECTED]"
            dots = "." * max(1, 30 - len(mk))
            f.write(f"  {mk} {dots} {cnt}/195{tag}\n")
        f.write("\n")

    # SECTION 2
    f.write("\n" + "=" * 50 + "\n")
    f.write("SECTION 2: WHAT EACH COUNTRY IS MISSING\n")
    f.write("=" * 50 + "\n\n")
    f.write("Only showing [EXPECTED] metrics (50%+ countries have them).\n")
    f.write("If a country is NOT listed here, it has everything.\n\n")

    for fname in sorted(missing_report.keys()):
        country_name = countries[fname].get("country", fname)
        items = missing_report[fname]
        f.write(f"--- {country_name} ---\n")
        f.write(f"  Missing: {', '.join(items)}\n\n")

    # SECTION 3
    f.write("\n" + "=" * 50 + "\n")
    f.write("SECTION 3: COUNTRIES WITH NOTHING MISSING\n")
    f.write("=" * 50 + "\n\n")

    if complete_countries:
        f.write(f"{len(complete_countries)} out of 195 countries have ALL expected metrics:\n\n")
        for i, name in enumerate(complete_countries, 1):
            f.write(f"  {i}. {name}\n")
    else:
        f.write("No country has ALL expected metrics.\n")
        f.write("Every single country is missing at least one metric.\n")

    # SECTION 4
    f.write("\n\n" + "=" * 50 + "\n")
    f.write("SECTION 4: METRICS IN THE NORMALIZED FOLDER\n")
    f.write("=" * 50 + "\n\n")
    f.write("The JSON_Normalized folder contains 195 files where\n")
    f.write("every country has EXACTLY these metrics\n")
    f.write("(the only ones ALL 195 countries share):\n\n")

    num = 1
    for sec in SECTIONS:
        for mk in sorted(metric_counts[sec], key=lambda x: -metric_counts[sec][x]):
            if metric_counts[sec][mk] == len(countries):
                f.write(f"  {num}. {mk} (from {sec})\n")
                num += 1

print(f"Report written to {OUTPUT_TXT}")
