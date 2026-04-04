"""
clean_countries.py
==================
Full-fidelity cleaning of data/raw/all_countries.json.

Rules applied
-------------
• Every country produces the same top-level sections:
    area | codes | economy | general | government | history | population | time | url
  ("country" is always first; all other keys are sorted A→Z recursively.)
• ALL original data is preserved — nothing is dropped.
• Ethnic groups and religion are normalised to a consistent
  {groups: {name: float}, year: int|null} hierarchy.
• Government leaders are separated from structural fields and
  historical-date entries; those dates flow into "history".
• All "Independence from …" and other auxiliary infobox sections
  are merged into "history".
• Pure numeric strings (matching ^-?\\d+(\\.\\d+)?$) are coerced
  to int/float throughout.
• Calling codes keep their leading "+" and TLDs their leading "."
  (they are identifiers, not quantities).

KNIME note
----------
Paste this file's content into a Python Script (Legacy) node.
Replace JSON_INPUT_PATH / JSON_OUTPUT_PATH with absolute paths
or use flow_variables["knime.workflow.dir"].
"""

import json
import os
import re
import pandas as pd

# ── Paths ──────────────────────────────────────────────────────────────────────
_BASE            = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else "."
JSON_INPUT_PATH  = os.path.join(_BASE, "..", "data", "raw",     "all_countries.json")
JSON_OUTPUT_PATH = os.path.join(_BASE, "..", "data", "clean",   "all_countries_clean.json")
CSV_OUTPUT_PATH  = os.path.join(_BASE, "..", "data", "outputs", "all_countries_flat.csv")


# ══════════════════════════════════════════════════════════════════════════════
# Primitive helpers
# ══════════════════════════════════════════════════════════════════════════════

_PURE_NUM = re.compile(r"^-?\d+(\.\d+)?$")


def _coerce(v):
    """Recursively coerce pure-numeric strings to int/float; sort dict keys."""
    if isinstance(v, dict):
        return {k: _coerce(vv) for k, vv in sorted(v.items())}
    if isinstance(v, list):
        return [_coerce(i) for i in v]
    if isinstance(v, str) and _PURE_NUM.match(v.strip()):
        s = v.strip()
        return int(s) if "." not in s else float(s)
    return v


def _sort(d: dict) -> dict:
    """Return d with keys sorted; values recursively coerced."""
    return {k: _coerce(v) for k, vv in sorted(d.items()) for v in (vv,)}


def to_snake(s: str) -> str:
    """'Prime Minister' → 'prime_minister', 'Vice-President' → 'vice_president'."""
    s = re.sub(r"[-\s/]+", "_", s.strip())
    s = re.sub(r"[^\w]", "", s)
    return s.lower()


def _pct_to_float(s) -> float | None:
    """'42%' or '42.5' → 42.5; None on failure."""
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    m = re.search(r"-?([\d]+(?:\.[\d]+)?)", str(s))
    return float(m.group(1)) if m else None


def _year_from_key(key: str) -> int | None:
    m = re.search(r"\b(\d{4})\b", key)
    return int(m.group(1)) if m else None


def _looks_like_date(v) -> bool:
    """True if v is a historical date string or list of date strings."""
    if isinstance(v, list):
        return bool(v) and all(_looks_like_date(i) for i in v)
    if not isinstance(v, str):
        return False
    # Contains a 3-4 digit year, "BC/AD/CE", century phrase, or decade
    return bool(re.search(
        r"\b(\d{3,4}\s*(BC|AD|CE|BCE)\b|(?:1[0-9]{3}|20[0-2][0-9]))", v
    ))


def _extract_capital(raw: str | None) -> str | None:
    """Strip Wikipedia coordinate notation: 'Kabul 34°31′N …' → 'Kabul'."""
    if not raw or not isinstance(raw, str):
        return None
    city = re.split(r"\s+\d+[°º]", raw)[0].strip()
    city = re.sub(r"\s+Country:.*", "", city).strip()
    return city or None


def _normalize_utc(text: str) -> str | None:
    if not isinstance(text, str):
        return None
    text = text.split(";")[0].strip()
    text = (text.replace("\u2212", "-").replace("\u2013", "-")
                .replace("\u2060", "").replace("\u00b1", "+"))
    m = re.search(r"UTC\s*([+\-])\s*(\d{1,2})(?::(\d{2}))?", text, re.IGNORECASE)
    if m:
        return f"UTC{m.group(1)}{int(m.group(2)):02d}:{int(m.group(3) or 0):02d}"
    if re.search(r"\bUTC\b", text, re.IGNORECASE):
        return "UTC+00:00"
    return None


def _gdp_to_billions(text: str) -> float | None:
    if not isinstance(text, str):
        return None
    text = re.sub(r"\s*\([^)]*\)", "", text).strip()
    m = re.match(r"[^\d]*([\d,\.]+)\s*(trillion|billion|million)?", text, re.IGNORECASE)
    if not m:
        return None
    val  = float(m.group(1).replace(",", ""))
    unit = (m.group(2) or "billion").lower()
    if unit == "trillion":
        val *= 1_000
    elif unit == "million":
        val /= 1_000
    return round(val, 3)


def _per_capita(text: str) -> int | None:
    if not isinstance(text, str):
        return None
    text = re.sub(r"\s*\([^)]*\)", "", text)
    text = re.sub(r"[^\d]", "", text)
    return int(text) if text else None


def _world_rank(text: str) -> int | None:
    if not isinstance(text, str):
        return None
    m = re.search(r"\(\s*(\d+)\s*(?:st|nd|rd|th)\s*\)", text)
    return int(m.group(1)) if m else None


def _first_number(text: str) -> float | None:
    if not isinstance(text, str):
        return None
    m = re.search(r"[\d]+(?:\.\d+)?", text.replace(",", ""))
    return float(m.group()) if m else None


# ══════════════════════════════════════════════════════════════════════════════
# Language key normalisation map
# ══════════════════════════════════════════════════════════════════════════════

_LANG_KEY_MAP = {
    "Official languages":                       "official_language",
    "Official language":                        "official_language",
    "Official language and national language":  "official_language",
    "Official language (federal level)":        "official_language",
    "Co-official languages":                    "official_language",
    "Common languages":                         "official_language",
    "National language":                                        "national_language",
    "National languages":                                       "national_language",
    "National language (official)":                             "official_language",
    "Recognised national languages":                            "national_language",
    "Recognized national languages":                            "national_language",
    "Official languages and recognised national languages":     "official_language",
    "Recognised language":                                      "recognized_languages",
    "Recognised minority languages":                            "recognized_minority_languages",
    "Officially recognized minority languages":                 "recognized_minority_languages",
    "Recognized regional languages":            "recognized_regional_languages",
    "Recognised regional languages":            "recognized_regional_languages",
    "Official regional languages":              "official_regional_languages",
    "Regional and minority languages":          "regional_and_minority_languages",
    "Regional languages":                       "regional_languages",
    "Foreign languages":                        "foreign_languages",
    "Other languages":                          "other_languages",
    "Other common language":                    "other_languages",
    "Other languages and dialects":             "other_languages",
    "Other spoken languages":                   "other_spoken_languages",
    "Widely used minority languages":           "other_languages",
    "Spoken languages":                         "spoken_languages",
    "Native languages":                         "native_languages",
    "Vernacular language":                      "vernacular_language",
    "Vernacular languages":                     "vernacular_language",
    "Vernaculars":                              "vernacular_language",
    "Local vernacular":                         "vernacular_language",
    "National vernacular":                      "national_vernacular",
    "Minority languages":                       "minority_languages",
    "Lingua franca":                            "lingua_franca",
    "Indigenous languages":                     "indigenous_languages",
    "Official script":                          "official_script",
    "Official scripts":                         "official_script",
    "Writing system":                           "writing_system",
    "Recognized":                               "recognized_languages",
    "Recognised":                               "recognized_languages",
    "Recognized languages":                     "recognized_languages",
    "Recognised languages":                     "recognized_languages",
}

# Keys whose values hold the main language string but appear in odd positions
_CAPITAL_KEYS = {
    "Capital and largest city", "Capital",
    "Capital Administrative center",
    "Administrative center", "Administrative Centre",
    "Administrative capital", "Seat of government",
}

# Government keys that define structure (not leaders, not dates)
_GOV_STRUCTURAL = {
    "Government":   "type",
    "Legislature":  "legislature",
    "Upper house":  "upper_house",
    "Lower house":  "lower_house",
    "Government seat": "seat",
    "Working language":  "working_language",
    "Working languages": "working_language",
    "Government-sponsored languages": "government_sponsored_languages",
}


# ══════════════════════════════════════════════════════════════════════════════
# Section cleaners
# ══════════════════════════════════════════════════════════════════════════════

def _normalize_lang_value(v):
    """Normalise a language field value to a plain string or dict."""
    if isinstance(v, str):
        return v.strip() or None
    if isinstance(v, list):
        return " ".join(str(i) for i in v) or None
    if isinstance(v, dict):
        # e.g. Switzerland: {"), French (": "62%"} → extract capitalised words
        langs = []
        for k in v:
            words = re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b", k)
            langs.extend(words)
        return " / ".join(langs) if langs else None
    return None


def _normalize_ethnic_groups(raw, year: int | None) -> dict:
    """
    Produce {groups: {Name: pct_float, …}, year: int|null}.
    If raw is a non-parseable string (e.g. 'See Ethnic groups') the
    groups key is null and a note key is added instead.
    """
    base: dict = {"groups": None, "year": year}
    if isinstance(raw, str):
        base["note"] = raw.strip()
        return base
    if not isinstance(raw, dict):
        return base
    groups = {}
    for name, val in raw.items():
        pct = _pct_to_float(val)
        groups[name] = pct if pct is not None else val
    base["groups"] = _sort(groups) if groups else None
    return base


def _normalize_religion(raw, year: int | None) -> dict:
    """
    Produce {groups: {Name: {percentage: float, breakdown: {…}} | float}, year}.
    Both flat ('43.9%') and nested ({percentage, breakdown}) source formats
    are handled; percentage strings become floats throughout.
    """
    base: dict = {"groups": None, "year": year}
    if not isinstance(raw, dict):
        return base
    groups = {}
    for rel, data in raw.items():
        if isinstance(data, dict) and "percentage" in data:
            entry: dict = {"percentage": _pct_to_float(data["percentage"])}
            if "breakdown" in data and isinstance(data["breakdown"], dict):
                bd = {}
                for sub, sub_pct in data["breakdown"].items():
                    # sub_pct may itself be nested (Antigua edge case)
                    if isinstance(sub_pct, dict) and "percentage" in sub_pct:
                        bd[sub] = _pct_to_float(sub_pct["percentage"])
                    else:
                        bd[sub] = _pct_to_float(sub_pct)
                entry["breakdown"] = _sort(bd)
            groups[rel] = entry
        else:
            pct = _pct_to_float(data)
            groups[rel] = pct if pct is not None else data
    base["groups"] = _sort(groups) if groups else None
    return base


def clean_general(raw: dict) -> dict:
    """Normalise the General infobox section."""
    out: dict = {}
    capital_set = False

    for rk, rv in raw.items():
        # ── Capital ────────────────────────────────────────────────────────
        if rk in _CAPITAL_KEYS:
            if not capital_set:
                out["capital"] = _extract_capital(rv)
                capital_set = True
            if "largest city" in rk.lower():
                out.setdefault("largest_city", _extract_capital(rv))

        elif rk == "Largest city":
            out["largest_city"] = _extract_capital(rv)

        # ── Demonym ────────────────────────────────────────────────────────
        elif rk in ("Demonym", "Demonyms"):
            val = rv[0] if isinstance(rv, list) else rv
            out["demonym"] = val

        # ── Ethnic groups (any year variant) ──────────────────────────────
        elif rk.startswith("Ethnic"):
            out["ethnic_groups"] = _normalize_ethnic_groups(rv, _year_from_key(rk))

        # ── Religion (most-recent year; prefix match) ─────────────────────
        elif rk.startswith("Religion"):
            yr = _year_from_key(rk)
            existing = out.get("religion")
            if existing is None or (yr and (existing.get("year") or 0) < yr):
                out["religion"] = _normalize_religion(rv, yr)

        # ── Language keys ──────────────────────────────────────────────────
        elif rk in _LANG_KEY_MAP:
            ck = _LANG_KEY_MAP[rk]
            # If the canonical key was already populated, keep the first value
            out.setdefault(ck, _normalize_lang_value(rv))

        # ── Everything else → snake_case ──────────────────────────────────
        else:
            ck = to_snake(rk)
            if ck and ck not in out:
                out[ck] = rv

    # Ensure largest_city is present (falls back to capital for combined fields)
    if "largest_city" not in out:
        out["largest_city"] = out.get("capital")

    # Ensure these keys always exist for consistency
    for k in ("capital", "demonym", "ethnic_groups", "largest_city",
              "official_language", "religion"):
        out.setdefault(k, None)
    if out["ethnic_groups"] is None:
        out["ethnic_groups"] = {"groups": None, "year": None}
    if out["religion"] is None:
        out["religion"] = {"groups": None, "year": None}
    # Fallback: promote national_language to official_language when not set
    if out["official_language"] is None and out.get("national_language"):
        out["official_language"] = out["national_language"]

    return _sort(out)


def clean_government(raw: dict) -> tuple[dict, dict]:
    """
    Returns (government_dict, historical_dates_dict).
    Historical date entries found in the Government section are extracted
    and returned separately so they can be merged into "history".
    """
    struct: dict  = {}
    leaders: dict = {}
    hist: dict    = {}

    for rk, rv in raw.items():
        # Structural fields
        if rk in _GOV_STRUCTURAL:
            struct[_GOV_STRUCTURAL[rk]] = rv
        # Historical date entries
        elif _looks_like_date(rv):
            hist[rk] = rv
        # Everything else → leader / official title
        else:
            leaders[to_snake(rk)] = rv

    out: dict = {}
    if struct.get("type"):
        out["type"] = struct.pop("type")
    out.update({k: v for k, v in struct.items() if v is not None})
    if leaders:
        out["leaders"] = _sort(leaders)

    # Guarantee presence of common fields
    for k in ("leaders", "legislature", "lower_house", "type", "upper_house"):
        out.setdefault(k, None)
    if out["leaders"] is None:
        out["leaders"] = {}

    return _sort(out), hist


def clean_history(*section_dicts) -> dict:
    """
    Merge any number of {event: date} dicts into one unified history dict,
    sorted alphabetically by event name.
    """
    merged: dict = {}
    for sec in section_dicts:
        if isinstance(sec, dict):
            for k, v in sec.items():
                merged.setdefault(k, v)     # first occurrence wins
    return _sort(merged)


def clean_area(raw: dict) -> dict:
    total_raw = (raw.get("Total")
                 or raw.get("Total area")
                 or next((v for v in raw.values()
                          if isinstance(v, str) and "km" in v), None))
    water_raw = raw.get("Water (%)", "0")
    water = 0.0 if (not water_raw or
                    re.match(r"negligible|none|n/?a", str(water_raw).strip(), re.IGNORECASE)
                    ) else (_first_number(str(water_raw)) or 0.0)
    return _sort({
        "rank":      _world_rank(total_raw or ""),
        "total_km2": _first_number(total_raw or ""),
        "water_pct": water,
    })


def clean_population(raw: dict) -> dict:
    total = density = None
    year  = None
    best  = -1

    for k, v in raw.items():
        if k in ("Density", "Date format") or not isinstance(v, str):
            continue
        m = re.search(r"\b(20\d{2})\b", k)
        if not m:
            continue
        yr = int(m.group(1))
        if yr < best:
            continue
        best = yr
        year = yr
        clean = re.sub(r"\s*\([^)]*\)", "", v).strip()
        clean = clean.replace(",", "").replace("\u2013", "-").replace("\u2212", "-")
        rng = re.match(r"(\d+)\s*-\s*(\d+)\s*(million|billion)?", clean, re.IGNORECASE)
        if rng:
            lo, hi = float(rng.group(1)), float(rng.group(2))
            mul = 1_000_000 if (rng.group(3) or "").lower() == "million" else 1
            total = int((lo + hi) / 2 * mul)
        else:
            nm = re.search(r"(\d[\d]*)", clean)   # search handles leading "=" etc.
            total = int(nm.group(1)) if nm else None

    density_raw = raw.get("Density", "")
    if density_raw:
        density = _first_number(density_raw)

    return _sort({"density_per_km2": density, "total": total, "year": year})


def clean_economy(raw: dict) -> dict:
    # GDP PPP
    ppp = raw.get("GDP ( PPP )", {})
    ppp_total = ppp_pc = ppp_year = None
    if isinstance(ppp, dict):
        ppp_total = _gdp_to_billions(ppp.get("Total"))
        ppp_pc    = _per_capita(ppp.get("Per capita"))
        ppp_year  = _year_from_key(ppp.get("Details", ""))

    # GDP Nominal
    nom = raw.get("GDP (nominal)", {})
    nom_total = nom_pc = nom_year = None
    if isinstance(nom, dict):
        nom_total = _gdp_to_billions(nom.get("Total"))
        nom_pc    = _per_capita(nom.get("Per capita"))
        nom_year  = _year_from_key(nom.get("Details", ""))

    # HDI – prefer most recent
    hdi_val = hdi_cat = hdi_rank = hdi_year = None
    for yr in ("2024", "2023", "2022", "2021"):
        raw_hdi = raw.get(f"HDI ({yr})")
        if raw_hdi:
            m = re.match(r"([\d\.]+)", raw_hdi)
            hdi_val  = float(m.group(1)) if m else None
            cat      = re.search(r"(very high|high|medium|low)", raw_hdi, re.IGNORECASE)
            hdi_cat  = cat.group(1).lower() if cat else None
            hdi_rank = _world_rank(raw_hdi)
            hdi_year = int(yr)
            break

    # Gini – most recent year
    gini_val = gini_cat = gini_year = None
    best_yr  = -1
    for k, v in raw.items():
        if not k.startswith("Gini") or not isinstance(v, str):
            continue
        m = re.search(r"\b(\d{4})\b", k)
        yr = int(m.group(1)) if m else 0
        if yr >= best_yr:
            best_yr  = yr
            nm       = re.match(r"([\d\.]+)", v)
            gini_val = float(nm.group(1)) if nm else None
            cat      = re.search(r"(very high|high|medium|low)", v, re.IGNORECASE)
            gini_cat = cat.group(1).lower() if cat else None
            gini_year = yr if yr > 0 else None

    # Currency code
    cur_raw = raw.get("Currency", "") or ""
    hits    = re.findall(r"\(\s*([A-Z]{3})\s*\)", cur_raw)
    cur_code = hits[-1] if hits else (cur_raw.strip() or None)

    return _sort({
        "currency_code": cur_code,
        "gdp_nominal": _sort({
            "per_capita_usd":   nom_pc,
            "total_billion_usd": nom_total,
            "year":             nom_year,
        }),
        "gdp_ppp": _sort({
            "per_capita_usd":   ppp_pc,
            "total_billion_usd": ppp_total,
            "year":             ppp_year,
        }),
        "gini": _sort({"category": gini_cat, "value": gini_val, "year": gini_year}),
        "hdi":  _sort({"category": hdi_cat,  "rank": hdi_rank,
                        "value": hdi_val,     "year": hdi_year}),
    })


def clean_time(raw: dict) -> dict:
    return _sort({
        "timezone_dst": _normalize_utc(raw.get("Summer ( DST )", "")),
        "timezone_utc": _normalize_utc(raw.get("Time zone", "")),
    })


def clean_codes(raw: dict) -> dict:
    cc_raw  = raw.get("Calling code", "") or ""
    tld_raw = raw.get("Internet TLD", "") or ""
    cc_hits  = re.findall(r"\+[\d\s]+", cc_raw)
    tld_hits = re.findall(r"\.\S+", tld_raw)
    return _sort({
        "calling_code":  cc_hits[0].strip() if cc_hits else (cc_raw.strip() or None),
        "internet_tld":  tld_hits[0] if tld_hits else None,
        "iso_3166_code": raw.get("ISO 3166 code"),
    })


# ══════════════════════════════════════════════════════════════════════════════
# Master country cleaner
# ══════════════════════════════════════════════════════════════════════════════

# Infobox sections that are purely historical (merged into "history")
_HISTORY_SECTIONS = {
    "History", "Establishment", "Independence",
    "Independence as principality",
    "Historical polities",
    "Unification of the petty kingdoms",
}

# Regex that matches government/leader title keywords
_LEADER_KEY_RE = re.compile(
    r"president|prime.minister|minister|chancellor|king|queen|sultan|emir|sheikh|"
    r"chief|vice|deputy|director|secretary|monarch|governor|commissioner|chairman|"
    r"leader|captain|mayor|judge|justice|co.prince|representative|syndic|"
    r"regent|premier|speaker|junta|general.secretary",
    re.IGNORECASE,
)


def _extract_leaders_from_dict(d: dict) -> dict:
    """
    Pull any leader-like {title: name} pairs from an arbitrary dict
    (used to rescue government data mis-placed in other infobox sections,
    e.g. Andorra's Economy.Significant language).
    Returns only entries whose KEY matches a leader-title pattern and
    whose VALUE does not look like a date.
    """
    found = {}
    for k, v in d.items():
        if _LEADER_KEY_RE.search(k) and not _looks_like_date(v):
            found[to_snake(k)] = v
    return found


def clean_country(entry: dict) -> dict:
    ib  = entry.get("infobox", {})

    # ── Standard sections ──────────────────────────────────────────────────
    gov_dict, gov_hist = clean_government(ib.get("Government", {}))

    # ── Rescue leaders buried in non-Government sections ──────────────────
    # (e.g. Andorra stores Co-princes / Prime minister inside Economy)
    extra_leaders: dict = {}
    for sec_name, sec_data in ib.items():
        if sec_name in ("Government", "General", "History", "Area",
                        "Population", "Time", "Codes"):
            continue
        if isinstance(sec_data, dict):
            for sub_val in sec_data.values():
                if isinstance(sub_val, dict):
                    extra_leaders.update(_extract_leaders_from_dict(sub_val))

    if extra_leaders:
        merged = {**extra_leaders, **(gov_dict.get("leaders") or {})}
        gov_dict["leaders"] = _sort(merged)

    # ── Collect all historical date dicts ─────────────────────────────────
    hist_parts = [gov_hist]
    for sec_name, sec_data in ib.items():
        if sec_name in _HISTORY_SECTIONS or sec_name.startswith("Independence"):
            if isinstance(sec_data, dict):
                hist_parts.append(sec_data)
        elif sec_name not in {
            "General", "Government", "Area", "Population",
            "Economy", "Time", "Codes",
        }:
            if isinstance(sec_data, dict):
                hist_parts.append(sec_data)

    result = {
        "country":    entry["country"],
        "area":       clean_area(ib.get("Area", {})),
        "codes":      clean_codes(ib.get("Codes", {})),
        "economy":    clean_economy(ib.get("Economy", {})),
        "general":    clean_general(ib.get("General", {})),
        "government": gov_dict,
        "history":    clean_history(*hist_parts),
        "population": clean_population(ib.get("Population", {})),
        "time":       clean_time(ib.get("Time", {})),
        # url intentionally omitted
    }
    return result


# ══════════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__" or "output_table_1" not in dir():
    with open(JSON_INPUT_PATH, encoding="utf-8") as f:
        raw_data = json.load(f)

    rows   = []
    errors = []
    for entry in raw_data["countries"]:
        try:
            rows.append(clean_country(entry))
        except Exception as exc:
            errors.append({"country": entry.get("country", "?"), "error": str(exc)})
            rows.append({"country": entry.get("country", "?"), "error": str(exc)})

    with open(JSON_OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump({"countries": rows}, f, ensure_ascii=False, indent=2, default=str)

    # Flat CSV (top-level scalar fields only)
    flat_rows = []
    for r in rows:
        flat = {"country": r["country"]}
        for sec in ("area", "codes", "population", "time"):
            for k, v in (r.get(sec) or {}).items():
                if not isinstance(v, dict):
                    flat[f"{sec}_{k}"] = v
        eco = r.get("economy", {})
        flat["currency_code"] = eco.get("currency_code")
        for sub in ("gdp_ppp", "gdp_nominal", "hdi", "gini"):
            for k, v in (eco.get(sub) or {}).items():
                flat[f"{sub}_{k}"] = v
        gen = r.get("general", {})
        for k in ("capital", "demonym", "largest_city", "official_language"):
            flat[f"general_{k}"] = gen.get(k)
        rel  = (gen.get("religion")  or {}).get("groups") or {}
        eth  = (gen.get("ethnic_groups") or {}).get("groups") or {}
        flat["top_religion"] = max(
            ((n, v) for n, v in rel.items() if isinstance(v, (int, float))),
            key=lambda x: x[1], default=(None, None)
        )[0]
        gov = r.get("government", {})
        flat["government_type"] = gov.get("type")
        flat["legislature"]     = gov.get("legislature")
        flat_rows.append(flat)

    pd.DataFrame(flat_rows).to_csv(CSV_OUTPUT_PATH, index=False, encoding="utf-8")

    print(f"Done. {len(rows) - len(errors)}/{len(rows)} countries cleaned.")
    if errors:
        for e in errors:
            print(f"  ERROR: {e['country']}: {e['error']}")
    print(f"  JSON -> {JSON_OUTPUT_PATH}")
    print(f"  CSV  -> {CSV_OUTPUT_PATH}")

# KNIME output
output_table_1 = pd.DataFrame(flat_rows) if "flat_rows" in dir() else pd.DataFrame()