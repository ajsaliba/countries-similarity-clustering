"""
clustering/cluster.py
=====================
Clustering algorithms for the country similarity matrix.

All algorithms operate on the **precomputed distance matrix**
(``dist = 1 − similarity``) produced by ``ted.similarity.compute_matrix``.
No Euclidean embedding is assumed anywhere in this module.

Algorithms
----------
agglomerative(dist_array, names, n_clusters, linkage)
    Hierarchical agglomerative clustering.  Average linkage is the default
    and the recommended choice for non-Euclidean precomputed data.
    Ward linkage is explicitly blocked — it requires Euclidean geometry.

dbscan(dist_array, names, eps, min_samples)
    Density-based clustering.  Countries that do not belong to any dense
    neighbourhood are labelled −1 (noise / outlier).  Ideal for flagging
    micro-states and politically isolated countries without forcing them
    into a cluster.

spectral(sim_array, names, n_clusters)
    Graph-Laplacian clustering on the **similarity** matrix used directly
    as an affinity (no inversion needed).  Finds well-connected subgraphs.

kmedoids(dist_array, names, n_clusters, n_init, random_state)
    Partitioning Around Medoids.  Each cluster centre is a real country,
    making results interpretable ("France is the medoid of Cluster 3").

All functions return a ``ClusterResult`` named tuple:
    labels  – list[int], parallel to ``names``; −1 = noise (DBSCAN only)
    names   – list[str], country names in the same order as dist_array
    method  – str, algorithm name
    params  – dict, the parameters used
    n_clusters_found – int, number of non-noise clusters
"""

from __future__ import annotations

import random
from typing import Dict, List, NamedTuple, Optional

import numpy as np
from sklearn.cluster import AgglomerativeClustering, DBSCAN, SpectralClustering


# ── result container ──────────────────────────────────────────────────────────

class ClusterResult(NamedTuple):
    """Immutable result of a clustering run."""
    labels:           List[int]   # parallel to names; -1 = noise
    names:            List[str]   # country names
    method:           str         # algorithm identifier
    params:           Dict        # parameters used
    n_clusters_found: int         # number of real clusters (excludes noise)

    def as_dict(self) -> Dict[str, int]:
        """Return {country: cluster_label} mapping."""
        return dict(zip(self.names, self.labels))

    def cluster_members(self) -> Dict[int, List[str]]:
        """Return {cluster_id: [country, ...]} mapping; noise is key -1."""
        groups: Dict[int, List[str]] = {}
        for name, label in zip(self.names, self.labels):
            groups.setdefault(label, []).append(name)
        return groups


# ── helpers ───────────────────────────────────────────────────────────────────

def _validate_square(arr: np.ndarray, label: str = "matrix") -> None:
    if arr.ndim != 2 or arr.shape[0] != arr.shape[1]:
        raise ValueError(
            f"{label} must be square 2-D array; got shape {arr.shape}"
        )


def _n_real_clusters(labels: np.ndarray) -> int:
    """Count distinct cluster labels excluding noise (−1)."""
    return len(set(labels.tolist()) - {-1})


# ══════════════════════════════════════════════════════════════════════════════
# 1. Agglomerative Hierarchical Clustering
# ══════════════════════════════════════════════════════════════════════════════

_VALID_LINKAGE = {"average", "complete", "single"}
_BLOCKED_LINKAGE = {"ward"}


def agglomerative(
    dist_array: np.ndarray,
    names: List[str],
    distance_threshold: float = 0.5,
    linkage: str = "average",
) -> ClusterResult:
    """
    Hierarchical agglomerative clustering on a precomputed distance matrix.

    Cluster count is determined automatically by cutting the dendrogram at
    *distance_threshold* — pairs of clusters whose linkage distance exceeds
    the threshold are not merged.  This is the natural hierarchical
    parameter and avoids forcing an arbitrary *k*.

    Parameters
    ----------
    dist_array : np.ndarray, shape (n, n)
        Symmetric distance matrix.  Values in [0, 1] where 0 = identical
        and 1 = maximally different.  Compute as ``1 − similarity_matrix``.
    names : list[str]
        Country names, parallel to the rows/columns of dist_array.
    distance_threshold : float
        Height at which to cut the dendrogram.  Lower → more, tighter
        clusters; higher → fewer, looser clusters.  Typical TED range:
        ~0.1 (very tight) to ~0.7 (very loose).  Default 0.5.
    linkage : str
        Inter-cluster distance rule.  Must be one of:
        - "average"  (UPGMA) — recommended for non-Euclidean data.
        - "complete" — compact clusters but sensitive to outliers.
        - "single"   — chaining effect; rarely useful here.
        Ward linkage is blocked because it requires Euclidean geometry.

    Returns
    -------
    ClusterResult
        n_clusters_found is the auto-detected count after applying the cut.
    """
    _validate_square(dist_array, "dist_array")

    if linkage in _BLOCKED_LINKAGE:
        raise ValueError(
            f"Linkage '{linkage}' is blocked: Ward requires Euclidean geometry "
            f"and is invalid for a precomputed TED distance matrix.  "
            f"Use one of: {sorted(_VALID_LINKAGE)}."
        )
    if linkage not in _VALID_LINKAGE:
        raise ValueError(
            f"Unknown linkage '{linkage}'.  Choose from: {sorted(_VALID_LINKAGE)}."
        )

    model = AgglomerativeClustering(
        n_clusters=None,
        distance_threshold=float(distance_threshold),
        metric="precomputed",
        linkage=linkage,
    )
    labels: np.ndarray = model.fit_predict(dist_array)

    return ClusterResult(
        labels=labels.tolist(),
        names=list(names),
        method="agglomerative",
        params={"distance_threshold": float(distance_threshold), "linkage": linkage},
        n_clusters_found=_n_real_clusters(labels),
    )


# ══════════════════════════════════════════════════════════════════════════════
# 2. DBSCAN
# ══════════════════════════════════════════════════════════════════════════════

def dbscan(
    dist_array: np.ndarray,
    names: List[str],
    eps: float = 0.30,
    min_samples: int = 3,
) -> ClusterResult:
    """
    Density-Based Spatial Clustering of Applications with Noise.

    Countries that are not within ``eps`` distance of at least
    ``min_samples − 1`` other countries are labelled −1 (noise / outlier).
    This cleanly handles micro-states (Vatican City, Nauru) and politically
    isolated countries (North Korea) without forcing them into a cluster.

    Parameters
    ----------
    dist_array : np.ndarray, shape (n, n)
        Precomputed distance matrix (dist = 1 − similarity).
    names : list[str]
        Country names parallel to matrix rows/columns.
    eps : float
        Maximum distance to be considered a neighbour.
        In similarity terms, two countries must have similarity ≥ (1 − eps)
        to be in the same neighbourhood.
        Recommended sweep: eps ∈ [0.20, 0.50]; start at 0.30 which
        corresponds to similarity ≥ 0.70 — the "clearly similar" threshold.
    min_samples : int
        Minimum neighbourhood size (including the point itself) to form a
        core point.  3 is a reasonable floor for n ≈ 195.

    Returns
    -------
    ClusterResult
        labels contains −1 for noise/outlier countries.
    """
    _validate_square(dist_array, "dist_array")

    model = DBSCAN(
        eps=eps,
        min_samples=min_samples,
        metric="precomputed",
    )
    labels: np.ndarray = model.fit_predict(dist_array)
    n_noise = int(np.sum(labels == -1))
    n_found = _n_real_clusters(labels)

    result = ClusterResult(
        labels=labels.tolist(),
        names=list(names),
        method="dbscan",
        params={
            "eps": eps,
            "min_samples": min_samples,
            "n_noise": n_noise,
        },
        n_clusters_found=n_found,
    )
    return result


# ══════════════════════════════════════════════════════════════════════════════
# 3. Spectral Clustering
# ══════════════════════════════════════════════════════════════════════════════

def spectral(
    sim_array: np.ndarray,
    names: List[str],
    n_clusters: int = 10,
    random_state: int = 42,
) -> ClusterResult:
    """
    Spectral clustering using the similarity matrix as a graph affinity.

    Takes the **similarity** matrix directly (no inversion to distance).
    The graph Laplacian partitions the country-similarity graph by cutting
    weakly connected edges — countries that are naturally isolated (low
    similarity to all others) end up in their own partition.

    Parameters
    ----------
    sim_array : np.ndarray, shape (n, n)
        Symmetric similarity matrix with values in [0, 1].
        Pass ``sim_array`` directly — do NOT convert to distance first.
    names : list[str]
        Country names parallel to matrix rows/columns.
    n_clusters : int
        Number of partitions.
    random_state : int
        Seed for the k-means step in the spectral embedding.

    Returns
    -------
    ClusterResult

    Notes
    -----
    Spectral clustering can be noisy at n ≈ 195 because the eigenvector
    decomposition amplifies small numerical perturbations.  Use as a
    cross-validation tool alongside agglomerative results, not as the
    sole method.
    """
    _validate_square(sim_array, "sim_array")

    # Ensure the affinity matrix is non-negative (similarity must be ≥ 0)
    affinity = np.clip(sim_array, 0.0, 1.0)

    model = SpectralClustering(
        n_clusters=n_clusters,
        affinity="precomputed",
        random_state=random_state,
        assign_labels="kmeans",
    )
    labels: np.ndarray = model.fit_predict(affinity)

    return ClusterResult(
        labels=labels.tolist(),
        names=list(names),
        method="spectral",
        params={"n_clusters": n_clusters, "random_state": random_state},
        n_clusters_found=_n_real_clusters(labels),
    )


# ══════════════════════════════════════════════════════════════════════════════
# 4. k-Medoids (PAM — Partitioning Around Medoids)
# ══════════════════════════════════════════════════════════════════════════════

def kmedoids(
    dist_array: np.ndarray,
    names: List[str],
    n_clusters: int = 10,
    n_init: int = 10,
    random_state: Optional[int] = 42,
    max_iter: int = 300,
) -> ClusterResult:
    """
    k-Medoids clustering (PAM) on a precomputed distance matrix.

    Unlike k-Means, each cluster centre is a real country (the medoid —
    the country with the smallest total distance to all other cluster
    members).  This makes results immediately interpretable:
    "France is the representative of Cluster 2."

    This is a pure-NumPy implementation that does not require scikit-learn-
    extra, keeping dependencies minimal.

    Algorithm
    ---------
    1. Randomly initialise k medoids.
    2. Assign each country to its nearest medoid.
    3. For each cluster, find the country that minimises total intra-cluster
       distance — that becomes the new medoid.
    4. Repeat until convergence or max_iter.
    5. Run n_init times with different seeds; return the best result
       (lowest total within-cluster distance).

    Parameters
    ----------
    dist_array : np.ndarray, shape (n, n)
        Precomputed distance matrix.
    names : list[str]
        Country names parallel to matrix rows/columns.
    n_clusters : int
        Number of clusters (k).
    n_init : int
        Number of random restarts.  Higher values reduce sensitivity to
        initialisation at the cost of compute.
    random_state : int or None
        Seed for reproducibility.
    max_iter : int
        Maximum iterations per restart.

    Returns
    -------
    ClusterResult
        params includes ``medoids`` — the list of representative country names.
    """
    _validate_square(dist_array, "dist_array")
    n = dist_array.shape[0]

    if n_clusters > n:
        raise ValueError(
            f"n_clusters ({n_clusters}) cannot exceed the number of "
            f"countries ({n})."
        )

    rng = random.Random(random_state)
    best_labels: Optional[np.ndarray] = None
    best_cost = float("inf")
    best_medoid_indices: List[int] = []

    for _ in range(n_init):
        # ── initialise ────────────────────────────────────────────────────────
        medoid_indices = rng.sample(range(n), n_clusters)

        for _iter in range(max_iter):
            # ── assignment step ───────────────────────────────────────────────
            # labels[i] = index into medoid_indices of the nearest medoid
            medoid_arr = np.array(medoid_indices)
            dists_to_medoids = dist_array[:, medoid_arr]   # shape (n, k)
            assignments = np.argmin(dists_to_medoids, axis=1)  # shape (n,)

            # ── update step ───────────────────────────────────────────────────
            new_medoids = []
            for k_idx in range(n_clusters):
                members = np.where(assignments == k_idx)[0]
                if len(members) == 0:
                    # Empty cluster: reinitialise with a random point
                    new_medoids.append(rng.choice(range(n)))
                    continue
                # Medoid = member with minimum total distance to all others
                sub_dist = dist_array[np.ix_(members, members)]
                local_idx = int(np.argmin(sub_dist.sum(axis=1)))
                new_medoids.append(int(members[local_idx]))

            if new_medoids == medoid_indices:
                break   # converged
            medoid_indices = new_medoids

        # ── compute total within-cluster cost ─────────────────────────────────
        medoid_arr = np.array(medoid_indices)
        dists_to_medoids = dist_array[:, medoid_arr]
        assignments = np.argmin(dists_to_medoids, axis=1)
        total_cost = float(
            sum(
                dist_array[i, medoid_indices[assignments[i]]]
                for i in range(n)
            )
        )

        if total_cost < best_cost:
            best_cost = total_cost
            best_labels = assignments.copy()
            best_medoid_indices = list(medoid_indices)

    assert best_labels is not None
    medoid_names = [names[i] for i in best_medoid_indices]

    return ClusterResult(
        labels=best_labels.tolist(),
        names=list(names),
        method="kmedoids",
        params={
            "n_clusters": n_clusters,
            "n_init": n_init,
            "random_state": random_state,
            "medoids": medoid_names,
            "total_cost": round(best_cost, 4),
        },
        n_clusters_found=_n_real_clusters(best_labels),
    )
