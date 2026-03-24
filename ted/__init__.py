"""
Ted - Type-Aware Tree Edit Distance for country infobox comparison.

Public API:
    build_country_tree(infobox_dict)  -> Node
    zhang_shasha(root1, root2, cost_fn) -> float
    CostFunction
    ted_similarity(tree1, tree2) -> (distance, similarity)
    compute_matrix(country_trees) -> (dist_df, sim_df)
"""

from .node import Node
from .tree_builder import build_country_tree, build_tree, tree_size
from .cost_functions import CostFunction
from .zhang_shasha import zhang_shasha
from .similarity import ted_similarity, compute_matrix, max_ted_cost

__all__ = [
    "Node",
    "build_country_tree",
    "build_tree",
    "tree_size",
    "CostFunction",
    "zhang_shasha",
    "ted_similarity",
    "compute_matrix",
    "max_ted_cost",
]