"""
Type-aware, section-weighted cost function for Tree Edit Distance.

Theoretical foundations
------------------------
Every cost decision below is grounded in the course material and papers:

1. LOG-RATIO for numeric comparisons  (Ch. 5, our original cost_functions.py)
   cost = min(1, |ln(v1) − ln(v2)| / ln(100))
   Rationale: economic/demographic magnitudes span many orders of magnitude.
   A 2× ratio → cost ≈ 0.15; 10× → 0.50; 100× → 1.00.
   This is far more principled than linear distance for GDP, population, area.

2. L1 TOTAL VARIATION for distributions  (Journal_7 §3.2, Ch. 5)
   cost = Σ|p_i − q_i| / 200
   Rationale: religion and ethnic composition are probability distributions.
   L1 = total variation distance, the natural metric for comparing them.
   Denominator 200 because each sums to ~100%, so max divergence = 200.

3. TOKEN-JACCARD for strings  (Ch. 6 set-similarity prerequisites)
   cost = 1 − |tokens(s1) ∩ tokens(s2)| / |tokens(s1) ∪ tokens(s2)|
   Rationale: government-type strings share many tokens even when different
   ("Federal republic" vs "Federal presidential republic").  Token overlap
   rewards partial matches rather than punishing any wording difference.

4. D-FACTOR depth attenuation  (Journal_7 §3.3 TOC, tekli_Conf_14)
   factor(depth) = 1 / (1 + depth)
   Rationale: root-level section differences (missing "economy") matter far
   more than deep leaf differences (one extra ethnic group entry).
   Applied as a multiplier on the update cost: deep nodes pay less.

5. SECTION INFORMATION-CONTENT weight  (Fix #3 from PROJECT_NOTES §7.3)
   IC(section) = log(N / df(section))  — TF-IDF style across 195 countries.
   Sections present in almost every country (e.g. "area") have low IC
   and contribute less per-node to insert/delete cost.
   Sections that are rare or vary substantially (e.g. "gini", "hdi") have
   high IC and their absence is genuinely informative.
   Pre-computed once for the full corpus; defaults to 1.0 if not set.

6. S-CURVE SHARPENING  (original cost_functions.py, smoothstep)
   Maps [0,1]→[0,1] via f(x) = 3x² − 2x³.
   Compresses small differences (noise tolerance) and amplifies large ones
   (meaningful divergence hits harder).  Applied to update costs only.

7. MISSING-VALUE PENALTY  (original design)
   If one side has a value and the other has MISSING_VALUE (−1.0), cost = 0.5.
   This is a partial penalty: we know something is different but not how much.
   It is NOT sharpened, because 0.5 is already the midpoint of the cost range.

Cost model summary
-------------------
  insert(node)  = SECTION_WEIGHT[section] × BASE_WEIGHT[label]
  delete(node)  = same
  update(n1,n2) = inf                           if labels differ  (force del+ins)
                = 0.0                           if both are dict containers
                = weight × d_factor × sharpen(raw_cost(type))   otherwise

Insert/delete costs are *not* depth-attenuated — the D-factor applies only
to updates.  This matches Journal_7's TOC: the tree-op cost for a missing
section is anchored to the section's importance, not its depth.
"""

from __future__ import annotations

import math
import re
from typing import Dict, FrozenSet, Optional, Set

from .node import Node

# ── sentinel ────────────────────────────────────────────────────────────────
MISSING_VALUE: float = -1.0

# ── log scale for numeric cost ───────────────────────────────────────────────
# A 100× ratio between two positive numbers gives cost = 1.0
_LN_100: float = math.log(100.0)

# ── section-level base weights ───────────────────────────────────────────────
# Grounded in information content: how much does this field tell us about a
# country's identity and similarity to others?
#
# High   (2.0–3.0) → field is highly discriminating between countries
# Medium (1.0–1.5) → field is useful but shared broadly
# Low    (0.3–0.5) → field is almost always present with similar values,
#                    or carries little comparative information
#
FEATURE_WEIGHTS: Dict[str, float] = {
    # ── Economy — highest discriminating power ───────────────────────────
    "gdp_ppp":              0.4,   # container — cost lives in children
    "gdp_nominal":          0.4,   # container
    "total_billion_usd":    3.0,   # GDP total: strongest economic signal
    "per_capita_usd":       2.5,   # GDP per-capita: wealth level
    "gini":                 2.0,   # inequality index — high cross-country variance
    "hdi":                  2.0,   # human development — composite, discriminating
    "currency_code":        1.0,   # monetary union signal

    # ── Population ───────────────────────────────────────────────────────
    "total":                2.5,   # population size — major country attribute
    "density_per_km2":      1.5,   # density — related to urbanisation

    # ── Area ─────────────────────────────────────────────────────────────
    "total_km2":            1.5,   # geographic size
    "water_pct":            0.5,   # minor geographic detail
    "rank":                 0.3,   # ordinal rank — low additional info beyond size

    # ── General / cultural identity ───────────────────────────────────────
    "religion":             1.5,   # distribution — culturally discriminating
    "ethnic_groups":        1.5,   # distribution — culturally discriminating
    "official_language":    1.5,   # single strongest cultural marker
    "capital":              0.8,   # capitals are distinct but don't cluster well
    "demonym":              0.3,   # nearly derivable from country name

    # ── Government ───────────────────────────────────────────────────────
    "type":                 1.5,   # government form — clusters countries (republic / monarchy)
    "legislature":          1.0,   # legislative body name
    "lower_house":          0.8,
    "upper_house":          0.8,

    # ── History ───────────────────────────────────────────────────────────
    "history":              0.5,   # opaque token string — weak signal

    # ── Codes / time — low comparative value ─────────────────────────────
    "calling_code":         0.2,
    "internet_tld":         0.2,
    "iso_3166_code":        0.1,
    "timezone_utc":         0.4,
    "timezone_dst":         0.2,

    # ── Section containers — cost in children, not here ──────────────────
    "infobox":              0.1,
    "area":                 0.3,
    "codes":                0.1,
    "economy":              0.3,
    "general":              0.3,
    "government":           0.3,
    "population":           0.3,
    "time":                 0.1,
}

DEFAULT_WEIGHT: float = 1.0


# ══════════════════════════════════════════════════════════════════════════════
# Raw cost primitives
# ══════════════════════════════════════════════════════════════════════════════

def sharpen(x: float, degree: int = 3) -> float:
    """
    S-curve (smoothstep) that compresses small costs and amplifies large ones.
    Maps [0, 1] → [0, 1] with fixed points at 0, 0.5, 1.

    degree=1  linear (off)
    degree=3  smoothstep:   f(x) = 3x² − 2x³          ← default
    degree=5  smootherstep: f(x) = 6x⁵ − 15x⁴ + 10x³  ← more aggressive
    """
    x = max(0.0, min(1.0, x))
    if degree == 1:
        return x
    if degree == 3:
        return x * x * (3.0 - 2.0 * x)
    if degree == 5:
        return x * x * x * (x * (6.0 * x - 15.0) + 10.0)
    raise ValueError(f"Unsupported sharpening degree {degree}. Use 1, 3, or 5.")


def d_factor(node: Node) -> float:
    """
    Depth-attenuation factor from Tekli Journal_7 §3.3.

    Returns 1/(1 + depth) where depth is counted from the root (root = 0).
    Root-level updates (depth=0) pay full cost; deeper nodes pay less.

    depth 0 (infobox root)  → 1.000
    depth 1 (sections)      → 0.500
    depth 2 (fields)        → 0.333
    depth 3 (sub-fields)    → 0.250
    """
    depth = 0
    current = node.parent
    while current is not None:
        depth += 1
        current = current.parent
    return 1.0 / (1.0 + depth)


def _tokenize(text: str) -> FrozenSet[str]:
    """Lowercase alphabetic+digit tokens from a string."""
    return frozenset(re.findall(r"[a-z0-9]+", text.lower()))


def _jaccard(a: Set, b: Set) -> float:
    """Jaccard similarity ∈ [0, 1].  Returns 1.0 if both empty."""
    if not a and not b:
        return 1.0
    union = len(a | b)
    return len(a & b) / union if union > 0 else 1.0


def numeric_cost(v1: float, v2: float) -> float:
    """
    Log-ratio cost for two numeric values → [0, 1].

    |ln(v1) − ln(v2)| / ln(100) so that:
      2×   ratio → ~0.15
      10×  ratio → ~0.50
      100× ratio →  1.00

    Special cases:
      Either value is MISSING_VALUE → 0.5 (partial penalty, not sharpened)
      Either value ≤ 0              → linear normalised difference
      Both equal                    → 0.0
    """
    if v1 == MISSING_VALUE or v2 == MISSING_VALUE:
        # One side missing — we know they differ, but not by how much
        return 0.5
    if v1 == v2:
        return 0.0
    if v1 <= 0.0 or v2 <= 0.0:
        # Fall back to linear ratio when log is undefined
        max_abs = max(abs(v1), abs(v2))
        if max_abs == 0.0:
            return 0.0
        return min(abs(v1 - v2) / max_abs, 1.0)
    log_diff = abs(math.log(v1) - math.log(v2))
    return min(log_diff / _LN_100, 1.0)


def string_cost(s1: str, s2: str) -> float:
    """1 − token-Jaccard similarity for string nodes."""
    if s1 == s2:
        return 0.0
    if not s1 and not s2:
        return 0.0
    if not s1 or not s2:
        # One is empty — treat as completely different
        return 1.0
    return 1.0 - _jaccard(_tokenize(s1), _tokenize(s2))


def list_cost(lst1: list, lst2: list) -> float:
    """1 − item-Jaccard similarity for list nodes (order-independent)."""
    s1: Set[str] = {str(x).lower().strip() for x in lst1 if x is not None}
    s2: Set[str] = {str(x).lower().strip() for x in lst2 if x is not None}
    return 1.0 - _jaccard(s1, s2)


def l1_distribution_cost(d1: dict, d2: dict) -> float:
    """
    L1 (total variation) distance between two percentage distributions → [0, 1].

    cost = Σ|p_i − q_i| / 200

    Denominator is 200 because each distribution sums to ~100%, so the
    maximum possible total variation is 200 (completely disjoint).

    Empty distributions: if both empty → 0.0; one empty → 1.0
    (a country with no religion data vs one with rich data is maximally
    different on that dimension).
    """
    if not d1 and not d2:
        return 0.0
    if not d1 or not d2:
        return 1.0
    all_keys = set(d1) | set(d2)
    total = sum(abs(d1.get(k, 0.0) - d2.get(k, 0.0)) for k in all_keys)
    return min(total / 200.0, 1.0)


# ══════════════════════════════════════════════════════════════════════════════
# CostFunction class
# ══════════════════════════════════════════════════════════════════════════════

class CostFunction:
    """
    Encapsulates insert, delete, and type-aware update costs for TED.

    Args:
        weights:         Per-label importance weights.  Defaults to FEATURE_WEIGHTS.
        missing_value:   Sentinel for absent numeric data.  Default −1.0.
        sharpness:       S-curve degree applied to update costs.
                         1 = linear, 3 = smoothstep (default), 5 = smootherstep.
        use_d_factor:    Apply depth attenuation to update costs.
                         Default is False for the fixed-schema country trees,
                         where all leaves live at depth 2–3 and D-factor would
                         uniformly cut all leaf costs by 75%, masking real
                         differences.  FEATURE_WEIGHTS carries the importance
                         gradient instead.  Set True when comparing trees of
                         variable depth (e.g. generic XML).
        section_ic:      Optional {section_label: ic_weight} dict computed from
                         corpus document-frequency.  When provided, insert/delete
                         costs for nodes in that section are multiplied by the
                         IC weight, boosting the cost of missing rare sections.
    """

    def __init__(
        self,
        weights: Optional[Dict[str, float]] = None,
        missing_value: float = MISSING_VALUE,
        sharpness: int = 3,
        use_d_factor: bool = False,
        section_ic: Optional[Dict[str, float]] = None,
    ) -> None:
        self._weights    = weights if weights is not None else FEATURE_WEIGHTS
        self._missing    = missing_value
        self._sharpness  = sharpness
        self._use_d_factor = use_d_factor
        self._section_ic = section_ic or {}

    # ── section IC lookup ────────────────────────────────────────────────────

    def _ic_weight(self, node: Node) -> float:
        """
        Return the information-content multiplier for this node's section.

        Walk up the tree to find the top-level section (depth-1 child of
        root "infobox").  If section_ic was provided, return its weight for
        that section; otherwise return 1.0.
        """
        if not self._section_ic:
            return 1.0
        # Find the depth-1 ancestor (direct child of infobox root)
        current = node
        section_label = node.label
        while current.parent is not None:
            if current.parent.parent is None:
                # current.parent is root → current is the section node
                section_label = current.label
                break
            current = current.parent
        return self._section_ic.get(section_label, 1.0)

    # ── base weight lookup ───────────────────────────────────────────────────

    def _weight(self, node: Node) -> float:
        return self._weights.get(node.label, DEFAULT_WEIGHT)

    # ── insert / delete ──────────────────────────────────────────────────────

    def insert(self, node: Node) -> float:
        """
        Cost of inserting *node* into the tree.

        = feature_weight × IC_weight

        Insert/delete costs are NOT depth-attenuated (D-factor) because a
        missing section is equally bad regardless of where it would sit.
        Journal_7 §4.4: tree-op cost is anchored to importance, not depth.
        """
        return self._weight(node) * self._ic_weight(node)

    def delete(self, node: Node) -> float:
        """Cost of deleting *node* from the tree.  Symmetric with insert."""
        return self._weight(node) * self._ic_weight(node)

    # ── update ───────────────────────────────────────────────────────────────

    def update(self, node1: Node, node2: Node) -> float:
        """
        Cost of updating node1 to become node2.

        Returns inf for label mismatches — forces Zhang-Shasha to prefer
        delete + insert rather than relabeling across keys.

        For dict (container) nodes: 0.0 — the cost lives in children.

        For leaf nodes:
          raw_cost = type-specific primitive (numeric, string, list, dist)
          final    = feature_weight × D-factor × sharpen(raw_cost)

        The D-factor means root-level field updates cost more than deep ones,
        matching Tekli Journal_7's TOC formulation.
        """
        # Labels must match — otherwise Zhang-Shasha uses del+ins
        if node1.label != node2.label:
            return float("inf")

        # Type mismatch on same label — treat as full replacement
        if node1.node_type != node2.node_type:
            return self._weight(node1) * (self._ic_weight(node1) if self._section_ic else 1.0)

        t = node1.node_type

        # Containers carry no value — cost lives in children
        if t == "dict":
            return 0.0

        # ── numeric ─────────────────────────────────────────────────────
        if t == "num":
            raw = numeric_cost(node1.value, node2.value)
            # Missing-value penalty bypasses sharpening (0.5 is the
            # midpoint; sharpening would leave it unchanged anyway for
            # smoothstep: f(0.5) = 0.5)
            if raw == 0.5:
                cost = 0.5
            else:
                cost = sharpen(raw, self._sharpness)

        # ── string ──────────────────────────────────────────────────────
        elif t == "str":
            raw = string_cost(
                node1.value if node1.value else "",
                node2.value if node2.value else "",
            )
            cost = sharpen(raw, self._sharpness)

        # ── list ────────────────────────────────────────────────────────
        elif t == "list":
            raw = list_cost(
                node1.value if node1.value else [],
                node2.value if node2.value else [],
            )
            cost = sharpen(raw, self._sharpness)

        # ── distribution ─────────────────────────────────────────────────
        elif t == "dist":
            raw = l1_distribution_cost(
                node1.value if node1.value else {},
                node2.value if node2.value else {},
            )
            cost = sharpen(raw, self._sharpness)

        else:
            # Unknown type — treat as fully different
            cost = 1.0

        # Apply feature weight
        weighted = cost * self._weight(node1)

        # Apply D-factor depth attenuation (Journal_7 §3.3)
        if self._use_d_factor:
            weighted *= d_factor(node1)

        return weighted


# ══════════════════════════════════════════════════════════════════════════════
# Corpus-level IC weight computation
# ══════════════════════════════════════════════════════════════════════════════

def compute_section_ic(country_trees, n_countries: int) -> Dict[str, float]:
    """
    Compute Information Content weights for each top-level section
    using document frequency across the corpus.

    IC(section) = log(N / df(section))   [natural log, clamped to ≥ 0]

    where df(section) = number of country trees that have at least one
    non-missing leaf under that section.

    A section present in every country (df = N) → IC = 0 → weight = 1.0
    A section present in half the countries    → IC = ln(2) ≈ 0.69

    We return normalised weights so the maximum IC maps to 2.0 and the
    minimum maps to 1.0 (avoids zeroing out common sections entirely):

        weight(section) = 1.0 + IC(section) / max_IC

    Args:
        country_trees: iterable of (name, Node) or list of Node objects
        n_countries:   total number of countries (= N)

    Returns:
        {section_label: weight}
    """
    from collections import Counter

    # Accept either (name, tree) pairs or bare trees
    if hasattr(next(iter(country_trees), None), 'children'):
        trees = list(country_trees)
    else:
        trees = [t for _, t in country_trees]

    section_df: Counter = Counter()

    for root in trees:
        for section_node in root.children:
            # A section "exists" if it has at least one non-missing leaf
            if _section_has_data(section_node):
                section_df[section_node.label] += 1

    ic: Dict[str, float] = {}
    for section, df in section_df.items():
        ic[section] = max(0.0, math.log(n_countries / df)) if df > 0 else math.log(n_countries)

    if not ic:
        return {}

    max_ic = max(ic.values()) if ic else 1.0
    if max_ic == 0.0:
        return {s: 1.0 for s in ic}

    return {s: 1.0 + ic_val / max_ic for s, ic_val in ic.items()}


def _section_has_data(node: Node) -> bool:
    """Return True if the section subtree has at least one non-missing leaf."""
    if node.is_leaf():
        if node.node_type == "num":
            return node.value != MISSING_VALUE and node.value is not None
        if node.node_type == "str":
            return bool(node.value)
        if node.node_type in ("list", "dist"):
            return bool(node.value)
        return False
    return any(_section_has_data(c) for c in node.children)
