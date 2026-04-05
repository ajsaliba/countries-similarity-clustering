#!/usr/bin/env python3
"""
Flask API bridge between the React GUI and the Python TED algorithm.

Uses algoOriginal_clean_v2_with_patching_fixed.py as the TED backend.

Endpoints:
  GET  /api/ted/countries?dataset=clean       List country names
  GET  /api/ted/country?name=Lebanon&dataset=clean  Get raw country JSON
  POST /api/ted/build-tree                    Build tree for a country, return as frontend TreeNode
  POST /api/ted/compare                       Full comparison: TED, similarity, edit script, patch, post-process
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS

ROOT_DIR = Path(__file__).resolve().parent.parent  # project root

# Make sure scripts/ is importable
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

# Import the original algorithm module
import algoOriginal_clean_v2_with_patching_fixed as algo

DATASET_PATHS = {
    "clean": ROOT_DIR / "data" / "clean" / "all_countries_clean.json",
    "raw":   ROOT_DIR / "data" / "raw"   / "all_countries.json",
}

app = Flask(__name__)
CORS(app)

# Cache: dataset_name -> (dataset_list, numeric_normalizer)
_cache: dict = {}


def _load(dataset: str):
    if dataset not in _cache:
        path = DATASET_PATHS.get(dataset)
        if path is None or not path.exists():
            raise ValueError(f"Dataset '{dataset}' not found at {path}")
        data = algo.load_dataset(str(path))
        normalizer = algo.DatasetNumericNormalizer.fit(data, dataset)
        _cache[dataset] = (data, normalizer)
    return _cache[dataset]


def _orig_node_to_frontend_tree(node: algo.TreeNode, counter: list | None = None, depth: int = 0) -> dict:
    """Convert a TreeNode (from original algo) to the frontend TreeNode shape."""
    if counter is None:
        counter = [0]
    nid = str(counter[0])
    counter[0] += 1

    children = []
    for child in node.children:
        children.append(_orig_node_to_frontend_tree(child, counter, depth + 1))

    result: dict = {
        "id": nid,
        "label": node.label,
        "children": children,
        "depth": depth,
    }

    if node.is_leaf():
        if node.kind == "numeric":
            if node.norm_number is not None:
                result["value"] = str(round(node.norm_number, 6))
                result["numericValue"] = float(node.norm_number)
            else:
                result["value"] = node.raw_value or ""
        elif node.kind in ("atomic_text", "token"):
            result["value"] = node.norm_value or node.raw_value or ""
        else:
            result["value"] = node.raw_value or node.norm_value or ""

    return result


def _orig_edit_script_to_frontend(script: list) -> list:
    """Convert original algo edit script ops to frontend EditOperation[] shape."""
    ops = []
    for op in script:
        kind = op.get("op", "")
        path_str = op.get("path", "(root)")

        fe_op: dict = {
            "type": kind,
            "node": _label_from_path(path_str),
            "cost": op.get("cost", 1),
        }

        if kind in ("update_value", "update_node"):
            from_dict = op.get("from", {})
            to_dict = op.get("to", {})
            old_val = json.dumps(_leaf_display(from_dict), ensure_ascii=False)
            new_val = json.dumps(_leaf_display(to_dict), ensure_ascii=False)
            if len(old_val) > 80:
                old_val = old_val[:77] + "..."
            if len(new_val) > 80:
                new_val = new_val[:77] + "..."
            fe_op["from"] = old_val
            fe_op["to"] = new_val

        elif kind == "insert_tree":
            subtree = op.get("subtree", {})
            val = json.dumps(_leaf_display(subtree), ensure_ascii=False)
            if len(val) > 80:
                val = val[:77] + "..."
            fe_op["value"] = val
            fe_op["node"] = subtree.get("label", fe_op["node"])

        elif kind == "delete_tree":
            subtree = op.get("subtree", {})
            val = json.dumps(_leaf_display(subtree), ensure_ascii=False)
            if len(val) > 80:
                val = val[:77] + "..."
            fe_op["value"] = val
            fe_op["node"] = subtree.get("label", fe_op["node"])

        ops.append(fe_op)
    return ops


def _label_from_path(path: str) -> str:
    """Extract the last segment label from a tree path like 'root/General[2]/Capital[1]'."""
    if not path or path == "root":
        return "(root)"
    seg = path.rstrip("/").split("/")[-1]
    # strip [index]
    m = re.match(r"^(.+)\[\d+\]$", seg)
    return m.group(1) if m else seg


def _leaf_display(node_dict: dict) -> str:
    """Return a short human-readable string for a node dict."""
    label = node_dict.get("label", "")
    norm = node_dict.get("norm_value") or node_dict.get("raw_value")
    num = node_dict.get("norm_number")
    if num is not None:
        return f"{label}: {round(num, 4)}"
    if norm:
        return f"{label}: {norm}"
    return label


@app.route("/api/ted/countries")
def list_countries():
    dataset = request.args.get("dataset", "clean")
    try:
        data, _ = _load(dataset)
        names = [c["country"] for c in data if "country" in c]
        return jsonify(names)
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/ted/country")
def get_country():
    dataset = request.args.get("dataset", "clean")
    name = request.args.get("name", "")
    if not name:
        return jsonify({"error": "name parameter required"}), 400

    try:
        data, _ = _load(dataset)
        doc = algo.get_country_doc(data, name)
        return jsonify(doc)
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/ted/build-tree", methods=["POST"])
def build_tree_endpoint():
    body = request.get_json()
    dataset = body.get("dataset", "clean")
    name = body.get("name", "")

    if not name:
        return jsonify({"error": "name required"}), 400

    try:
        data, normalizer = _load(dataset)
        doc = algo.get_country_doc(data, name)
        tree = algo.build_tree_from_country_json(doc, dataset, normalizer)
        fe_tree = _orig_node_to_frontend_tree(tree)
        fe_tree["value"] = doc.get("country", name)
        return jsonify({
            "name": doc.get("country", name),
            "tree": fe_tree,
            "size": algo.subtree_size(tree),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/ted/compare", methods=["POST"])
def compare():
    body = request.get_json()
    dataset = body.get("dataset", "clean")
    name_a = body.get("country_a", "")
    name_b = body.get("country_b", "")

    if not name_a or not name_b:
        return jsonify({"error": "country_a and country_b required"}), 400

    try:
        import time
        t0 = time.time()

        data, normalizer = _load(dataset)
        doc_a = algo.get_country_doc(data, name_a)
        doc_b = algo.get_country_doc(data, name_b)

        actual_a = doc_a.get("country", name_a)
        actual_b = doc_b.get("country", name_b)

        tree_a = algo.build_tree_from_country_json(doc_a, dataset, normalizer)
        tree_b = algo.build_tree_from_country_json(doc_b, dataset, normalizer)
        algo._assign_patch_ids(tree_a)

        memo: dict = {}
        contain_memo: dict = {}

        distance = algo.nj_ted_cost(tree_a, tree_b, memo, contain_memo)
        similarity = algo.normalized_similarity(tree_a, tree_b)
        script = algo.recover_edit_script(tree_a, tree_b, "root", memo, contain_memo)

        # Patch
        patched_tree = algo.apply_edit_script_to_tree(tree_a, script)
        verification = algo.verify_patch(patched_tree, tree_b)
        patch_ok = verification.get("exact_match", False)

        # Post-processed outputs
        patched_json_str = json.dumps(
            algo.tree_to_native_document(patched_tree, prefer="raw"),
            ensure_ascii=False, indent=2
        )
        patched_infobox_str = algo.tree_to_infobox_text(patched_tree, prefer="raw")

        # Frontend trees
        fe_tree_a = _orig_node_to_frontend_tree(tree_a)
        fe_tree_a["value"] = actual_a
        fe_tree_b = _orig_node_to_frontend_tree(tree_b)
        fe_tree_b["value"] = actual_b

        # Count ops by type
        op_counts = {"insert": 0, "delete": 0, "update": 0}
        for op in script:
            k = op.get("op", "")
            if "insert" in k:
                op_counts["insert"] += 1
            elif "delete" in k:
                op_counts["delete"] += 1
            elif "update" in k:
                op_counts["update"] += 1

        elapsed = round(time.time() - t0, 3)

        result = {
            "country_a": actual_a,
            "country_b": actual_b,
            "dataset": dataset,
            "method": "nj_ted",
            "distance": round(distance, 6),
            "similarity": round(similarity, 6),
            "tree_a_size": algo.subtree_size(tree_a),
            "tree_b_size": algo.subtree_size(tree_b),
            "tree_a": fe_tree_a,
            "tree_b": fe_tree_b,
            "edit_script": _orig_edit_script_to_frontend(script),
            "edit_script_raw": script,
            "edit_script_summary": f"{len(script)} operations",
            "operation_counts": op_counts,
            "total_operations": len(script),
            "patch_verified": patch_ok,
            "patched_json": patched_json_str,
            "patched_infobox": patched_infobox_str,
            "elapsed_seconds": elapsed,
        }

        return jsonify(result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 400


@app.route("/api/ted/stats")
def stats():
    """Return filesystem counts for countries and pre-computed outputs."""
    try:
        clean_path = DATASET_PATHS.get("clean")
        country_count = 0
        if clean_path and clean_path.exists():
            data = algo.load_dataset(str(clean_path))
            country_count = len(data)

        outputs_dir = ROOT_DIR / "data" / "outputs"
        precomputed_count = len(list(outputs_dir.glob("edit_script_*.json"))) if outputs_dir.exists() else 0

        return jsonify({
            "country_count": country_count,
            "precomputed_count": precomputed_count,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/ted/precomputed")
def precomputed():
    """List and return parsed pre-computed edit scripts from data/outputs/."""
    try:
        outputs_dir = ROOT_DIR / "data" / "outputs"
        key = request.args.get("key")

        files = []
        for f in sorted(outputs_dir.glob("edit_script_*.json")):
            name = f.stem.replace("edit_script_", "")
            label = name.replace("_to_", " → ").replace("_", " ")
            if key and name == key:
                with open(f, encoding="utf-8") as fh:
                    script = json.load(fh)
                fe_script = _orig_edit_script_to_frontend(script) if isinstance(script, list) else script
                return jsonify({"name": name, "label": label, "edit_script": fe_script})
            files.append({"name": name, "label": label})

        if key:
            return jsonify({"error": f"Pre-computed pair '{key}' not found"}), 404

        return jsonify({"files": files})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


# In-memory cache for pairwise matrices
_matrix_cache: dict = {}


@app.route("/api/ted/clustering/matrix", methods=["POST"])
def clustering_matrix():
    """Compute pairwise similarity matrix for a set of countries."""
    body = request.get_json()
    country_names = body.get("countries", [])
    dataset = body.get("dataset", "clean")

    if not country_names or len(country_names) < 2:
        return jsonify({"error": "At least 2 countries required"}), 400

    cache_key = (frozenset(country_names), dataset)
    if cache_key in _matrix_cache:
        return jsonify(_matrix_cache[cache_key])

    try:
        import time
        t0 = time.time()

        data, normalizer = _load(dataset)

        resolved = []
        trees = []
        for name in country_names:
            try:
                doc = algo.get_country_doc(data, name)
                resolved.append(doc.get("country", name))
                trees.append(algo.build_tree_from_country_json(doc, dataset, normalizer))
            except Exception:
                resolved.append(name)
                trees.append(None)

        n = len(resolved)
        matrix = [[0.0] * n for _ in range(n)]

        for i in range(n):
            for j in range(n):
                if i == j:
                    matrix[i][j] = 1.0
                elif i < j:
                    if trees[i] is not None and trees[j] is not None:
                        sim = algo.normalized_similarity(trees[i], trees[j])
                        matrix[i][j] = round(sim, 6)
                        matrix[j][i] = round(sim, 6)

        elapsed = round(time.time() - t0, 3)
        result = {
            "matrix": matrix,
            "countries": resolved,
            "elapsed_seconds": elapsed,
        }
        _matrix_cache[cache_key] = result
        return jsonify(result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 400


@app.route("/api/ted/clustering/pca", methods=["POST"])
def clustering_pca():
    """Reduce NxN similarity matrix to 2D using sklearn PCA."""
    body = request.get_json()
    matrix = body.get("matrix", [])
    labels = body.get("labels", [])
    country_names = body.get("countries", [])

    if not matrix or not country_names:
        return jsonify({"error": "matrix and countries required"}), 400

    try:
        import numpy as np
        from sklearn.decomposition import PCA

        arr = np.array(matrix)
        dist = 1.0 - arr

        pca = PCA(n_components=2)
        coords = pca.fit_transform(dist)

        points = [
            {
                "x": float(coords[i, 0]),
                "y": float(coords[i, 1]),
                "country": country_names[i] if i < len(country_names) else str(i),
                "cluster": labels[i] if i < len(labels) else 0,
            }
            for i in range(len(coords))
        ]
        return jsonify({"points": points})

    except ImportError:
        import math
        n = len(country_names)
        points = [
            {
                "x": math.cos(2 * math.pi * i / max(n, 1)),
                "y": math.sin(2 * math.pi * i / max(n, 1)),
                "country": country_names[i],
                "cluster": labels[i] if i < len(labels) else 0,
            }
            for i in range(n)
        ]
        return jsonify({"points": points})

    except Exception as e:
        return jsonify({"error": str(e)}), 400


# ── One-vs-All cache ─────────────────────────────────────────────────────────
_ova_cache: dict = {}


def _ova_compute(base_name: str, data: list, normalizer, dataset: str) -> tuple[list, int]:
    """Build trees + run nj_ted for base vs all others. Returns (results, base_tree_size)."""
    base_doc = algo.get_country_doc(data, base_name)
    actual_base = base_doc.get("country", base_name)
    base_tree = algo.build_tree_from_country_json(base_doc, dataset, normalizer)
    base_size = algo.subtree_size(base_tree)

    results = []
    for item in data:
        name = item.get("country", "")
        if name == actual_base:
            continue
        try:
            other_tree = algo.build_tree_from_country_json(item, dataset, normalizer)
            distance = algo.nj_ted_cost(base_tree, other_tree)
            similarity = algo.normalized_similarity(base_tree, other_tree)
            results.append({
                "country": name,
                "distance": round(distance, 6),
                "similarity": round(similarity, 6),
            })
        except Exception:
            continue

    results.sort(key=lambda x: x["similarity"], reverse=True)
    for i, r in enumerate(results):
        r["rank"] = i + 1

    return results, base_size, actual_base, base_tree


def _ova_stats(sims: list) -> dict:
    import math, statistics
    buckets = [{"range": f"{i/10:.1f}\u2013{(i+1)/10:.1f}", "count": 0} for i in range(10)]
    for s in sims:
        idx = min(int(s * 10), 9)
        buckets[idx]["count"] += 1
    sorted_sims = sorted(sims)
    n = len(sorted_sims)
    return {
        "mean_similarity":   round(statistics.mean(sims), 6),
        "median_similarity": round(statistics.median(sims), 6),
        "std_similarity":    round(statistics.stdev(sims), 6) if n > 1 else 0.0,
        "min_similarity":    round(min(sims), 6),
        "max_similarity":    round(max(sims), 6),
        "percentile_25":     round(sorted_sims[n // 4], 6),
        "percentile_75":     round(sorted_sims[3 * n // 4], 6),
        "distribution_buckets": buckets,
    }


@app.route("/api/ted/one-vs-all", methods=["POST"])
def one_vs_all():
    """Compare one base country against every other country in the dataset."""
    body = request.get_json()
    base_country = body.get("base_country", "")
    dataset = body.get("dataset", "clean")
    top_n = int(body.get("top_n", 20))

    if not base_country:
        return jsonify({"error": "base_country required"}), 400

    try:
        data, normalizer = _load(dataset)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    try:
        base_doc = algo.get_country_doc(data, base_country)
        actual_base = base_doc.get("country", base_country)
    except KeyError:
        return jsonify({"error": f"Country not found: {base_country}"}), 400

    cache_key = (actual_base, dataset)
    if cache_key in _ova_cache:
        return jsonify(_ova_cache[cache_key])

    try:
        import time
        t0 = time.time()

        results, base_size, actual_base, base_tree = _ova_compute(actual_base, data, normalizer, dataset)

        sims = [r["similarity"] for r in results]
        stats = _ova_stats(sims) if sims else {}

        fe_base_tree = _orig_node_to_frontend_tree(base_tree)
        fe_base_tree["value"] = actual_base

        response = {
            "base_country": actual_base,
            "dataset": dataset,
            "method": "nj_ted",
            "total_compared": len(results),
            "base_tree_size": base_size,
            "base_tree": fe_base_tree,
            "results": results,
            "top_n": results[:top_n],
            "bottom_n": results[-(top_n):] if len(results) >= top_n else results[::-1],
            "stats": stats,
            "elapsed_seconds": round(time.time() - t0, 3),
        }
        _ova_cache[cache_key] = response
        return jsonify(response)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/ted/one-vs-all/stream")
def one_vs_all_stream():
    """SSE stream: yields per-pair progress then the full OvaResult when done."""
    base_country = request.args.get("base_country", "")
    dataset = request.args.get("dataset", "clean")
    top_n = int(request.args.get("top_n", 20))

    if not base_country:
        def _err():
            yield 'data: {"error":"base_country required"}\n\n'
        return app.response_class(_err(), mimetype="text/event-stream")

    def _generate():
        import time, json as _json
        try:
            data, normalizer = _load(dataset)
        except Exception as e:
            yield f'data: {_json.dumps({"error": str(e)})}\n\n'
            return

        try:
            base_doc = algo.get_country_doc(data, base_country)
            actual_base = base_doc.get("country", base_country)
        except KeyError:
            yield f'data: {_json.dumps({"error": f"Country not found: {base_country}"})}\n\n'
            return

        cache_key = (actual_base, dataset)
        if cache_key in _ova_cache:
            cached = _ova_cache[cache_key]
            yield f'data: {_json.dumps({**cached, "complete": True})}\n\n'
            return

        try:
            base_tree = algo.build_tree_from_country_json(base_doc, dataset, normalizer)
            base_size = algo.subtree_size(base_tree)
            others = [item for item in data if item.get("country") != actual_base]
            total = len(others)
            results = []
            t0 = time.time()

            for done_idx, item in enumerate(others):
                name = item.get("country", "")
                try:
                    other_tree = algo.build_tree_from_country_json(item, dataset, normalizer)
                    distance = algo.nj_ted_cost(base_tree, other_tree)
                    similarity = algo.normalized_similarity(base_tree, other_tree)
                    results.append({"country": name, "distance": round(distance, 6), "similarity": round(similarity, 6)})
                    # stream progress every 5 pairs or last
                    if (done_idx + 1) % 5 == 0 or done_idx == total - 1:
                        yield f'data: {_json.dumps({"done": done_idx + 1, "total": total, "country": name, "similarity": round(similarity, 6)})}\n\n'
                except Exception:
                    yield f'data: {_json.dumps({"done": done_idx + 1, "total": total, "country": name, "similarity": None})}\n\n'
                    continue

            results.sort(key=lambda x: x["similarity"], reverse=True)
            for i, r in enumerate(results):
                r["rank"] = i + 1

            sims = [r["similarity"] for r in results]
            stats = _ova_stats(sims) if sims else {}

            fe_base_tree = _orig_node_to_frontend_tree(base_tree)
            fe_base_tree["value"] = actual_base

            response = {
                "base_country": actual_base,
                "dataset": dataset,
                "method": "nj_ted",
                "total_compared": len(results),
                "base_tree_size": base_size,
                "base_tree": fe_base_tree,
                "results": results,
                "top_n": results[:top_n],
                "bottom_n": results[-(top_n):] if len(results) >= top_n else results[::-1],
                "stats": stats,
                "elapsed_seconds": round(time.time() - t0, 3),
                "complete": True,
            }
            _ova_cache[cache_key] = {k: v for k, v in response.items() if k != "complete"}
            yield f'data: {_json.dumps(response)}\n\n'

        except Exception as e:
            import traceback
            traceback.print_exc()
            yield f'data: {_json.dumps({"error": str(e)})}\n\n'

    return app.response_class(
        _generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if __name__ == "__main__":
    app.run(port=5001, debug=True)