"""
Similarity conversion and pairwise matrix computation.

Distance → Similarity methods
------------------------------
"exp_size"  (default, recommended)
    similarity = exp(−TED / avg_tree_size)
    where avg_tree_size = (|T1| + |T2|) / 2  (total node count each tree).
    Normalises by tree complexity so that the score is independent of how
    many nodes each country's infobox happens to have.
    Target ranges:  very similar > 0.7,  clearly different < 0.3.

"norm"
    similarity = 1 − TED / max_cost
    where max_cost = delete_all(T1) + insert_all(T2).
    Bounded in [0, 1]; useful when an absolute upper bound is needed.

"exp"
    similarity = exp(−TED)            (fast decay, for small distances)

"inv"
    similarity = 1 / (1 + TED)        (slow decay)
"""

from __future__ import annotations

import math
from typing import Dict, List, Tuple

from .node import Node
from .tree_builder import tree_size
from .cost_functions import CostFunction
from .zhang_shasha import zhang_shasha


# ---------------------------------------------------------------------------
# Max-cost helper  (for "norm" method)
# ---------------------------------------------------------------------------

def _tree_delete_cost(root: Node, cost_fn: CostFunction) -> float:
    total = cost_fn.delete(root)
    for child in root.children:
        total += _tree_delete_cost(child, cost_fn)
    return total


def _tree_insert_cost(root: Node, cost_fn: CostFunction) -> float:
    total = cost_fn.insert(root)
    for child in root.children:
        total += _tree_insert_cost(child, cost_fn)
    return total


def max_ted_cost(tree1: Node, tree2: Node, cost_fn: CostFunction) -> float:
    """Upper bound: cost of deleting all of T1 + inserting all of T2."""
    return _tree_delete_cost(tree1, cost_fn) + _tree_insert_cost(tree2, cost_fn)


# ---------------------------------------------------------------------------
# Core similarity function
# ---------------------------------------------------------------------------

def ted_similarity(
    tree1: Node,
    tree2: Node,
    cost_fn: CostFunction | None = None,
    method: str = "exp_size",
) -> Tuple[float, float]:
    """
    Compute TED distance and similarity between two country trees.

    Args:
        tree1, tree2: Roots built by build_country_tree().
        cost_fn:      CostFunction (default: built-in weights, sharpness=3).
        method:       "exp_size" (default), "norm", "exp", or "inv".

    Returns:
        (distance, similarity)
    """
    if cost_fn is None:
        cost_fn = CostFunction()

    dist = zhang_shasha(tree1, tree2, cost_fn)
    sim  = _to_similarity(dist, tree1, tree2, cost_fn, method)
    return dist, sim


def _to_similarity(
    distance: float,
    tree1: Node,
    tree2: Node,
    cost_fn: CostFunction,
    method: str = "exp_size",
) -> float:
    """Convert a non-negative TED distance to a similarity score."""
    if method == "exp_size":
        avg_size = (tree_size(tree1) + tree_size(tree2)) / 2.0
        if avg_size == 0:
            return 1.0
        return math.exp(-distance / avg_size)

    if method == "norm":
        upper = max_ted_cost(tree1, tree2, cost_fn)
        if upper == 0.0:
            return 1.0
        return max(0.0, 1.0 - distance / upper)

    if method == "exp":
        return math.exp(-distance)

    if method == "inv":
        return 1.0 / (1.0 + distance)

    raise ValueError(
        f"Unknown method: {method!r}. Choose 'exp_size', 'norm', 'exp', or 'inv'."
    )


# ---------------------------------------------------------------------------
# Pairwise matrix
# ---------------------------------------------------------------------------

def compute_matrix(
    country_trees: Dict[str, Node],
    cost_fn: CostFunction | None = None,
    method: str = "exp_size",
    progress: bool = True,
) -> Tuple[Dict, Dict]:
    """
    Compute pairwise distance and similarity for all country pairs.

    Returns:
        (distance_matrix, similarity_matrix) as nested dicts
        { country_name: { country_name: float } }
    """
    if cost_fn is None:
        cost_fn = CostFunction()

    names: List[str] = sorted(country_trees.keys())
    n = len(names)

    dist_mat: Dict[str, Dict[str, float]] = {c: {} for c in names}
    sim_mat:  Dict[str, Dict[str, float]] = {c: {} for c in names}

    for name in names:
        dist_mat[name][name] = 0.0
        sim_mat[name][name]  = 1.0

    total_pairs = n * (n - 1) // 2
    done = 0

    for i, name_i in enumerate(names):
        for j in range(i + 1, n):
            name_j = names[j]
            dist, sim = ted_similarity(
                country_trees[name_i],
                country_trees[name_j],
                cost_fn,
                method,
            )
            dist_mat[name_i][name_j] = dist
            dist_mat[name_j][name_i] = dist
            sim_mat[name_i][name_j]  = sim
            sim_mat[name_j][name_i]  = sim

            done += 1
            if progress and done % 500 == 0:
                pct = 100.0 * done / total_pairs
                print(f"  {done}/{total_pairs} pairs ({pct:.1f}%)", flush=True)

    if progress:
        print(f"  {done}/{total_pairs} pairs (100.0%)", flush=True)

    return dist_mat, sim_mat


# ---------------------------------------------------------------------------
# Ranking
# ---------------------------------------------------------------------------

def top_similar(
    country: str,
    sim_mat: Dict[str, Dict[str, float]],
    n: int = 10,
    exclude_self: bool = True,
) -> List[Tuple[str, float]]:
    """Return the n most similar countries sorted descending."""
    row = sim_mat.get(country, {})
    ranked = sorted(
        ((c, s) for c, s in row.items() if not (exclude_self and c == country)),
        key=lambda x: x[1],
        reverse=True,
    )
    return ranked[:n]