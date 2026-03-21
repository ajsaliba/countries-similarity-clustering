import json
import os
import sys
import re
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(__file__))
from country_url_parser import country_dict_to_xml

json_dir = os.path.join(os.path.dirname(__file__), "..", "Data", "Wiki Infobox", "JSON")
xml_dir = os.path.join(os.path.dirname(__file__), "..", "Data", "Wiki Infobox", "XML")

# Keys to drop entirely
DROP_KEYWORDS = [
    "unspecified", "undeclared", "not stated", "no answer", "unknown",
    "not reported", "unclassified", "two nationalities",
    "data taken from administrative", "persons for whom data",
    "not specified", "prefer not", "undeclared/unknown",
    "major racial",
]

def should_drop(key):
    kl = key.lower().replace("(%)", "").strip()
    for d in DROP_KEYWORDS:
        if d in kl:
            return True
    return False

def is_other(key):
    kl = key.lower().replace("(%)", "").strip()
    if kl in ("other", "others", "other / unspecified", "other/ unspecified",
              "other / none", "others or none", "other ethnic groups",
              "other ethnics", "other white", "other by origin",
              "non afric", "other afric", "other liberi",
              "others/foreigners", "mbenga pygmies and others",
              "asian / other"):
        return True
    return False

def clean_key(key):
    k = key
    has_pct = "(%" in k
    k = k.replace("(%)", "").strip()

    # Remove sentence noise
    for noise in [" make up", " constitute", " representing", " overall",
                  " are betwee", " was "]:
        k = k.replace(noise, "")

    # Remove ranges like '15–', '5–', '9–', '1–', '~'
    k = re.sub(r"\s*\d+\s*[–-]\s*", " ", k)
    k = k.replace("~", "").replace("< ", "")

    # Remove annotations in parentheses
    k = re.sub(r"\s*\([^)]*\)", "", k)

    # Remove leading/trailing punctuation and special chars
    k = k.strip(" ,;:.—")
    k = " ".join(k.split())

    if not k:
        return None

    # Capitalize first letter
    k = k[0].upper() + k[1:]

    return k + " (%)"

# Manual fixes for badly broken countries
MANUAL = {
    "Bangladesh": {"Bengali (%)": 99.0, "Other (%)": 1.0},
    "Iraq": {"Arab (%)": 75.0, "Kurdish (%)": 15.0, "Other (%)": 10.0},
    "Iran": {
        "Persian (%)": 51.0, "Azerbaijani (%)": 24.0, "Kurdish (%)": 7.0,
        "Gilak and Mazanderani (%)": 8.0, "Lur (%)": 2.0, "Baloch (%)": 2.0,
        "Arab (%)": 3.0, "Turkmen (%)": 2.0, "Other (%)": 1.0,
    },
    "Belgium": {"Belgian (%)": 86.1, "Foreign (%)": 13.9},
    "Mauritania": {
        "Haratin (%)": 40.0, "Beidane (%)": 30.0,
        "Sub-Saharan African (%)": 30.0,
    },
    "Ivory Coast": {
        "Akan (%)": 38.0, "Voltaiques/Gur (%)": 22.0,
        "Northern Mande (%)": 22.0, "Kru (%)": 9.1,
        "Southern Mande (%)": 8.6, "Other (%)": 0.3,
    },
    "Poland": {"Polish (%)": 96.3, "Other (%)": 3.7},
    "Thailand": {
        "Thai (%)": 80.0, "Chinese (%)": 12.0,
        "Malay (%)": 4.0, "Other (%)": 4.0,
    },
    "Burundi": {"Hutu (%)": 85.0, "Tutsi (%)": 14.0, "Twa (%)": 1.0},
    "Rwanda": {"Hutu (%)": 85.0, "Tutsi (%)": 14.0, "Twa (%)": 1.0},
    "United States": {
        "White (%)": 61.6, "Hispanic or Latino (%)": 18.7,
        "Black (%)": 12.4, "Asian (%)": 6.0, "Multiracial (%)": 10.2,
        "Native American (%)": 1.1, "Pacific Islander (%)": 0.2,
    },
    "Syria": {"Arab (%)": 90.0, "Kurdish (%)": 10.0},
    "United Arab Emirates": {
        "Emirati (%)": 12.0, "South Asian (%)": 59.4,
        "Egyptian (%)": 10.2, "Filipino (%)": 6.1, "Other (%)": 12.3,
    },
    "Liberia": {
        "Kpelle (%)": 20.3, "Bassa (%)": 13.4, "Grebo (%)": 10.0,
        "Gio (%)": 10.0, "Mano (%)": 7.9, "Kru (%)": 7.9,
        "Lorma (%)": 5.1, "Kissi (%)": 4.8, "Gola (%)": 4.4,
        "Mandinka (%)": 3.2, "Gbandi (%)": 3.0, "Vai (%)": 4.0,
        "Other (%)": 6.0,
    },
    "North Macedonia": {
        "Macedonian (%)": 58.4, "Albanian (%)": 24.3,
        "Turkish (%)": 3.9, "Roma (%)": 2.5, "Serbian (%)": 1.3,
        "Bosniak (%)": 0.9, "Aromanian (%)": 0.5, "Other (%)": 8.2,
    },
    "Uganda": {
        "Baganda (%)": 15.3, "Banyankole (%)": 9.1, "Basoga (%)": 8.1,
        "Iteso (%)": 6.8, "Bakiga (%)": 6.4, "Langi (%)": 5.9,
        "Bagisu (%)": 4.5, "Acholi (%)": 4.2, "Lugbara (%)": 2.6,
        "Other (%)": 37.1,
    },
    "South Korea": {"Korean (%)": 94.8, "Other (%)": 5.2},
    "Cameroon": {
        "Bamileke-Bamun (%)": 22.2, "Biu-Mandara (%)": 16.4,
        "Shuwa Arab (%)": 13.5, "Beti-Bassa (%)": 13.1,
        "Fulani (%)": 12.0, "Adamawa-Ubangi (%)": 9.8,
        "Tikar (%)": 9.9, "Sawa (%)": 4.6,
        "Southwest Bantu (%)": 4.3, "Pygmy (%)": 2.3, "Other (%)": 3.8,
    },
    "Malaysia": {
        "Bumiputera (%)": 70.5, "Chinese (%)": 22.9, "Indian (%)": 6.6,
    },
    "Qatar": {"Arab (%)": 49.0, "South Asian (%)": 43.0, "Other (%)": 8.0},
    "Turkey": {
        "Turkish (%)": 70.0, "Kurdish (%)": 18.0, "Other (%)": 12.0,
    },
    "Burkina Faso": {
        "Mossi (%)": 53.7, "Fula (%)": 6.8, "Gurma (%)": 5.2,
        "Gurunsi (%)": 5.9, "Bobo (%)": 3.4, "Senufo (%)": 2.2,
        "Bissa (%)": 1.5, "Lobi (%)": 1.5, "Other (%)": 19.8,
    },
    "Suriname": {
        "Hindustani (%)": 27.4, "Maroon (%)": 21.7,
        "Creole (%)": 15.7, "Javanese (%)": 13.7,
        "Multiracial (%)": 13.4, "Indigenous (%)": 3.8,
        "Chinese (%)": 1.5, "Other (%)": 2.8,
    },
    "Singapore": {
        "Chinese (%)": 74.3, "Malay (%)": 13.5,
        "Indian (%)": 9.0, "Other (%)": 3.2,
    },
    "Solomon Islands": {
        "Melanesian (%)": 95.3, "Polynesian (%)": 3.1,
        "Micronesian (%)": 1.2, "Other (%)": 0.4,
    },
}

changed = 0
for f in sorted(os.listdir(json_dir)):
    if not f.endswith(".json") or f == "all_countries.json":
        continue
    path = os.path.join(json_dir, f)
    with open(path, encoding="utf-8") as fh:
        d = json.load(fh)
    name = d.get("country", f)
    eth = d.get("infobox", {}).get("General", {}).get("Ethnic groups", {})

    # Skip Unknown placeholder
    if eth == {"Unknown": 100.0}:
        continue

    # Use manual fix if available
    if name in MANUAL:
        new_eth = MANUAL[name]
    else:
        new_eth = {}
        other_sum = 0.0
        for k, v in eth.items():
            if not isinstance(v, (int, float)):
                continue
            if should_drop(k):
                continue
            if is_other(k):
                other_sum += v
                continue
            cleaned = clean_key(k)
            if cleaned is None:
                continue
            if cleaned in new_eth:
                new_eth[cleaned] = round(new_eth[cleaned] + v, 2)
            else:
                new_eth[cleaned] = round(float(v), 2)
        if other_sum > 0:
            new_eth["Other (%)"] = round(other_sum, 2)

    # Sort keys alphabetically
    new_eth = dict(sorted(new_eth.items()))

    if new_eth != eth:
        d["infobox"]["General"]["Ethnic groups"] = new_eth
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(d, fh, indent=4, ensure_ascii=False)
        with open(os.path.join(xml_dir, f.replace(".json", ".xml")), "wb") as fh:
            fh.write(country_dict_to_xml(d))
        changed += 1
        print(f"{name}: {json.dumps(new_eth, ensure_ascii=False)}")

print(f"\nStandardized {changed} countries.")
