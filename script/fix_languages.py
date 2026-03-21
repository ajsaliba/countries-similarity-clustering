import json
import os
import re
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from country_url_parser import country_dict_to_xml

json_dir = os.path.join(os.path.dirname(__file__), "..", "Data", "Wiki Infobox", "JSON")
xml_dir = os.path.join(os.path.dirname(__file__), "..", "Data", "Wiki Infobox", "XML")

# Known multi-word languages that should NOT be split
MULTI_WORD = {
    "Standard Chinese", "Standard Hindi", "Fiji Hindi", "Egyptian Arabic",
    "Haitian Creole", "Cape Verdean Creole", "Seychellois Creole",
    "Hiri Motu", "Tok Pisin", "PNG Sign Language", "NZ Sign Language",
    "Maltese Sign Language", "Korean Sign Language", "Norwegian Sign Language",
    "Finnish Sign Language", "South African Sign Language",
    "Uruguayan Sign Language", "Zimbabwean sign language",
    "Portuguese Sign Language", "Finland-Swedish Sign Language",
    "Dutch Sign Language", "Kikongo ya leta", "Koyraboro Senni",
    "Toro So", "Hassaniya Arabic", "Luba-Kasai",
}

NOISE_PATTERNS = [
    r"^\d+ (?:national )?languages?\s*:?\s*",
    r"\blocally:\s*",
    r"\bofficial:\s*",
    r"\brecognized:\s*",
    r"\bLanguages with special status\b.*$",
    r"\band around \d+ other languages\b",
    r"\balongside any other languages so recognized by law\b",
    r"\bOther [Ii]ndigenous languages\b",
    r"\bAll mother-tongues\b",
    r"\bNational language:\s*",
    r"\bAdministrative languages:\s*",
]

KNOWN = {
    "Afar", "Afrikaans", "Aymara", "Albanian", "Amharic", "Arabic", "Armenian",
    "Azerbaijani", "Bambara", "Bariba", "Bari", "Beja", "Bengali", "Berber",
    "Belarusian", "Bilen", "Bislama", "Bobo", "Bosnian", "Bozo", "Buduma",
    "Bulgarian", "Burmese", "Catalan", "Chewa", "Chibarwe", "Chinese",
    "Chokwe", "Comorian", "Croatian", "Czech", "Danish", "Dari", "Dendi",
    "Dhivehi", "Dinka", "Diola", "Dutch", "Dzongkha", "English", "Estonian",
    "Faroese", "Fijian", "Filipino", "Finnish", "Fon", "French", "Fula",
    "Fulfulde", "Georgian", "German", "Gilbertese", "Greek", "Greenlandic",
    "Guarani", "Gujarati", "Hausa", "Hebrew", "Hindi", "Hungarian",
    "Icelandic", "Indonesian", "Irish", "Italian", "Japanese", "Jola",
    "Kalanga", "Kalo", "Kanuri", "Karelian", "Kassonke", "Kazakh", "Khmer",
    "Khoisan", "Khoekhoegowab", "Kikongo", "Kimbundu", "Kinyarwanda",
    "Kirundi", "Kituba", "Korean", "Krio", "Kunama", "Kurdish", "Kven",
    "Kyrgyz", "Lao", "Latin", "Latvian", "Lingala", "Lithuanian",
    "Luchazi", "Luxembourgish", "Macedonian", "Malagasy", "Malay",
    "Maltese", "Mandarin", "Mandinka", "Maninke", "Marshallese",
    "Mayan", "Minyanka", "Mongolian", "Montenegrin",
    "Murle", "Nambya", "Nara", "Nauruan", "Ndau", "Ndebele", "Nepali",
    "Norwegian", "Oromo", "Oshiwambo", "Otjiherero", "Otuho",
    "Palauan", "Pashto", "Persian", "Polish", "Portuguese", "Pulaar",
    "Quechua", "Romanian", "Romansh", "Romani", "RuKwangali", "Russian",
    "Saho", "Samoan", "Sango", "Sanskrit", "Scandoromani", "Senara",
    "Sepedi", "Serbian", "Serer", "Sesotho", "Setswana", "Shangani",
    "Shona", "Sinhala", "Slovak", "Slovene", "Somali", "Soninke",
    "Songhai", "Sotho", "Spanish", "Swahili", "Swazi", "Swedish",
    "Tajik", "Tamil", "Tamasheq", "Tamazight", "Tassawaq", "Tebu",
    "Telugu", "Tetum", "Thai", "Tigre", "Tigrinya", "Tonga", "Tongan",
    "Tshivenda", "Tswana", "Turkish", "Turkmen", "Tuvaluan", "Ukrainian",
    "Umbundu", "Urdu", "Uzbek", "Venda", "Vietnamese", "Wolof", "Xhosa",
    "Xitsonga", "Yoruba", "Zande", "Zarma", "Zulu",
    "Gourmanchema", "Nama", "Nuer",
    "Macedonian", "Sami",
    "Dogon", "Senufo",
}


def clean_and_split(lang_list):
    all_langs = set()

    for item in lang_list:
        if not isinstance(item, str):
            continue
        text = item

        # Remove noise
        for pattern in NOISE_PATTERNS:
            text = re.sub(pattern, "", text, flags=re.IGNORECASE)

        text = text.replace("\u2022", ",")  # bullet
        text = text.replace("\u00e9", "e")  # é -> e for Gourmanchéma

        # Extract multi-word languages first
        found_multi = []
        remaining = text
        for mw in sorted(MULTI_WORD, key=len, reverse=True):
            if mw.lower() in remaining.lower():
                # Find actual case in text
                idx = remaining.lower().find(mw.lower())
                found_multi.append(mw)
                remaining = remaining[:idx] + " " + remaining[idx + len(mw):]

        # Split remaining by comma, semicolon, slash
        parts = re.split(r"[;,/]", remaining)

        for part in parts:
            part = part.strip(" ,;:()")
            if not part:
                continue

            words = part.split()
            i = 0
            while i < len(words):
                w = words[i].strip("(),:;. ")
                # Normalize special chars
                w_norm = w.replace("\u00e9", "e").replace("\u0101", "a")
                if w_norm in KNOWN or w in KNOWN:
                    all_langs.add(w)
                elif w == "Sámi" or w == "Saami":
                    all_langs.add("Sámi")
                elif w == "Māori":
                    all_langs.add("Māori")
                elif w == "siLozi":
                    all_langs.add("siLozi")
                elif w == "Ma'di":
                    all_langs.add("Ma'di")
                elif len(w) > 2 and w[0].isupper() and w.lower() not in (
                    "and", "the", "of", "with", "so", "any", "other",
                    "by", "law", "languages", "language", "national",
                    "status", "special",
                ):
                    all_langs.add(w)
                i += 1

        for mw in found_multi:
            all_langs.add(mw)

    return sorted(all_langs)


changed = 0
for f in sorted(os.listdir(json_dir)):
    if not f.endswith(".json") or f == "all_countries.json":
        continue
    path = os.path.join(json_dir, f)
    with open(path, encoding="utf-8") as fh:
        d = json.load(fh)
    name = d.get("country", f)
    gen = d.get("infobox", {}).get("General", {})
    old_pl = gen.get("Primary Language", [])

    new_pl = clean_and_split(old_pl)

    if new_pl != old_pl:
        gen["Primary Language"] = new_pl
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(d, fh, indent=4, ensure_ascii=False)
        xname = f.replace(".json", "")
        with open(os.path.join(xml_dir, xname + ".xml"), "wb") as fh:
            fh.write(country_dict_to_xml(d))
        changed += 1
        print("%-40s  %s" % (name, new_pl))

print()
print("Changed %d countries." % changed)
