"""
Chawathe's Tree Edit Distance (TED) Algorithm (1999)

Computes the edit distance between two trees using their LD-pair representations.
Operations: update (upd), delete (del), insert (ins).
"""


def cost_upd(node_a, node_b):
    """Cost of updating node_a to node_b. 0 if labels match, 1 otherwise."""
    if node_a["label"] == node_b["label"] and node_a["value"] == node_b["value"]:
        return 0
    return 1


def cost_del(node):
    """Cost of deleting a node."""
    return 1


def cost_ins(node):
    """Cost of inserting a node."""
    return 1


def tree_to_ld_pairs(tree, depth=0, result=None):
    """
    Convert a tree (nested dict) into an LD-pair representation.

    Each node in the tree should be a dict with:
      - "label": the node label/tag
      - "value": the node value (optional, defaults to "")
      - "children": list of child nodes (optional)

    Returns a list of nodes in left-to-right postorder,
    each annotated with 'l' (leftmost leaf descendant index) and 'd' (depth).
    """
    if result is None:
        result = []

    children = tree.get("children", [])

    if not children:
        # Leaf node
        idx = len(result) + 1  # 1-based index
        node = {
            "label": tree.get("label", ""),
            "value": tree.get("value", ""),
            "l": idx,
            "d": depth,
        }
        result.append(node)
    else:
        for child in children:
            tree_to_ld_pairs(child, depth + 1, result)
        # Internal node gets the leftmost leaf index of its first child
        first_child_l = None
        # Find the l value of the subtree rooted at the first child
        # It's the l of the first descendant added
        idx_before = len(result) - sum(
            1 for _ in _postorder_nodes(children[-1])
        )
        # Simpler: the l of an internal node = l of its leftmost child
        first_child_l = result[len(result) - _subtree_size(tree) + 1]["l"] if len(result) > 0 else 1
        node = {
            "label": tree.get("label", ""),
            "value": tree.get("value", ""),
            "l": first_child_l,
            "d": depth,
        }
        result.append(node)

    return result


def _postorder_nodes(tree):
    """Yield nodes in postorder."""
    for child in tree.get("children", []):
        yield from _postorder_nodes(child)
    yield tree


def _subtree_size(tree):
    """Count total nodes in a subtree."""
    count = 1
    for child in tree.get("children", []):
        count += _subtree_size(child)
    return count


def build_ld_pairs(tree):
    """
    Build LD-pair list from a tree in postorder.
    Returns list of dicts with keys: label, value, l, d (1-indexed).
    """
    result = []

    def _postorder(node, depth):
        children = node.get("children", [])
        leftmost_leaf = None

        for child in children:
            child_l = _postorder(child, depth + 1)
            if leftmost_leaf is None:
                leftmost_leaf = child_l

        idx = len(result) + 1  # 1-based
        if leftmost_leaf is None:
            leftmost_leaf = idx  # leaf: its own index

        result.append({
            "label": node.get("label", ""),
            "value": node.get("value", ""),
            "l": leftmost_leaf,
            "d": depth,
        })
        return leftmost_leaf

    _postorder(tree, 0)
    return result


def chawathe_ted(tree_a, tree_b):
    """
    Compute the Tree Edit Distance between two trees using Chawathe's algorithm.

    Parameters:
        tree_a: dict representing the first tree
        tree_b: dict representing the second tree

    Each tree node is a dict:
        {"label": str, "value": str, "children": [child_nodes...]}

    Returns:
        The edit distance (int or float) between tree_a and tree_b.
    """
    # Build LD-pair representations (1-indexed lists)
    A = build_ld_pairs(tree_a)
    B = build_ld_pairs(tree_b)

    n = len(A)  # |A*|
    m = len(B)  # |B*|

    # Initialize distance matrix Dist[0..n][0..m]
    Dist = [[0] * (m + 1) for _ in range(n + 1)]

    # Base cases
    # Dist[i][0] = Dist[i-1][0] + cost_del(A_i)
    for i in range(1, n + 1):
        Dist[i][0] = Dist[i - 1][0] + cost_del(A[i - 1])

    # Dist[0][j] = Dist[0][j-1] + cost_ins(B_j)
    for j in range(1, m + 1):
        Dist[0][j] = Dist[0][j - 1] + cost_ins(B[j - 1])

    # Fill the matrix
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            candidates = []

            a_node = A[i - 1]  # A_i (1-indexed -> 0-indexed)
            b_node = B[j - 1]  # B_j

            # Condition 1: A[i].d == B[j].d  -> update
            if a_node["d"] == b_node["d"]:
                candidates.append(
                    Dist[i - 1][j - 1] + cost_upd(a_node, b_node)
                )

            # Condition 2: (A[i].d >= B[j].d) or (j == |B|)  -> delete
            if a_node["d"] >= b_node["d"] or j == m:
                candidates.append(
                    Dist[i - 1][j] + cost_del(a_node)
                )

            # Condition 3: (A[i].d <= B[j].d) or (i == |A|)  -> insert
            if a_node["d"] <= b_node["d"] or i == n:
                candidates.append(
                    Dist[i][j - 1] + cost_ins(b_node)
                )

            Dist[i][j] = min(candidates)

    return Dist[n][m]


# --- Example usage ---
if __name__ == "__main__":
    # Example trees
    #     a            a
    #    / \          / \
    #   b   c        b   d
    #  /            / \
    # d            e   f

    tree1 = {
        "label": "a", "value": "",
        "children": [
            {
                "label": "b", "value": "",
                "children": [
                    {"label": "d", "value": ""}
                ]
            },
            {"label": "c", "value": ""}
        ]
    }

    tree2 = {
        "label": "a", "value": "",
        "children": [
            {
                "label": "b", "value": "",
                "children": [
                    {"label": "e", "value": ""},
                    {"label": "f", "value": ""}
                ]
            },
            {"label": "d", "value": ""}
        ]
    }

    distance = chawathe_ted(tree1, tree2)
    print(f"Tree Edit Distance: {distance}")

    # Print LD-pairs for inspection
    print("\nTree A LD-pairs:")
    for i, node in enumerate(build_ld_pairs(tree1), 1):
        print(f"  {i}: label={node['label']}, l={node['l']}, d={node['d']}")

    print("\nTree B LD-pairs:")
    for i, node in enumerate(build_ld_pairs(tree2), 1):
        print(f"  {i}: label={node['label']}, l={node['l']}, d={node['d']}")
