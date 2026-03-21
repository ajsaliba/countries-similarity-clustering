"""
Zhang-Shasha Tree Edit Distance algorithm.

Reference
---------
K. Zhang and D. Shasha, "Simple Fast Algorithms for the Editing Distance
between Trees and Related Problems," SIAM Journal on Computing, 1989.

Key properties of this implementation
--------------------------------------
1. Label-matching constraint: update_cost returns inf for mismatched labels,
   so the optimiser always prefers delete+insert over cross-key matching.
2. Type-aware costs: delegated entirely to the CostFunction object.
3. Uses 2-D list arrays (not dicts) for the forest-distance sub-problem to
   keep constant factors small in Python.

Complexity: O(|T1|² · |T2|²) worst-case, O(|T1| · |T2| · D1 · D2) typical,
where D is the number of distinct leftmost-leaf values (≈ leaf count).
For country trees with ~35 nodes each the runtime per pair is < 5 ms.
"""

from __future__ import annotations

from typing import List, Tuple

from .node import Node
from .cost_functions import CostFunction


# ---------------------------------------------------------------------------
# Internal tree-indexing helpers
# ---------------------------------------------------------------------------

def _postorder(root: Node) -> List[Node]:
    """Return all nodes in left-right postorder (children before parent)."""
    result: List[Node] = []

    def _visit(node: Node) -> None:
        for child in node.children:
            _visit(child)
        result.append(node)

    _visit(root)
    return result


def _leftmost_leaf(postorder_nodes: List[Node]) -> List[int]:
    """
    Compute ld[i] = index (1-based) of the leftmost leaf in the subtree
    rooted at postorder_nodes[i-1].

    For a leaf: ld[i] = i.
    For an internal node: ld[i] = ld of its leftmost child.

    Returns a 1-indexed list (ld[0] is a dummy 0).
    """
    n = len(postorder_nodes)
    # Map each node object → its 1-based postorder index
    idx: dict[int, int] = {id(nd): i + 1 for i, nd in enumerate(postorder_nodes)}

    ld = [0] * (n + 1)  # ld[1..n]; ld[0] unused
    for i, node in enumerate(postorder_nodes, start=1):
        if node.is_leaf():
            ld[i] = i
        else:
            # Leftmost child in postorder has the smallest index among children;
            # because we process children left-to-right, the first child's
            # subtree occupies the lowest postorder indices.
            ld[i] = ld[idx[id(node.children[0])]]
    return ld


def _keyroots(ld: List[int], n: int) -> List[int]:
    """
    Keyroots = nodes whose leftmost-leaf value is unique when scanning
    right-to-left, i.e. for each distinct ld value we keep the node with
    the *largest* postorder index.

    Returns a sorted (ascending) list of 1-based node indices.
    """
    seen: dict[int, int] = {}
    for i in range(1, n + 1):
        seen[ld[i]] = i  # overwrite with the larger index
    return sorted(seen.values())


# ---------------------------------------------------------------------------
# Forest-distance sub-problem  (called for each keyroot pair)
# ---------------------------------------------------------------------------

def _forest_dist(
    ki: int,
    kj: int,
    nodes1: List[Node],   # 1-indexed (nodes1[0] is None)
    nodes2: List[Node],   # 1-indexed
    ld1: List[int],
    ld2: List[int],
    TD: List[List[float]],
    cost_fn: CostFunction,
) -> None:
    """
    Fill in TD[i1][j1] for all (i1, j1) in the subproblem defined by
    keyroots ki (tree1) and kj (tree2).

    FD[r][c] = min-cost edit from the forest T1[ldi..i1] to T2[ldj..j1],
    where r = i1 - (ldi-1) and c = j1 - (ldj-1).
    """
    ldi = ld1[ki]
    ldj = ld2[kj]

    rows = ki - ldi + 2   # r ∈ [0, ki - ldi + 1]
    cols = kj - ldj + 2   # c ∈ [0, kj - ldj + 1]

    FD: List[List[float]] = [[0.0] * cols for _ in range(rows)]

    # ── Base cases ──────────────────────────────────────────────────────
    # FD[0][0] = 0  (empty forest ↔ empty forest, already initialised)

    # Delete all of T1-forest (column 0)
    for r in range(1, rows):
        i1 = ldi - 1 + r          # actual postorder index
        FD[r][0] = FD[r - 1][0] + cost_fn.delete(nodes1[i1])

    # Insert all of T2-forest (row 0)
    for c in range(1, cols):
        j1 = ldj - 1 + c
        FD[0][c] = FD[0][c - 1] + cost_fn.insert(nodes2[j1])

    # ── Main DP ─────────────────────────────────────────────────────────
    for r in range(1, rows):
        i1 = ldi - 1 + r
        node1 = nodes1[i1]

        for c in range(1, cols):
            j1 = ldj - 1 + c
            node2 = nodes2[j1]

            # Option A: delete node i1
            opt_del = FD[r - 1][c] + cost_fn.delete(node1)
            # Option B: insert node j1
            opt_ins = FD[r][c - 1] + cost_fn.insert(node2)

            if ld1[i1] == ldi and ld2[j1] == ldj:
                # ── Tree case: i1 and j1 are tree roots within this forest.
                # We can match (update) them directly.
                opt_upd = FD[r - 1][c - 1] + cost_fn.update(node1, node2)
                val = min(opt_del, opt_ins, opt_upd)
                FD[r][c] = val
                TD[i1][j1] = val   # record tree distance

            else:
                # ── Forest case: at least one of i1, j1 is an intermediate
                # node whose subtree was already handled by a previous keyroot
                # call.  Use the precomputed TD value for those subtrees.
                #
                # FD index for (ld1[i1]-1, ld2[j1]-1) in array coordinates:
                prev_r = ld1[i1] - ldi      # = (ld1[i1] - 1) - (ldi - 1)
                prev_c = ld2[j1] - ldj      # = (ld2[j1] - 1) - (ldj - 1)
                opt_sub = FD[prev_r][prev_c] + TD[i1][j1]
                FD[r][c] = min(opt_del, opt_ins, opt_sub)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def zhang_shasha(
    root1: Node,
    root2: Node,
    cost_fn: CostFunction | None = None,
) -> float:
    """
    Compute the Tree Edit Distance between *root1* and *root2*.

    Args:
        root1:    Root of the first tree.
        root2:    Root of the second tree.
        cost_fn:  CostFunction instance.  Defaults to CostFunction() with
                  the built-in feature weights.

    Returns:
        Minimum-cost edit distance (float ≥ 0).
    """
    if cost_fn is None:
        cost_fn = CostFunction()

    seq1 = _postorder(root1)
    seq2 = _postorder(root2)
    n = len(seq1)
    m = len(seq2)

    if n == 0 and m == 0:
        return 0.0

    # 1-indexed node arrays (index 0 is a dummy placeholder)
    nodes1: List[Node | None] = [None] + seq1
    nodes2: List[Node | None] = [None] + seq2

    ld1 = _leftmost_leaf(seq1)
    ld2 = _leftmost_leaf(seq2)

    kr1 = _keyroots(ld1, n)
    kr2 = _keyroots(ld2, m)

    # TD[i][j] = TED(subtree rooted at nodes1[i], subtree rooted at nodes2[j])
    # Initialised to 0; filled in by _forest_dist calls.
    TD: List[List[float]] = [[0.0] * (m + 1) for _ in range(n + 1)]

    for ki in kr1:
        for kj in kr2:
            _forest_dist(ki, kj, nodes1, nodes2, ld1, ld2, TD, cost_fn)

    return TD[n][m]


# ---------------------------------------------------------------------------
# Optional: edit-script reconstruction (for debugging / UI diff view)
# ---------------------------------------------------------------------------

def zhang_shasha_with_script(
    root1: Node,
    root2: Node,
    cost_fn: CostFunction | None = None,
) -> Tuple[float, List[str]]:
    """
    Run Zhang-Shasha and return (distance, edit_script).

    The edit script is a list of human-readable operation strings such as:
      "DELETE  'Gini' (num, -1.0)"
      "INSERT  'Gini' (num, 32.4)"
      "UPDATE  'HDI': 0.496 → 0.958  (cost=0.482)"

    Note: this reconstructs the script by back-tracing the DP table and is
    therefore O(n·m) additional memory on top of the main algorithm.
    """
    if cost_fn is None:
        cost_fn = CostFunction()

    seq1 = _postorder(root1)
    seq2 = _postorder(root2)
    n, m = len(seq1), len(seq2)

    nodes1: List[Node | None] = [None] + seq1
    nodes2: List[Node | None] = [None] + seq2

    ld1 = _leftmost_leaf(seq1)
    ld2 = _leftmost_leaf(seq2)
    kr1 = _keyroots(ld1, n)
    kr2 = _keyroots(ld2, m)

    TD = [[0.0] * (m + 1) for _ in range(n + 1)]
    # Also store operation choices for back-tracing
    OP = [["" for _ in range(m + 1)] for _ in range(n + 1)]

    # We re-run _forest_dist but record choices in OP
    for ki in kr1:
        for kj in kr2:
            ldi, ldj = ld1[ki], ld2[kj]
            rows = ki - ldi + 2
            cols = kj - ldj + 2
            FD = [[0.0] * cols for _ in range(rows)]

            for r in range(1, rows):
                i1 = ldi - 1 + r
                FD[r][0] = FD[r - 1][0] + cost_fn.delete(nodes1[i1])
            for c in range(1, cols):
                j1 = ldj - 1 + c
                FD[0][c] = FD[0][c - 1] + cost_fn.insert(nodes2[j1])

            for r in range(1, rows):
                i1 = ldi - 1 + r
                nd1 = nodes1[i1]
                for c in range(1, cols):
                    j1 = ldj - 1 + c
                    nd2 = nodes2[j1]
                    d = FD[r - 1][c] + cost_fn.delete(nd1)
                    ins = FD[r][c - 1] + cost_fn.insert(nd2)
                    if ld1[i1] == ldi and ld2[j1] == ldj:
                        upd = FD[r - 1][c - 1] + cost_fn.update(nd1, nd2)
                        best = min(d, ins, upd)
                        FD[r][c] = best
                        TD[i1][j1] = best
                        if best == upd:
                            OP[i1][j1] = "update"
                        elif best == d:
                            OP[i1][j1] = "delete"
                        else:
                            OP[i1][j1] = "insert"
                    else:
                        pr, pc = ld1[i1] - ldi, ld2[j1] - ldj
                        sub = FD[pr][pc] + TD[i1][j1]
                        FD[r][c] = min(d, ins, sub)

    # Back-trace from (n, m) following OP
    script: List[str] = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and OP[i][j] == "update":
            nd1, nd2 = nodes1[i], nodes2[j]
            upd_cost = cost_fn.update(nd1, nd2)
            if upd_cost == 0.0:
                script.append(f"MATCH   {nd1.label!r} (no change)")
            else:
                script.append(
                    f"UPDATE  {nd1.label!r}: {nd1.value!r} -> {nd2.value!r}"
                    f"  (cost={upd_cost:.3f})"
                )
            i -= 1
            j -= 1
        elif i > 0 and (j == 0 or OP[i][j] == "delete"):
            nd1 = nodes1[i]
            script.append(
                f"DELETE  {nd1.label!r} ({nd1.node_type}, {nd1.value!r})"
                f"  (cost={cost_fn.delete(nd1):.2f})"
            )
            i -= 1
        else:
            nd2 = nodes2[j]
            script.append(
                f"INSERT  {nd2.label!r} ({nd2.node_type}, {nd2.value!r})"
                f"  (cost={cost_fn.insert(nd2):.2f})"
            )
            j -= 1

    script.reverse()
    return TD[n][m], script