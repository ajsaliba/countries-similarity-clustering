"""
clean_countries.py
==================
Standalone cleaning script for JSON/all_countries.json.

Normalises all 195 country entries so every country exposes the same
flat set of fields with consistent types and value formats.

Can also be pasted directly into KNIME's Python Script (Legacy) node:
  - Set JSON_INPUT_PATH / CSV_OUTPUT_PATH to match your file system.
  - The final two lines assign output_table_1 for the KNIME table port.
"""

import json
import re
import os
import pandas as pd

# ---------------------------------------------------------------
# Paths  (edit if running standalone or inside KNIME)
# ---------------------------------------------------------------
_BASE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else "."
JSON_INPUT_PATH  = os.path.join(_BASE, "..", "JSON", "all_countries.json")
JSON_OUTPUT_PATH = os.path.join(_BASE, "..", "JSON", "all_countries_clean.json")
CSV_OUTPUT_PATH  = os.path.join(_BASE, "..", "JSON", "all_countries_flat.csv")


# ================================================================
# Helper utilities
# ================================================================

def _first(d: dict, *keys):
    """Return the value of the first matching key found in *d*."""
    for k in keys:
        if k in d:
            return d[k]
    return None


def _first_by_prefix(d: dict, prefix: str):
    """Return the value of the first key in *d* that starts with *prefix*."""
    for k in d:
        if k.startswith(prefix):
            return d[k]
    return None


def _most_recent_by_prefix(d: dict, prefix: str):
    """
    Among all keys starting with *prefix*, return the value whose key
    contains the highest 4-digit year, falling back to any match.
    """
    best_year, best_val = -1, None
    any_val = None
    for k, v in d.items():
        if k == prefix or k.startswith(prefix):
            any_val = v
            m = re.search(r"\b(\d{4})\b", k)
            year = int(m.group(1)) if m else 0
            if year >= best_year:
                best_year, best_val = year, v
    return best_val if best_val is not None else any_val


def extract_capital(raw) -> str | None:
    """
    Strip Wikipedia coordinate notation from a capital field.
    e.g. "Kabul 34°31′N 69°11′E ﻿ / …"  →  "Kabul"
    """
    if not raw or not isinstance(raw, str):
        return None
    # Split on first occurrence of a degree symbol or digit+° pattern
    city = re.split(r"\s+\d+[°º]", raw)[0].strip()
    # Some entries include "Country: …" suffix
    city = re.sub(r"\s+Country:.*", "", city).strip()
    return city or None


def extract_first_number(text: str, *, keep_decimal=True) -> float | None:
    """Extract the first numeric value from an arbitrary string."""
    if not text or not isinstance(text, str):
        return None
    text = text.replace(",", "")
    pattern = r"[\d]+(?:\.\d+)?" if keep_decimal else r"\d+"
    m = re.search(pattern, text)
    return float(m.group()) if m else None


def extract_world_rank(text: str) -> int | None:
    """Extract world rank from strings like '( 40th )' or '(22nd)'."""
    if not text or not isinstance(text, str):
        return None
    m = re.search(r"\(\s*(\d+)\s*(?:st|nd|rd|th)\s*\)", text)
    return int(m.group(1)) if m else None


def gdp_to_billions(text: str) -> float | None:
    """
    Convert GDP total strings to float billions USD.
    Handles 'million', 'billion', 'trillion' suffixes.
    Strips parenthetical rank and currency symbols.
    """
    if not text or not isinstance(text, str):
        return None
    text = re.sub(r"\s*\([^)]*\)", "", text).strip()   # drop "(22nd)" etc.
    m = re.match(r"[^\d]*([\d,\.]+)\s*(trillion|billion|million)?",
                 text, re.IGNORECASE)
    if not m:
        return None
    value = float(m.group(1).replace(",", ""))
    unit = (m.group(2) or "billion").lower()
    if unit == "trillion":
        value *= 1_000
    elif unit == "million":
        value /= 1_000
    return round(value, 3)


def per_capita_usd(text: str) -> int | None:
    """Extract per-capita GDP as integer USD (not billions)."""
    if not text or not isinstance(text, str):
        return None
    text = re.sub(r"\s*\([^)]*\)", "", text)           # drop rank
    text = re.sub(r"[^\d]", "", text)                  # keep digits only
    return int(text) if text else None


def normalize_timezone(text: str) -> str | None:
    """
    Normalise timezone strings to 'UTC±HH:MM'.
    Multiple timezone countries (e.g. Australia) keep only the first.
    Unicode minus/dash/plus-minus variants are handled.
    """
    if not text or not isinstance(text, str):
        return None
    text = text.split(";")[0].strip()
    # Unify Unicode variants: minus, en-dash, word-joiner, plus-minus
    text = (text.replace("\u2212", "-")
                .replace("\u2013", "-")
                .replace("\u2060", "")   # word joiner (e.g. Spain)
                .replace("\u00b1", "+")) # ±0 means UTC+00:00
    m = re.search(r"UTC\s*([+\-])\s*(\d{1,2})(?::(\d{2}))?", text, re.IGNORECASE)
    if m:
        sign  = m.group(1)
        hours = int(m.group(2))
        mins  = int(m.group(3) or 0)
        return f"UTC{sign}{hours:02d}:{mins:02d}"
    # "UTC ( GMT )" or bare "UTC" → UTC+00:00
    if re.search(r"\bUTC\b", text, re.IGNORECASE):
        return "UTC+00:00"
    return None


def flatten_religion(religion_data) -> dict:
    """
    Flatten the two religion formats found in the data into
    {religion_name: percentage_string}:
      • Flat:   {"Islam": "99.9%", "other": "0.1%"}
      • Nested: {"Islam": {"percentage": "99.9%", "breakdown": {...}}}
    """
    if not religion_data or not isinstance(religion_data, dict):
        return {}
    flat = {}
    for rel, data in religion_data.items():
        if isinstance(data, dict) and "percentage" in data:
            flat[rel] = data["percentage"]
        elif isinstance(data, str):
            flat[rel] = data
        # Skip deeper nesting (e.g. Antigua's Rastafari sub-object)
    return flat


def top_religion(flat: dict) -> tuple[str | None, float | None]:
    """Return (name, percentage_float) of the dominant religion."""
    best_name, best_pct = None, -1.0
    for rel, pct_str in flat.items():
        if isinstance(pct_str, str):
            m = re.search(r"([\d\.]+)", pct_str)
            if m:
                pct = float(m.group(1))
                if pct > best_pct:
                    best_pct, best_name = pct, rel
    return best_name, (best_pct if best_pct >= 0 else None)


def currency_code(text: str) -> str | None:
    """
    Extract the 3-letter ISO 4217 currency code from strings like
    'Afghan afghani (AFN)' or 'Afghani ( افغانى ) ( AFN )'.
    """
    if not text or not isinstance(text, str):
        return None
    # Prefer the last (outermost) 3-letter uppercase token in parens
    # Spaces inside parens are common: "( AFN )"
    hits = re.findall(r"\(\s*([A-Z]{3})\s*\)", text)
    return hits[-1] if hits else text.strip()


def water_pct(text: str) -> float:
    """Parse water percentage; 'negligible' → 0.0."""
    if not text or not isinstance(text, str):
        return 0.0
    if re.match(r"negligible|none|n/?a", text.strip(), re.IGNORECASE):
        return 0.0
    n = extract_first_number(text)
    return n if n is not None else 0.0


_PURE_NUMBER = re.compile(r"^-?\d+(\.\d+)?$")

def _sort_and_coerce(record: dict) -> dict:
    """
    Return a new dict where:
      • "country" is always the first key.
      • All remaining keys are sorted alphabetically.
      • String values that are pure integers or decimals (matching
        matching r'^-?\\d+(\\.\\d+)?$') are coerced to int or float.
        Strings with leading "+", ".", or letters are left as-is.
    """
    def coerce(v):
        if not isinstance(v, str):
            return v
        if _PURE_NUMBER.match(v):
            return int(v) if "." not in v else float(v)
        return v

    rest = {k: coerce(v) for k, v in record.items() if k != "country"}
    return {"country": record["country"], **dict(sorted(rest.items()))}


def ethnic_groups_string(raw) -> str | None:
    """
    Normalise ethnic groups to a human-readable
    'Group1: XX%, Group2: YY%' string.
    """
    if isinstance(raw, dict):
        parts = []
        for k, v in raw.items():
            if isinstance(v, str):
                parts.append(f"{k}: {v}")
        return "; ".join(parts) if parts else None
    if isinstance(raw, str):
        return raw
    return None


# ================================================================
# Per-country extraction
# ================================================================

def clean_country(entry: dict) -> dict:
    name    = entry.get("country", "")
    url     = entry.get("url", "")
    ib      = entry.get("infobox", {})

    general    = ib.get("General", {})
    government = ib.get("Government", {})
    area_sec   = ib.get("Area", {})
    pop_sec    = ib.get("Population", {})
    eco        = ib.get("Economy", {})
    time_sec   = ib.get("Time", {})
    codes_sec  = ib.get("Codes", {})

    # ------------------------------------------------------------------
    # General → Capital / Largest city
    # ------------------------------------------------------------------
    cap_raw = _first(general,
                     "Capital and largest city", "Capital",
                     "Capital Administrative center",   # e.g. Palestine
                     "Administrative center", "Administrative Centre",
                     "Administrative capital", "Seat of government")
    capital      = extract_capital(cap_raw)
    lc_raw       = general.get("Largest city", cap_raw
                               if "Capital and largest city" in general else None)
    largest_city = extract_capital(lc_raw)

    # ------------------------------------------------------------------
    # General → Official language  (many key variants)
    # ------------------------------------------------------------------
    lang_raw = _first(general,
                      "Official languages", "Official language",
                      "National language", "National languages",
                      "Official language and national language",
                      "National language (official)",          # Malaysia
                      "Recognised national languages",         # Fiji
                      "Common languages",
                      "Official language (federal level)",
                      "Co-official languages",
                      "Spoken languages")
    if isinstance(lang_raw, list):
        lang_raw = " ".join(lang_raw)
    elif isinstance(lang_raw, dict):
        # e.g. Switzerland: {"), French (": "62%", "), Italian (": "23%", ...}
        # Extract capitalised words (language names) from garbled markup keys
        langs = []
        for k in lang_raw:
            words = re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b", k)
            langs.extend(words)
        lang_raw = " / ".join(langs) if langs else None
    official_language = lang_raw if isinstance(lang_raw, str) and lang_raw else None

    # ------------------------------------------------------------------
    # General → Demonym
    # ------------------------------------------------------------------
    demonym = _first(general, "Demonym", "Demonyms")
    if isinstance(demonym, list):
        demonym = demonym[0] if demonym else None

    # ------------------------------------------------------------------
    # General → Ethnic groups (any year variant)
    # ------------------------------------------------------------------
    ethnic_raw = _first_by_prefix(general, "Ethnic groups") \
              or _first_by_prefix(general, "Ethnic")
    ethnic_groups = ethnic_groups_string(ethnic_raw)

    # ------------------------------------------------------------------
    # General → Religion (most-recent year, flatten)
    # ------------------------------------------------------------------
    rel_raw  = _most_recent_by_prefix(general, "Religion")
    rel_flat = flatten_religion(rel_raw)
    top_rel, top_rel_pct = top_religion(rel_flat)

    # ------------------------------------------------------------------
    # Area
    # ------------------------------------------------------------------
    # "Total area" (Canada, USA) or "Total" (most); Denmark uses country name as key
    area_total_raw = area_sec.get("Total") \
                  or area_sec.get("Total area") \
                  or next((v for v in area_sec.values()
                           if isinstance(v, str) and "km" in v), "")
    area_km2       = extract_first_number(area_total_raw)
    area_rank      = extract_world_rank(area_total_raw)
    water_percent  = water_pct(area_sec.get("Water (%)", "0"))

    # ------------------------------------------------------------------
    # Population (most recent year)
    # ------------------------------------------------------------------
    pop_val = pop_rank = pop_density = None
    pop_year = None
    best_pop_year = -1

    for key, val in pop_sec.items():
        if key in ("Density", "Date format") or not isinstance(val, str):
            continue
        m = re.search(r"\b(20\d{2})\b", key)
        if not m:
            continue
        yr = int(m.group(1))
        if yr < best_pop_year:
            continue
        best_pop_year = yr
        pop_year = yr

        # Handle range values like "35–50 million"
        clean = re.sub(r"\s*\([^)]*\)", "", val).strip()
        clean = clean.replace(",", "").replace("\u2013", "-").replace("\u2212", "-")
        range_m = re.match(r"([\d]+)\s*[-]\s*([\d]+)\s*(million|billion)?",
                           clean, re.IGNORECASE)
        if range_m:
            lo  = float(range_m.group(1))
            hi  = float(range_m.group(2))
            mul = 1_000_000 if (range_m.group(3) or "").lower() == "million" else 1
            pop_val = int((lo + hi) / 2 * mul)
        else:
            num_m = re.match(r"(\d[\d]*)", clean.replace(",", ""))
            pop_val = int(num_m.group(1)) if num_m else None

        pop_rank = extract_world_rank(val)

    density_raw = pop_sec.get("Density", "")
    if density_raw:
        pop_density = extract_first_number(density_raw)

    # ------------------------------------------------------------------
    # Economy → GDP PPP
    # ------------------------------------------------------------------
    gdp_ppp = eco.get("GDP ( PPP )", {})
    gdp_ppp_total_b = None
    gdp_ppp_pc_usd  = None
    if isinstance(gdp_ppp, dict):
        gdp_ppp_total_b = gdp_to_billions(gdp_ppp.get("Total"))
        gdp_ppp_pc_usd  = per_capita_usd(gdp_ppp.get("Per capita"))

    # ------------------------------------------------------------------
    # Economy → GDP Nominal
    # ------------------------------------------------------------------
    gdp_nom = eco.get("GDP (nominal)", {})
    gdp_nom_total_b = None
    gdp_nom_pc_usd  = None
    if isinstance(gdp_nom, dict):
        gdp_nom_total_b = gdp_to_billions(gdp_nom.get("Total"))
        gdp_nom_pc_usd  = per_capita_usd(gdp_nom.get("Per capita"))

    # ------------------------------------------------------------------
    # Economy → HDI (prefer most recent year)
    # ------------------------------------------------------------------
    hdi = hdi_category = None
    hdi_rank = hdi_year = None
    for yr in ("2024", "2023", "2022", "2021"):
        raw_hdi = eco.get(f"HDI ({yr})")
        if raw_hdi:
            m = re.match(r"([\d\.]+)", raw_hdi)
            hdi = float(m.group(1)) if m else None
            cat = re.search(r"(very high|high|medium|low)", raw_hdi, re.IGNORECASE)
            hdi_category = cat.group(1).lower() if cat else None
            hdi_rank = extract_world_rank(raw_hdi)
            hdi_year = int(yr)
            break

    # ------------------------------------------------------------------
    # Economy → Gini (most recent year)
    # ------------------------------------------------------------------
    gini = gini_category = gini_year = None
    best_gini_yr = -1
    for k, v in eco.items():
        if not k.startswith("Gini"):
            continue
        m = re.search(r"\b(\d{4})\b", k)
        yr = int(m.group(1)) if m else 0
        if yr >= best_gini_yr:
            best_gini_yr = yr
            nm = re.match(r"([\d\.]+)", v) if isinstance(v, str) else None
            gini = float(nm.group(1)) if nm else None
            cat  = re.search(r"(very high|high|medium|low)", v or "",
                             re.IGNORECASE)
            gini_category = cat.group(1).lower() if cat else None
            gini_year = yr if yr > 0 else None

    # ------------------------------------------------------------------
    # Economy → Currency code
    # ------------------------------------------------------------------
    cur_code = currency_code(eco.get("Currency", ""))

    # ------------------------------------------------------------------
    # Government
    # ------------------------------------------------------------------
    government_type = government.get("Government")
    legislature     = government.get("Legislature")

    # ------------------------------------------------------------------
    # Time zone
    # ------------------------------------------------------------------
    tz = normalize_timezone(time_sec.get("Time zone", ""))

    # ------------------------------------------------------------------
    # Codes
    # Some countries (e.g. Denmark, Netherlands) prefix multi-entry
    # calling/TLD fields with a count: "3 codes +45 … +298 …" or
    # "3 TLDs .dk … .fo …".  Extract the first real value in each case.
    # ------------------------------------------------------------------
    iso_code     = codes_sec.get("ISO 3166 code")

    calling_raw  = codes_sec.get("Calling code", "") or ""
    # Real calling codes start with "+" – grab the first such token
    cc_hits = re.findall(r"\+[\d\s]+", calling_raw)
    calling_code = cc_hits[0].strip() if cc_hits else (calling_raw.strip() or None)

    tld_raw = codes_sec.get("Internet TLD", "") or ""
    # Real TLDs start with "." – grab the first such token
    tld_hits = re.findall(r"\.\S+", tld_raw)
    tld = tld_hits[0] if tld_hits else None

    # ------------------------------------------------------------------
    # Assemble flat record, then sort keys alphabetically
    # ("country" is pinned first; all other keys sorted A→Z).
    # String values that are pure integers or decimals are coerced to
    # their numeric type (calling codes keep their leading "+" so they
    # are not affected).
    # ------------------------------------------------------------------
    raw = {
        "country":                       name,
        "iso_3166_code":                 iso_code,
        "url":                           url,
        "capital":                       capital,
        "largest_city":                  largest_city,
        "official_language":             official_language,
        "demonym":                       demonym,
        "ethnic_groups":                 ethnic_groups,
        "top_religion":                  top_rel,
        "top_religion_pct":              top_rel_pct,
        "government_type":               government_type,
        "legislature":                   legislature,
        "area_km2":                      area_km2,
        "area_rank":                     area_rank,
        "water_pct":                     water_percent,
        "population":                    pop_val,
        "population_year":               pop_year,
        "population_rank":               pop_rank,
        "population_density_per_km2":    pop_density,
        "gdp_ppp_total_billion_usd":     gdp_ppp_total_b,
        "gdp_ppp_per_capita_usd":        gdp_ppp_pc_usd,
        "gdp_nominal_total_billion_usd": gdp_nom_total_b,
        "gdp_nominal_per_capita_usd":    gdp_nom_pc_usd,
        "hdi":                           hdi,
        "hdi_category":                  hdi_category,
        "hdi_rank":                      hdi_rank,
        "hdi_year":                      hdi_year,
        "gini":                          gini,
        "gini_category":                 gini_category,
        "gini_year":                     gini_year,
        "currency_code":                 cur_code,
        "timezone_utc":                  tz,
        "calling_code":                  calling_code,
        "internet_tld":                  tld,
    }
    return _sort_and_coerce(raw)


# ================================================================
# Main
# ================================================================

if __name__ == "__main__" or "output_table_1" not in dir():
    with open(JSON_INPUT_PATH, encoding="utf-8") as f:
        raw_data = json.load(f)

    rows = []
    errors = []
    for entry in raw_data["countries"]:
        try:
            rows.append(clean_country(entry))
        except Exception as exc:
            errors.append({"country": entry.get("country", "?"), "error": str(exc)})
            rows.append({"country": entry.get("country", "?"), "error": str(exc)})

    # Write flat JSON
    with open(JSON_OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump({"countries": rows}, f, ensure_ascii=False, indent=2, default=str)

    # Write flat CSV
    df = pd.DataFrame(rows)
    df.to_csv(CSV_OUTPUT_PATH, index=False, encoding="utf-8")

    print(f"Done. {len(rows) - len(errors)}/{len(rows)} countries cleaned.")
    if errors:
        print(f"Errors ({len(errors)}):")
        for e in errors:
            print(f"  {e['country']}: {e['error']}")
    print(f"  JSON -> {JSON_OUTPUT_PATH}")
    print(f"  CSV  -> {CSV_OUTPUT_PATH}")

# ================================================================
# KNIME Python Script (Legacy) output
# (This line is ignored when running standalone)
# ================================================================
output_table_1 = pd.DataFrame(rows) if "rows" in dir() else pd.DataFrame()