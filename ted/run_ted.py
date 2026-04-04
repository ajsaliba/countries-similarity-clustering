from __future__ import annotations

import argparse
import difflib
import json
import math
import re
import sys
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

ROOT_DIR = Path(__file__).resolve().parent
PARENT_DIR = ROOT_DIR.parent
if str(PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(PARENT_DIR))

from ted import Node, build_country_tree, build_tree, ted_similarity, tree_size

DATASET_FILES = {
    "clean": ROOT_DIR.parent / "data" / "clean" / "all_countries_clean.json",
    "raw":   ROOT_DIR.parent / "data" / "raw"   / "all_countries.json",
}

MISSING_VALUE = -1.0

_MULTIPLIERS = {
    "thousand": 1e3,
    "million": 1e6,
    "billion": 1e9,
    "trillion": 1e12,
}

_LANGUAGE_KEYS = [
    "Official language",
    "Official languages",
    "National language",
    "National languages",
    "Primary language",
    "Primary languages",
]

_CAPITAL_KEYS = [
    "Capital",
    "Capital and largest city",
    "Administrative center",
    "Federal city",
]




def get_dataset_path(dataset_name: str) -> Path:
    try:
        return DATASET_FILES[dataset_name]
    except KeyError as exc:
        valid = ", ".join(DATASET_FILES.keys())
        raise ValueError(f"Unknown dataset '{dataset_name}'. Valid options: {valid}") from exc




def normalize_name(name: str) -> str:
    return " ".join(name.strip().casefold().split())


def build_lookup(countries: List[dict]) -> Dict[str, dict]:
    lookup: Dict[str, dict] = {}
    for item in countries:
        country_name = item.get("country")
        if country_name:
            lookup[normalize_name(str(country_name))] = item
    return lookup


def resolve_country(name: str, lookup: Dict[str, dict]) -> Tuple[str, dict]:
    key = normalize_name(name)
    if key in lookup:
        item = lookup[key]
        return str(item["country"]), item

    matches = difflib.get_close_matches(key, list(lookup.keys()), n=5, cutoff=0.6)
    if matches:
        suggestions = ", ".join(str(lookup[m]["country"]) for m in matches)
        raise KeyError(f"Country '{name}' not found. Closest matches: {suggestions}")

    raise KeyError(f"Country '{name}' not found in dataset.")


def strip_coords(text: str) -> str:
    text = re.sub(r"\d+°[^A-Za-z]*[NSEW].*$", "", text).strip()
    text = re.sub(r"\s*\([^)]*de facto[^)]*\)", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"\s{2,}", " ", text).strip(" ,;/")
    return text or text


def parse_first_number(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if value is None:
        return MISSING_VALUE

    text = str(value)
    match = re.search(r"-?\d[\d,]*(?:\.\d+)?", text)
    if not match:
        return MISSING_VALUE

    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return MISSING_VALUE


def parse_percent(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if value is None:
        return MISSING_VALUE

    text = str(value).replace("−", "-")
    match = re.search(r"-?\d[\d,]*(?:\.\d+)?", text)
    if not match:
        return MISSING_VALUE

    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return MISSING_VALUE


def parse_money(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if value is None:
        return MISSING_VALUE

    text = str(value).replace(",", "")
    match = re.search(r"(-?\d+(?:\.\d+)?)", text)
    if not match:
        return MISSING_VALUE

    number = float(match.group(1))
    lower = text.casefold()
    for word, mult in _MULTIPLIERS.items():
        if word in lower:
            return number * mult
    return number


def clean_token(text: str) -> str:
    text = re.sub(r"\([^)]*\)", " ", text)
    text = text.replace("•", " ")
    text = re.sub(r"\b(?:and|or)\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" ,;/")


def split_language_string(value: str) -> List[str]:
    text = clean_token(value)
    if not text:
        return []

    parts = re.split(r"[,/]", text)
    items: List[str] = []
    for part in parts:
        part = part.strip()
        if part:
            items.append(part)

    return [item for item in items if item]


def dedupe_preserve_order(values: Iterable[str]) -> List[str]:
    seen = OrderedDict()
    for value in values:
        v = str(value).strip()
        if v:
            seen.setdefault(v, None)
    return list(seen.keys())


def parse_languages_from_general(general: dict) -> List[str]:
    langs: List[str] = []
    for key in _LANGUAGE_KEYS:
        if key not in general:
            continue

        value = general[key]
        if isinstance(value, list):
            langs.extend(str(x) for x in value)
        elif isinstance(value, dict):
            langs.extend(str(k) for k in value.keys())
        else:
            langs.extend(split_language_string(str(value)))

    return dedupe_preserve_order(langs)


def parse_currency(value: Any) -> List[str]:
    if isinstance(value, list):
        return dedupe_preserve_order(str(x) for x in value)
    if value is None:
        return []

    text = clean_token(str(value))
    parts = re.split(r"[,/]", text)
    return dedupe_preserve_order(part.strip() for part in parts if part.strip())


def flatten_distribution(data: Any) -> Dict[str, float]:
    out: Dict[str, float] = {}

    def visit(prefix: str, value: Any) -> None:
        if isinstance(value, dict):
            if "percentage" in value and isinstance(value["percentage"], (str, int, float)):
                pct = parse_percent(value.get("percentage"))
                if pct != MISSING_VALUE and prefix:
                    out[prefix] = pct

                breakdown = value.get("breakdown")
                if isinstance(breakdown, dict):
                    for k, v in breakdown.items():
                        visit(str(k), v)

                for k, v in value.items():
                    if k not in {"percentage", "breakdown", "Details"}:
                        visit(str(k), v)
                return

            for k, v in value.items():
                key = str(k).strip()
                if key.lower() == "details":
                    continue
                visit(key, v)
            return

        pct = parse_percent(value)
        if pct != MISSING_VALUE and prefix:
            out[prefix] = pct

    visit("", data)

    cleaned: Dict[str, float] = {}
    for key, val in out.items():
        k = clean_token(key)
        if k:
            cleaned[k] = val

    return cleaned


def pick_capital(general: dict) -> str:
    for key in _CAPITAL_KEYS:
        if key in general:
            value = general[key]
            if isinstance(value, str):
                cleaned = strip_coords(value)
                if cleaned:
                    return cleaned
            else:
                return str(value)
    return ""


def pick_population_count(population: dict) -> float:
    if not isinstance(population, dict):
        return MISSING_VALUE

    scored: List[Tuple[int, float]] = []
    for key, value in population.items():
        key_lower = str(key).casefold()
        if "density" in key_lower or "date format" in key_lower:
            continue

        num = parse_first_number(value)
        if num == MISSING_VALUE:
            continue

        score = 0
        if re.search(r"estimate", key_lower):
            score += 3
        if re.search(r"census", key_lower):
            score += 2
        if re.search(r"population", key_lower):
            score += 1

        scored.append((score, num))

    if not scored:
        return MISSING_VALUE

    scored.sort(key=lambda t: t[0], reverse=True)
    return scored[0][1]


def find_value_case_insensitive(mapping: dict, *patterns: str) -> Any:
    for key, value in mapping.items():
        k = str(key)
        if any(p.casefold() in k.casefold() for p in patterns):
            return value
    return None


def normalize_country(item: dict) -> dict:
    infobox = item.get("infobox", {}) if isinstance(item, dict) else {}
    general = infobox.get("General", {}) if isinstance(infobox, dict) else {}
    government = infobox.get("Government", {}) if isinstance(infobox, dict) else {}
    area = infobox.get("Area", {}) if isinstance(infobox, dict) else {}
    population = infobox.get("Population", {}) if isinstance(infobox, dict) else {}
    economy = infobox.get("Economy", {}) if isinstance(infobox, dict) else {}

    langs = parse_languages_from_general(general)
    religion_raw = general.get("Religion") or next(
        (v for k, v in general.items() if "religion" in str(k).casefold()),
        {},
    )
    ethnic_raw = general.get("Ethnic groups") or next(
        (
            v
            for k, v in general.items()
            if "ethnic group" in str(k).casefold() or "nationality" in str(k).casefold()
        ),
        {},
    )

    economy_gdp_ppp = economy.get("GDP ( PPP )") or economy.get("GDP ( PPP") or {}
    economy_gdp_nom = economy.get("GDP (nominal)") or economy.get("GDP (nominal") or {}

    normalized = {
        "country": item.get("country", "Unknown"),
        "infobox": {
            "General": {
                "Capital": pick_capital(general),
                "Primary Language": (
                    langs
                    if langs
                    else ([str(general.get("Official languages"))] if general.get("Official languages") else [])
                ),
                "Ethnic groups": flatten_distribution(ethnic_raw),
                "Religion": flatten_distribution(religion_raw),
                "Demonyms": general.get("Demonyms") or general.get("Demonym") or "",
            },
            "Government": {
                "Government": government.get("Government", ""),
                "Legislature": government.get("Legislature", ""),
            },
            "Area": {
                "Total (km2)": parse_first_number(find_value_case_insensitive(area, "Total")),
                "Water (%)": parse_percent(find_value_case_insensitive(area, "Water")),
            },
            "Population": {
                "Count": pick_population_count(population),
                "Density (/km2)": parse_first_number(population.get("Density", MISSING_VALUE)),
            },
            "Economy": {
                "GDP ( PPP )": {
                    "Total ($)": parse_money(find_value_case_insensitive(economy_gdp_ppp, "Total")),
                    "Per capita ($)": parse_money(find_value_case_insensitive(economy_gdp_ppp, "Per capita")),
                },
                "GDP (nominal)": {
                    "Total ($)": parse_money(find_value_case_insensitive(economy_gdp_nom, "Total")),
                    "Per capita ($)": parse_money(find_value_case_insensitive(economy_gdp_nom, "Per capita")),
                },
                "Gini": parse_percent(economy.get("Gini") or find_value_case_insensitive(economy, "Gini")),
                "HDI": parse_percent(economy.get("HDI") or find_value_case_insensitive(economy, "HDI")),
                "Currency": parse_currency(economy.get("Currency", [])),
            },
        },
    }
    return normalized


def load_countries(dataset_name: str) -> List[dict]:
    dataset_path = get_dataset_path(dataset_name)

    with dataset_path.open("r", encoding="utf-8") as f:
        payload = json.load(f)

    if isinstance(payload, dict) and "countries" in payload:
        countries = payload["countries"]
    elif isinstance(payload, list):
        countries = payload
    else:
        raise ValueError(f"Unexpected JSON structure in {dataset_path}")

    return [normalize_country(item) for item in countries if isinstance(item, dict)]




def _clone_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _clone_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_clone_value(v) for v in value]
    return value


def clone_node(node: Node) -> Node:
    cloned = Node(label=node.label, node_type=node.node_type, value=_clone_value(node.value))
    for child in node.children:
        cloned.add_child(clone_node(child))
    return cloned


def node_to_data(node: Node) -> Any:
    if node.node_type == "dict":
        return {child.label: node_to_data(child) for child in node.children}
    return _clone_value(node.value)


def country_doc_from_tree(country_name: str, root: Node) -> dict:
    return {
        "country": country_name,
        "infobox": node_to_data(root),
    }


def _child_map(node: Node) -> Dict[str, Node]:
    return {child.label: child for child in node.children}


def _child_index_map(node: Node) -> Dict[str, int]:
    return {child.label: idx for idx, child in enumerate(node.children)}


def _path_str(path: List[str]) -> str:
    return "infobox" if not path else "infobox/" + "/".join(path)


def make_insert_op(path: List[str], node: Node, index: int) -> dict:
    return {
        "op": "insert",
        "path": list(path),
        "index": index,
        "label": node.label,
        "node_type": node.node_type,
        "value": node_to_data(node),
    }


def make_delete_op(path: List[str], node: Node) -> dict:
    return {
        "op": "delete",
        "path": list(path),
        "label": node.label,
        "node_type": node.node_type,
        "old_value": node_to_data(node),
    }


def make_update_op(path: List[str], src: Node, dst: Node) -> dict:
    return {
        "op": "update",
        "path": list(path),
        "label": dst.label,
        "old_type": src.node_type,
        "new_type": dst.node_type,
        "old_value": node_to_data(src),
        "new_value": node_to_data(dst),
    }


def diff_trees(source: Node, target: Node, path: List[str] | None = None) -> List[dict]:
    if path is None:
        path = []

    if source.label != target.label:
        raise ValueError(
            f"Mismatched labels at {_path_str(path)}: {source.label!r} vs {target.label!r}"
        )

    if source.node_type != target.node_type:
        return [make_update_op(path, source, target)]

    if source.node_type != "dict":
        if node_to_data(source) != node_to_data(target):
            return [make_update_op(path, source, target)]
        return []

    script: List[dict] = []
    src_map = _child_map(source)
    tgt_map = _child_map(target)
    src_idx = _child_index_map(source)
    tgt_idx = _child_index_map(target)

    shared = [child.label for child in target.children if child.label in src_map]
    src_only = [child.label for child in source.children if child.label not in tgt_map]
    tgt_only = [child.label for child in target.children if child.label not in src_map]

    for label in shared:
        script.extend(diff_trees(src_map[label], tgt_map[label], path + [label]))

    for label in sorted(src_only, key=lambda x: src_idx[x], reverse=True):
        script.append(make_delete_op(path + [label], src_map[label]))

    for label in sorted(tgt_only, key=lambda x: tgt_idx[x]):
        script.append(make_insert_op(path + [label], tgt_map[label], tgt_idx[label]))

    return script


def _get_node(root: Node, path: List[str]) -> Node:
    node = root
    for part in path:
        for child in node.children:
            if child.label == part:
                node = child
                break
        else:
            raise KeyError(f"Path not found: {_path_str(path)}")
    return node


def _get_parent_and_name(root: Node, path: List[str]) -> Tuple[Node, str]:
    if not path:
        raise ValueError("Root does not have a parent")
    return _get_node(root, path[:-1]), path[-1]


def _replace_child(parent: Node, child_name: str, new_child: Node) -> None:
    for i, child in enumerate(parent.children):
        if child.label == child_name:
            new_child.parent = parent
            parent.children[i] = new_child
            return
    raise KeyError(f"Child {child_name!r} not found under {parent.label!r}")


def _delete_child(parent: Node, child_name: str) -> None:
    for i, child in enumerate(parent.children):
        if child.label == child_name:
            parent.children.pop(i)
            return
    raise KeyError(f"Child {child_name!r} not found under {parent.label!r}")


def _insert_child(parent: Node, child: Node, index: int | None = None) -> None:
    child.parent = parent
    if index is None or index < 0 or index > len(parent.children):
        parent.children.append(child)
    else:
        parent.children.insert(index, child)


def apply_edit_script(root: Node, script: List[dict]) -> Node:
    patched = clone_node(root)

    for op in script:
        kind = op["op"]
        path = list(op["path"])

        if kind == "update":
            if not path:
                patched = build_tree(op["new_value"], label=patched.label)
                continue

            parent, name = _get_parent_and_name(patched, path)
            new_child = build_tree(op["new_value"], label=name)
            _replace_child(parent, name, new_child)

        elif kind == "delete":
            parent, name = _get_parent_and_name(patched, path)
            _delete_child(parent, name)

        elif kind == "insert":
            parent, name = _get_parent_and_name(patched, path)
            new_child = build_tree(op["value"], label=name)
            _insert_child(parent, new_child, op.get("index"))

        else:
            raise ValueError(f"Unsupported operation: {kind}")

    return patched


def invert_edit_script(script: List[dict]) -> List[dict]:
    inverse: List[dict] = []

    for op in reversed(script):
        kind = op["op"]

        if kind == "insert":
            inverse.append({
                "op": "delete",
                "path": list(op["path"]),
                "label": op["label"],
                "node_type": op["node_type"],
                "old_value": _clone_value(op["value"]),
            })

        elif kind == "delete":
            inverse.append({
                "op": "insert",
                "path": list(op["path"]),
                "index": None,
                "label": op["label"],
                "node_type": op["node_type"],
                "value": _clone_value(op["old_value"]),
            })

        elif kind == "update":
            inverse.append({
                "op": "update",
                "path": list(op["path"]),
                "label": op["label"],
                "old_type": op["new_type"],
                "new_type": op["old_type"],
                "old_value": _clone_value(op["new_value"]),
                "new_value": _clone_value(op["old_value"]),
            })

        else:
            raise ValueError(f"Unsupported operation: {kind}")

    return inverse


def verify_patch(patched: Node, expected: Node) -> bool:
    return node_to_data(patched) == node_to_data(expected)


def script_summary(script: List[dict]) -> str:
    lines: List[str] = []

    for op in script:
        kind = op["op"].upper()
        path = _path_str(op["path"])

        if op["op"] == "insert":
            lines.append(f"{kind:<6} {path} <- {json.dumps(op['value'], ensure_ascii=False)}")
        elif op["op"] == "delete":
            lines.append(f"{kind:<6} {path}")
        elif op["op"] == "update":
            lines.append(
                f"{kind:<6} {path}: "
                f"{json.dumps(op['old_value'], ensure_ascii=False)} -> "
                f"{json.dumps(op['new_value'], ensure_ascii=False)}"
            )
        else:
            lines.append(f"{kind:<6} {path}")

    return "\n".join(lines)




def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _format_number_for_label(label: str, value: float) -> str:
    if value == MISSING_VALUE:
        return "N/A"

    if label == "HDI":
        return f"{value:.3f}"

    if label in {"Gini", "Water (%)"}:
        if float(value).is_integer():
            return f"{int(value)}"
        return f"{value:.1f}".rstrip("0").rstrip(".")

    if label in {"Count", "Total ($)", "Per capita ($)", "Total (km2)"}:
        if float(value).is_integer():
            return f"{int(value):,}"
        return f"{value:,.2f}".rstrip("0").rstrip(".")

    if label == "Density (/km2)":
        if float(value).is_integer():
            return f"{int(value):,}"
        return f"{value:,.2f}".rstrip("0").rstrip(".")

    if float(value).is_integer():
        return f"{int(value):,}"
    return f"{value:,.3f}".rstrip("0").rstrip(".")


def _scalar_to_text(label: str, value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(str(v) for v in value) if value else "N/A"

    if _is_number(value):
        return _format_number_for_label(label, float(value))

    return str(value) if value not in {"", None} else "N/A"


def _render_mapping(mapping: Dict[str, Any], indent: int = 0) -> List[str]:
    lines: List[str] = []
    pad = "  " * indent

    for key, value in mapping.items():
        if isinstance(value, dict):
            if value and all(_is_number(v) for v in value.values()):
                lines.append(f"{pad}{key}:")
                for sub_key, sub_val in value.items():
                    lines.append(f"{pad}  {sub_key}: {_format_number_for_label(sub_key, float(sub_val))}%")
            else:
                lines.append(f"{pad}{key}:")
                lines.extend(_render_mapping(value, indent + 1))
        else:
            lines.append(f"{pad}{key}: {_scalar_to_text(key, value)}")

    return lines


def postprocess_to_json(country_name: str, root: Node) -> str:
    return json.dumps(country_doc_from_tree(country_name, root), indent=2, ensure_ascii=False)


def postprocess_to_infobox_text(country_name: str, root: Node) -> str:
    infobox = node_to_data(root)
    lines = [f"Country: {country_name}", "Infobox:"]
    lines.extend(_render_mapping(infobox, indent=1))
    return "\n".join(lines)


def write_text(path: str | None, content: str) -> None:
    if not path:
        return
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(content, encoding="utf-8")




def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare two countries using TED, extract a diff, patch one tree into the other, and post-process the result."
    )
    parser.add_argument("--a", required=True, help="First country name")
    parser.add_argument("--b", required=True, help="Second country name")
    parser.add_argument(
        "--dataset",
        choices=["clean", "raw"],
        default="clean",
        help="Choose which dataset to use",
    )
    parser.add_argument(
        "--method",
        choices=["exp_size", "norm", "exp", "inv"],
        default="exp_size",
        help="Similarity conversion method",
    )
    parser.add_argument(
        "--patch-direction",
        choices=["a_to_b", "b_to_a"],
        default="a_to_b",
        help="Which source tree to patch",
    )
    parser.add_argument(
        "--show-script",
        action="store_true",
        help="Print a human-readable edit script",
    )
    parser.add_argument(
        "--save-script-json",
        help="Save the machine-readable edit script as JSON",
    )
    parser.add_argument(
        "--save-patched-json",
        help="Save the patched result as JSON",
    )
    parser.add_argument(
        "--save-patched-infobox",
        help="Save the patched result as infobox-style text",
    )
    parser.add_argument(
        "--verify-patch",
        action="store_true",
        help="Fail if the patched tree does not match the target tree",
    )

    args = parser.parse_args()

    try:
        dataset_path = get_dataset_path(args.dataset)
        countries = load_countries(args.dataset)
        lookup = build_lookup(countries)

        actual_a, item_a = resolve_country(args.a, lookup)
        actual_b, item_b = resolve_country(args.b, lookup)

        tree_a = build_country_tree(item_a)
        tree_b = build_country_tree(item_b)

        distance, similarity = ted_similarity(tree_a, tree_b, method=args.method)

        script_a_to_b = diff_trees(tree_a, tree_b)
        script_b_to_a = invert_edit_script(script_a_to_b)

        if args.patch_direction == "a_to_b":
            source_name = actual_a
            target_name = actual_b
            source_tree = tree_a
            target_tree = tree_b
            script = script_a_to_b
        else:
            source_name = actual_b
            target_name = actual_a
            source_tree = tree_b
            target_tree = tree_a
            script = script_b_to_a

        patched_tree = apply_edit_script(source_tree, script)
        patch_ok = verify_patch(patched_tree, target_tree)

        print(f"Dataset: {dataset_path}")
        print(f"Dataset mode: {args.dataset}")
        print(f"Method: {args.method}")
        print(f"A: {actual_a}")
        print(f"B: {actual_b}")
        print(f"Distance: {distance:.6f}")
        print(f"Similarity: {similarity:.6f}")
        print(f"Tree A size: {tree_size(tree_a)}")
        print(f"Tree B size: {tree_size(tree_b)}")
        print(f"Patch direction: {source_name} -> {target_name}")
        print(f"Edit operations: {len(script)}")
        print(f"Patch verification: {'OK' if patch_ok else 'FAILED'}")

        if args.show_script:
            print("\n=== Edit Script ===")
            print(script_summary(script) or "(no changes)")

        if args.save_script_json:
            write_text(args.save_script_json, json.dumps(script, indent=2, ensure_ascii=False))
            print(f"Saved edit script JSON to: {args.save_script_json}")

        patched_country_name = target_name if patch_ok else source_name
        patched_json = postprocess_to_json(patched_country_name, patched_tree)
        patched_infobox = postprocess_to_infobox_text(patched_country_name, patched_tree)

        if args.save_patched_json:
            write_text(args.save_patched_json, patched_json)
            print(f"Saved patched JSON to: {args.save_patched_json}")

        if args.save_patched_infobox:
            write_text(args.save_patched_infobox, patched_infobox)
            print(f"Saved patched infobox text to: {args.save_patched_infobox}")

        if args.verify_patch and not patch_ok:
            print("Error: patched tree does not match target tree.", file=sys.stderr)
            return 2

        return 0

    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())