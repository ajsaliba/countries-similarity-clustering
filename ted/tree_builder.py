"""
JSON → rooted labeled tree conversion.

Node types
----------
dict   Internal node; children are key-value pairs.
dist   Percentage-distribution leaf (Religion, Ethnic groups).
       Stored as a single leaf with value = raw dict.
       Compared via L1 distance instead of node-by-node TED.
list   Simple-set leaf (Currency, Primary Language).
str    String leaf.
num    Numeric leaf.

Distribution detection
----------------------
A dict is treated as a "dist" node when:
  (a) its label is a known distribution label ("Religion", "Ethnic groups"), OR
  (b) all its values are numeric and all its keys end with "(%)".

This prevents the 8-entry Afghan ethnic-group sub-tree from swamping the
structural similarity against a country whose ethnic data is listed as
{"Unknown": 100.0}.
"""

from __future__ import annotations

from typing import Any

from .node import Node

_DISTRIBUTION_LABELS: frozenset[str] = frozenset({"Religion", "Ethnic groups"})

MISSING_VALUE: float = -1.0


def _is_distribution(data: dict, label: str) -> bool:
    """
    Return True when this dict should be treated as a flat distribution leaf.
    """
    if label in _DISTRIBUTION_LABELS:
        return True
    return len(data) > 0 and all(
        isinstance(v, (int, float)) and str(k).endswith("(%)")
        for k, v in data.items()
    )


def build_tree(data: Any, label: str = "root") -> Node:
    """
    Recursively convert a JSON-decoded Python object into a Node tree.

    Args:
        data:  The JSON value (dict, list, str, int, or float).
        label: The key name that this value was stored under.

    Returns:
        Root Node of the constructed sub-tree.
    """
    if isinstance(data, dict):
        if _is_distribution(data, label):
            return Node(label=label, node_type="dist", value=data)
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


def build_country_tree(country_json: dict) -> Node:
    """
    Build a tree from a raw country JSON document.

    Roots at the "infobox" dict so every country tree shares the same root
    label, making the TED directly comparable.
    """
    infobox = country_json.get("infobox", {})
    return build_tree(infobox, label="infobox")


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