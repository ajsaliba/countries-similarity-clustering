"""
Type-aware cost functions for Tree Edit Distance.

Design principles
-----------------
1. Value differences dominate over structural similarity.
   Dict container nodes (Area, Economy, …) carry low insert/delete weights
   so that a shared schema does not inflate similarity.

2. Log-based numeric comparison.
   cost = min(1, |ln(v1) − ln(v2)| / ln(100))
   A 100× ratio gives cost 1.0; a 10× ratio gives cost 0.5; a 2× ratio ~0.15.
   This correctly penalises large economic gaps without collapsing small ones.

3. L1 distance for percentage distributions (Religion, Ethnic groups).
   cost = Σ|p_i − q_i| / 200
   Treats the full distribution as a unit rather than matching individual
   religion/ethnicity nodes, which avoids structural bias from different
   numbers of sub-entries between countries.

4. Jaccard for simple-set lists (Currency, Primary Language).
   cost = 1 − |intersection| / |union|

5. Token-Jaccard for strings (Government type, Legislature).

6. S-curve sharpening applied to all update costs.
   Compresses small differences (similar values stay cheap) and amplifies
   large differences (different values hit harder).
"""

from __future__ import annotations

import math
import re
from typing import Dict, FrozenSet, Set

from .node import Node




FEATURE_WEIGHTS: Dict[str, float] = {
    # Economic value nodes – highest weight
    "GDP ( PPP )":    3.0,
    "GDP (nominal)":  3.0,
    "Total ($)":      3.0,
    "Per capita ($)": 2.5,
    # Demographic value nodes
    "Count":          2.5,
    "Density (/km2)": 1.5,
    # Development indices
    "HDI":            2.0,
    "Gini":           2.0,
    # Geographic value nodes
    "Total (km2)":    1.5,
    "Water (%)":      0.5,
    # Cultural / identity nodes
    "Religion":       1.5,
    "Ethnic groups":  1.5,
    "Primary Language": 1.5,
    "Currency":       1.0,
    # Structural containers – deliberately low so schema match stays cheap
    "Economy":        0.5,
    "Population":     0.5,
    "General":        0.3,
    "Government":     0.5,
    "Area":           0.3,
    "infobox":        0.1,
}

DEFAULT_WEIGHT: float = 1.0


MISSING_VALUE: float = -1.0


_LN_SCALE: float = math.log(100.0)  

def sharpen(x: float, degree: int = 3) -> float:
    """
    Polynomial S-curve that compresses small costs and amplifies large ones.

    Maps [0, 1] → [0, 1] with fixed points at 0, 0.5, and 1.

    degree=3  smoothstep:    f(x) = 3x² − 2x³
    degree=5  smootherstep:  f(x) = 6x⁵ − 15x⁴ + 10x³
    degree=1  linear pass-through (no sharpening)
    """
    x = max(0.0, min(1.0, x))
    if degree == 1:
        return x
    if degree == 3:
        return x * x * (3.0 - 2.0 * x)
    if degree == 5:
        return x * x * x * (x * (6.0 * x - 15.0) + 10.0)
    raise ValueError(f"Unsupported sharpening degree: {degree}. Choose 1, 3, or 5.")

def _tokenize(text: str) -> FrozenSet[str]:
    return frozenset(re.findall(r"[a-z0-9]+", text.lower()))


def _jaccard(a: Set, b: Set) -> float:
    if not a and not b:
        return 1.0
    u = len(a | b)
    return len(a & b) / u if u > 0 else 1.0


def numeric_cost(v1: float, v2: float) -> float:
    """
    Raw log-based cost for two numeric values → [0, 1].

    Uses |ln(v1) − ln(v2)| / ln(100) so that:
      • A 2×   ratio  →  cost ≈ 0.15
      • A 10×  ratio  →  cost ≈ 0.50
      • A 100× ratio  →  cost  = 1.00

    Special cases:
      • Either value is MISSING_VALUE → 0.5  (partial penalty)
      • Either value ≤ 0             → linear normalised difference
      • Both equal                   → 0.0
    """
    if v1 == MISSING_VALUE or v2 == MISSING_VALUE:
        return 0.5
    if v1 == v2:
        return 0.0
    if v1 <= 0.0 or v2 <= 0.0:
        
        max_abs = max(abs(v1), abs(v2))
        if max_abs == 0.0:
            return 0.0
        return min(abs(v1 - v2) / max_abs, 1.0)
    log_diff = abs(math.log(v1) - math.log(v2))
    return min(log_diff / _LN_SCALE, 1.0)


def string_cost(s1: str, s2: str) -> float:
    """Raw 1 − token-Jaccard similarity."""
    if s1 == s2:
        return 0.0
    return 1.0 - _jaccard(_tokenize(s1), _tokenize(s2))


def list_cost(lst1: list, lst2: list) -> float:
    """Raw 1 − item-Jaccard similarity (order-independent)."""
    s1: Set[str] = {str(x).lower() for x in lst1}
    s2: Set[str] = {str(x).lower() for x in lst2}
    return 1.0 - _jaccard(s1, s2)


def l1_distribution_cost(d1: dict, d2: dict) -> float:
    """
    L1 (Total Variation) distance between two percentage distributions.

    cost = Σ|p_i − q_i| / 200

    The denominator is 200 because each distribution sums to ~100%,
    so the maximum possible L1 sum is 200 (completely disjoint distributions).

    Returns a value in [0, 1].
    """
    all_keys = set(d1) | set(d2)
    total = sum(abs(d1.get(k, 0.0) - d2.get(k, 0.0)) for k in all_keys)
    return min(total / 200.0, 1.0)


class CostFunction:
    """
    Encapsulates insert, delete, and type-aware update costs.

    Update costs are passed through an S-curve sharpening function so that
    small differences stay cheap and large differences hit harder.

    Args:
        weights:    Per-label importance weights (overrides FEATURE_WEIGHTS).
        missing_value: Sentinel for a missing numeric measurement.
        sharpness:  S-curve degree. 1 = linear (off), 3 = smoothstep (default),
                    5 = smootherstep (most aggressive).
    """

    def __init__(
        self,
        weights: Dict[str, float] | None = None,
        missing_value: float = MISSING_VALUE,
        sharpness: int = 3,
    ) -> None:
        self._weights   = weights if weights is not None else FEATURE_WEIGHTS
        self._missing   = missing_value
        self._sharpness = sharpness

    def insert(self, node: Node) -> float:
        return self._weights.get(node.label, DEFAULT_WEIGHT)

    def delete(self, node: Node) -> float:
        return self._weights.get(node.label, DEFAULT_WEIGHT)

    def update(self, node1: Node, node2: Node) -> float:
        """
        Cost of updating node1 to node2.

        Returns inf for label mismatches (forces delete+insert).
        Missing-value penalty (0.5) bypasses sharpening since f(0.5)=0.5.
        """
        if node1.label != node2.label:
            return float("inf")

        if node1.node_type != node2.node_type:
            return 1.0

        t = node1.node_type

        if t == "dict":
            return 0.0

        if t == "num":
            raw = numeric_cost(node1.value, node2.value)
            if raw == 0.5 and (
                node1.value == self._missing or node2.value == self._missing
            ):
                return 0.5

        elif t == "str":
            raw = string_cost(node1.value, node2.value)

        elif t == "list":
            raw = list_cost(node1.value, node2.value)

        elif t == "dist":
            raw = l1_distribution_cost(node1.value, node2.value)

        else:
            return 1.0

        return sharpen(raw, self._sharpness)