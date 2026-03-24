"""
Tree node representation for JSON infobox data.

Each node carries:
  label     - the JSON key name (e.g. "GDP ( PPP )", "Currency")
  node_type - one of "dict" | "list" | "str" | "num"
  value     - leaf value (None for dict nodes whose value lives in children)
  children  - ordered list of child Nodes
  parent    - back-reference to parent (None for root)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, List, Optional


@dataclass
class Node:
    label: str
    node_type: str          # "dict" | "list" | "str" | "num"
    value: Any = None       # populated for leaf nodes
    children: List[Node] = field(default_factory=list)
    parent: Optional[Node] = field(default=None, repr=False)

    def add_child(self, child: Node) -> None:
        child.parent = self
        self.children.append(child)

    def is_leaf(self) -> bool:
        return len(self.children) == 0

    def __repr__(self) -> str:
        if self.is_leaf():
            return f"Node({self.label!r}, {self.node_type}, val={self.value!r})"
        return f"Node({self.label!r}, {self.node_type}, children={len(self.children)})"

    # Nodes must be hashable for use as dict keys in the algorithm.
    def __hash__(self) -> int:
        return id(self)

    def __eq__(self, other: object) -> bool:
        return self is other