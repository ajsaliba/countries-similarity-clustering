"""
clustering/visualise.py
=======================
Publication-quality visualisations for country clustering results.

All plots are built with matplotlib + scipy.  No seaborn dependency.

Public API
----------
plot_dendrogram(Z, names, ...)
    Hierarchical dendrogram with country labels.  Colour threshold
    automatically set at the largest merge gap.

plot_mds_scatter(dist_array, names, labels, ...)
    Multidimensional Scaling (MDS) 2-D scatter coloured by cluster.
    Returns the 2-D coordinates so they can be reused (e.g. for
    Calinski-Harabasz evaluation).

plot_similarity_heatmap(sim_array, names, labels, ...)
    Similarity matrix heatmap with rows/columns sorted by cluster label,
    exposing the block-diagonal structure of well-formed clusters.

plot_silhouette_sweep(sweep_df, ...)
    Line chart of silhouette / Davies-Bouldin vs k.

All functions return the ``matplotlib.figure.Figure`` object so callers
can save, embed, or display it as needed.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import matplotlib
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.figure import Figure
from scipy.cluster.hierarchy import dendrogram


# ── colour palette (10-class qualitative, colourblind-friendly) ───────────────
# Based on Tableau-10 / Paul Tol's bright palette
_PALETTE = [
    "#4C78A8",  # steel blue
    "#F58518",  # orange
    "#54A24B",  # green
    "#E45756",  # red
    "#72B7B2",  # teal
    "#EECA3B",  # yellow
    "#B279A2",  # purple
    "#FF9DA6",  # pink
    "#9D755D",  # brown
    "#BAB0AC",  # grey
    "#86BCB6",  # light teal
    "#D67195",  # rose
    "#A2A475",  # olive
    "#6F8EAD",  # slate
    "#D4A6C8",  # lavender
    "#F2E4CA",  # cream
]
_NOISE_COLOUR = "#CCCCCC"   # light grey for DBSCAN noise points


def _label_colour(label: int) -> str:
    """Map an integer cluster label to a hex colour string."""
    if label == -1:
        return _NOISE_COLOUR
    return _PALETTE[label % len(_PALETTE)]


def _cluster_colours(labels: Sequence[int]) -> List[str]:
    return [_label_colour(lbl) for lbl in labels]


def _legend_handles(
    labels: Sequence[int],
    cluster_names: Optional[Dict[int, str]] = None,
) -> List[mpatches.Patch]:
    """Build legend patches, one per unique cluster label."""
    seen = {}
    for lbl in labels:
        if lbl in seen:
            continue
        if lbl == -1:
            display = "Noise / Outlier"
        else:
            display = (cluster_names or {}).get(lbl, f"Cluster {lbl}")
        seen[lbl] = mpatches.Patch(color=_label_colour(lbl), label=display)
    return [seen[k] for k in sorted(seen)]


# ══════════════════════════════════════════════════════════════════════════════
# 1. Dendrogram
# ══════════════════════════════════════════════════════════════════════════════

def plot_dendrogram(
    Z: np.ndarray,
    names: List[str],
    *,
    title: str = "Country Similarity — Hierarchical Dendrogram",
    color_threshold: Optional[float] = None,
    figsize: Tuple[float, float] = (18, 10),
    label_fontsize: int = 6,
    truncate_mode: Optional[str] = None,
    p: int = 30,
) -> Figure:
    """
    Draw a dendrogram from a scipy linkage matrix.

    The colour threshold is automatically set at the midpoint of the largest
    merge-distance gap in the linkage matrix if not supplied.  This visually
    highlights the natural number of clusters.

    Parameters
    ----------
    Z : np.ndarray, shape (n-1, 4)
        Linkage matrix from ``evaluate.compute_linkage``.
    names : list[str]
        Country names in the leaf order returned by ``compute_linkage``.
    title : str
        Figure title.
    color_threshold : float or None
        Height at which the dendrogram is coloured.  If None, the gap
        heuristic is used.
    figsize : (width, height) in inches.
    label_fontsize : int
        Font size for leaf labels.  Use 5–7 for ~195 countries.
    truncate_mode : str or None
        Pass "lastp" to show only the last ``p`` merges (collapsed view).
    p : int
        Used when truncate_mode="lastp".

    Returns
    -------
    matplotlib.figure.Figure
    """
    # ── auto colour threshold: largest gap in merge distances ─────────────────
    if color_threshold is None:
        merge_heights = Z[:, 2]
        gaps = np.diff(np.sort(merge_heights))
        if len(gaps) > 0:
            split_point = np.argmax(gaps)
            color_threshold = float(
                (np.sort(merge_heights)[split_point] +
                 np.sort(merge_heights)[split_point + 1]) / 2
            )
        else:
            color_threshold = float(merge_heights.max() * 0.7)

    fig, ax = plt.subplots(figsize=figsize)

    dendrogram(
        Z,
        labels=names,
        ax=ax,
        leaf_rotation=90,
        leaf_font_size=label_fontsize,
        color_threshold=color_threshold,
        above_threshold_color="#AAAAAA",
        truncate_mode=truncate_mode,
        p=p,
    )

    ax.set_title(title, fontsize=13, fontweight="bold", pad=14)
    ax.set_xlabel("Country", fontsize=9)
    ax.set_ylabel("TED Distance", fontsize=9)
    ax.axhline(
        y=color_threshold,
        linestyle="--",
        linewidth=0.8,
        color="#888888",
        label=f"Cut threshold = {color_threshold:.3f}",
    )
    ax.legend(fontsize=8, loc="upper left")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    fig.tight_layout()
    return fig


# ══════════════════════════════════════════════════════════════════════════════
# 2. MDS scatter plot
# ══════════════════════════════════════════════════════════════════════════════

def plot_mds_scatter(
    dist_array: np.ndarray,
    names: List[str],
    labels: Sequence[int],
    *,
    title: str = "Country Similarity — MDS 2-D Projection",
    annotate: bool = True,
    annotation_fontsize: int = 5,
    figsize: Tuple[float, float] = (14, 10),
    random_state: int = 42,
    cluster_names: Optional[Dict[int, str]] = None,
) -> Tuple[Figure, np.ndarray]:
    """
    Project countries into 2-D with MDS and colour them by cluster.

    MDS preserves pairwise distances as faithfully as possible in 2-D.
    Clusters that are well-separated in the full distance space will
    appear as distinct blobs.

    Parameters
    ----------
    dist_array : np.ndarray, shape (n, n)
        Precomputed distance matrix.
    names : list[str]
        Country names parallel to rows/columns.
    labels : sequence of int
        Cluster labels (−1 = DBSCAN noise).
    title : str
    annotate : bool
        If True, draw country name labels next to each point.
    annotation_fontsize : int
        Font size for country name labels.
    figsize : (width, height) in inches.
    random_state : int
        MDS initialisation seed.
    cluster_names : dict or None
        Optional {cluster_id: human_readable_name} for the legend.

    Returns
    -------
    (fig, coords)
        fig    : matplotlib Figure
        coords : np.ndarray, shape (n, 2)  — the MDS 2-D coordinates.
                 Reuse these for Calinski-Harabasz evaluation.
    """
    from sklearn.manifold import MDS

    mds = MDS(
        n_components=2,
        dissimilarity="precomputed",
        random_state=random_state,
        normalized_stress="auto",
        n_init=4,
        max_iter=500,
    )
    coords: np.ndarray = mds.fit_transform(dist_array)

    colours = _cluster_colours(labels)

    fig, ax = plt.subplots(figsize=figsize)

    # ── scatter ───────────────────────────────────────────────────────────────
    ax.scatter(
        coords[:, 0], coords[:, 1],
        c=colours,
        s=40,
        linewidths=0.4,
        edgecolors="white",
        zorder=3,
    )

    # ── country labels ────────────────────────────────────────────────────────
    if annotate:
        for i, name in enumerate(names):
            ax.annotate(
                name,
                xy=(coords[i, 0], coords[i, 1]),
                xytext=(3, 3),
                textcoords="offset points",
                fontsize=annotation_fontsize,
                color="#444444",
                zorder=4,
            )

    # ── legend ────────────────────────────────────────────────────────────────
    handles = _legend_handles(labels, cluster_names)
    ax.legend(
        handles=handles,
        fontsize=7,
        loc="best",
        framealpha=0.85,
        ncol=2 if len(handles) > 8 else 1,
    )

    ax.set_title(title, fontsize=13, fontweight="bold", pad=12)
    ax.set_xlabel("MDS Dimension 1", fontsize=9)
    ax.set_ylabel("MDS Dimension 2", fontsize=9)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(True, linewidth=0.3, alpha=0.5, zorder=0)

    fig.tight_layout()
    return fig, coords


# ══════════════════════════════════════════════════════════════════════════════
# 3. Similarity heatmap
# ══════════════════════════════════════════════════════════════════════════════

def plot_similarity_heatmap(
    sim_array: np.ndarray,
    names: List[str],
    labels: Sequence[int],
    *,
    title: str = "Country Pairwise Similarity — Sorted by Cluster",
    figsize: Tuple[float, float] = (14, 12),
    label_fontsize: int = 4,
    cmap: str = "YlOrRd",
    show_cluster_boundaries: bool = True,
) -> Figure:
    """
    Similarity heatmap with rows/columns sorted by cluster label.

    Sorting by cluster exposes the block-diagonal structure: high-similarity
    pairs inside a cluster appear as bright blocks along the diagonal, while
    inter-cluster regions are darker.

    Parameters
    ----------
    sim_array : np.ndarray, shape (n, n)
        Similarity matrix (values in [0, 1]).
    names : list[str]
        Country names parallel to rows/columns.
    labels : sequence of int
        Cluster labels used for sorting.
    title : str
    figsize : (width, height) in inches.
    label_fontsize : int
        Axis tick label font size.  Use 3–5 for ~195 countries.
    cmap : str
        Matplotlib colour map name.
    show_cluster_boundaries : bool
        Draw horizontal and vertical lines between cluster blocks.

    Returns
    -------
    matplotlib.figure.Figure
    """
    lbl_arr = np.array(labels)

    # ── sort order: by cluster label, then alphabetically within ─────────────
    sort_key = [(lbl_arr[i], names[i]) for i in range(len(names))]
    order = sorted(range(len(names)), key=lambda i: sort_key[i])

    sorted_names  = [names[i]     for i in order]
    sorted_labels = [labels[i]    for i in order]
    sorted_sim    = sim_array[np.ix_(order, order)]

    fig, ax = plt.subplots(figsize=figsize)

    im = ax.imshow(
        sorted_sim,
        cmap=cmap,
        vmin=0.0,
        vmax=1.0,
        aspect="auto",
        interpolation="nearest",
    )

    # ── axis ticks ────────────────────────────────────────────────────────────
    n = len(sorted_names)
    ax.set_xticks(range(n))
    ax.set_yticks(range(n))
    ax.set_xticklabels(sorted_names, rotation=90, fontsize=label_fontsize)
    ax.set_yticklabels(sorted_names,              fontsize=label_fontsize)

    # ── cluster boundary lines ────────────────────────────────────────────────
    if show_cluster_boundaries:
        prev = sorted_labels[0]
        for i, lbl in enumerate(sorted_labels[1:], start=1):
            if lbl != prev:
                ax.axhline(y=i - 0.5, color="black", linewidth=0.6)
                ax.axvline(x=i - 0.5, color="black", linewidth=0.6)
            prev = lbl

    # ── colour bar ────────────────────────────────────────────────────────────
    cbar = fig.colorbar(im, ax=ax, fraction=0.03, pad=0.02)
    cbar.set_label("Similarity", fontsize=9)
    cbar.ax.tick_params(labelsize=7)

    ax.set_title(title, fontsize=12, fontweight="bold", pad=12)
    fig.tight_layout()
    return fig


# ══════════════════════════════════════════════════════════════════════════════
# 4. Silhouette / k-sweep chart
# ══════════════════════════════════════════════════════════════════════════════

def plot_silhouette_sweep(
    sweep_result,          # pd.DataFrame or list[dict] from evaluate.sweep_k
    *,
    title: str = "Cluster Quality vs Number of Clusters (k)",
    figsize: Tuple[float, float] = (10, 5),
    highlight_best_k: bool = True,
) -> Figure:
    """
    Line chart of Silhouette and Davies-Bouldin scores across k values.

    Parameters
    ----------
    sweep_result : pd.DataFrame or list[dict]
        Output of ``evaluate.sweep_k``.
    title : str
    figsize : (width, height) in inches.
    highlight_best_k : bool
        Annotate the k with the highest silhouette score.

    Returns
    -------
    matplotlib.figure.Figure
    """
    # ── normalise to lists ────────────────────────────────────────────────────
    try:
        import pandas as pd
        if isinstance(sweep_result, pd.DataFrame):
            ks  = list(sweep_result.index.astype(int))
            sil = list(sweep_result["silhouette"].astype(float))
            db  = list(sweep_result["davies_bouldin"].astype(float))
        else:
            raise TypeError
    except (ImportError, TypeError, AttributeError):
        ks  = [r["k"]             for r in sweep_result]
        sil = [r["silhouette"]    for r in sweep_result]
        db  = [r["davies_bouldin"] for r in sweep_result]

    fig, ax1 = plt.subplots(figsize=figsize)
    ax2 = ax1.twinx()

    # ── silhouette (left axis) ────────────────────────────────────────────────
    line1, = ax1.plot(
        ks, sil,
        color="#4C78A8", linewidth=2, marker="o", markersize=5,
        label="Silhouette (higher = better)",
    )
    ax1.set_ylabel("Silhouette Score", color="#4C78A8", fontsize=9)
    ax1.tick_params(axis="y", labelcolor="#4C78A8")

    # ── davies-bouldin (right axis) ───────────────────────────────────────────
    line2, = ax2.plot(
        ks, db,
        color="#E45756", linewidth=2, marker="s", markersize=5,
        linestyle="--",
        label="Davies-Bouldin (lower = better)",
    )
    ax2.set_ylabel("Davies-Bouldin Index", color="#E45756", fontsize=9)
    ax2.tick_params(axis="y", labelcolor="#E45756")

    # ── best k annotation ─────────────────────────────────────────────────────
    if highlight_best_k and sil:
        valid_sil = [(k, s) for k, s in zip(ks, sil) if not np.isnan(s)]
        if valid_sil:
            best_k, best_s = max(valid_sil, key=lambda x: x[1])
            ax1.axvline(x=best_k, color="#54A24B", linewidth=1.2, linestyle=":")
            ax1.annotate(
                f"Best k = {best_k}\n(sil = {best_s:.3f})",
                xy=(best_k, best_s),
                xytext=(best_k + 0.4, best_s - 0.02),
                fontsize=8,
                color="#54A24B",
                arrowprops=dict(arrowstyle="-", color="#54A24B", lw=0.8),
            )

    ax1.set_xlabel("Number of Clusters (k)", fontsize=9)
    ax1.set_xticks(ks)
    ax1.set_title(title, fontsize=12, fontweight="bold", pad=10)

    # ── combined legend ───────────────────────────────────────────────────────
    lines = [line1, line2]
    labels = [l.get_label() for l in lines]
    ax1.legend(lines, labels, fontsize=8, loc="upper right")

    ax1.spines["top"].set_visible(False)
    ax2.spines["top"].set_visible(False)
    ax1.grid(True, linewidth=0.3, alpha=0.4, axis="x")

    fig.tight_layout()
    return fig


# ══════════════════════════════════════════════════════════════════════════════
# 5. DBSCAN eps sensitivity chart
# ══════════════════════════════════════════════════════════════════════════════

def plot_dbscan_eps_sweep(
    dist_array: np.ndarray,
    names: List[str],
    *,
    eps_values: Optional[Sequence[float]] = None,
    min_samples: int = 3,
    figsize: Tuple[float, float] = (10, 5),
    title: str = "DBSCAN Sensitivity — ε vs Clusters & Noise",
) -> Figure:
    """
    Chart showing how number of clusters and noise count change with ε.

    Helps choose a good eps value: look for the ε where the cluster count
    stabilises and the noise count is reasonable (not too many, not zero).

    Parameters
    ----------
    dist_array : np.ndarray, shape (n, n)
    names : list[str]
    eps_values : sequence of float or None
        ε values to sweep.  Defaults to np.linspace(0.10, 0.55, 30).
    min_samples : int
    figsize, title : self-explanatory.

    Returns
    -------
    matplotlib.figure.Figure
    """
    from .cluster import dbscan as _dbscan

    if eps_values is None:
        eps_values = list(np.linspace(0.10, 0.55, 30))

    n_clusters_list = []
    n_noise_list    = []

    for eps in eps_values:
        result = _dbscan(dist_array, names, eps=eps, min_samples=min_samples)
        n_clusters_list.append(result.n_clusters_found)
        n_noise_list.append(result.params["n_noise"])

    fig, ax1 = plt.subplots(figsize=figsize)
    ax2 = ax1.twinx()

    ax1.plot(
        eps_values, n_clusters_list,
        color="#4C78A8", linewidth=2, marker="o", markersize=4,
        label="Number of clusters",
    )
    ax2.plot(
        eps_values, n_noise_list,
        color="#E45756", linewidth=2, marker="s", markersize=4,
        linestyle="--",
        label="Noise / outlier count",
    )

    ax1.set_xlabel("ε (eps — max distance to be a neighbour)", fontsize=9)
    ax1.set_ylabel("Number of Clusters", color="#4C78A8", fontsize=9)
    ax2.set_ylabel("Noise Points",        color="#E45756", fontsize=9)
    ax1.tick_params(axis="y", labelcolor="#4C78A8")
    ax2.tick_params(axis="y", labelcolor="#E45756")

    # ── annotation: similarity equivalent ────────────────────────────────────
    ax1.set_title(title, fontsize=12, fontweight="bold", pad=10)

    handles1 = ax1.get_lines()
    handles2 = ax2.get_lines()
    ax1.legend(handles1 + handles2, [h.get_label() for h in handles1 + handles2],
               fontsize=8, loc="upper right")

    ax1.spines["top"].set_visible(False)
    ax2.spines["top"].set_visible(False)
    ax1.grid(True, linewidth=0.3, alpha=0.4)

    fig.tight_layout()
    return fig
