"""
clustering/evaluate.py
======================
Cluster quality evaluation on precomputed distance / similarity matrices.

All metrics work with ``metric="precomputed"`` — no Euclidean embedding is
assumed.  The only exception is Calinski-Harabasz, which requires a feature
matrix; we provide it only when an MDS embedding is supplied.

Public API
----------
silhouette(dist_array, labels)          → float  in [-1, 1]
davies_bouldin(dist_array, labels)      → float  ≥ 0  (lower is better)
calinski_harabasz(embed, labels)        → float  ≥ 0  (higher is better)
sweep_k(dist_array, names, ks, ...)     → DataFrame of scores vs k
linkage_distances(dist_array, names)    → (linkage_matrix, ordered_names)
cluster_summary(result, dist_array)     → DataFrame per-cluster statistics
"""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

# Lazy imports so the module loads even when optional packages are missing
try:
    import pandas as pd
    _PANDAS = True
except ImportError:
    _PANDAS = False

from sklearn.metrics import silhouette_score, davies_bouldin_score
from sklearn.metrics import calinski_harabasz_score
from scipy.cluster.hierarchy import linkage, optimal_leaf_ordering

from .cluster import ClusterResult, agglomerative


# ══════════════════════════════════════════════════════════════════════════════
# Single-result metrics
# ══════════════════════════════════════════════════════════════════════════════

def silhouette(
    dist_array: np.ndarray,
    labels: Sequence[int],
    *,
    exclude_noise: bool = True,
) -> float:
    """
    Mean silhouette coefficient on the precomputed distance matrix.

    Silhouette ∈ [−1, 1]:
      +1  → country is well inside its cluster, far from neighbours
       0  → country sits on the boundary between two clusters
      −1  → country is closer to a different cluster than its own

    Parameters
    ----------
    dist_array : np.ndarray, shape (n, n)
    labels : sequence of int  (−1 = DBSCAN noise, excluded by default)
    exclude_noise : bool
        If True, rows with label −1 are masked out before scoring.
        Noise points have no cluster membership and would distort the metric.

    Returns
    -------
    float, or NaN if fewer than 2 clusters remain after filtering.
    """
    lbl = np.array(labels)

    if exclude_noise:
        mask = lbl != -1
        if mask.sum() == 0:
            return float("nan")
        dist_sub = dist_array[np.ix_(mask, mask)]
        lbl_sub = lbl[mask]
    else:
        dist_sub = dist_array
        lbl_sub = lbl

    n_cls = len(set(lbl_sub.tolist()) - {-1})
    if n_cls < 2:
        return float("nan")

    return float(silhouette_score(dist_sub, lbl_sub, metric="precomputed"))


def davies_bouldin(
    dist_array: np.ndarray,
    labels: Sequence[int],
    *,
    exclude_noise: bool = True,
) -> float:
    """
    Davies-Bouldin index on the precomputed distance matrix.

    DB index = average of max(within_scatter_i + within_scatter_j) /
               between_centroid_dist(i, j)  over all cluster pairs.

    Lower is better (0 = perfect separation with no within-cluster spread).

    We approximate cluster centroids as the medoid (minimiser of total
    intra-cluster distance) so the metric remains valid without an
    embedding.

    Parameters
    ----------
    dist_array : np.ndarray
    labels : sequence of int
    exclude_noise : bool
        Exclude DBSCAN noise points (label = −1).

    Returns
    -------
    float ≥ 0, or NaN if fewer than 2 clusters.
    """
    lbl = np.array(labels)

    if exclude_noise:
        mask = lbl != -1
        if mask.sum() == 0:
            return float("nan")
        dist_sub = dist_array[np.ix_(mask, mask)]
        lbl_sub = lbl[mask]
    else:
        dist_sub = dist_array
        lbl_sub = lbl

    cluster_ids = sorted(set(lbl_sub.tolist()) - {-1})
    if len(cluster_ids) < 2:
        return float("nan")

    n = dist_sub.shape[0]

    # ── within-cluster scatter (average distance to medoid) ───────────────────
    scatter: Dict[int, float] = {}
    medoid_idx: Dict[int, int] = {}

    for cid in cluster_ids:
        members = np.where(lbl_sub == cid)[0]
        sub = dist_sub[np.ix_(members, members)]
        med_local = int(np.argmin(sub.sum(axis=1)))
        medoid_idx[cid] = int(members[med_local])
        scatter[cid] = float(sub[:, med_local].mean()) if len(members) > 1 else 0.0

    # ── between-cluster distance (medoid to medoid) ────────────────────────────
    db_values = []
    for i, ci in enumerate(cluster_ids):
        worst = -1.0
        for j, cj in enumerate(cluster_ids):
            if i == j:
                continue
            between = dist_sub[medoid_idx[ci], medoid_idx[cj]]
            if between == 0.0:
                continue
            ratio = (scatter[ci] + scatter[cj]) / between
            worst = max(worst, ratio)
        if worst >= 0:
            db_values.append(worst)

    return float(np.mean(db_values)) if db_values else float("nan")


def calinski_harabasz(
    embedding: np.ndarray,
    labels: Sequence[int],
    *,
    exclude_noise: bool = True,
) -> float:
    """
    Calinski-Harabasz (Variance Ratio) index.

    Requires a Euclidean feature matrix (e.g., MDS 2-D coordinates).
    Higher is better: well-separated, compact clusters score higher.

    Use this only when you have an MDS or UMAP embedding — do NOT pass the
    raw distance matrix here.

    Parameters
    ----------
    embedding : np.ndarray, shape (n, d)
        Euclidean feature representation (e.g., MDS output).
    labels : sequence of int
    exclude_noise : bool

    Returns
    -------
    float ≥ 0, or NaN if fewer than 2 clusters.
    """
    lbl = np.array(labels)

    if exclude_noise:
        mask = lbl != -1
        if mask.sum() == 0:
            return float("nan")
        emb_sub = embedding[mask]
        lbl_sub = lbl[mask]
    else:
        emb_sub = embedding
        lbl_sub = lbl

    if len(set(lbl_sub.tolist()) - {-1}) < 2:
        return float("nan")

    return float(calinski_harabasz_score(emb_sub, lbl_sub))


# ══════════════════════════════════════════════════════════════════════════════
# k-sweep: find the best number of clusters
# ══════════════════════════════════════════════════════════════════════════════

def sweep_k(
    dist_array: np.ndarray,
    names: List[str],
    ks: Optional[Sequence[int]] = None,
    linkage: str = "average",
    embedding: Optional[np.ndarray] = None,
) -> "pd.DataFrame | List[Dict]":
    """
    Sweep over a range of k values and compute quality metrics for each.

    Uses agglomerative clustering (average linkage by default) to produce
    labels for each k, then evaluates:
      - Silhouette score (higher = better)
      - Davies-Bouldin index (lower = better)
      - Calinski-Harabasz index (higher = better; requires ``embedding``)

    Parameters
    ----------
    dist_array : np.ndarray, shape (n, n)
        Precomputed distance matrix.
    names : list[str]
        Country names.
    ks : sequence of int or None
        Values of k to try.  Defaults to range(5, 21).
    linkage : str
        Linkage method for agglomerative clustering.  Default "average".
    embedding : np.ndarray or None
        MDS / UMAP 2-D coordinates for Calinski-Harabasz.  If None, CH
        scores are omitted.

    Returns
    -------
    pandas.DataFrame if pandas is installed; otherwise list[dict].
    Each row/entry has: k, silhouette, davies_bouldin, calinski_harabasz.
    """
    if ks is None:
        ks = list(range(5, 21))

    rows = []
    for k in ks:
        result = agglomerative(dist_array, names, n_clusters=k, linkage=linkage)
        lbl = result.labels

        sil = silhouette(dist_array, lbl)
        db  = davies_bouldin(dist_array, lbl)
        ch  = calinski_harabasz(embedding, lbl) if embedding is not None else float("nan")

        rows.append({
            "k":                  k,
            "silhouette":         round(sil, 4),
            "davies_bouldin":     round(db,  4),
            "calinski_harabasz":  round(ch,  4) if not np.isnan(ch) else float("nan"),
        })

    if _PANDAS:
        import pandas as pd
        return pd.DataFrame(rows).set_index("k")
    return rows


# ══════════════════════════════════════════════════════════════════════════════
# Linkage / dendrogram matrix
# ══════════════════════════════════════════════════════════════════════════════

def compute_linkage(
    dist_array: np.ndarray,
    names: List[str],
    method: str = "average",
    optimal_ordering: bool = True,
) -> Tuple[np.ndarray, List[str]]:
    """
    Compute a scipy linkage matrix for dendrogram plotting.

    Parameters
    ----------
    dist_array : np.ndarray, shape (n, n)
        Symmetric precomputed distance matrix.
    names : list[str]
        Country names parallel to rows/columns.
    method : str
        Agglomerative linkage method ("average", "complete", "single").
        "ward" is blocked — see cluster.py.
    optimal_ordering : bool
        If True, apply ``scipy.cluster.hierarchy.optimal_leaf_ordering``
        to minimise the sum of adjacent-leaf distances in the dendrogram.
        Makes the plot easier to read; adds modest compute.

    Returns
    -------
    (Z, ordered_names)
        Z           : scipy linkage matrix, shape (n-1, 4)
        ordered_names : country names in the leaf order implied by Z
    """
    from scipy.cluster.hierarchy import dendrogram as _dg
    from scipy.spatial.distance import squareform

    if method == "ward":
        raise ValueError(
            "Ward linkage requires Euclidean geometry.  "
            "Use 'average', 'complete', or 'single' instead."
        )

    # scipy.linkage expects a condensed distance vector
    condensed = squareform(dist_array, checks=False)
    Z = linkage(condensed, method=method)

    if optimal_ordering:
        Z = optimal_leaf_ordering(Z, condensed)

    # Recover leaf order from the linkage matrix
    dg_result = _dg(Z, no_plot=True)
    leaf_order: List[int] = dg_result["leaves"]
    ordered_names: List[str] = [names[i] for i in leaf_order]

    return Z, ordered_names


# ══════════════════════════════════════════════════════════════════════════════
# Per-cluster summary statistics
# ══════════════════════════════════════════════════════════════════════════════

def cluster_summary(
    result: ClusterResult,
    dist_array: np.ndarray,
) -> "pd.DataFrame | List[Dict]":
    """
    Compute per-cluster statistics: size, intra-cluster cohesion, medoid.

    Statistics
    ----------
    cluster_id      Cluster label (−1 = noise for DBSCAN)
    size            Number of countries in the cluster
    cohesion        Mean pairwise distance within the cluster (lower = tighter)
    max_diameter    Maximum pairwise distance within the cluster
    medoid          Country name with the smallest total intra-cluster distance

    Parameters
    ----------
    result : ClusterResult
        Output from any clustering function in cluster.py.
    dist_array : np.ndarray, shape (n, n)
        The same distance matrix used to produce ``result``.

    Returns
    -------
    pandas.DataFrame if pandas is installed; otherwise list[dict].
    Sorted by cluster_id ascending.
    """
    labels = np.array(result.labels)
    names  = result.names
    cluster_ids = sorted(set(result.labels))

    rows = []
    for cid in cluster_ids:
        members_idx = [i for i, lbl in enumerate(result.labels) if lbl == cid]
        member_names = [names[i] for i in members_idx]
        n_members = len(members_idx)

        if n_members == 1:
            rows.append({
                "cluster_id": cid,
                "size":        1,
                "cohesion":    0.0,
                "max_diameter": 0.0,
                "medoid":      member_names[0],
                "members":     member_names,
            })
            continue

        # Sub-matrix for this cluster
        sub = dist_array[np.ix_(members_idx, members_idx)]
        row_sums = sub.sum(axis=1)
        med_local = int(np.argmin(row_sums))
        medoid_name = member_names[med_local]

        # Upper triangle to avoid double-counting pairs
        upper = sub[np.triu_indices(n_members, k=1)]
        cohesion     = float(upper.mean()) if len(upper) > 0 else 0.0
        max_diameter = float(upper.max())  if len(upper) > 0 else 0.0

        rows.append({
            "cluster_id":   cid,
            "size":         n_members,
            "cohesion":     round(cohesion,     4),
            "max_diameter": round(max_diameter, 4),
            "medoid":       medoid_name,
            "members":      sorted(member_names),
        })

    if _PANDAS:
        import pandas as pd
        df = pd.DataFrame(rows).set_index("cluster_id")
        return df
    return rows
