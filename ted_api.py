#!/usr/bin/env python3
"""
Flask API bridge between the React GUI and the Python TED algorithm.

Endpoints:
  GET  /api/ted/countries?dataset=clean       List country names
  GET  /api/ted/country?name=Lebanon&dataset=clean  Get raw country JSON
  POST /api/ted/build-tree                    Build tree for a country, return as frontend TreeNode
  POST /api/ted/compare                       Full comparison: TED, similarity, edit script, patch, post-process
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS

ROOT_DIR = Path(__file__).resolve().parent

# Make sure ted package and run_ted are importable
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from ted import Node, build_country_tree, tree_size
from ted.run_ted import (
    load_countries,
    build_lookup,
    resolve_country,
    diff_trees,
    apply_edit_script,
    verify_patch,
    script_summary,
    postprocess_to_json,
    postprocess_to_infobox_text,
    invert_edit_script,
    node_to_data,
    clone_node,
)
from ted.similarity import ted_similarity

app = Flask(__name__)
CORS(app)

# Cache loaded datasets
_cache: dict[str, tuple[list[dict], dict[str, dict]]] = {}


def _load(dataset: str):
    if dataset not in _cache:
        countries = load_countries(dataset)
        lookup = build_lookup(countries)
        _cache[dataset] = (countries, lookup)
    return _cache[dataset]


def _node_to_frontend_tree(node: Node, counter: list[int] | None = None, depth: int = 0) -> dict:
    """Convert a Python Node to the frontend TreeNode shape."""
    if counter is None:
        counter = [0]
    nid = str(counter[0])
    counter[0] += 1

    children = []
    for child in node.children:
        children.append(_node_to_frontend_tree(child, counter, depth + 1))

    result: dict = {
        "id": nid,
        "label": node.label,
        "children": children,
        "depth": depth,
    }

    if node.is_leaf():
        if node.node_type == "num":
            result["value"] = str(node.value) if node.value is not None else "0"
            result["numericValue"] = float(node.value) if node.value is not None else 0
        elif node.node_type == "str":
            result["value"] = str(node.value) if node.value is not None else ""
        elif node.node_type == "list":
            result["value"] = ", ".join(str(x) for x in node.value) if node.value else ""
        elif node.node_type == "dist":
            # Distribution: show as comma-separated key:value pairs
            if isinstance(node.value, dict):
                result["value"] = ", ".join(f"{k}: {v}" for k, v in node.value.items())
            else:
                result["value"] = str(node.value) if node.value else ""
        else:
            result["value"] = str(node.value) if node.value is not None else ""

    return result


def _edit_script_to_frontend(script: list[dict]) -> list[dict]:
    """Convert Python edit script to frontend EditOperation[] shape."""
    ops = []
    for op in script:
        kind = op["op"]
        path_str = "/".join(op["path"]) if op["path"] else "(root)"

        fe_op: dict = {
            "type": kind,
            "node": op.get("label", path_str),
            "cost": 1,
        }

        if kind == "update":
            old_val = json.dumps(op.get("old_value", ""), ensure_ascii=False)
            new_val = json.dumps(op.get("new_value", ""), ensure_ascii=False)
            # Truncate long values for display
            if len(old_val) > 80:
                old_val = old_val[:77] + "..."
            if len(new_val) > 80:
                new_val = new_val[:77] + "..."
            fe_op["from"] = old_val
            fe_op["to"] = new_val
        elif kind == "insert":
            val = json.dumps(op.get("value", ""), ensure_ascii=False)
            if len(val) > 80:
                val = val[:77] + "..."
            fe_op["value"] = val
        elif kind == "delete":
            old_val = json.dumps(op.get("old_value", ""), ensure_ascii=False)
            if len(old_val) > 80:
                old_val = old_val[:77] + "..."
            fe_op["value"] = old_val

        ops.append(fe_op)
    return ops


@app.route("/api/ted/countries")
def list_countries():
    dataset = request.args.get("dataset", "clean")
    try:
        countries, _ = _load(dataset)
        names = [c["country"] for c in countries]
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
        _, lookup = _load(dataset)
        actual_name, item = resolve_country(name, lookup)
        return jsonify(item)
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/ted/build-tree", methods=["POST"])
def build_tree_endpoint():
    data = request.get_json()
    dataset = data.get("dataset", "clean")
    name = data.get("name", "")

    if not name:
        return jsonify({"error": "name required"}), 400

    try:
        _, lookup = _load(dataset)
        actual_name, item = resolve_country(name, lookup)
        tree = build_country_tree(item)
        fe_tree = _node_to_frontend_tree(tree)
        fe_tree["value"] = actual_name  # Set root value to country name
        return jsonify({
            "name": actual_name,
            "tree": fe_tree,
            "size": tree_size(tree),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/ted/compare", methods=["POST"])
def compare():
    data = request.get_json()
    dataset = data.get("dataset", "clean")
    name_a = data.get("country_a", "")
    name_b = data.get("country_b", "")
    method = data.get("method", "exp_size")
    fields = data.get("fields", None)  # optional field filter (not used by Python algo currently)

    if not name_a or not name_b:
        return jsonify({"error": "country_a and country_b required"}), 400

    try:
        _, lookup = _load(dataset)
        actual_a, item_a = resolve_country(name_a, lookup)
        actual_b, item_b = resolve_country(name_b, lookup)

        tree_a = build_country_tree(item_a)
        tree_b = build_country_tree(item_b)

        distance, similarity = ted_similarity(tree_a, tree_b, method=method)

        # Build edit script
        script_a_to_b = diff_trees(tree_a, tree_b)

        # Patch and verify
        patched_tree = apply_edit_script(tree_a, script_a_to_b)
        patch_ok = verify_patch(patched_tree, tree_b)

        # Post-processed output
        patched_country_name = actual_b if patch_ok else actual_a
        patched_json_str = postprocess_to_json(patched_country_name, patched_tree)
        patched_infobox_str = postprocess_to_infobox_text(patched_country_name, patched_tree)

        # Convert trees to frontend format
        fe_tree_a = _node_to_frontend_tree(tree_a)
        fe_tree_a["value"] = actual_a
        fe_tree_b = _node_to_frontend_tree(tree_b)
        fe_tree_b["value"] = actual_b

        # Count operations by type
        op_counts = {"insert": 0, "delete": 0, "update": 0}
        for op in script_a_to_b:
            kind = op["op"]
            if kind in op_counts:
                op_counts[kind] += 1

        result = {
            "country_a": actual_a,
            "country_b": actual_b,
            "dataset": dataset,
            "method": method,
            "distance": round(distance, 6),
            "similarity": round(similarity, 6),
            "tree_a_size": tree_size(tree_a),
            "tree_b_size": tree_size(tree_b),
            "tree_a": fe_tree_a,
            "tree_b": fe_tree_b,
            "edit_script": _edit_script_to_frontend(script_a_to_b),
            "edit_script_raw": script_a_to_b,
            "edit_script_summary": script_summary(script_a_to_b),
            "operation_counts": op_counts,
            "total_operations": len(script_a_to_b),
            "patch_verified": patch_ok,
            "patched_json": patched_json_str,
            "patched_infobox": patched_infobox_str,
        }

        return jsonify(result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 400


if __name__ == "__main__":
    app.run(port=5001, debug=True)
