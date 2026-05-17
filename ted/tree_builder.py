"""
JSON → rooted labeled tree conversion for the *clean* country schema.

Clean schema top-level sections
---------------------------------
  area       → total_km2 (num), water_pct (num), rank (num)
  codes      → calling_code (str), internet_tld (str), iso_3166_code (str)
  economy    → currency_code (str),
               gdp_ppp   → total_billion_usd (num), per_capita_usd (num)
               gdp_nominal → total_billion_usd (num), per_capita_usd (num)
               gini      → value (num)
               hdi       → value (num)
  general    → capital (str), demonym (str), official_language (str),
               ethnic_groups → groups (dist), religion → groups (dist)
  government → type (str), legislature (str), lower_house (str), upper_house (str)
  history    → key: date pairs (str leaves) — treated as an opaque str node
  population → total (num), density_per_km2 (num)
  time       → timezone_utc (str), timezone_dst (str)

Node types
-----------
  dict  – internal container; children hold all sub-fields
  num   – numeric leaf (float); MISSING_VALUE (-1.0) used for null
  str   – string leaf
  list  – ordered list of strings leaf
  dist  – percentage-distribution leaf  {str: float}; compared via L1

Design rationale
-----------------
* Every node carries its *section* label (top-level key) so the cost
  function can apply IC-weighting per section.
* Depth is implicit in the tree structure; the cost function derives it
  from node.parent chains.
* Distribution nodes (ethnic_groups.groups, religion.groups) are
  collapsed to a single "dist" leaf so that a country with 8 ethnic
  entries is not penalised structurally against one with 1 entry.
* The "history" section is deliberately kept as a single opaque string
  leaf: history timelines are highly variable and semantically
  incomparable in a general way.
* "codes" and "time" sections are included but their fields are low-
  weight (see cost_functions.py FEATURE_WEIGHTS) — they provide weak
  structural signal without inflating the similarity floor.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from .node import Node

# ── sentinel ────────────────────────────────────────────────────────────────
MISSING_VALUE: float = -1.0


# ── helpers ──────────────────────────────────────────────────────────────────

def _num(value: Any) -> float:
    """Return float or MISSING_VALUE for None / non-numeric."""
    if value is None:
        return MISSING_VALUE
    try:
        return float(value)
    except (TypeError, ValueError):
        return MISSING_VALUE


def _str(value: Any) -> str:
    """Return stripped string or empty string."""
    if value is None:
        return ""
    return str(value).strip()


def _dist(groups: Any) -> Dict[str, float]:
    """
    Normalise a {label: pct} dict into a clean float dict.
    None values and non-numeric values are dropped.
    """
    if not isinstance(groups, dict):
        return {}
    result: Dict[str, float] = {}
    for k, v in groups.items():
        if v is not None:
            try:
                result[str(k).strip()] = float(v)
            except (TypeError, ValueError):
                pass
    return result


def _add(parent: Node, label: str, node_type: str, value: Any = None) -> Node:
    """Create a child node, attach it to parent, and return it."""
    child = Node(label=label, node_type=node_type, value=value)
    parent.add_child(child)
    return child


# ── section builders ─────────────────────────────────────────────────────────

def _build_area(root: Node, area: dict) -> None:
    sec = _add(root, "area", "dict")
    _add(sec, "total_km2",  "num", _num(area.get("total_km2")))
    _add(sec, "water_pct",  "num", _num(area.get("water_pct")))
    # rank is ordinal/comparative, not a magnitude — kept as num but
    # cost_functions gives it a low weight
    _add(sec, "rank",       "num", _num(area.get("rank")))


def _build_codes(root: Node, codes: dict) -> None:
    sec = _add(root, "codes", "dict")
    _add(sec, "calling_code",  "str", _str(codes.get("calling_code")))
    _add(sec, "internet_tld",  "str", _str(codes.get("internet_tld")))
    _add(sec, "iso_3166_code", "str", _str(codes.get("iso_3166_code")))


def _build_economy(root: Node, economy: dict) -> None:
    sec = _add(root, "economy", "dict")

    _add(sec, "currency_code", "str", _str(economy.get("currency_code")))

    # GDP PPP sub-section
    ppp = economy.get("gdp_ppp") or {}
    ppp_node = _add(sec, "gdp_ppp", "dict")
    _add(ppp_node, "total_billion_usd", "num", _num(ppp.get("total_billion_usd")))
    _add(ppp_node, "per_capita_usd",    "num", _num(ppp.get("per_capita_usd")))

    # GDP Nominal sub-section
    nom = economy.get("gdp_nominal") or {}
    nom_node = _add(sec, "gdp_nominal", "dict")
    _add(nom_node, "total_billion_usd", "num", _num(nom.get("total_billion_usd")))
    _add(nom_node, "per_capita_usd",    "num", _num(nom.get("per_capita_usd")))

    # Gini — scalar index [0, 100]
    gini_raw = economy.get("gini") or {}
    gini_val = _num(gini_raw.get("value") if isinstance(gini_raw, dict) else gini_raw)
    _add(sec, "gini", "num", gini_val)

    # HDI — scalar index [0, 1]
    hdi_raw = economy.get("hdi") or {}
    hdi_val = _num(hdi_raw.get("value") if isinstance(hdi_raw, dict) else hdi_raw)
    _add(sec, "hdi", "num", hdi_val)


def _build_general(root: Node, general: dict) -> None:
    sec = _add(root, "general", "dict")

    _add(sec, "capital",           "str", _str(general.get("capital")))
    _add(sec, "demonym",           "str", _str(general.get("demonym")))
    _add(sec, "official_language", "str", _str(general.get("official_language")))

    # Religion — percentage distribution
    religion_raw = general.get("religion") or {}
    religion_groups = (
        religion_raw.get("groups") if isinstance(religion_raw, dict) else religion_raw
    )
    _add(sec, "religion", "dist", _dist(religion_groups))

    # Ethnic groups — percentage distribution
    ethnic_raw = general.get("ethnic_groups") or {}
    ethnic_groups = (
        ethnic_raw.get("groups") if isinstance(ethnic_raw, dict) else ethnic_raw
    )
    _add(sec, "ethnic_groups", "dist", _dist(ethnic_groups))


def _build_government(root: Node, government: dict) -> None:
    sec = _add(root, "government", "dict")
    _add(sec, "type",        "str", _str(government.get("type")))
    _add(sec, "legislature", "str", _str(government.get("legislature")))
    _add(sec, "lower_house", "str", _str(government.get("lower_house")))
    _add(sec, "upper_house", "str", _str(government.get("upper_house")))


def _build_history(root: Node, history: dict) -> None:
    """
    History is highly variable across countries (different events, depths,
    date formats).  We represent it as a single string leaf — the sorted
    concatenation of event names — so TED sees it as a comparable token set
    rather than a sprawling sub-tree that inflates distances.
    """
    if not isinstance(history, dict) or not history:
        token = ""
    else:
        token = " | ".join(sorted(str(k) for k in history.keys()))
    _add(root, "history", "str", token)


def _build_population(root: Node, population: dict) -> None:
    sec = _add(root, "population", "dict")
    _add(sec, "total",           "num", _num(population.get("total")))
    _add(sec, "density_per_km2", "num", _num(population.get("density_per_km2")))


def _build_time(root: Node, time: dict) -> None:
    sec = _add(root, "time", "dict")
    _add(sec, "timezone_utc", "str", _str(time.get("timezone_utc")))
    _add(sec, "timezone_dst", "str", _str(time.get("timezone_dst")))


# ── public API ────────────────────────────────────────────────────────────────

def build_country_tree(country_json: dict) -> Node:
    """
    Convert a clean-schema country JSON document into a Node tree.

    The root label is "infobox" so all country trees share the same
    root and the TED is directly comparable.

    Args:
        country_json: A dict with keys country, area, codes, economy,
                      general, government, history, population, time.

    Returns:
        Root Node of the constructed tree.
    """
    root = Node(label="infobox", node_type="dict")

    _build_area      (root, country_json.get("area",       {}) or {})
    _build_codes     (root, country_json.get("codes",      {}) or {})
    _build_economy   (root, country_json.get("economy",    {}) or {})
    _build_general   (root, country_json.get("general",    {}) or {})
    _build_government(root, country_json.get("government", {}) or {})
    _build_history   (root, country_json.get("history",    {}) or {})
    _build_population(root, country_json.get("population", {}) or {})
    _build_time      (root, country_json.get("time",       {}) or {})

    return root


def tree_size(root: Node) -> int:
    """Total number of nodes in the tree (including root)."""
    return 1 + sum(tree_size(c) for c in root.children)


def tree_summary(root: Node, indent: int = 0) -> str:
    """Return a human-readable indented string of the tree structure."""
    prefix = "  " * indent
    if root.node_type == "dist":
        items = ", ".join(f"{k}: {v}" for k, v in list(root.value.items())[:3])
        ellipsis = "..." if len(root.value) > 3 else ""
        return f"{prefix}{root.label!r} (dist) = {{{items}{ellipsis}}}\n"
    if root.is_leaf():
        return f"{prefix}{root.label!r} ({root.node_type}) = {root.value!r}\n"
    lines = [f"{prefix}{root.label!r} ({root.node_type})\n"]
    for child in root.children:
        lines.append(tree_summary(child, indent + 1))
    return "".join(lines)


# Keep build_tree for any code that constructs ad-hoc trees from arbitrary JSON
def build_tree(data: Any, label: str = "root") -> Node:
    """
    Generic recursive converter: JSON value → Node tree.
    Used by the patching layer and tests.  Not used by build_country_tree.
    """
    if isinstance(data, dict):
        node = Node(label=label, node_type="dict")
        for key, val in data.items():
            child = build_tree(val, label=key)
            node.add_child(child)
        return node
    if isinstance(data, list):
        return Node(label=label, node_type="list", value=data)
    if isinstance(data, str):
        return Node(label=label, node_type="str", value=data)
    if isinstance(data, (int, float)):
        return Node(label=label, node_type="num", value=float(data))
    return Node(label=label, node_type="str", value=str(data))
