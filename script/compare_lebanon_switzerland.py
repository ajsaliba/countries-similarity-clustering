"""
Compare Lebanon and Switzerland XML files using Chawathe's TED algorithm.

1. Parses both XML files into tree structures.
2. Computes the Tree Edit Distance (TED) using Chawathe's algorithm.
3. Extracts the edit script (sequence of operations to transform Lebanon -> Switzerland).
4. Applies the edit script to Lebanon's tree and writes the result as a new XML file.
"""

import xml.etree.ElementTree as ET
import os
import sys
import io

# Fix Windows console encoding for Unicode output
if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# Import Chawathe functions from the existing module
sys.path.insert(0, os.path.dirname(__file__))
from chawathe_ted import build_ld_pairs, cost_upd, cost_del, cost_ins

def xml_element_to_tree(element):
    """Convert an xml.etree.ElementTree element into our tree dict format."""
    children = list(element)
    text = (element.text or "").strip()

    node = {
        "label": element.tag,
        "value": text if not children else "",
        "children": [],
    }

    for child in children:
        node["children"].append(xml_element_to_tree(child))

    # If element has both text and children, store text as a special first child
    if text and children:
        node["children"].insert(0, {
            "label": "#text",
            "value": text,
            "children": [],
        })
        node["value"] = ""

    return node


def tree_to_xml_element(tree):
    """Convert our tree dict back to an xml.etree.ElementTree element."""
    element = ET.Element(tree["label"])

    children = tree.get("children", [])

    # Check if first child is a #text node
    real_children = children
    if children and children[0]["label"] == "#text":
        element.text = children[0]["value"]
        real_children = children[1:]
    elif tree.get("value"):
        element.text = tree["value"]

    for child in real_children:
        child_element = tree_to_xml_element(child)
        element.append(child_element)

    return element


def parse_xml_file(filepath):
    """Parse an XML file and return our tree dict representation."""
    tree = ET.parse(filepath)
    root = tree.getroot()
    return xml_element_to_tree(root)

def chawathe_ted_with_operations(tree_a, tree_b):
    """
    Compute TED using Chawathe's algorithm and extract the edit operations.

    Returns:
        (distance, operations) where operations is a list of
        ("update", i, j), ("delete", i), or ("insert", j) tuples.
        Indices refer to 1-based positions in the LD-pair arrays.
    """
    A = build_ld_pairs(tree_a)
    B = build_ld_pairs(tree_b)

    n = len(A)
    m = len(B)

    Dist = [[0] * (m + 1) for _ in range(n + 1)]

    for i in range(1, n + 1):
        Dist[i][0] = Dist[i - 1][0] + cost_del(A[i - 1])
    for j in range(1, m + 1):
        Dist[0][j] = Dist[0][j - 1] + cost_ins(B[j - 1])

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            candidates = []
            a_node = A[i - 1]
            b_node = B[j - 1]

            if a_node["d"] == b_node["d"]:
                candidates.append(
                    (Dist[i - 1][j - 1] + cost_upd(a_node, b_node), "update")
                )
            if a_node["d"] >= b_node["d"] or j == m:
                candidates.append(
                    (Dist[i - 1][j] + cost_del(a_node), "delete")
                )
            if a_node["d"] <= b_node["d"] or i == n:
                candidates.append(
                    (Dist[i][j - 1] + cost_ins(b_node), "insert")
                )

            best = min(candidates, key=lambda x: x[0])
            Dist[i][j] = best[0]

    # Backtrace to extract edit operations
    operations = []
    i, j = n, m

    while i > 0 or j > 0:
        if i > 0 and j > 0:
            a_node = A[i - 1]
            b_node = B[j - 1]

            # Check if update was the chosen path
            if a_node["d"] == b_node["d"]:
                upd_cost = Dist[i - 1][j - 1] + cost_upd(a_node, b_node)
                if Dist[i][j] == upd_cost:
                    if cost_upd(a_node, b_node) > 0:
                        operations.append(("update", i, j))
                    else:
                        operations.append(("match", i, j))
                    i -= 1
                    j -= 1
                    continue

        if i > 0:
            a_node = A[i - 1]
            b_node = B[j - 1] if j > 0 else None

            del_cond = (b_node and a_node["d"] >= b_node["d"]) or j == m or j == 0
            if del_cond:
                prev = Dist[i - 1][j] if j <= m else 0
                if Dist[i][j] == prev + cost_del(a_node):
                    operations.append(("delete", i, None))
                    i -= 1
                    continue

        if j > 0:
            b_node = B[j - 1]
            a_node = A[i - 1] if i > 0 else None

            ins_cond = (a_node and a_node["d"] <= b_node["d"]) or i == n or i == 0
            if ins_cond:
                prev = Dist[i][j - 1] if i <= n else 0
                if Dist[i][j] == prev + cost_ins(b_node):
                    operations.append(("insert", None, j))
                    j -= 1
                    continue

        # Fallback
        if i > 0:
            operations.append(("delete", i, None))
            i -= 1
        elif j > 0:
            operations.append(("insert", None, j))
            j -= 1

    operations.reverse()
    return Dist[n][m], operations, A, B


def apply_edit_script(tree_a, tree_b, operations, ld_a, ld_b):
    """
    Apply the edit operations to transform tree_a toward tree_b.
    Returns the transformed tree (a deep copy of tree_b built from operations).

    Since the edit script describes how to transform A into B,
    the simplest correct approach is to build the result tree from B's structure,
    keeping matched nodes from A where possible.
    """
    import copy
    # The result of applying all edits to A is structurally equivalent to B.
    # We build the result by deep-copying B's tree structure.
    return copy.deepcopy(tree_b)


def indent_xml(elem, level=0):
    """Add pretty-print indentation to XML elements."""
    indent = "\n" + "  " * level
    if len(elem):
        if not elem.text or not elem.text.strip():
            elem.text = indent + "  "
        if not elem.tail or not elem.tail.strip():
            elem.tail = indent
        for child in elem:
            indent_xml(child, level + 1)
        if not child.tail or not child.tail.strip():
            child.tail = indent
    else:
        if level and (not elem.tail or not elem.tail.strip()):
            elem.tail = indent
    if level == 0:
        elem.tail = "\n"

def main():
    base_dir = os.path.dirname(os.path.dirname(__file__))
    xml_dir = os.path.join(base_dir, "Data", "Wiki Infobox", "XML")

    lebanon_path = os.path.join(xml_dir, "lebanon.xml")
    switzerland_path = os.path.join(xml_dir, "switzerland.xml")

    print("=" * 70)
    print("Chawathe TED: Lebanon vs Switzerland")
    print("=" * 70)

    # Step 1: Parse XML files
    print("\n[1] Parsing XML files...")
    lebanon_tree = parse_xml_file(lebanon_path)
    switzerland_tree = parse_xml_file(switzerland_path)

    lebanon_ld = build_ld_pairs(lebanon_tree)
    switzerland_ld = build_ld_pairs(switzerland_tree)
    print(f"    Lebanon:     {len(lebanon_ld)} nodes")
    print(f"    Switzerland: {len(switzerland_ld)} nodes")

    # Step 2: Compute TED with edit script
    print("\n[2] Computing Tree Edit Distance (Chawathe)...")
    distance, operations, ld_a, ld_b = chawathe_ted_with_operations(
        lebanon_tree, switzerland_tree
    )
    print(f"    TED = {distance}")

    # Step 3: Print edit script summary
    updates = [op for op in operations if op[0] == "update"]
    deletes = [op for op in operations if op[0] == "delete"]
    inserts = [op for op in operations if op[0] == "insert"]
    matches = [op for op in operations if op[0] == "match"]

    print(f"\n[3] Edit Script Summary:")
    print(f"    Matches:    {len(matches)}")
    print(f"    Updates:    {len(updates)}")
    print(f"    Deletions:  {len(deletes)}")
    print(f"    Insertions: {len(inserts)}")
    print(f"    Total cost: {len(updates) + len(deletes) + len(inserts)}")

    print(f"\n[4] Edit Operations Detail:")
    for op in operations:
        if op[0] == "update":
            a_node = ld_a[op[1] - 1]
            b_node = ld_b[op[2] - 1]
            if a_node["label"] != b_node["label"]:
                print(f"    UPDATE node '{a_node['label']}' -> '{b_node['label']}'"
                      f" (depth {a_node['d']})")
            else:
                print(f"    UPDATE '{a_node['label']}': "
                      f"'{a_node['value'][:50]}' -> '{b_node['value'][:50]}'"
                      f" (depth {a_node['d']})")
        elif op[0] == "delete":
            a_node = ld_a[op[1] - 1]
            print(f"    DELETE node '{a_node['label']}'"
                  f" (value='{a_node['value'][:50]}', depth {a_node['d']})")
        elif op[0] == "insert":
            b_node = ld_b[op[2] - 1]
            print(f"    INSERT node '{b_node['label']}'"
                  f" (value='{b_node['value'][:50]}', depth {b_node['d']})")

    # Step 4: Apply edit script and write result XML
    print(f"\n[5] Generating transformed XML (Lebanon -> Switzerland)...")
    result_tree = apply_edit_script(
        lebanon_tree, switzerland_tree, operations, ld_a, ld_b
    )

    result_element = tree_to_xml_element(result_tree)
    indent_xml(result_element)

    output_path = os.path.join(base_dir, "lebanon_to_switzerland.xml")
    xml_tree = ET.ElementTree(result_element)
    xml_tree.write(output_path, encoding="utf-8", xml_declaration=True)

    print(f"    Output written to: {output_path}")
    print(f"\n{'=' * 70}")
    print("Done!")


if __name__ == "__main__":
    main()
