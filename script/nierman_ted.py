"""
Nierman & Jagadish's Tree Edit Distance (TED) Algorithm (2002)

Computes the edit distance between two XML document trees.
Operations: update root, delete subtree, insert subtree.
"""


def cost_upd(node_a, node_b):
    """Cost of updating node_a's root label/value to node_b's. 0 if equal, 1 otherwise."""
    if node_a["label"] == node_b["label"] and node_a.get("value", "") == node_b.get("value", ""):
        return 0
    return 1


def cost_del_tree(tree):
    """Cost of deleting an entire subtree (counts all nodes)."""
    count = 1
    for child in tree.get("children", []):
        count += cost_del_tree(child)
    return count


def cost_ins_tree(tree):
    """Cost of inserting an entire subtree (counts all nodes)."""
    count = 1
    for child in tree.get("children", []):
        count += cost_ins_tree(child)
    return count


def nierman_ted(A, B, memo=None):
    """
    Compute the Tree Edit Distance between two trees using
    Nierman & Jagadish's algorithm (2002).

    Parameters:
        A: dict representing the first tree
        B: dict representing the second tree
        memo: internal memoization dict (do not pass manually)

    Each tree node is a dict:
        {"label": str, "value": str, "children": [child_nodes...]}

    Returns:
        The edit distance (int or float) between A and B.
    """
    if memo is None:
        memo = {}

    # Use id-based memoization to avoid recomputation
    key = (id(A), id(B))
    if key in memo:
        return memo[key]

    children_a = A.get("children", [])
    children_b = B.get("children", [])

    M = len(children_a)  # Degree(A) - number of first level sub-trees
    N = len(children_b)  # Degree(B) - number of first level sub-trees

    # Initialize distance matrix Dist[0..M][0..N]
    Dist = [[0] * (N + 1) for _ in range(M + 1)]

    # Line 4: Dist[0][0] = Cost_upd(R(A), R(B))
    Dist[0][0] = cost_upd(A, B)

    # Line 5: Dist[i][0] = Dist[i-1][0] + Cost_DelTree(A_i)
    for i in range(1, M + 1):
        Dist[i][0] = Dist[i - 1][0] + cost_del_tree(children_a[i - 1])

    # Line 6: Dist[0][j] = Dist[0][j-1] + Cost_InsTree(B_j)
    for j in range(1, N + 1):
        Dist[0][j] = Dist[0][j - 1] + cost_ins_tree(children_b[j - 1])

    # Lines 7-17: Fill the matrix
    for i in range(1, M + 1):
        for j in range(1, N + 1):
            Dist[i][j] = min(
                # Line 12: Dist[i-1][j-1] + TED(A_i, B_j)
                Dist[i - 1][j - 1] + nierman_ted(children_a[i - 1], children_b[j - 1], memo),
                # Line 13: Dist[i-1][j] + Cost_DelTree(A_i)
                Dist[i - 1][j] + cost_del_tree(children_a[i - 1]),
                # Line 14: Dist[i][j-1] + Cost_InsTree(B_j)
                Dist[i][j - 1] + cost_ins_tree(children_b[j - 1]),
            )

    # Line 18: Return Dist[M][N]
    result = Dist[M][N]
    memo[key] = result
    return result


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

    distance = nierman_ted(tree1, tree2)
    print(f"Tree Edit Distance (Nierman & Jagadish): {distance}")

    # Show tree structure
    def print_tree(tree, indent=0):
        label = tree["label"]
        value = tree.get("value", "")
        display = f"{label}={value}" if value else label
        print("  " * indent + display)
        for child in tree.get("children", []):
            print_tree(child, indent + 1)

    print("\nTree A:")
    print_tree(tree1)
    print("\nTree B:")
    print_tree(tree2)
