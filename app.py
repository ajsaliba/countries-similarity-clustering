"""
app.py — SIMILICA Flask Backend
================================
Single-file Flask application wiring the SIMILICA UI to real Python algorithms.
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from flask import Flask, jsonify, render_template, request, session

# ── path setup so `ted` and `clustering` are importable ──────────────────────
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

from ted.tree_builder import build_country_tree
from ted.node import Node
from ted.similarity import ted_similarity
from ted.cost_functions import CostFunction
from ted.run_ted import (
    diff_trees,
    apply_edit_script,
    script_summary,
    node_to_data,
    clone_node,
    verify_patch,
)
from clustering.cluster import agglomerative, dbscan, spectral, kmedoids

app = Flask(__name__)
app.secret_key = "similica-secret-2026"

# ─────────────────────────────────────────────────────────────────────────────
# Region lookup
# ─────────────────────────────────────────────────────────────────────────────
REGION_MAP: Dict[str, str] = {
    # Europe
    "AD": "Europe", "AL": "Europe", "AM": "Europe", "AT": "Europe",
    "AZ": "Europe", "BA": "Europe", "BE": "Europe", "BG": "Europe",
    "BY": "Europe", "CH": "Europe", "CY": "Europe", "CZ": "Europe",
    "DE": "Europe", "DK": "Europe", "EE": "Europe", "ES": "Europe",
    "FI": "Europe", "FR": "Europe", "GB": "Europe", "GE": "Europe",
    "GR": "Europe", "HR": "Europe", "HU": "Europe", "IE": "Europe",
    "IS": "Europe", "IT": "Europe", "KZ": "Europe", "LI": "Europe",
    "LT": "Europe", "LU": "Europe", "LV": "Europe", "MC": "Europe",
    "MD": "Europe", "ME": "Europe", "MK": "Europe", "MT": "Europe",
    "NL": "Europe", "NO": "Europe", "PL": "Europe", "PT": "Europe",
    "RO": "Europe", "RS": "Europe", "RU": "Europe", "SE": "Europe",
    "SI": "Europe", "SK": "Europe", "SM": "Europe", "TR": "Europe",
    "UA": "Europe", "VA": "Europe", "XK": "Europe",
    # Americas
    "AG": "Americas", "AI": "Americas", "AN": "Americas", "AR": "Americas",
    "AW": "Americas", "BB": "Americas", "BL": "Americas", "BM": "Americas",
    "BO": "Americas", "BQ": "Americas", "BR": "Americas", "BS": "Americas",
    "BZ": "Americas", "CA": "Americas", "CL": "Americas", "CO": "Americas",
    "CR": "Americas", "CU": "Americas", "CW": "Americas", "DM": "Americas",
    "DO": "Americas", "EC": "Americas", "FK": "Americas", "GD": "Americas",
    "GF": "Americas", "GP": "Americas", "GT": "Americas", "GY": "Americas",
    "HN": "Americas", "HT": "Americas", "JM": "Americas", "KN": "Americas",
    "KY": "Americas", "LC": "Americas", "MF": "Americas", "MQ": "Americas",
    "MS": "Americas", "MX": "Americas", "NI": "Americas", "PA": "Americas",
    "PE": "Americas", "PM": "Americas", "PR": "Americas", "PY": "Americas",
    "SR": "Americas", "SV": "Americas", "SX": "Americas", "TC": "Americas",
    "TT": "Americas", "US": "Americas", "UY": "Americas", "VC": "Americas",
    "VE": "Americas", "VG": "Americas", "VI": "Americas",
    # Asia
    "AE": "Asia", "AF": "Asia", "BD": "Asia", "BH": "Asia", "BN": "Asia",
    "BT": "Asia", "CN": "Asia", "ID": "Asia", "IL": "Asia", "IN": "Asia",
    "IQ": "Asia", "IR": "Asia", "JO": "Asia", "JP": "Asia", "KG": "Asia",
    "KH": "Asia", "KP": "Asia", "KR": "Asia", "KW": "Asia", "LA": "Asia",
    "LB": "Asia", "LK": "Asia", "MM": "Asia", "MN": "Asia", "MO": "Asia",
    "MV": "Asia", "MY": "Asia", "NP": "Asia", "OM": "Asia", "PH": "Asia",
    "PK": "Asia", "PS": "Asia", "QA": "Asia", "SA": "Asia", "SG": "Asia",
    "SY": "Asia", "TH": "Asia", "TJ": "Asia", "TL": "Asia", "TM": "Asia",
    "TW": "Asia", "UZ": "Asia", "VN": "Asia", "YE": "Asia",
    # Africa
    "AO": "Africa", "BF": "Africa", "BI": "Africa", "BJ": "Africa",
    "BW": "Africa", "CD": "Africa", "CF": "Africa", "CG": "Africa",
    "CI": "Africa", "CM": "Africa", "CV": "Africa", "DJ": "Africa",
    "DZ": "Africa", "EG": "Africa", "ER": "Africa", "ET": "Africa",
    "GA": "Africa", "GH": "Africa", "GM": "Africa", "GN": "Africa",
    "GQ": "Africa", "GW": "Africa", "KE": "Africa", "KM": "Africa",
    "LR": "Africa", "LS": "Africa", "LY": "Africa", "MA": "Africa",
    "MG": "Africa", "ML": "Africa", "MR": "Africa", "MU": "Africa",
    "MW": "Africa", "MZ": "Africa", "NA": "Africa", "NE": "Africa",
    "NG": "Africa", "RW": "Africa", "SC": "Africa", "SD": "Africa",
    "SL": "Africa", "SN": "Africa", "SO": "Africa", "SS": "Africa",
    "ST": "Africa", "SZ": "Africa", "TD": "Africa", "TG": "Africa",
    "TN": "Africa", "TZ": "Africa", "UG": "Africa", "ZA": "Africa",
    "ZM": "Africa", "ZW": "Africa",
    # Oceania
    "AU": "Oceania", "FJ": "Oceania", "FM": "Oceania", "GU": "Oceania",
    "KI": "Oceania", "MH": "Oceania", "MP": "Oceania", "NC": "Oceania",
    "NR": "Oceania", "NZ": "Oceania", "PF": "Oceania", "PG": "Oceania",
    "PW": "Oceania", "SB": "Oceania", "TO": "Oceania", "TV": "Oceania",
    "VU": "Oceania", "WS": "Oceania",
}

DATA_DIR = BASE_DIR / "data" / "clean" / "countries"
SEMANTIC_DATA_DIR = BASE_DIR / "data" / "cleaned-data"
PATCH_OUTPUT_DIR = BASE_DIR / "outputs" / "patches"
TED_MATRIX_FILE = BASE_DIR / "outputs" / "matrix.npz"
MDS_COORDS_FILE = BASE_DIR / "outputs" / "mds_coords.npz"

# Map every wizard "Select Labels" key to the corresponding top-level keys
# in the cleaned-data schema, so the same UI filter can prune both
# datasets even though their vocabularies differ.
LABEL_TO_CLEANED_KEYS: Dict[str, List[str]] = {
    # Sections (wizard "top-level") → cleaned-data keys they cover
    "general":          ["Capital", "Official Languages", "Ethnic Groups", "Religions"],
    "government":       ["Government Type", "Government Structure"],
    "economy":          ["GDP PPP", "GDP Nominal", "HDI", "Currency"],
    "population":       ["Population"],
    "area":             ["Area"],
    "codes":            [],  # cleaned-data has no codes section
    "time":             [],
    "history":          [],

    # Leaf labels under General
    "capital":           ["Capital"],
    "official_language": ["Official Languages"],
    "religion":          ["Religions"],
    "ethnic_groups":     ["Ethnic Groups"],
    "demonym":           [],

    # Leaf labels under Government
    "type":         ["Government Type"],
    "legislature":  [],
    "lower_house":  [],
    "upper_house":  [],

    # Leaf labels under Economy
    "currency_code": ["Currency"],
    "gdp_ppp":       ["GDP PPP"],
    "gdp_nominal":   ["GDP Nominal"],
    "hdi":           ["HDI"],
    "gini":          [],

    # Other leaves (mostly nested inside cleaned-data, so dropping at
    # top-level only triggers when the whole section is excluded)
    "total":           [],
    "density_per_km2": [],
    "total_km2":       [],
    "water_pct":       [],
    "rank":            [],
    "calling_code":    [],
    "internet_tld":    [],
    "iso_3166_code":   [],
    "timezone_utc":    [],
    "timezone_dst":    [],
}

# ── ISO 3166 → approximate (lat, lng) country centroid for the map overlay ──
COUNTRY_COORDS: Dict[str, Tuple[float, float]] = {
    "AD": (42.5, 1.5), "AE": (24.0, 54.0), "AF": (33.0, 65.0), "AG": (17.05, -61.8),
    "AL": (41.0, 20.0), "AM": (40.0, 45.0), "AO": (-12.5, 18.5), "AR": (-34.0, -64.0),
    "AT": (47.3, 13.3), "AU": (-27.0, 133.0), "AZ": (40.5, 47.5), "BA": (44.0, 18.0),
    "BB": (13.17, -59.5), "BD": (24.0, 90.0), "BE": (50.8, 4.0), "BF": (13.0, -2.0),
    "BG": (43.0, 25.0), "BH": (26.0, 50.55), "BI": (-3.5, 30.0), "BJ": (9.5, 2.25),
    "BN": (4.5, 114.7), "BO": (-17.0, -65.0), "BR": (-10.0, -55.0), "BS": (24.25, -76.0),
    "BT": (27.5, 90.5), "BW": (-22.0, 24.0), "BY": (53.0, 28.0), "BZ": (17.25, -88.75),
    "CA": (60.0, -95.0), "CD": (0.0, 25.0), "CF": (7.0, 21.0), "CG": (-1.0, 15.0),
    "CH": (47.0, 8.0), "CI": (8.0, -5.0), "CL": (-30.0, -71.0), "CM": (6.0, 12.0),
    "CN": (35.0, 105.0), "CO": (4.0, -72.0), "CR": (10.0, -84.0), "CU": (21.5, -80.0),
    "CV": (16.0, -24.0), "CY": (35.0, 33.0), "CZ": (49.75, 15.5), "DE": (51.0, 9.0),
    "DJ": (11.5, 43.0), "DK": (56.0, 10.0), "DM": (15.42, -61.33), "DO": (19.0, -70.7),
    "DZ": (28.0, 3.0), "EC": (-2.0, -77.5), "EE": (59.0, 26.0), "EG": (27.0, 30.0),
    "ER": (15.0, 39.0), "ES": (40.0, -4.0), "ET": (8.0, 38.0), "FI": (64.0, 26.0),
    "FJ": (-18.0, 175.0), "FM": (6.92, 158.25), "FR": (46.0, 2.0), "GA": (-1.0, 11.75),
    "GB": (54.0, -2.0), "GD": (12.12, -61.67), "GE": (42.0, 43.5), "GH": (8.0, -2.0),
    "GM": (13.47, -16.57), "GN": (11.0, -10.0), "GQ": (2.0, 10.0), "GR": (39.0, 22.0),
    "GT": (15.5, -90.25), "GW": (12.0, -15.0), "GY": (5.0, -59.0), "HN": (15.0, -86.5),
    "HR": (45.17, 15.5), "HT": (19.0, -72.42), "HU": (47.0, 20.0), "ID": (-5.0, 120.0),
    "IE": (53.0, -8.0), "IL": (31.5, 34.75), "IN": (20.0, 77.0), "IQ": (33.0, 44.0),
    "IR": (32.0, 53.0), "IS": (65.0, -18.0), "IT": (42.83, 12.83), "JM": (18.25, -77.5),
    "JO": (31.0, 36.0), "JP": (36.0, 138.0), "KE": (1.0, 38.0), "KG": (41.0, 75.0),
    "KH": (13.0, 105.0), "KI": (1.42, 173.0), "KM": (-12.17, 44.25), "KN": (17.33, -62.75),
    "KP": (40.0, 127.0), "KR": (37.0, 127.5), "KW": (29.5, 47.75), "KZ": (48.0, 68.0),
    "LA": (18.0, 105.0), "LB": (33.83, 35.83), "LC": (13.88, -61.13), "LI": (47.27, 9.53),
    "LK": (7.0, 81.0), "LR": (6.5, -9.5), "LS": (-29.5, 28.5), "LT": (56.0, 24.0),
    "LU": (49.75, 6.17), "LV": (57.0, 25.0), "LY": (25.0, 17.0), "MA": (32.0, -5.0),
    "MC": (43.73, 7.4), "MD": (47.0, 29.0), "ME": (42.5, 19.3), "MG": (-20.0, 47.0),
    "MH": (9.0, 168.0), "MK": (41.83, 22.0), "ML": (17.0, -4.0), "MM": (22.0, 98.0),
    "MN": (46.0, 105.0), "MR": (20.0, -12.0), "MT": (35.83, 14.58), "MU": (-20.28, 57.55),
    "MV": (3.25, 73.0), "MW": (-13.5, 34.0), "MX": (23.0, -102.0), "MY": (2.5, 112.5),
    "MZ": (-18.25, 35.0), "NA": (-22.0, 17.0), "NE": (16.0, 8.0), "NG": (10.0, 8.0),
    "NI": (13.0, -85.0), "NL": (52.5, 5.75), "NO": (62.0, 10.0), "NP": (28.0, 84.0),
    "NR": (-0.53, 166.92), "NZ": (-41.0, 174.0), "OM": (21.0, 57.0), "PA": (9.0, -80.0),
    "PE": (-10.0, -76.0), "PG": (-6.0, 147.0), "PH": (13.0, 122.0), "PK": (30.0, 70.0),
    "PL": (52.0, 20.0), "PT": (39.5, -8.0), "PW": (7.5, 134.5), "PY": (-23.0, -58.0),
    "QA": (25.5, 51.25), "RO": (46.0, 25.0), "RS": (44.0, 21.0), "RU": (60.0, 100.0),
    "RW": (-2.0, 30.0), "SA": (25.0, 45.0), "SB": (-8.0, 159.0), "SC": (-4.58, 55.67),
    "SD": (15.0, 30.0), "SE": (62.0, 15.0), "SG": (1.37, 103.8), "SI": (46.0, 15.0),
    "SK": (48.67, 19.5), "SL": (8.5, -11.5), "SM": (43.93, 12.42), "SN": (14.0, -14.0),
    "SO": (10.0, 49.0), "SR": (4.0, -56.0), "SS": (8.0, 30.0), "ST": (1.0, 7.0),
    "SV": (13.83, -88.92), "SY": (35.0, 38.0), "SZ": (-26.5, 31.5), "TD": (15.0, 19.0),
    "TG": (8.0, 1.17), "TH": (15.0, 100.0), "TJ": (39.0, 71.0), "TL": (-8.83, 125.92),
    "TM": (40.0, 60.0), "TN": (34.0, 9.0), "TO": (-20.0, -175.0), "TR": (39.0, 35.0),
    "TT": (11.0, -61.0), "TV": (-8.0, 178.0), "TW": (23.5, 121.0), "TZ": (-6.0, 35.0),
    "UA": (49.0, 32.0), "UG": (1.0, 32.0), "US": (38.0, -97.0), "UY": (-33.0, -56.0),
    "UZ": (41.0, 64.0), "VA": (41.9, 12.45), "VC": (13.25, -61.2), "VE": (8.0, -66.0),
    "VN": (16.17, 107.83), "VU": (-16.0, 167.0), "WS": (-13.58, -172.33), "XK": (42.67, 21.17),
    "YE": (15.0, 48.0), "ZA": (-29.0, 24.0), "ZM": (-15.0, 30.0), "ZW": (-19.0, 30.0),
}

# ── in-memory stores ──────────────────────────────────────────────────────────
COUNTRY_DATA: Dict[str, dict] = {}                # data/clean/countries — drives structural + UI
SEMANTIC_DATA: Dict[str, dict] = {}               # data/cleaned-data    — drives the semantic Jaccard only
_SEMANTIC_NORM_INDEX: Dict[str, str] = {}         # lower-cased name → SEMANTIC_DATA key, for fuzzy match
COUNTRY_LIST: List[dict] = []
_TREE_CACHE: Dict[str, Node] = {}
_MATRIX_CACHE: Dict[str, Any] = {}
_JOBS: Dict[str, dict] = {}

# Precomputed full-corpus TED similarity matrix. Populated once at startup
# (either loaded from outputs/matrix.npz or rebuilt). When present, every
# clustering call slices a sub-matrix from it instead of computing TEDs live.
_TED_MATRIX: Optional[Dict[str, Any]] = None      # {names, sim, dist, name_to_idx}

# Persistent MDS coordinate atlas for the full corpus. Populated once at
# startup (loaded from outputs/mds_coords.npz or computed + saved). Every
# clustering call just indexes into this — no per-request MDS run.
_MDS_ATLAS: Optional[Dict[str, Any]] = None       # {coords: 195x2 array, name_to_idx}


# ─────────────────────────────────────────────────────────────────────────────
# Startup data loading
# ─────────────────────────────────────────────────────────────────────────────

def _infer_region(code: str) -> str:
    return REGION_MAP.get(code, "Other")


def load_countries() -> None:
    for f in sorted(DATA_DIR.glob("*.json")):
        raw_name = f.stem.replace("_", " ")
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        name = data.get("country", raw_name)
        COUNTRY_DATA[name] = data

    for name, d in COUNTRY_DATA.items():
        code = d.get("codes", {}).get("iso_3166_code", "")
        lat, lng = COUNTRY_COORDS.get(code, (None, None))
        COUNTRY_LIST.append({
            "name":   name,
            "code":   code,
            "region": _infer_region(code),
            "lat":    lat,
            "lng":    lng,
        })


def _norm_name(s: str) -> str:
    """Loose key for matching country names across the two datasets."""
    return re.sub(r"[^a-z0-9]", "", s.lower())


def load_semantic_data() -> None:
    """
    Load the data/cleaned-data corpus used by the semantic Jaccard.
    Falls back gracefully if the folder is missing — semantic similarity
    will then drop to comparing empty docs (score 1.0 for identical pair,
    0.0 otherwise).
    """
    if not SEMANTIC_DATA_DIR.exists():
        print(f"[SIMILICA] WARNING: {SEMANTIC_DATA_DIR} not found — semantic dataset unavailable",
              flush=True)
        return

    for f in sorted(SEMANTIC_DATA_DIR.glob("*.json")):
        try:
            # utf-8-sig strips an optional BOM; ~half the cleaned-data files
            # were exported with one and would otherwise fail to parse.
            data = json.loads(f.read_text(encoding="utf-8-sig"))
        except Exception as e:
            print(f"[SIMILICA] skipped {f.name}: {e}", flush=True)
            continue
        # Prefer the "Country" field; fall back to filename.
        name = data.get("Country") or f.stem.replace("_", " ")
        SEMANTIC_DATA[name] = data
        _SEMANTIC_NORM_INDEX[_norm_name(name)] = name

    # Report any countries in COUNTRY_DATA that have no match in cleaned-data.
    missing = [n for n in COUNTRY_DATA if _norm_name(n) not in _SEMANTIC_NORM_INDEX]
    print(f"[SIMILICA] Loaded {len(SEMANTIC_DATA)} cleaned-data semantic documents"
          f"{f' ({len(missing)} unmatched)' if missing else ''}", flush=True)


def _semantic_data_for(name: str) -> dict:
    """
    Return the cleaned-data document for a country name, doing a loose
    name match so 'Bahamas, The' / 'The Bahamas' / 'Bahamas' all resolve.
    Returns an empty dict if there's truly no match.
    """
    if name in SEMANTIC_DATA:
        return SEMANTIC_DATA[name]
    key = _SEMANTIC_NORM_INDEX.get(_norm_name(name))
    return SEMANTIC_DATA.get(key, {}) if key else {}


def load_or_build_ted_matrix() -> None:
    """
    Populate _TED_MATRIX with the full-corpus pairwise TED similarity /
    distance matrix.

    Strategy:
      1. Try outputs/matrix.npz; if its `names` array is exactly the set of
         currently-loaded countries, accept the cached matrix and skip work.
      2. Otherwise compute the matrix (Zhang-Shasha across every pair) and
         persist it back to matrix.npz for next time. This is the slow path
         — first run takes ~30-90s for 195 countries; subsequent starts are
         instant.
    """
    global _TED_MATRIX

    all_names = sorted(COUNTRY_DATA.keys())
    n = len(all_names)

    if TED_MATRIX_FILE.exists():
        try:
            z = np.load(TED_MATRIX_FILE, allow_pickle=True)
            cached_names = list(z["names"].tolist())
            sim = z["sim_array"]
            # IMPORTANT: ignore any cached dist_array. Older versions of this
            # file stored the *raw TED edit-cost* (values 3–30) rather than
            # the similarity-derived distance (1 − similarity, in [0, 1]).
            # Always recompute from sim_array so the clustering algorithms
            # (especially DBSCAN's eps) see distances in the expected range.
            dist = 1.0 - sim
            np.fill_diagonal(dist, 0.0)
            if set(cached_names) == set(all_names) and sim.shape == (len(cached_names), len(cached_names)):
                _TED_MATRIX = {
                    "names":       cached_names,
                    "sim":         sim,
                    "dist":        dist,
                    "name_to_idx": {nm: i for i, nm in enumerate(cached_names)},
                }
                print(f"[SIMILICA] Loaded cached TED matrix ({len(cached_names)}×{len(cached_names)}) "
                      f"from {TED_MATRIX_FILE.relative_to(BASE_DIR)}", flush=True)
                return
            print(f"[SIMILICA] Cached TED matrix ignored (names mismatch); rebuilding…", flush=True)
        except Exception as e:
            print(f"[SIMILICA] Cached TED matrix unreadable ({e}); rebuilding…", flush=True)

    # ── Slow path: compute pairwise TED for every (i, j) ───────────────
    print(f"[SIMILICA] Building TED matrix for {n} countries (this takes ~30-90s on first run)…",
          flush=True)
    trees = {name: build_country_tree(COUNTRY_DATA[name]) for name in all_names}
    sim = np.zeros((n, n), dtype=np.float64)
    total_pairs = n * (n - 1) // 2
    done = 0
    for i in range(n):
        sim[i, i] = 1.0
        for j in range(i + 1, n):
            _, s = ted_similarity(trees[all_names[i]], trees[all_names[j]])
            sim[i, j] = sim[j, i] = s
            done += 1
            if done % 1000 == 0:
                print(f"  {done}/{total_pairs} pairs "
                      f"({100.0 * done / total_pairs:.1f}%)", flush=True)
    dist = 1.0 - sim
    np.fill_diagonal(dist, 0.0)

    TED_MATRIX_FILE.parent.mkdir(parents=True, exist_ok=True)
    np.savez(TED_MATRIX_FILE,
             names=np.array(all_names, dtype=object),
             sim_array=sim,
             dist_array=dist)
    print(f"[SIMILICA] Saved TED matrix to {TED_MATRIX_FILE.relative_to(BASE_DIR)}", flush=True)

    _TED_MATRIX = {
        "names":       all_names,
        "sim":         sim,
        "dist":        dist,
        "name_to_idx": {nm: i for i, nm in enumerate(all_names)},
    }


def load_or_build_mds_atlas() -> None:
    """
    Populate _MDS_ATLAS with a 2D MDS projection of the full corpus.

    First run: ~3-5 seconds on a 195x195 distance matrix; result persisted
    to outputs/mds_coords.npz. Subsequent server starts load it in
    milliseconds. After loading, every clustering call indexes into this
    atlas instead of running MDS — even on Select-All-195.
    """
    global _MDS_ATLAS
    if _TED_MATRIX is None:
        return

    all_names = _TED_MATRIX["names"]
    n = len(all_names)

    if MDS_COORDS_FILE.exists():
        try:
            z = np.load(MDS_COORDS_FILE, allow_pickle=True)
            cached_names = list(z["names"].tolist())
            coords = z["coords"]
            if (set(cached_names) == set(all_names)
                    and coords.shape == (len(cached_names), 2)):
                # Reorder cached coords to match the current corpus order.
                idx_map = {nm: i for i, nm in enumerate(cached_names)}
                ordered = np.array([coords[idx_map[nm]] for nm in all_names])
                _MDS_ATLAS = {
                    "coords":      ordered,
                    "name_to_idx": {nm: i for i, nm in enumerate(all_names)},
                }
                print(f"[SIMILICA] Loaded cached MDS atlas ({n} points) "
                      f"from {MDS_COORDS_FILE.relative_to(BASE_DIR)}", flush=True)
                return
            print("[SIMILICA] Cached MDS atlas ignored (names mismatch); rebuilding…",
                  flush=True)
        except Exception as e:
            print(f"[SIMILICA] Cached MDS atlas unreadable ({e}); rebuilding…",
                  flush=True)

    print(f"[SIMILICA] Building MDS atlas for {n} points (one-time, ~5 s)…",
          flush=True)
    from sklearn.manifold import MDS
    mds = MDS(n_components=2, dissimilarity="precomputed", random_state=42,
              normalized_stress="auto", n_init=1, max_iter=300)
    coords = mds.fit_transform(_TED_MATRIX["dist"])

    MDS_COORDS_FILE.parent.mkdir(parents=True, exist_ok=True)
    np.savez(MDS_COORDS_FILE,
             names=np.array(all_names, dtype=object),
             coords=coords)
    print(f"[SIMILICA] Saved MDS atlas to {MDS_COORDS_FILE.relative_to(BASE_DIR)}",
          flush=True)

    _MDS_ATLAS = {
        "coords":      coords,
        "name_to_idx": {nm: i for i, nm in enumerate(all_names)},
    }


def _mds_subset(names: List[str]) -> Optional[np.ndarray]:
    """Return (len(names), 2) coords array from the atlas; None if any miss."""
    if _MDS_ATLAS is None:
        return None
    try:
        idx = [_MDS_ATLAS["name_to_idx"][nm] for nm in names]
    except KeyError:
        return None
    return _MDS_ATLAS["coords"][idx]


def _ted_submatrices(names: List[str]) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    """
    Return (sim_sub, dist_sub) for the given country subset by slicing the
    cached full matrix.  None if any country isn't in the cache (forces
    the caller to fall back to live computation).
    """
    if _TED_MATRIX is None:
        return None
    name_to_idx = _TED_MATRIX["name_to_idx"]
    try:
        idx = [name_to_idx[nm] for nm in names]
    except KeyError:
        return None
    idx_arr = np.array(idx)
    sim_sub  = _TED_MATRIX["sim"][np.ix_(idx_arr, idx_arr)]
    dist_sub = _TED_MATRIX["dist"][np.ix_(idx_arr, idx_arr)]
    return sim_sub, dist_sub


def _filter_cleaned_by_labels(data: dict, excluded_labels: set) -> dict:
    """
    Translate the wizard's flat excluded-label set to cleaned-data top-
    level keys via LABEL_TO_CLEANED_KEYS, then drop those keys.

    Only top-level keys are filtered; cleaned-data is shallow enough that
    section-level pruning is sufficient.
    """
    if not excluded_labels:
        return data
    drop: set = set()
    for label in excluded_labels:
        for mapped in LABEL_TO_CLEANED_KEYS.get(label, []):
            drop.add(mapped)
    if not drop:
        return data
    return {k: v for k, v in data.items() if k not in drop}

    COUNTRY_LIST.sort(key=lambda x: x["name"])
    print(f"[SIMILICA] Loaded {len(COUNTRY_DATA)} countries", flush=True)


# ─────────────────────────────────────────────────────────────────────────────
# Tree helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_tree(name: str) -> Node:
    if name not in _TREE_CACHE:
        _TREE_CACHE[name] = build_country_tree(COUNTRY_DATA[name])
    return _TREE_CACHE[name]


def _prune_tree_by_labels(root: Node, excluded: set) -> Optional[Node]:
    """
    Return a clone of *root* with every node whose label is in *excluded*
    dropped, along with its entire subtree.

    Returns None if the root itself was excluded (caller should treat as
    "empty tree" — but the root label is always "infobox" which the UI
    never lets the user exclude).
    """
    if root.label in excluded:
        return None
    new_node = Node(label=root.label, node_type=root.node_type, value=root.value)
    for child in root.children:
        pruned = _prune_tree_by_labels(child, excluded)
        if pruned is not None:
            new_node.add_child(pruned)
    return new_node


def _filter_data_by_labels(data: Any, excluded: set) -> Any:
    """
    Recursively drop dict keys whose name is in *excluded*.  Used to filter
    the raw country JSON before computing the semantic Jaccard, so the
    tokens reflect only the user-selected labels.
    """
    if isinstance(data, dict):
        return {k: _filter_data_by_labels(v, excluded)
                for k, v in data.items() if k not in excluded}
    if isinstance(data, list):
        return [_filter_data_by_labels(v, excluded) for v in data]
    return data


def _tree_stats(root: Node) -> dict:
    def walk(node, depth):
        if not node.children:
            return 1, depth, 1
        total_nodes = 1
        max_depth = depth
        total_leaves = 0
        for child in node.children:
            n, d, l = walk(child, depth + 1)
            total_nodes += n
            max_depth = max(max_depth, d)
            total_leaves += l
        return total_nodes, max_depth, total_leaves

    nc, dp, lc = walk(root, 0)
    return {"node_count": nc, "depth": dp, "leaf_count": lc}


# ─────────────────────────────────────────────────────────────────────────────
# XML generation
# ─────────────────────────────────────────────────────────────────────────────

def dict_to_xml(d: Any, tag: str = "infobox", indent: int = 0) -> str:
    pad = "  " * indent
    safe_tag = re.sub(r"[^a-zA-Z0-9_\-.]", "_", str(tag))
    if safe_tag and safe_tag[0].isdigit():
        safe_tag = "_" + safe_tag
    if not safe_tag:
        safe_tag = "field"

    if isinstance(d, dict):
        if not d:
            return f"{pad}<{safe_tag}/>"
        inner = "\n".join(dict_to_xml(v, k, indent + 1) for k, v in d.items())
        return f"{pad}<{safe_tag}>\n{inner}\n{pad}</{safe_tag}>"
    elif isinstance(d, list):
        if not d:
            return f"{pad}<{safe_tag}/>"
        items = "\n".join(f"{'  ' * (indent + 1)}<item>{v}</item>" for v in d)
        return f"{pad}<{safe_tag}>\n{items}\n{pad}</{safe_tag}>"
    else:
        val = "" if d is None else str(d).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        return f"{pad}<{safe_tag}>{val}</{safe_tag}>"


# ─────────────────────────────────────────────────────────────────────────────
# Semantic similarity (Jaccard over text tokens)
# ─────────────────────────────────────────────────────────────────────────────

def extract_text_tokens(country_data: dict) -> set:
    tokens: set = set()

    def walk(obj):
        if isinstance(obj, str):
            tokens.update(re.findall(r"[a-z0-9\xc0-\xff]+", obj.lower()))
        elif isinstance(obj, dict):
            for v in obj.values():
                walk(v)
        elif isinstance(obj, list):
            for v in obj:
                walk(v)

    walk(country_data)
    return tokens


def semantic_similarity(a_data: dict, b_data: dict) -> float:
    ta = extract_text_tokens(a_data)
    tb = extract_text_tokens(b_data)
    if not ta and not tb:
        return 1.0
    intersection = len(ta & tb)
    union = len(ta | tb)
    return intersection / union if union else 0.0


# ─────────────────────────────────────────────────────────────────────────────
# Edit script
# ─────────────────────────────────────────────────────────────────────────────

def generate_edit_script(a_data: dict, b_data: dict) -> List[dict]:
    ops: List[dict] = []

    def compare(a, b, path=""):
        if isinstance(a, dict) and isinstance(b, dict):
            all_keys = sorted(set(a) | set(b))
            for k in all_keys:
                child_path = f"{path}.{k}" if path else k
                if k not in a:
                    ops.append({"op": "insert", "path": child_path,
                                "from_val": "", "to_val": str(b[k])[:120],
                                "dimension": "structural"})
                elif k not in b:
                    ops.append({"op": "delete", "path": child_path,
                                "from_val": str(a[k])[:120], "to_val": "",
                                "dimension": "structural"})
                else:
                    compare(a[k], b[k], child_path)
        else:
            a_str = str(a) if a is not None else ""
            b_str = str(b) if b is not None else ""
            if a_str != b_str:
                ops.append({"op": "update", "path": path,
                            "from_val": a_str[:120], "to_val": b_str[:120],
                            "dimension": "semantic"})
            else:
                ops.append({"op": "match", "path": path,
                            "from_val": a_str[:80], "to_val": b_str[:80],
                            "dimension": "semantic"})

    compare(a_data, b_data)
    return ops


# ─────────────────────────────────────────────────────────────────────────────
# Field-level scores
# ─────────────────────────────────────────────────────────────────────────────

def _get_nested(d: dict, *keys) -> Any:
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def compute_field_scores(a_data: dict, b_data: dict) -> List[dict]:
    fields = [
        ("capital",     "Capital",     ("general", "capital")),
        ("gov_type",    "Gov. Type",   ("government", "type")),
        ("legislature", "Legislature", ("government", "legislature")),
        ("currency",    "Currency",    ("economy", "currency_code")),
        ("language",    "Language",    ("general", "official_language")),
        ("timezone",    "Timezone",    ("time", "timezone_utc")),
        ("demonym",     "Demonym",     ("general", "demonym")),
    ]

    scores = []
    for fid, label, path in fields:
        av = _get_nested(a_data, *path)
        bv = _get_nested(b_data, *path)
        a_tokens = set(re.findall(r"[a-z0-9]+", str(av).lower())) if av else set()
        b_tokens = set(re.findall(r"[a-z0-9]+", str(bv).lower())) if bv else set()
        shared = sorted(a_tokens & b_tokens)
        union = a_tokens | b_tokens
        score = len(a_tokens & b_tokens) / len(union) if union else (1.0 if not a_tokens and not b_tokens else 0.0)
        scores.append({
            "field": fid, "label": label,
            "a_val": str(av) if av is not None else "—",
            "b_val": str(bv) if bv is not None else "—",
            "score": round(score, 4),
            "shared": shared,
            "unique_a": sorted(a_tokens - b_tokens),
            "unique_b": sorted(b_tokens - a_tokens),
        })

    rel_a = _get_nested(a_data, "general", "religion", "groups") or {}
    rel_b = _get_nested(b_data, "general", "religion", "groups") or {}
    if isinstance(rel_a, dict) and isinstance(rel_b, dict):
        ka = set(rel_a.keys())
        kb = set(rel_b.keys())
        shared_rel = sorted(ka & kb)
        union_rel = ka | kb
        score_rel = len(ka & kb) / len(union_rel) if union_rel else 1.0
        scores.append({
            "field": "religion", "label": "Religion",
            "a_val": ", ".join(sorted(ka)) or "—",
            "b_val": ", ".join(sorted(kb)) or "—",
            "score": round(score_rel, 4),
            "shared": shared_rel,
            "unique_a": sorted(ka - kb),
            "unique_b": sorted(kb - ka),
        })

    return scores


def compute_token_analysis(a_data: dict, b_data: dict, a_name: str, b_name: str) -> dict:
    ta = extract_text_tokens(a_data)
    tb = extract_text_tokens(b_data)
    shared = sorted(ta & tb)
    unique_a = sorted(ta - tb)
    unique_b = sorted(tb - ta)
    union = ta | tb
    jaccard = len(ta & tb) / len(union) if union else 0.0

    per_field = []
    for key in sorted(set(a_data.keys()) | set(b_data.keys())):
        fa_tokens = extract_text_tokens({key: a_data.get(key, {})})
        fb_tokens = extract_text_tokens({key: b_data.get(key, {})})
        fu = fa_tokens | fb_tokens
        fs = len(fa_tokens & fb_tokens) / len(fu) if fu else 1.0
        per_field.append({
            "field": key,
            "a_count": len(fa_tokens),
            "b_count": len(fb_tokens),
            "shared_count": len(fa_tokens & fb_tokens),
            "jaccard": round(fs, 4),
        })

    return {
        "vocab_a": unique_a[:50],
        "vocab_b": unique_b[:50],
        "shared": shared[:80],
        "jaccard": round(jaccard, 4),
        "total_a": len(ta),
        "total_b": len(tb),
        "per_field": per_field,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Patching pipeline — structural edit-script generation, replay, and on-disk
# artifacts (so the user can open them directly in VSCode).
# ─────────────────────────────────────────────────────────────────────────────

# ── op-cost lookup used to enrich the script for the UI ──────────────────────
_PATCH_COST_FN = CostFunction()


def _safe_slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_") or "country"


def _path_display(path: List[str]) -> str:
    """Render an edit-script path as 'root/section/field'."""
    return "root" + ("" if not path else "/" + "/".join(path))


def _short(value: Any, limit: int = 80) -> str:
    s = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
    return s if len(s) <= limit else s[: limit - 1] + "…"


def _ui_edit_script(script: List[dict]) -> List[dict]:
    """
    Adapt the structural diff_trees() output to the shape the UI consumes:

        { op: "insert" | "delete" | "update",
          path: "root/section/field",
          node: "<label>",
          from: "<short old value>",
          to:   "<short new value>",
          cost: <float, two decimals> }
    """
    ui: List[dict] = []
    for op in script:
        kind = op["op"]
        label = op.get("label", "")
        path_disp = _path_display(op.get("path", []))

        if kind == "insert":
            ui.append({
                "op": "insert",
                "path": path_disp,
                "node": label,
                "from": "",
                "to": _short(op.get("value")),
                "cost": 1.0,
            })
        elif kind == "delete":
            ui.append({
                "op": "delete",
                "path": path_disp,
                "node": label,
                "from": _short(op.get("old_value")),
                "to": "",
                "cost": 1.0,
            })
        elif kind == "update":
            ui.append({
                "op": "update",
                "path": path_disp,
                "node": label,
                "from": _short(op.get("old_value")),
                "to":   _short(op.get("new_value")),
                "cost": 1.0,
            })
    return ui


def _build_patch_steps(source_tree: Node, script: List[dict]) -> List[dict]:
    """
    Apply the edit script one operation at a time, snapshotting the tree
    state after each application.  Each step entry is:

        { idx, op, label, path, summary, snapshot }

    where snapshot is the full patched-document dict at that step.  The UI
    plays these back to show the source → target transformation live.
    """
    steps: List[dict] = []

    # Step 0 = original source, no op applied yet
    working = clone_node(source_tree)
    steps.append({
        "idx": 0,
        "op": "init",
        "label": "source",
        "path": "root",
        "summary": "Initial state (source document)",
        "snapshot": node_to_data(working),
    })

    for i, op in enumerate(script, start=1):
        # Apply ops cumulatively: clone the original each iteration and apply
        # operations [0..i] to keep the apply_edit_script invariants intact.
        working = apply_edit_script(source_tree, script[:i])

        path_disp = _path_display(op.get("path", []))
        kind = op["op"]
        if kind == "insert":
            summary = f"INSERT {op.get('label')} at {path_disp}  ←  {_short(op.get('value'), 60)}"
        elif kind == "delete":
            summary = f"DELETE {op.get('label')} at {path_disp}"
        else:
            summary = (
                f"UPDATE {op.get('label')} at {path_disp}: "
                f"{_short(op.get('old_value'), 40)}  →  {_short(op.get('new_value'), 40)}"
            )

        steps.append({
            "idx": i,
            "op": kind,
            "label": op.get("label", ""),
            "path": path_disp,
            "summary": summary,
            "snapshot": node_to_data(working),
        })

    return steps


def _write_patch_artifacts(
    source_name: str,
    target_name: str,
    source_data: dict,
    target_data: dict,
    script: List[dict],
    patched_data: dict,
    patch_ok: bool,
) -> dict:
    """
    Persist source, target, edit script (both JSON and TXT), and patched
    document under outputs/patches/<source>_to_<target>_<timestamp>/.
    Returns the paths so the UI can show them to the user.
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    folder_name = f"{_safe_slug(source_name)}_to_{_safe_slug(target_name)}_{timestamp}"
    out_dir = PATCH_OUTPUT_DIR / folder_name
    out_dir.mkdir(parents=True, exist_ok=True)

    files = {
        "source":      out_dir / "source.json",
        "target":      out_dir / "target.json",
        "script_json": out_dir / "edit_script.json",
        "script_txt":  out_dir / "edit_script.txt",
        "patched":     out_dir / "patched.json",
        "summary":     out_dir / "summary.txt",
    }

    files["source"].write_text(
        json.dumps(source_data, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    files["target"].write_text(
        json.dumps(target_data, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    files["script_json"].write_text(
        json.dumps(script, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    files["script_txt"].write_text(
        script_summary(script) or "(no edit operations — trees are identical)",
        encoding="utf-8",
    )
    files["patched"].write_text(
        json.dumps(patched_data, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    op_counts = {"insert": 0, "delete": 0, "update": 0}
    for op in script:
        op_counts[op["op"]] = op_counts.get(op["op"], 0) + 1
    files["summary"].write_text(
        "\n".join([
            f"Patching run · {timestamp}",
            f"Source: {source_name}",
            f"Target: {target_name}",
            f"Operations: {len(script)}  "
            f"(insert={op_counts['insert']}, "
            f"delete={op_counts['delete']}, "
            f"update={op_counts['update']})",
            f"Verification (patched == target): {'OK' if patch_ok else 'FAILED'}",
            "",
            "Files in this folder:",
            "  source.json       — original source country document",
            "  target.json       — destination document",
            "  edit_script.json  — machine-readable edit operations",
            "  edit_script.txt   — human-readable edit script",
            "  patched.json      — result of applying the script to source",
            "  summary.txt       — this file",
        ]),
        encoding="utf-8",
    )

    # Return paths relative to BASE_DIR so the UI can display them cleanly.
    return {
        "folder": str(out_dir.relative_to(BASE_DIR)).replace("\\", "/"),
        "files": {
            key: str(path.relative_to(BASE_DIR)).replace("\\", "/")
            for key, path in files.items()
        },
        "op_counts": op_counts,
        "verification_ok": patch_ok,
    }


def _run_patching(source_name: str, target_name: str,
                  excluded_labels: Optional[set] = None) -> dict:
    """
    Full patching pipeline for one (source, target) pair.

    If *excluded_labels* is given, both trees are pruned to drop those nodes
    before TED/patching runs — so the edit script reflects only the user-
    selected labels.

    Returns a dict containing:
        ui_script        — adapted edit script for the UI table/diff view
        raw_script       — original diff_trees output (also written to disk)
        steps            — step-by-step snapshots for the playback UI
        source_doc       — full source document
        target_doc       — full target document
        patched_doc      — final patched document
        artifacts        — paths to files saved under outputs/patches/...
        verification_ok  — True iff patched == target
    """
    excluded   = excluded_labels or set()
    source_data = COUNTRY_DATA[source_name]
    target_data = COUNTRY_DATA[target_name]

    full_src_tree = build_country_tree(source_data)
    full_tgt_tree = build_country_tree(target_data)

    if excluded:
        source_tree = _prune_tree_by_labels(full_src_tree, excluded) or full_src_tree
        target_tree = _prune_tree_by_labels(full_tgt_tree, excluded) or full_tgt_tree
    else:
        source_tree = full_src_tree
        target_tree = full_tgt_tree

    raw_script = diff_trees(source_tree, target_tree)
    patched_tree = apply_edit_script(source_tree, raw_script)
    patch_ok = verify_patch(patched_tree, target_tree)

    patched_data = node_to_data(patched_tree)
    source_doc = node_to_data(source_tree)
    target_doc = node_to_data(target_tree)

    steps = _build_patch_steps(source_tree, raw_script)
    artifacts = _write_patch_artifacts(
        source_name, target_name,
        source_doc, target_doc,
        raw_script, patched_data, patch_ok,
    )

    return {
        "ui_script":       _ui_edit_script(raw_script),
        "raw_script":      raw_script,
        "steps":           steps,
        "source_doc":      source_doc,
        "target_doc":      target_doc,
        "patched_doc":     patched_data,
        "artifacts":       artifacts,
        "verification_ok": patch_ok,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Dendrogram builder
# ─────────────────────────────────────────────────────────────────────────────

def build_dendrogram(dist_mat: np.ndarray, names: List[str], linkage_method: str = "average") -> dict:
    """
    Build a binary tree suitable for the D3 dendrogram in clustering.js.

    Each internal node carries .left and .right; leaf nodes carry .name.
    No redundant "children" array, no per-node "members" list — both used
    to balloon the JSON to multiple GB on 195-leaf trees because JSON
    serialisation duplicates referenced objects at every visit.
    """
    try:
        from scipy.cluster.hierarchy import linkage as sp_linkage, to_tree as sp_to_tree
        Z = sp_linkage(dist_mat[np.triu_indices(len(names), k=1)], method=linkage_method)
        root_node, _ = sp_to_tree(Z, rd=True)

        def convert(node) -> dict:
            if node.is_leaf():
                return {
                    "id": f"leaf_{names[node.id]}",
                    "name": names[node.id],
                    "height": 0.0,
                }
            return {
                "id": f"node_{node.id}",
                "name": None,
                "height": round(float(node.dist), 4),
                "left":  convert(node.left),
                "right": convert(node.right),
            }

        return convert(root_node)
    except Exception:
        # Fallback when scipy linkage chokes on degenerate inputs: emit a
        # right-leaning chain so the UI has something to draw.
        def chain(i):
            if i >= len(names) - 1:
                return {"id": f"leaf_{names[i]}", "name": names[i], "height": 0.0}
            return {
                "id": f"node_{i}", "name": None, "height": 1.0,
                "left":  {"id": f"leaf_{names[i]}", "name": names[i], "height": 0.0},
                "right": chain(i + 1),
            }
        return chain(0) if names else {"id": "root", "name": None, "height": 0.0}


def _derive_medoids(
    dist_mat: np.ndarray,
    names: List[str],
    labels: List[int],
    explicit: Optional[List[str]] = None,
) -> Dict[str, str]:
    """
    Return {cluster_id_str: country_name} mapping the cluster centre to a
    real country.  For k-medoids the runner already supplies explicit medoid
    names; for the other algorithms we pick the member with the lowest mean
    intra-cluster distance.
    """
    medoids: Dict[str, str] = {}
    label_arr = np.array(labels)

    # Map explicit medoid names to their cluster id (k-medoids path).
    if explicit:
        name_to_idx = {n: i for i, n in enumerate(names)}
        for med_name in explicit:
            if med_name in name_to_idx:
                cid = int(label_arr[name_to_idx[med_name]])
                medoids[str(cid)] = med_name

    for cid in sorted(set(labels)):
        if cid == -1 or str(cid) in medoids:
            continue
        member_idx = np.where(label_arr == cid)[0]
        if member_idx.size == 0:
            continue
        if member_idx.size == 1:
            medoids[str(int(cid))] = names[int(member_idx[0])]
            continue
        sub = dist_mat[np.ix_(member_idx, member_idx)]
        best_local = int(np.argmin(sub.sum(axis=1)))
        medoids[str(int(cid))] = names[int(member_idx[best_local])]

    return medoids


def _country_coords_for(names: List[str]) -> Dict[str, List[float]]:
    """Return {name: [lat, lng]} for every country we have a centroid for."""
    coords: Dict[str, List[float]] = {}
    for name in names:
        data = COUNTRY_DATA.get(name, {})
        code = data.get("codes", {}).get("iso_3166_code", "")
        if code in COUNTRY_COORDS:
            lat, lng = COUNTRY_COORDS[code]
            coords[name] = [lat, lng]
    return coords


# ─────────────────────────────────────────────────────────────────────────────
# Clustering runner
# ─────────────────────────────────────────────────────────────────────────────

def run_clustering_api(countries: List[str], basis: str, algorithm: str, params: dict) -> dict:
    from sklearn.manifold import MDS
    from sklearn.metrics import silhouette_score, davies_bouldin_score

    names = [c for c in countries if c in COUNTRY_DATA]
    if len(names) < 2:
        raise ValueError("Need at least 2 valid countries")

    n = len(names)

    # Fast path: slice the precomputed full-corpus TED matrix instead of
    # recomputing pairwise TEDs. Falls back to live computation if the
    # cache isn't available (first run before the matrix has been built,
    # or a country not in the cache).
    sub = _ted_submatrices(names) if basis == "structural" else None
    if sub is not None:
        sim_mat, dist_mat = sub
        # numpy returns views from np.ix_; copy so np.fill_diagonal below
        # doesn't mutate the shared cache.
        sim_mat  = sim_mat.copy()
        dist_mat = dist_mat.copy()
    else:
        sim_mat = np.zeros((n, n))
        for i in range(n):
            sim_mat[i, i] = 1.0
            for j in range(i + 1, n):
                if basis == "structural":
                    _, s = ted_similarity(get_tree(names[i]), get_tree(names[j]))
                else:
                    s = semantic_similarity(COUNTRY_DATA[names[i]], COUNTRY_DATA[names[j]])
                sim_mat[i, j] = sim_mat[j, i] = s
        dist_mat = 1.0 - sim_mat

    np.fill_diagonal(dist_mat, 0.0)

    k = int(params.get("k", 4))
    k = max(2, min(k, n - 1))

    if algorithm == "agglomerative":
        # Agglomerative uses a distance threshold (dendrogram cut height),
        # not a fixed k — cluster count is inferred from the hierarchy.
        thresh = float(params.get("distance_threshold", 0.5))
        result = agglomerative(dist_mat, names,
                               distance_threshold=thresh,
                               linkage=params.get("linkage", "average"))
    elif algorithm == "dbscan":
        result = dbscan(dist_mat, names,
                        eps=float(params.get("eps", 0.30)),
                        min_samples=int(params.get("min_samples", 2)))
    elif algorithm == "spectral":
        result = spectral(sim_mat, names, n_clusters=k)
    elif algorithm == "kmedoids":
        result = kmedoids(dist_mat, names, n_clusters=k)
    else:
        raise ValueError(f"Unknown algorithm: {algorithm}")

    # MDS is the slow step — on 195 points it dominates the entire clustering
    # call. The full-corpus MDS projection is precomputed once at startup
    # (load_or_build_mds_atlas → outputs/mds_coords.npz) and we just index
    # into it. Falls back to per-request MDS only if a country isn't in the
    # atlas (shouldn't happen in normal operation).
    coords = _mds_subset(names)
    if coords is None:
        mds = MDS(n_components=2, dissimilarity="precomputed", random_state=42,
                  normalized_stress="auto", n_init=1, max_iter=300)
        coords = mds.fit_transform(dist_mat)

    # UI expects an array of [name, x, y] triples (clustering.js iterates this).
    mds_coords = [
        [names[i],
         round(float(coords[i, 0]), 4),
         round(float(coords[i, 1]), 4)]
        for i in range(n)
    ]
    positions = {names[i]: [mds_coords[i][1], mds_coords[i][2]] for i in range(n)}

    # Note: we used to emit a fully connected edges list (~18,915 entries
    # for 195 countries) in the response. clustering.js builds its own
    # edges client-side from cluster_members, so we drop it server-side.
    assignments = {names[i]: int(result.labels[i]) for i in range(n)}
    cluster_members = {str(k): v for k, v in result.cluster_members().items()}

    eval_metrics: Dict[str, float] = {}
    unique_labels = set(result.labels) - {-1}
    if len(unique_labels) >= 2 and n > len(unique_labels):
        try:
            labels_arr = np.array(result.labels)
            mask = labels_arr != -1
            if mask.sum() > len(unique_labels):
                eval_metrics["silhouette"] = round(
                    float(silhouette_score(dist_mat[np.ix_(mask, mask)],
                                          labels_arr[mask],
                                          metric="precomputed")), 4)
                eval_metrics["davies_bouldin"] = round(
                    float(davies_bouldin_score(coords[mask], labels_arr[mask])), 4)
        except Exception:
            pass

    dendrogram = None
    if algorithm == "agglomerative":
        dendrogram = build_dendrogram(dist_mat, names,
                                      linkage_method=params.get("linkage", "average"))

    # Identify a representative country (medoid) per cluster so the UI can
    # label cards with "Cluster N · medoid: France".  k-medoids supplies the
    # canonical medoid list directly via result.params.
    explicit_meds = result.params.get("medoids") if algorithm == "kmedoids" else None
    medoids = _derive_medoids(dist_mat, names, result.labels, explicit_meds)

    country_coords = _country_coords_for(names)

    matrix_out = {
        names[i]: {names[j]: round(float(sim_mat[i, j]), 4) for j in range(n)}
        for i in range(n)
    }

    n_outliers = int(sum(1 for lbl in result.labels if lbl == -1))
    summary = {
        "n_countries":  n,
        "n_clusters":   result.n_clusters_found,
        "n_outliers":   n_outliers,
        "basis":        basis,
        "algorithm":    algorithm,
        "params":       result.params,
        "silhouette":   eval_metrics.get("silhouette"),
        "davies_bouldin": eval_metrics.get("davies_bouldin"),
    }

    return {
        "algorithm":       algorithm,
        "basis":           basis,
        "k_used":          result.n_clusters_found,
        "assignments":     assignments,
        "cluster_members": cluster_members,
        "medoids":         medoids,
        "matrix":          matrix_out,
        "mds_coords":      mds_coords,
        "positions_2d":    positions,
        "country_coords":  country_coords,
        "dendrogram":      dendrogram,
        "eval":            eval_metrics,
        "summary":         summary,
        "names":           names,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Page routes
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html", active_page="home")


@app.route("/similarity")
def similarity_page():
    return render_template("similarity.html", active_page="similarity")


@app.route("/clustering")
def clustering_page():
    return render_template("clustering.html", active_page="clustering")


@app.route("/results")
def results_page():
    return render_template("results.html", active_page="results")


@app.route("/saved")
def saved_page():
    return render_template("saved.html", active_page="saved")


@app.route("/about")
def about_page():
    return render_template("about.html", active_page="about")


# ─────────────────────────────────────────────────────────────────────────────
# API routes
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/countries")
def api_countries():
    return jsonify({"countries": COUNTRY_LIST})


@app.route("/api/country/<path:name>")
def api_country(name: str):
    if name not in COUNTRY_DATA:
        return jsonify({"error": f"Country '{name}' not found"}), 404
    try:
        data = COUNTRY_DATA[name]
        tree = get_tree(name)
        xml = dict_to_xml(data, "infobox")
        stats = _tree_stats(tree)
        code = data.get("codes", {}).get("iso_3166_code", "")
        return jsonify({
            "name":       name,
            "code":       code,
            "region":     _infer_region(code),
            "infobox":    data,
            "data":       data,                       # alias used by the doc-review UI
            "xml":        xml,
            "tree_stats": stats,
            "tree_size":  stats["node_count"],
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/similarity", methods=["POST"])
def api_similarity():
    try:
        body = request.get_json(force=True)

        # Normalise mode: accept "pairwise"/"one_vs_all" (wizard) or "1v1"/"1vall" (legacy)
        raw_mode = body.get("mode", "pairwise")
        mode_map = {"pairwise": "1v1", "one_vs_all": "1vall",
                    "1v1": "1v1", "1vall": "1vall"}
        mode = mode_map.get(raw_mode, "1v1")

        sim_type = body.get("type", "structural")
        alpha    = float(body.get("alpha", 0.5))

        # Label filter from the wizard's "Select Labels" step. Anything in this
        # set is dropped from the tree (and from the raw data, for semantic).
        # "infobox" is sanitised out so the root is always kept.
        excluded_labels = set(body.get("excluded_labels") or []) - {"infobox"}

        # Closures that build the per-country tree / data, respecting the
        # excluded-label filter when it's non-empty.
        def _tree_for(name: str) -> Node:
            if not excluded_labels:
                return get_tree(name)
            full = build_country_tree(COUNTRY_DATA[name])
            return _prune_tree_by_labels(full, excluded_labels) or full

        def _data_for(name: str) -> dict:
            if not excluded_labels:
                return COUNTRY_DATA[name]
            return _filter_data_by_labels(COUNTRY_DATA[name], excluded_labels)

        # Semantic similarity (and the semantic half of "combined") runs on
        # the data/cleaned-data corpus, not data/clean. Structural / patching /
        # field-scores / token-analysis all stay on COUNTRY_DATA.
        def _semantic_for(name: str) -> dict:
            doc = _semantic_data_for(name)
            return _filter_cleaned_by_labels(doc, excluded_labels)

        # Accept {countries:[...]} (wizard) or {source, targets} (legacy)
        countries_list = body.get("countries", [])
        if countries_list:
            source = countries_list[0] if countries_list else ""
            if mode == "1v1":
                targets = [countries_list[1]] if len(countries_list) > 1 else []
            else:
                # 1-vs-all: compare source against every other country
                # COUNTRY_LIST is a list of dicts with "name" key
                targets = [c["name"] for c in COUNTRY_LIST if c["name"] != source]
        else:
            source  = body.get("source", "")
            targets = body.get("targets", [])

        if source not in COUNTRY_DATA:
            return jsonify({"error": f"Source country '{source}' not found"}), 400

        src_tree_filtered = _tree_for(source)
        src_data_filtered = _data_for(source)
        src_semantic_doc  = _semantic_for(source)

        pairs = []
        for target in targets:
            if target not in COUNTRY_DATA:
                continue

            struct_sim = 0.0
            sem_sim    = 0.0
            ted_dist   = 0.0

            if sim_type in ("structural", "combined"):
                t1 = src_tree_filtered
                t2 = _tree_for(target)
                ted_dist, struct_sim = ted_similarity(t1, t2)
                struct_sim = round(struct_sim, 4)
                ted_dist   = round(ted_dist, 4)

            if sim_type in ("semantic", "combined"):
                # Semantic Jaccard runs on data/cleaned-data via _semantic_for.
                sem_sim = round(semantic_similarity(src_semantic_doc, _semantic_for(target)), 4)

            if sim_type == "structural":
                combined = struct_sim
            elif sim_type == "semantic":
                combined = sem_sim
            else:
                combined = round(alpha * struct_sim + (1 - alpha) * sem_sim, 4)

            code = COUNTRY_DATA[target].get("codes", {}).get("iso_3166_code", "")
            lat, lng = COUNTRY_COORDS.get(code, (None, None))
            pairs.append({
                "name":         target,
                "code":         code,
                "structural":   struct_sim,
                "semantic":     sem_sim,
                "combined":     combined,
                "ted_distance": ted_dist,
                "lat":          lat,
                "lng":          lng,
            })

        if mode == "1vall":
            pairs.sort(key=lambda x: x["combined"], reverse=True)

        scores: dict = {}
        if mode == "1v1" and pairs:
            p = pairs[0]
            if sim_type == "structural":
                scores = {"structural": p["structural"]}
            elif sim_type == "semantic":
                scores = {"semantic": p["semantic"]}
            else:
                scores = {"structural": p["structural"],
                          "semantic":   p["semantic"],
                          "combined":   p["combined"]}

        response: dict = {
            "mode":      mode,
            "type":      sim_type,
            "alpha":     alpha,
            "source":    source,
            "countries": [source] + ([targets[0]] if mode == "1v1" and targets else []),
            "pairs":     pairs,
            "results":   pairs,
            "scores":    scores,
        }

        if mode == "1v1" and targets:
            target = targets[0]
            if target in COUNTRY_DATA:
                # Run the full patching pipeline: structural diff, on-disk
                # artifacts, and step-by-step snapshots for the replay UI.
                patch_bundle = _run_patching(source, target,
                                             excluded_labels=excluded_labels)

                tgt_data_filtered = _data_for(target)

                response["edit_distance"] = pairs[0]["ted_distance"] if pairs else 0
                response["edit_script"]   = patch_bundle["ui_script"]
                response["field_scores"]  = compute_field_scores(
                    src_data_filtered, tgt_data_filtered)

                # Token analysis is a viz of the semantic Jaccard, so run it
                # on the cleaned-data corpus to stay consistent with the
                # semantic score shown in the score panel.
                tok = compute_token_analysis(
                    src_semantic_doc, _semantic_for(target), source, target)
                response["token_analysis"] = {
                    "shared":    tok["shared"],
                    "only_a":    tok["vocab_a"],
                    "only_b":    tok["vocab_b"],
                    "jaccard":   tok["jaccard"],
                    "total_a":   tok["total_a"],
                    "total_b":   tok["total_b"],
                    "per_field": tok["per_field"],
                }

                # Bundle for the patching tab: source doc, target doc, every
                # intermediate snapshot, and links to the saved files.
                response["patching"] = {
                    "source_name":     source,
                    "target_name":     target,
                    "source_doc":      patch_bundle["source_doc"],
                    "target_doc":      patch_bundle["target_doc"],
                    "patched_doc":     patch_bundle["patched_doc"],
                    "steps":           patch_bundle["steps"],
                    "raw_script":      patch_bundle["raw_script"],
                    "artifacts":       patch_bundle["artifacts"],
                    "verification_ok": patch_bundle["verification_ok"],
                }

        return jsonify(response)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/patch", methods=["POST"])
def api_patch():
    """
    Run the patching pipeline for an explicit (source, target) pair.

    Body: { "source": "<country>", "target": "<country>" }

    Returns the same bundle that /api/similarity puts under the "patching"
    key — source doc, target doc, every intermediate snapshot, the UI-shaped
    edit script, and the on-disk artifact paths.

    This is the endpoint the UI calls when the user asks to patch a target
    from inside a 1-vs-all result, or to re-patch with a different pair.
    """
    try:
        body = request.get_json(force=True)
        source = body.get("source", "")
        target = body.get("target", "")

        if source not in COUNTRY_DATA:
            return jsonify({"error": f"Source country '{source}' not found"}), 400
        if target not in COUNTRY_DATA:
            return jsonify({"error": f"Target country '{target}' not found"}), 400

        bundle = _run_patching(source, target)

        return jsonify({
            "source_name":     source,
            "target_name":     target,
            "edit_script":     bundle["ui_script"],
            "raw_script":      bundle["raw_script"],
            "source_doc":      bundle["source_doc"],
            "target_doc":      bundle["target_doc"],
            "patched_doc":     bundle["patched_doc"],
            "steps":           bundle["steps"],
            "artifacts":       bundle["artifacts"],
            "verification_ok": bundle["verification_ok"],
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/clustering", methods=["POST"])
def api_clustering():
    """
    Synchronous clustering — the structural TED matrix is precomputed at
    startup and cached in _TED_MATRIX, so even Select-All-195 clustering
    runs in well under a second. The old n>20 background-job split is no
    longer needed.
    """
    try:
        body = request.get_json(force=True)
        basis     = body.get("basis", "structural")
        algorithm = body.get("algorithm", "agglomerative")
        countries = body.get("countries", [])
        params    = body.get("params", {})

        result = run_clustering_api(countries, basis, algorithm, params)
        return jsonify(result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/job/<job_id>")
def api_job(job_id: str):
    job = _JOBS.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job["status"] == "done":
        return jsonify({"status": "done", **job["result"]})
    elif job["status"] == "error":
        return jsonify({"status": "error", "error": job["error"]}), 500
    return jsonify({"status": "running"})


# ─────────────────────────────────────────────────────────────────────────────
# Bootstrap
# ─────────────────────────────────────────────────────────────────────────────

load_countries()
load_semantic_data()
load_or_build_ted_matrix()
load_or_build_mds_atlas()

if __name__ == "__main__":
    app.run(debug=True, port=5000)
