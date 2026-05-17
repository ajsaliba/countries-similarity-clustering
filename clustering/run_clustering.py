"""
clustering/run_clustering.py
============================
CLI driver for the country similarity clustering pipeline.

Pipeline
--------
1. Load clean country dataset.
2. Build TED trees for all countries.
3. Compute the full pairwise distance & similarity matrix.
4. Run all four clustering algorithms.
5. Evaluate each result (silhouette, Davies-Bouldin).
6. Run the k-sweep to identify the optimal number of clusters.
7. Save plots (dendrogram, MDS scatter, heatmap, sweep chart).
8. Print a formatted per-cluster summary table to stdout.

Usage
-----
    python3 -B -m clustering.run_clustering

    # Specify number of clusters explicitly
    python3 -B -m clustering.run_clustering --k 10

    # Skip matrix recomputation by loading a cached matrix
    python3 -B -m clustering.run_clustering --load-matrix outputs/matrix.npz

    # Save the computed matrix for reuse
    python3 -B -m clustering.run_clustering --save-matrix outputs/matrix.npz

    # Custom output directory
    python3 -B -m clustering.run_clustering --output-dir results/

    # Run only one algorithm
    python3 -B -m clustering.run_clustering --method agglomerative --k 12

    # DBSCAN-specific: set eps
    python3 -B -m clustering.run_clustering --method dbscan --eps 0.28

    # Suppress plot generation (useful in headless environments)
    python3 -B -m clustering.run_clustering --no-plots
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import textwrap
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

# ── project root on path ──────────────────────────────────────────────────────
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from ted import build_country_tree, compute_matrix, CostFunction
from ted.similarity import top_similar

from clustering.cluster import (
    ClusterResult,
    agglomerative,
    dbscan,
    spectral,
    kmedoids,
)
from clustering.evaluate import (
    silhouette,
    davies_bouldin,
    sweep_k,
    compute_linkage,
    cluster_summary,
)
from clustering.visualise import (
    plot_dendrogram,
    plot_mds_scatter,
    plot_similarity_heatmap,
    plot_silhouette_sweep,
    plot_dbscan_eps_sweep,
)

# ── default paths ─────────────────────────────────────────────────────────────
_DATA_PATH    = _PROJECT_ROOT / "data" / "clean" / "all_countries_clean.json"
_DEFAULT_OUT  = _PROJECT_ROOT / "outputs" / "clustering"


# ══════════════════════════════════════════════════════════════════════════════
# Data loading helpers
# ══════════════════════════════════════════════════════════════════════════════

def load_countries(data_path: Path = _DATA_PATH) -> Dict[str, dict]:
    """Load the clean JSON dataset and return {country_name: doc}."""
    print(f"[data]  Loading {data_path} …")
    with open(data_path, encoding="utf-8") as f:
        raw = json.load(f)
    countries = {doc["country"]: doc for doc in raw["countries"]}
    print(f"[data]  {len(countries)} countries loaded.")
    return countries


def build_trees(countries: Dict[str, dict]) -> Dict[str, object]:
    """Build a TED Node tree for every country."""
    print("[trees] Building TED trees …")
    trees = {name: build_country_tree(doc) for name, doc in countries.items()}
    print(f"[trees] {len(trees)} trees built.")
    return trees


# ══════════════════════════════════════════════════════════════════════════════
# Matrix computation / caching
# ══════════════════════════════════════════════════════════════════════════════

def build_matrix(
    trees: Dict[str, object],
    save_path: Optional[Path] = None,
) -> Tuple[np.ndarray, np.ndarray, List[str]]:
    """
    Compute the full pairwise distance and similarity matrices.

    Returns
    -------
    (dist_array, sim_array, names)
        dist_array : np.ndarray, shape (n, n)
        sim_array  : np.ndarray, shape (n, n)
        names      : list[str], parallel to rows/columns
    """
    print(f"[matrix] Computing {len(trees)}×{len(trees)} pairwise matrix …")
    t0 = time.time()
    dist_mat, sim_mat = compute_matrix(trees, progress=True)
    elapsed = time.time() - t0
    print(f"[matrix] Done in {elapsed:.1f}s.")

    names: List[str] = sorted(dist_mat.keys())
    dist_array = np.array([[dist_mat[a][b] for b in names] for a in names])
    sim_array  = np.array([[sim_mat[a][b]  for b in names] for a in names])

    if save_path is not None:
        save_path = Path(save_path)
        save_path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            save_path,
            dist_array=dist_array,
            sim_array=sim_array,
            names=np.array(names),
        )
        print(f"[matrix] Saved to {save_path}")

    return dist_array, sim_array, names


def load_matrix(path: Path) -> Tuple[np.ndarray, np.ndarray, List[str]]:
    """Load a previously saved matrix from a .npz file."""
    print(f"[matrix] Loading cached matrix from {path} …")
    data = np.load(path, allow_pickle=False)
    dist_array = data["dist_array"]
    sim_array  = data["sim_array"]
    names      = list(data["names"])
    print(f"[matrix] Loaded {len(names)}×{len(names)} matrix.")
    return dist_array, sim_array, names


# ══════════════════════════════════════════════════════════════════════════════
# Printing helpers
# ══════════════════════════════════════════════════════════════════════════════

def _separator(char: str = "─", width: int = 80) -> str:
    return char * width


def _print_result_header(result: ClusterResult, sil: float, db: float) -> None:
    method_label = {
        "agglomerative": "Agglomerative (avg linkage)",
        "dbscan":        "DBSCAN",
        "spectral":      "Spectral",
        "kmedoids":      "k-Medoids (PAM)",
    }.get(result.method, result.method)

    print()
    print(_separator("═"))
    print(f"  {method_label}")
    print(_separator())
    print(f"  Clusters found : {result.n_clusters_found}")
    if result.method == "dbscan":
        print(f"  Noise points   : {result.params.get('n_noise', '?')}")
    if result.method == "kmedoids":
        print(f"  Total cost     : {result.params.get('total_cost', '?')}")
    print(f"  Silhouette     : {sil:+.4f}  (higher = better, max 1.0)")
    print(f"  Davies-Bouldin : {db:.4f}   (lower  = better, min 0.0)")
    print(f"  Params         : {result.params}")
    print(_separator())


def _print_cluster_table(result: ClusterResult, dist_array: np.ndarray) -> None:
    """Print a formatted per-cluster membership table."""
    summary = cluster_summary(result, dist_array)

    # Convert to list-of-dicts regardless of pandas availability
    try:
        import pandas as pd
        if isinstance(summary, pd.DataFrame):
            rows = summary.reset_index().to_dict(orient="records")
        else:
            rows = summary
    except ImportError:
        rows = summary

    for row in rows:
        cid     = row["cluster_id"]
        size    = row["size"]
        coh     = row["cohesion"]
        diam    = row["max_diameter"]
        medoid  = row["medoid"]
        members = row["members"]

        tag = "NOISE" if cid == -1 else f"Cluster {cid:2d}"
        print(f"\n  [{tag}]  size={size}  cohesion={coh:.4f}  "
              f"diameter={diam:.4f}  medoid='{medoid}'")

        # Wrap member list to 76 characters
        member_str = ", ".join(members)
        wrapped = textwrap.fill(member_str, width=76, initial_indent="    ",
                                subsequent_indent="    ")
        print(wrapped)


# ══════════════════════════════════════════════════════════════════════════════
# Plot saving helper
# ══════════════════════════════════════════════════════════════════════════════

def _save_fig(fig, path: Path, dpi: int = 180) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=dpi, bbox_inches="tight")
    print(f"[plot]  Saved → {path}")
    import matplotlib.pyplot as plt
    plt.close(fig)


# ══════════════════════════════════════════════════════════════════════════════
# Main pipeline
# ══════════════════════════════════════════════════════════════════════════════

def run(
    k: int = 10,
    method: Optional[str] = None,
    eps: float = 0.30,
    min_samples: int = 3,
    output_dir: Path = _DEFAULT_OUT,
    data_path: Path = _DATA_PATH,
    load_matrix_path: Optional[Path] = None,
    save_matrix_path: Optional[Path] = None,
    no_plots: bool = False,
    k_sweep_range: Tuple[int, int] = (5, 20),
) -> None:
    """
    Full clustering pipeline.

    Parameters
    ----------
    k            : Target number of clusters for agglomerative, spectral,
                   k-medoids.
    method       : If set, run only this algorithm.  One of:
                   "agglomerative", "dbscan", "spectral", "kmedoids".
                   If None, all four are run.
    eps          : DBSCAN neighbourhood radius (distance units).
    min_samples  : DBSCAN minimum neighbourhood size.
    output_dir   : Directory for plots and saved outputs.
    data_path    : Path to all_countries_clean.json.
    load_matrix_path : If provided, load a cached .npz matrix instead of
                       computing it.
    save_matrix_path : If provided, save the computed matrix here.
    no_plots     : If True, skip all matplotlib operations.
    k_sweep_range : (k_min, k_max) inclusive for the silhouette sweep.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # ── 1. Data ───────────────────────────────────────────────────────────────
    if load_matrix_path is not None:
        dist_array, sim_array, names = load_matrix(Path(load_matrix_path))
    else:
        countries  = load_countries(data_path)
        trees      = build_trees(countries)
        dist_array, sim_array, names = build_matrix(trees, save_path=save_matrix_path)

    n = len(names)
    print(f"\n[info]  Dataset: {n} countries, k={k}, eps={eps}")

    # ── 2. k-sweep (always run to find optimal k) ─────────────────────────────
    print(f"\n[sweep] Silhouette sweep k ∈ [{k_sweep_range[0]}, {k_sweep_range[1]}] …")
    ks = list(range(k_sweep_range[0], k_sweep_range[1] + 1))
    sweep_df = sweep_k(dist_array, names, ks=ks)

    # Determine best k from silhouette
    try:
        import pandas as pd
        if isinstance(sweep_df, pd.DataFrame):
            best_k = int(sweep_df["silhouette"].idxmax())
            best_sil = float(sweep_df.loc[best_k, "silhouette"])
        else:
            raise TypeError
    except (ImportError, TypeError):
        best_k  = max(sweep_df, key=lambda r: r["silhouette"])["k"]
        best_sil = max(r["silhouette"] for r in sweep_df)

    print(f"[sweep] Best k = {best_k}  (silhouette = {best_sil:.4f})")
    print(f"[info]  Using k = {k} as requested (best_k from sweep = {best_k})")

    if not no_plots:
        fig_sweep = plot_silhouette_sweep(sweep_df)
        _save_fig(fig_sweep, output_dir / "silhouette_sweep.png")

    # ── 3. Clustering algorithms ──────────────────────────────────────────────
    all_methods = ["agglomerative", "dbscan", "spectral", "kmedoids"]
    methods_to_run = [method] if method else all_methods

    results: Dict[str, ClusterResult] = {}

    for m in methods_to_run:
        print(f"\n[cluster] Running {m} …")

        if m == "agglomerative":
            result = agglomerative(dist_array, names, n_clusters=k, linkage="average")
        elif m == "dbscan":
            result = dbscan(dist_array, names, eps=eps, min_samples=min_samples)
        elif m == "spectral":
            result = spectral(sim_array, names, n_clusters=k)
        elif m == "kmedoids":
            result = kmedoids(dist_array, names, n_clusters=k, n_init=10)
        else:
            print(f"[warn]  Unknown method '{m}', skipping.")
            continue

        results[m] = result

    # ── 4. Evaluate & print ───────────────────────────────────────────────────
    print()
    print("=" * 80)
    print("  CLUSTERING RESULTS SUMMARY")
    print("=" * 80)

    for m, result in results.items():
        sil = silhouette(dist_array, result.labels)
        db  = davies_bouldin(dist_array, result.labels)
        _print_result_header(result, sil, db)
        _print_cluster_table(result, dist_array)

    # ── 5. Plots ──────────────────────────────────────────────────────────────
    if no_plots:
        print("\n[plots] Skipped (--no-plots).")
        return

    # Use the agglomerative result as the primary for shared plots
    # (falls back to first available if agglomerative wasn't run)
    primary_key = "agglomerative" if "agglomerative" in results else list(results.keys())[0]
    primary     = results[primary_key]
    primary_labels = primary.labels

    # ── 5a. Dendrogram (agglomerative only) ──────────────────────────────────
    if "agglomerative" in results:
        print("\n[plot]  Building dendrogram …")
        Z, ordered = compute_linkage(dist_array, names, method="average")
        fig_dg = plot_dendrogram(Z, ordered, title=f"Country Similarity Dendrogram (k={k})")
        _save_fig(fig_dg, output_dir / "dendrogram.png")

    # ── 5b. MDS scatter (primary result) ─────────────────────────────────────
    print("[plot]  Building MDS scatter …")
    fig_mds, coords = plot_mds_scatter(
        dist_array, names, primary_labels,
        title=f"Country Similarity — MDS Scatter ({primary_key}, k={k})",
    )
    _save_fig(fig_mds, output_dir / "mds_scatter.png")

    # ── 5c. Similarity heatmap ────────────────────────────────────────────────
    print("[plot]  Building similarity heatmap …")
    fig_heat = plot_similarity_heatmap(
        sim_array, names, primary_labels,
        title=f"Pairwise Similarity Heatmap — Sorted by Cluster ({primary_key})",
    )
    _save_fig(fig_heat, output_dir / "similarity_heatmap.png")

    # ── 5d. DBSCAN eps sweep (if dbscan was run) ──────────────────────────────
    if "dbscan" in results:
        print("[plot]  Building DBSCAN eps sweep …")
        fig_eps = plot_dbscan_eps_sweep(dist_array, names, min_samples=min_samples)
        _save_fig(fig_eps, output_dir / "dbscan_eps_sweep.png")

    # ── 5e. Per-method MDS scatter ────────────────────────────────────────────
    for m, result in results.items():
        if m == primary_key:
            continue   # already plotted
        fig_m, _ = plot_mds_scatter(
            dist_array, names, result.labels,
            title=f"Country Similarity — MDS Scatter ({m}, k={result.n_clusters_found})",
        )
        _save_fig(fig_m, output_dir / f"mds_scatter_{m}.png")

    print(f"\n[done]  All outputs saved to: {output_dir.resolve()}")


# ══════════════════════════════════════════════════════════════════════════════
# CLI entry point
# ══════════════════════════════════════════════════════════════════════════════

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Country Similarity Clustering Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            Examples
            --------
            # Run all methods with k=10 (default)
            python3 -B -m clustering.run_clustering

            # Agglomerative only, 12 clusters
            python3 -B -m clustering.run_clustering --method agglomerative --k 12

            # DBSCAN with custom eps
            python3 -B -m clustering.run_clustering --method dbscan --eps 0.28

            # Load cached matrix, skip recomputation
            python3 -B -m clustering.run_clustering --load-matrix outputs/matrix.npz
        """),
    )
    parser.add_argument(
        "--k", type=int, default=10,
        help="Number of clusters for agglomerative / spectral / k-medoids (default: 10).",
    )
    parser.add_argument(
        "--method", type=str, default=None,
        choices=["agglomerative", "dbscan", "spectral", "kmedoids"],
        help="Run only this algorithm.  Omit to run all four.",
    )
    parser.add_argument(
        "--eps", type=float, default=0.30,
        help="DBSCAN neighbourhood radius in distance units (default: 0.30).",
    )
    parser.add_argument(
        "--min-samples", type=int, default=3,
        help="DBSCAN minimum neighbourhood size (default: 3).",
    )
    parser.add_argument(
        "--output-dir", type=Path, default=_DEFAULT_OUT,
        help=f"Directory for plots and outputs (default: {_DEFAULT_OUT}).",
    )
    parser.add_argument(
        "--data", type=Path, default=_DATA_PATH,
        help=f"Path to all_countries_clean.json (default: {_DATA_PATH}).",
    )
    parser.add_argument(
        "--load-matrix", type=Path, default=None,
        metavar="PATH",
        help="Load a precomputed matrix from a .npz file instead of recomputing.",
    )
    parser.add_argument(
        "--save-matrix", type=Path, default=None,
        metavar="PATH",
        help="Save the computed matrix to a .npz file for later reuse.",
    )
    parser.add_argument(
        "--no-plots", action="store_true",
        help="Skip all plot generation (useful in headless / CI environments).",
    )
    parser.add_argument(
        "--k-min", type=int, default=5,
        help="Minimum k for the silhouette sweep (default: 5).",
    )
    parser.add_argument(
        "--k-max", type=int, default=20,
        help="Maximum k for the silhouette sweep (default: 20).",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    run(
        k=args.k,
        method=args.method,
        eps=args.eps,
        min_samples=args.min_samples,
        output_dir=args.output_dir,
        data_path=args.data,
        load_matrix_path=args.load_matrix,
        save_matrix_path=args.save_matrix,
        no_plots=args.no_plots,
        k_sweep_range=(args.k_min, args.k_max),
    )


if __name__ == "__main__":
    main()
