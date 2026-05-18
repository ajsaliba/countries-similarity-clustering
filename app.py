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

# ── in-memory stores ──────────────────────────────────────────────────────────
COUNTRY_DATA: Dict[str, dict] = {}
COUNTRY_LIST: List[dict] = []
_TREE_CACHE: Dict[str, Node] = {}
_MATRIX_CACHE: Dict[str, Any] = {}
_JOBS: Dict[str, dict] = {}


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
        COUNTRY_LIST.append({
            "name": name,
            "code": code,
            "region": _infer_region(code),
        })

    COUNTRY_LIST.sort(key=lambda x: x["name"])
    print(f"[SIMILICA] Loaded {len(COUNTRY_DATA)} countries", flush=True)


# ─────────────────────────────────────────────────────────────────────────────
# Tree helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_tree(name: str) -> Node:
    if name not in _TREE_CACHE:
        _TREE_CACHE[name] = build_country_tree(COUNTRY_DATA[name])
    return _TREE_CACHE[name]


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
# Dendrogram builder
# ─────────────────────────────────────────────────────────────────────────────

def build_dendrogram(dist_mat: np.ndarray, names: List[str], linkage_method: str = "average") -> dict:
    try:
        from scipy.cluster.hierarchy import linkage as sp_linkage, to_tree as sp_to_tree
        Z = sp_linkage(dist_mat[np.triu_indices(len(names), k=1)], method=linkage_method)
        root_node, node_list = sp_to_tree(Z, rd=True)

        def convert(node) -> dict:
            if node.is_leaf():
                return {
                    "id": f"leaf_{names[node.id]}",
                    "name": names[node.id],
                    "height": 0.0,
                    "members": [names[node.id]],
                    "children": None,
                }
            left = convert(node.left)
            right = convert(node.right)
            members = left["members"] + right["members"]
            return {
                "id": f"node_{node.id}",
                "name": None,
                "height": round(float(node.dist), 4),
                "members": members,
                "children": [left, right],
            }

        return convert(root_node)
    except Exception:
        return {
            "id": "root",
            "name": None,
            "height": 1.0,
            "members": names,
            "children": [{"id": f"leaf_{n}", "name": n, "height": 0.0,
                          "members": [n], "children": None} for n in names],
        }


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
        result = agglomerative(dist_mat, names, n_clusters=k,
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

    mds = MDS(n_components=2, dissimilarity="precomputed", random_state=42,
              normalized_stress="auto")
    coords = mds.fit_transform(dist_mat)
    positions = {names[i]: [round(float(coords[i, 0]), 4), round(float(coords[i, 1]), 4)]
                 for i in range(n)}

    edges = []
    for i in range(n):
        for j in range(i + 1, n):
            edges.append({
                "source": names[i],
                "target": names[j],
                "weight": round(float(sim_mat[i, j]), 4),
            })

    assignments = {names[i]: int(result.labels[i]) for i in range(n)}
    cluster_members = {str(k): v for k, v in result.cluster_members().items()}

    eval_metrics = {}
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

    matrix_out = {
        names[i]: {names[j]: round(float(sim_mat[i, j]), 4) for j in range(n)}
        for i in range(n)
    }

    return {
        "algorithm": algorithm,
        "k_used": result.n_clusters_found,
        "assignments": assignments,
        "cluster_members": cluster_members,
        "matrix": matrix_out,
        "positions_2d": positions,
        "dendrogram": dendrogram,
        "edges": edges,
        "eval": eval_metrics,
        "names": names,
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
            "name": name,
            "code": code,
            "region": _infer_region(code),
            "infobox": data,
            "xml": xml,
            "tree_stats": stats,
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

        pairs = []
        for target in targets:
            if target not in COUNTRY_DATA:
                continue

            struct_sim = 0.0
            sem_sim    = 0.0
            ted_dist   = 0.0

            if sim_type in ("structural", "combined"):
                t1 = get_tree(source)
                t2 = get_tree(target)
                ted_dist, struct_sim = ted_similarity(t1, t2)
                struct_sim = round(struct_sim, 4)
                ted_dist   = round(ted_dist, 4)

            if sim_type in ("semantic", "combined"):
                sem_sim = round(semantic_similarity(COUNTRY_DATA[source], COUNTRY_DATA[target]), 4)

            if sim_type == "structural":
                combined = struct_sim
            elif sim_type == "semantic":
                combined = sem_sim
            else:
                combined = round(alpha * struct_sim + (1 - alpha) * sem_sim, 4)

            pairs.append({
                "name":         target,
                "code":         COUNTRY_DATA[target].get("codes", {}).get("iso_3166_code", ""),
                "structural":   struct_sim,
                "semantic":     sem_sim,
                "combined":     combined,
                "ted_distance": ted_dist,
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
                response["edit_distance"] = pairs[0]["ted_distance"] if pairs else 0
                response["edit_script"]   = generate_edit_script(
                    COUNTRY_DATA[source], COUNTRY_DATA[target])
                response["field_scores"]  = compute_field_scores(
                    COUNTRY_DATA[source], COUNTRY_DATA[target])
                response["token_analysis"] = compute_token_analysis(
                    COUNTRY_DATA[source], COUNTRY_DATA[target], source, target)

        return jsonify(response)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/clustering", methods=["POST"])
def api_clustering():
    try:
        body = request.get_json(force=True)
        basis     = body.get("basis", "semantic")
        algorithm = body.get("algorithm", "agglomerative")
        countries = body.get("countries", [])
        params    = body.get("params", {})

        n = len([c for c in countries if c in COUNTRY_DATA])

        if basis == "structural" and n > 20:
            job_id = str(uuid.uuid4())
            _JOBS[job_id] = {"status": "running", "result": None, "error": None}

            def worker():
                try:
                    result = run_clustering_api(countries, basis, algorithm, params)
                    _JOBS[job_id]["result"] = result
                    _JOBS[job_id]["status"] = "done"
                except Exception as exc:
                    _JOBS[job_id]["error"] = str(exc)
                    _JOBS[job_id]["status"] = "error"

            t = threading.Thread(target=worker, daemon=True)
            t.start()
            return jsonify({"job_id": job_id, "status": "running"})

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

if __name__ == "__main__":
    app.run(debug=True, port=5000)
