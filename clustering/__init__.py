"""
clustering — country similarity clustering package.

Public API
----------
from clustering import (
    # Algorithms
    agglomerative, dbscan, spectral, kmedoids, ClusterResult,

    # Evaluation
    silhouette, davies_bouldin, calinski_harabasz,
    sweep_k, compute_linkage, cluster_summary,

    # Visualisation
    plot_dendrogram, plot_mds_scatter, plot_similarity_heatmap,
    plot_silhouette_sweep, plot_dbscan_eps_sweep,
)
"""

from .cluster import (
    ClusterResult,
    agglomerative,
    dbscan,
    spectral,
    kmedoids,
)

from .evaluate import (
    silhouette,
    davies_bouldin,
    calinski_harabasz,
    sweep_k,
    compute_linkage,
    cluster_summary,
)

from .visualise import (
    plot_dendrogram,
    plot_mds_scatter,
    plot_similarity_heatmap,
    plot_silhouette_sweep,
    plot_dbscan_eps_sweep,
)

__all__ = [
    # algorithms
    "ClusterResult",
    "agglomerative",
    "dbscan",
    "spectral",
    "kmedoids",
    # evaluation
    "silhouette",
    "davies_bouldin",
    "calinski_harabasz",
    "sweep_k",
    "compute_linkage",
    "cluster_summary",
    # visualisation
    "plot_dendrogram",
    "plot_mds_scatter",
    "plot_similarity_heatmap",
    "plot_silhouette_sweep",
    "plot_dbscan_eps_sweep",
]
