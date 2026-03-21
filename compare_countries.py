"""
compare_countries.py – Main runner for country infobox TED comparison.

Usage examples
--------------
# Compare two specific countries and print an edit script:
    python compare_countries.py --compare afghanistan australia

# Compute and save the full 195×195 similarity matrix:
    python compare_countries.py --matrix --output results/

# Show the 10 most similar countries for a given country:
    python compare_countries.py --top afghanistan --n 10
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Tuple

# ── Ensure the project root is on sys.path when running this file directly ──
sys.path.insert(0, str(Path(__file__).parent))

from ted import (
    CostFunction,
    Node,
    build_country_tree,
    compute_matrix,
    ted_similarity,
    zhang_shasha,
)
from ted.zhang_shasha import zhang_shasha_with_script
from ted.similarity import top_similar
from ted.tree_builder import tree_summary

# ────────────────────────────────────────────────────────────────────────────
# Data loading
# ────────────────────────────────────────────────────────────────────────────

DATA_DIR = Path(__file__).parent / "Data" / "Wiki Infobox" / "JSON"


def load_all_countries(data_dir: Path = DATA_DIR) -> Dict[str, dict]:
    """
    Load every per-country JSON file.

    Skips 'all_countries.json' (aggregate file).

    Returns:
        { country_name: raw_json_dict }
    """
    countries: Dict[str, dict] = {}
    for path in sorted(data_dir.glob("*.json")):
        if path.stem == "all_countries":
            continue
        with path.open(encoding="utf-8") as fh:
            doc = json.load(fh)
        countries[path.stem] = doc
    return countries


def build_all_trees(raw: Dict[str, dict]) -> Dict[str, Node]:
    """Convert raw JSON dicts → country trees."""
    return {name: build_country_tree(doc) for name, doc in raw.items()}


# ────────────────────────────────────────────────────────────────────────────
# Output helpers
# ────────────────────────────────────────────────────────────────────────────

def _country_display_name(filename_stem: str, raw: Dict[str, dict]) -> str:
    """Return the 'country' field from the JSON, falling back to the stem."""
    doc = raw.get(filename_stem, {})
    return doc.get("country", filename_stem)


def print_comparison(
    name1: str,
    name2: str,
    trees: Dict[str, Node],
    raw: Dict[str, dict],
    show_script: bool = True,
    cost_fn: CostFunction | None = None,
) -> None:
    """Print a detailed comparison between two countries."""
    if cost_fn is None:
        cost_fn = CostFunction()

    disp1 = _country_display_name(name1, raw)
    disp2 = _country_display_name(name2, raw)

    t1 = trees[name1]
    t2 = trees[name2]

    if show_script:
        dist, script = zhang_shasha_with_script(t1, t2, cost_fn)
    else:
        dist = zhang_shasha(t1, t2, cost_fn)
        script = []

    import math
    from ted.similarity import max_ted_cost
    from ted.tree_builder import tree_size
    avg_size = (tree_size(t1) + tree_size(t2)) / 2.0
    sim_exp_size = math.exp(-dist / avg_size) if avg_size > 0 else 1.0
    upper        = max_ted_cost(t1, t2, cost_fn)
    sim_norm     = max(0.0, 1.0 - dist / upper) if upper > 0 else 1.0

    bar = "-" * 60
    print(f"\n{bar}")
    print(f"  {disp1}  vs  {disp2}")
    print(bar)
    print(f"  TED distance           : {dist:.4f}")
    print(f"  Avg tree size          : {avg_size:.0f} nodes")
    print(f"  Similarity (exp_size)  : {sim_exp_size:.4f}  <-- recommended")
    print(f"  Similarity (norm)      : {sim_norm:.4f}")
    print(f"  Similarity (exp)       : {math.exp(-dist):.4f}")

    if script:
        print(f"\n  Edit script ({len(script)} operations):")
        for op in script:
            print(f"    {op}")
    print()


def save_matrix_csv(
    matrix: Dict[str, Dict[str, float]],
    path: Path,
    label: str = "distance",
) -> None:
    """Write a country×country matrix to a CSV file."""
    names = sorted(matrix.keys())
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow([""] + names)
        for row_name in names:
            row = [f"{matrix[row_name].get(col, ''):.6f}" for col in names]
            writer.writerow([row_name] + row)
    print(f"  Saved {label} matrix → {path}")


def print_top_similar(
    country: str,
    sim_mat: Dict[str, Dict[str, float]],
    raw: Dict[str, dict],
    n: int = 10,
) -> None:
    """Print the top-N most similar countries."""
    disp = _country_display_name(country, raw)
    ranked = top_similar(country, sim_mat, n=n)
    print(f"\nTop {n} countries most similar to {disp}:")
    print(f"  {'Rank':<5} {'Country':<30} {'Similarity':>10}")
    print(f"  {'-'*5} {'-'*30} {'-'*10}")
    for rank, (name, sim) in enumerate(ranked, 1):
        disp_other = _country_display_name(name, raw)
        print(f"  {rank:<5} {disp_other:<30} {sim:>10.4f}")
    print()


# ────────────────────────────────────────────────────────────────────────────
# CLI
# ────────────────────────────────────────────────────────────────────────────

def parse_args(argv: List[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Country infobox similarity via Tree Edit Distance",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=DATA_DIR,
        help="Directory containing per-country JSON files (default: %(default)s)",
    )
    parser.add_argument(
        "--compare",
        nargs=2,
        metavar=("COUNTRY1", "COUNTRY2"),
        help="Compare two countries and print distance + edit script",
    )
    parser.add_argument(
        "--no-script",
        action="store_true",
        help="Skip printing the edit script when using --compare",
    )
    parser.add_argument(
        "--top",
        metavar="COUNTRY",
        help="Print the N most similar countries for COUNTRY",
    )
    parser.add_argument(
        "--n",
        type=int,
        default=10,
        metavar="N",
        help="Number of results for --top (default: 10)",
    )
    parser.add_argument(
        "--matrix",
        action="store_true",
        help="Compute the full pairwise similarity matrix for all countries",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("results"),
        metavar="DIR",
        help="Output directory for --matrix CSVs (default: %(default)s)",
    )
    parser.add_argument(
        "--method",
        choices=["exp_size", "norm", "exp", "inv"],
        default="exp_size",
        help="Similarity method: 'exp_size' = exp(-TED/avg_nodes) [default], "
             "'norm' = 1-TED/max_cost, 'exp' = e^-TED, 'inv' = 1/(1+TED)",
    )
    parser.add_argument(
        "--tree",
        metavar="COUNTRY",
        help="Print the tree structure for a country and exit",
    )
    return parser.parse_args(argv)


def main(argv: List[str] | None = None) -> None:
    args = parse_args(argv)

    print("Loading country data…", flush=True)
    raw = load_all_countries(args.data_dir)
    trees = build_all_trees(raw)
    print(f"  Loaded {len(trees)} countries.", flush=True)

    cost_fn = CostFunction()

    # ── Print tree structure ────────────────────────────────────────────
    if args.tree:
        key = args.tree.lower().replace(" ", "_")
        if key not in trees:
            print(f"Error: country {args.tree!r} not found.", file=sys.stderr)
            sys.exit(1)
        print(f"\nTree for {_country_display_name(key, raw)}:\n")
        print(tree_summary(trees[key]))
        return

    # ── Pairwise comparison ─────────────────────────────────────────────
    if args.compare:
        c1, c2 = [c.lower().replace(" ", "_") for c in args.compare]
        for c in (c1, c2):
            if c not in trees:
                print(f"Error: country {c!r} not found.", file=sys.stderr)
                sys.exit(1)
        print_comparison(
            c1, c2, trees, raw,
            show_script=not args.no_script,
            cost_fn=cost_fn,
        )

    # ── Full matrix computation ─────────────────────────────────────────
    if args.matrix:
        print(f"\nComputing {len(trees)}×{len(trees)} distance matrix…", flush=True)
        t0 = time.perf_counter()
        dist_mat, sim_mat = compute_matrix(
            trees, cost_fn=cost_fn, method=args.method, progress=True
        )
        elapsed = time.perf_counter() - t0
        print(f"  Done in {elapsed:.1f}s")

        args.output.mkdir(parents=True, exist_ok=True)
        save_matrix_csv(dist_mat, args.output / "distance_matrix.csv", "distance")
        save_matrix_csv(sim_mat,  args.output / "similarity_matrix.csv", "similarity")

        # Also write a ranked pairs file (top 20 per country)
        ranked_path = args.output / "top_similar.txt"
        with ranked_path.open("w", encoding="utf-8") as fh:
            for country in sorted(sim_mat.keys()):
                disp = _country_display_name(country, raw)
                fh.write(f"\n{disp}\n")
                for other, sim in top_similar(country, sim_mat, n=20):
                    fh.write(f"  {_country_display_name(other, raw):<35} {sim:.4f}\n")
        print(f"  Saved ranked pairs  → {ranked_path}")

        # Print global top-20 most similar pairs
        all_pairs: List[Tuple[str, str, float]] = []
        names = sorted(sim_mat.keys())
        for i, n1 in enumerate(names):
            for n2 in names[i + 1:]:
                all_pairs.append((n1, n2, sim_mat[n1][n2]))
        all_pairs.sort(key=lambda x: x[2], reverse=True)

        print("\nGlobal top-20 most similar country pairs:")
        print(f"  {'Country 1':<30} {'Country 2':<30} {'Similarity':>10}")
        print(f"  {'-'*30} {'-'*30} {'-'*10}")
        for n1, n2, sim in all_pairs[:20]:
            print(
                f"  {_country_display_name(n1, raw):<30}"
                f" {_country_display_name(n2, raw):<30}"
                f" {sim:>10.4f}"
            )

        # Store matrix in args for --top below
        args._sim_mat = sim_mat
    else:
        args._sim_mat = None

    # ── Top-N similar ───────────────────────────────────────────────────
    if args.top:
        key = args.top.lower().replace(" ", "_")
        if key not in trees:
            print(f"Error: country {args.top!r} not found.", file=sys.stderr)
            sys.exit(1)

        sim_mat = args._sim_mat
        if sim_mat is None:
            # Need to compute similarities against this one country only
            print(f"\nComputing similarities for {args.top}…", flush=True)
            t_query = trees[key]
            rows: Dict[str, Dict[str, float]] = {key: {}}
            for other_key, t_other in trees.items():
                _, sim = ted_similarity(t_query, t_other, cost_fn, args.method)
                rows[key][other_key] = sim
            sim_mat = rows

        print_top_similar(key, sim_mat, raw, n=args.n)

    if not any([args.compare, args.matrix, args.top, args.tree]):
        print("\nNo action specified. Use --help for usage information.")


if __name__ == "__main__":
    main()