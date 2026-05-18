# SIMILICA — Wikipedia Infobox Similarity & Clustering Simulator

> **COE 543 / 743 · Intelligent Data Processing and Applications · Spring 2026 · LAU**

A Flask web application that compares the 195-country Wikipedia infobox dataset using **Tree Edit Distance (TED)** for structural similarity, generates step-by-step **patching** scripts that transform one country into another, and **clusters** all 195 countries with four different algorithms. Every algorithm is wired to a real, inspectable visualisation — dendrogram, similarity-matrix heatmap, MDS scatter, force graph, world map overlay, and table.

---

## Table of contents

- [Quick start](#quick-start)
- [What you can do with it](#what-you-can-do-with-it)
- [Project layout](#project-layout)
- [The data](#the-data)
- [Algorithms — what they are and where they live](#algorithms--what-they-are-and-where-they-live)
- [The wizard flows](#the-wizard-flows)
- [Visualisations](#visualisations)
- [HTTP API](#http-api)
- [Persisted artifacts](#persisted-artifacts)
- [Performance notes](#performance-notes)
- [Tech stack](#tech-stack)
- [Acknowledgements](#acknowledgements)

---

## Quick start

```bash
# 1.  Install dependencies
pip install flask numpy scipy scikit-learn python-docx

# 2.  Run the server (Windows / macOS / Linux)
cd Countries-Similarity-Clustering
python app.py

# 3.  Open the UI
#     → http://localhost:5000
```

First boot prints these lines once and persists everything to `outputs/`:

```
[SIMILICA] Loaded 195 countries
[SIMILICA] Loaded 195 cleaned-data semantic documents
[SIMILICA] Loaded cached TED matrix (195×195) from outputs/matrix.npz
[SIMILICA] Loaded cached MDS atlas (195 points) from outputs/mds_coords.npz
 * Running on http://127.0.0.1:5000
```

Every subsequent boot reads those caches in milliseconds. **Clustering all 195 countries returns in well under a second.**

---

## What you can do with it

### Similarity (`/similarity`)

A 7-step wizard. Pick two countries (pairwise) or one source against every other (one-vs-all), choose which infobox sections / fields participate in the comparison, and run.

**Pairwise output:**
- Overall TED similarity score
- Side-by-side colour-coded **tree diff**
- **Patching playback** — three-pane animation (source · live · target) that applies the edit script one operation at a time, with play / pause / step / scrub controls
- Full **edit script** (insert / delete / update operations, each with its full path)
- Per-section **field scores** (Capital, Language, Government type, …)
- **Token analysis** — Jaccard breakdown showing shared / unique-A / unique-B tokens

**One-vs-all output:**
- Ranked leaderboard of all 194 targets vs the source
- Geographic heatmap on a Leaflet world map
- **Click any row → drill into the full pairwise view** (with a "Back to leaderboard" button)

Every pairwise run writes 6 files to `outputs/patches/<source>_to_<target>_<timestamp>/` (source, target, machine-readable edit script, human-readable edit script, patched document, summary).

### Clustering (`/clustering`)

A 6-step wizard. Pick countries from a search list or click pins on the world map; pick one of four algorithms; tune its parameters; run.

| Algorithm | Type | Parameters |
|---|---|---|
| **Agglomerative** | Hierarchical (UPGMA) | `distance_threshold`, `linkage` |
| **DBSCAN** | Density-based | `ε`, `min_samples` |
| **Spectral** | Graph-Laplacian | `k` |
| **K-Medoids** | Partitional (PAM) | `k` |

Six visualisations — the wizard auto-selects the right default tab per algorithm (e.g. Force Graph for Spectral, Table for K-Medoids).

---

## Project layout

```
Countries-Similarity-Clustering/
├── app.py                          # Flask backend: routes, request handling, bootstrap
├── ted/                            # Tree Edit Distance package
│   ├── node.py                     # Node dataclass — typed tree representation
│   ├── tree_builder.py             # JSON → typed tree (8 section schema)
│   ├── cost_functions.py           # Type-aware costs (log-ratio, Jaccard, L1, sharpening)
│   ├── zhang_shasha.py             # Classical O(n²m²) DP algorithm
│   ├── similarity.py               # Distance → similarity converter (exp_size method)
│   └── run_ted.py                  # CLI driver + diff_trees / apply_edit_script / verify_patch
├── clustering/                     # Clustering algorithms
│   ├── cluster.py                  # agglomerative / dbscan / spectral / kmedoids
│   ├── evaluate.py                 # Internal validation helpers
│   └── visualise.py                # Server-side viz helpers (CLI use)
├── templates/                      # Jinja2 templates
│   ├── base.html                   # Design system (OKLCH dark theme, tabs, badges, toast)
│   ├── index.html                  # Landing page
│   ├── similarity.html             # 7-step similarity wizard
│   ├── clustering.html             # 6-step clustering wizard
│   ├── results.html                # Recent runs (session storage)
│   ├── saved.html                  # Bookmarked runs (local storage)
│   └── about.html                  # Project notes
├── static/js/
│   ├── similarity.js               # Similarity wizard logic + patching playback + result rendering
│   └── clustering.js               # Clustering wizard logic + 6 visualisations + zoom controls
├── data/
│   ├── clean/countries/*.json      # 195 country files in canonical schema (drives everything)
│   └── cleaned-data/*.json         # Alternate schema (used by legacy semantic Jaccard)
├── outputs/
│   ├── matrix.npz                  # Precomputed 195×195 TED similarity + distance matrix
│   ├── mds_coords.npz              # Precomputed 195×2 MDS atlas for scatter plots
│   └── patches/                    # Per-run patching artifacts (one folder per pairwise run)
└── Chapter/                        # Course notes (Tekli IDPA, COE 543) — reference only
```

---

## The data

**195 country JSON files** under `data/clean/countries/` — Wikipedia infoboxes scraped and normalised into a single canonical schema:

```jsonc
{
  "country":    "France",
  "area":       { "total_km2": ..., "water_pct": ..., "rank": ... },
  "codes":      { "calling_code": "+33", "internet_tld": ".fr", "iso_3166_code": "FR" },
  "economy":    {
    "currency_code": "EUR",
    "gdp_ppp":      { "total_billion_usd": ..., "per_capita_usd": ... },
    "gdp_nominal":  { ... },
    "gini":         { "value": ..., "category": "low" },
    "hdi":          { "value": ..., "category": "very high" }
  },
  "general":    {
    "capital":            "Paris",
    "official_language":  "French",
    "religion":           { "groups": { "Christianity": 50.0, "Islam": 4.0, ... } },
    "ethnic_groups":      { "groups": { ... } },
    ...
  },
  "government": { "type": "...", "legislature": "...", ... },
  "history":    { ... },
  "population": { "total": ..., "density_per_km2": ... },
  "time":       { "timezone_utc": "...", "timezone_dst": "..." }
}
```

The **8 top-level keys** (`area`, `codes`, `economy`, `general`, `government`, `history`, `population`, `time`) are exactly the 8 sections you see in the **Select Labels** step of the similarity wizard.

---

## Algorithms — what they are and where they live

### Tree Edit Distance (Zhang-Shasha, 1989)

[`ted/zhang_shasha.py`](ted/zhang_shasha.py)

The minimum-cost sequence of three operations that transforms tree T1 into T2:

| Operation | Cost |
|---|---|
| `insert(n)` | `cost_fn.insert(n)` — base weight of `n.label` |
| `delete(n)` | `cost_fn.delete(n)` — symmetric with insert |
| `update(n1, n2)` | `cost_fn.update(n1, n2)` — `∞` if labels differ; type-specific cost otherwise |

Classical O(\|T1\|² · \|T2\|²) DP using *keyroots* (nodes whose leftmost-leaf value is unique scanning right-to-left). Each pair of country trees (~35 nodes each) runs in 2–5 ms.

### Type-aware cost function

[`ted/cost_functions.py`](ted/cost_functions.py)

Six ideas combine:

1. **Log-ratio** for numeric leaves — `min(1, |ln(v1) − ln(v2)| / ln(100))`. A 2× ratio ≈ 0.15, 10× ≈ 0.50, 100× = 1.0.
2. **Token-Jaccard** for string leaves — `1 − |tokens(a) ∩ tokens(b)| / |tokens(a) ∪ tokens(b)|`.
3. **L1 total variation** for distribution leaves (religion, ethnic groups) — `Σ|p_i − q_i| / 200`.
4. **Feature weights** per label — GDP=3.0, currency_code=1.0, demonym=0.3, … (importance gradient).
5. **Smoothstep sharpening** — `f(x) = 3x² − 2x³` compresses noise and amplifies real differences.
6. **Missing-value penalty** — half-cost (0.5) if one side has the field and the other doesn't.

**Special case:** label mismatch returns `+∞`, so an apparent "rename" always decomposes into delete + insert.

### Distance → similarity converter

[`ted/similarity.py`](ted/similarity.py)

```
similarity = exp(−TED / max(|T1|, |T2|))
ceiling    = min(|T1|, |T2|) / max(|T1|, |T2|)
sim        = min(raw, ceiling)
```

Anchoring to the *larger* tree prevents a 5-node Vatican from looking 80% similar to a 50-node Russia. The hard ratio ceiling enforces that.

### Patching pipeline

[`ted/run_ted.py`](ted/run_ted.py) + [`app.py:_run_patching`](app.py)

`diff_trees(source, target)` walks both trees and emits a list of insert/delete/update ops with their full path from root. `apply_edit_script(source, script)` clones the source and replays each op; `verify_patch(patched, target)` confirms the round-trip is exact.

Every pairwise similarity run writes six files to `outputs/patches/<source>_to_<target>_<timestamp>/`:

| File | Contents |
|---|---|
| `source.json` | Original source document |
| `target.json` | Destination document |
| `edit_script.json` | Machine-readable list of ops |
| `edit_script.txt` | Human-readable script (one line per op) |
| `patched.json` | Result of applying the script to source |
| `summary.txt` | Run metadata + verification status |

The frontend then plays this back step-by-step — see [Patching tab](#patching-tab) below.

### Clustering algorithms

All four live in [`clustering/cluster.py`](clustering/cluster.py) and consume the precomputed 195×195 distance matrix.

#### Agglomerative (hierarchical, UPGMA by default)

```python
agglomerative(dist_array, names, distance_threshold=0.5, linkage="average")
```

Bottom-up — every country starts as its own cluster; pairs of clusters are merged until the merge distance exceeds `distance_threshold` (the dendrogram cut height). Linkage choices:

- **Average (UPGMA)** — mean of all pair distances. Robust against noise. **Recommended for non-Euclidean data like TED.**
- **Single (nearest)** — min pair distance. Chains through outliers; recovers non-globular shapes.
- **Complete (farthest)** — max pair distance. Tight compact clusters; sensitive to outliers.
- **Ward** — *explicitly blocked* — requires Euclidean geometry which TED doesn't have.

#### DBSCAN (density-based)

```python
dbscan(dist_array, names, eps=0.20, min_samples=3)
```

A country is a **core point** if it has ≥ `min_samples` neighbours within `ε`. Reachable points form a cluster; everything else gets label `-1` (noise). Useful ε range on this corpus: **0.15 – 0.30** (distance matrix values live in [0.08, 0.55]).

#### Spectral (graph-Laplacian)

```python
spectral(sim_array, names, n_clusters=k)
```

Operates on the **similarity** matrix directly (`affinity="precomputed"`). Embeds the country graph via eigen-decomposition of the Laplacian, then partitions via k-means in the embedded space.

#### K-Medoids (PAM — Partitioning Around Medoids)

```python
kmedoids(dist_array, names, n_clusters=k, n_init=10)
```

Pure-NumPy implementation. Like k-means but each cluster centre is a **real country** (the medoid — member with lowest sum of intra-cluster distances), not an abstract mean. Output includes the medoid name per cluster, so the UI labels every cluster card with "Medoid: France".

### Internal validation metrics

After clustering, [`app.py:run_clustering_api`](app.py) computes:

- **Silhouette score** — `(b − a) / max(a, b)` averaged across countries. Range `[-1, 1]`; closer to 1 = cleaner separation.
- **Davies-Bouldin index** — average ratio of within-cluster spread to between-cluster separation. Lower = better.

Both are surfaced as metric tiles on the results page.

---

## The wizard flows

### Similarity (7 steps)

| Step | What you do |
|---|---|
| 0 — Mode | Pairwise vs one-vs-all |
| 1 — Type | Structural (TED). Only option in the shipped build. |
| 2 — Countries | Search list + clickable world map. Map auto-pans/zooms to fit selection. |
| 3 — **Select Labels** | 8 section checkboxes with drill-in to leaf fields. Anything unchecked is pruned from the tree before TED runs. |
| 4 — Review Docs | Inspect rendered Wikipedia infobox, raw JSON, and typed tree of each selected country. Excluded labels show with strikethrough. |
| 5 — Compute | Configuration summary, then ▶ Run. |
| 6 — Results | Score panel + 5 tabs (Tree Diff, Patching, Edit Script, Field Scores, Tokens). |

### Clustering (6 steps)

| Step | What you do |
|---|---|
| 0 — Basis | Structural (TED). Only option in the shipped build. |
| 1 — Dataset | Country list / map. **Select All 195** works thanks to the precomputed matrix. |
| 2 — Algorithm | Agglomerative · DBSCAN · Spectral · K-Medoids |
| 3 — Parameters | Per-algorithm controls. The k slider hides itself for Agglo/DBSCAN; the distance-threshold slider only shows for Agglo. |
| 4 — Run | Config summary + ◎ Run. |
| 5 — Results | Metrics tiles + 6 visualisation tabs + cluster breakdown explainer. |

---

## Visualisations

### Patching tab

Three columns — Source · Live (Patched) · Target — rendered as JSON. The Live column mutates as each edit operation applies. Controls: **Reset · ← Step · ▶ Play · Step → · ⏭ Finish** plus a scrubber slider. Each step prints a one-line summary of the operation (kind + path + value delta).

### Dendrogram (Agglomerative default)

Horizontal binary tree — country names sit on the **right side** with horizontal text (no rotation), so even 195 leaves stay readable. X-axis shows merge distance with dashed gridlines. A yellow dashed line marks the current `distance_threshold` cut so you see exactly where the clusters are drawn.

### Similarity matrix (numeric table)

195×195 table with integer percentages in each cell. Rows/columns are **reordered by cluster** so cluster members sit adjacent — well-formed clusters appear as bright blocks. Thicker borders separate cluster boundaries. Sticky row/column headers; country labels coloured by cluster.

### 2D scatter (DBSCAN default)

Multi-Dimensional Scaling projection of the n×n distance matrix into 2D. Coordinates come from the precomputed `outputs/mds_coords.npz` atlas — no per-request MDS. Density patterns and outliers read best here, which is why DBSCAN defaults to this tab.

### Force graph (Spectral default)

D3 force-directed layout. Each country is a node coloured by cluster; edges connect members of the same cluster. **Zoom controls**: ＋ / − buttons, ⤢ Fit, ↺ Reset, plus mouse-wheel zoom, background-drag pan, and node-drag pinning.

### Map overlay

Leaflet world map. Every country gets a circle marker at its centroid, coloured by cluster. Lets you see whether geographic proximity correlates with cluster membership.

### Table (K-Medoids default)

One row per country, columns Country / Cluster / Medoid. Medoid rows are highlighted with a ⬡ glyph.

---

## HTTP API

### `GET /api/countries`

Returns the full country list with ISO codes, regions, and lat/lng centroids.

```json
{ "countries": [
  { "name": "Afghanistan", "code": "AF", "region": "Asia", "lat": 33.0, "lng": 65.0 },
  ...
]}
```

### `GET /api/country/<name>`

Returns one country's full document, generated XML representation, and tree stats.

### `POST /api/similarity`

Body:
```jsonc
{
  "mode":            "pairwise" | "one_vs_all",
  "type":            "structural",
  "countries":       ["France", "Germany"],
  "excluded_labels": ["history", "hdi"]   // optional
}
```

Returns a similarity score; for pairwise, also returns the full `patching` bundle (source / target / patched docs, step-by-step snapshots, on-disk artifact paths), an edit-script for the UI, per-field scores, and token analysis.

### `POST /api/patch`

Standalone patching endpoint for an explicit `(source, target)` pair. Body: `{ "source": "...", "target": "..." }`. Returns the same `patching` bundle without the surrounding similarity scores.

### `POST /api/clustering`

Body:
```jsonc
{
  "basis":     "structural",
  "algorithm": "agglomerative" | "dbscan" | "spectral" | "kmedoids",
  "countries": ["France", "Germany", ...],
  "params":    {
    "distance_threshold": 0.5,   // agglomerative
    "linkage":            "average",
    "eps":                0.20,  // dbscan
    "min_samples":        3,
    "k":                  8      // spectral / kmedoids
  }
}
```

Returns assignments, cluster members, medoids, MDS coordinates, dendrogram (agglomerative only), similarity matrix, evaluation metrics, and a workflow summary.

---

## Persisted artifacts

| Path | Format | Purpose |
|---|---|---|
| [`outputs/matrix.npz`](outputs/matrix.npz) | numpy `.npz` (`names`, `sim_array`, `dist_array`) | Precomputed 195×195 TED similarity + derived distance. Loaded at startup. |
| [`outputs/mds_coords.npz`](outputs/mds_coords.npz) | numpy `.npz` (`names`, `coords`) | Precomputed 195×2 MDS atlas. Loaded at startup. |
| `outputs/patches/<src>_to_<tgt>_<ts>/` | folder of 6 files per pairwise run | source · target · edit_script.json · edit_script.txt · patched.json · summary.txt |

If a cache file is deleted, the next server boot rebuilds it once (~5 s for the MDS atlas, ~60 s for the TED matrix) and re-saves it.

---

## Performance notes

| Operation | Time on 195 countries |
|---|---|
| Server cold start | ~5 s (one-time rebuild of MDS atlas) |
| Server warm start | < 1 s (everything loads from disk) |
| Pairwise TED + patching artifacts | ~30 ms |
| Slice 195×195 from cached matrix | 0.3 ms |
| MDS lookup (atlas) | < 1 ms |
| Full clustering call (any algorithm) | 30–60 ms |
| JSON serialisation of response | ~20 ms (≈ 800 KB payload) |

Clustering all 195 countries is now *faster* than displaying the spinner that announces it.

---

## Tech stack

| Layer | Tech |
|---|---|
| Backend | Python 3.11 · Flask · NumPy · SciPy · scikit-learn |
| Frontend | Vanilla JS · D3 v7 · Leaflet · CSS with OKLCH design tokens |
| Templating | Jinja2 |
| Persistence | Filesystem (numpy `.npz` for matrices, JSON for documents) |
| Algorithms | Zhang-Shasha (custom) · sklearn AgglomerativeClustering / DBSCAN / SpectralClustering · custom NumPy K-Medoids |

No build step, no node_modules, no database. Drop the repo on any machine with Python and run.

---

## Acknowledgements

- **Dr. Joe Tekli** — course material (COE 543 / 743 Ch. 4 Similarity, Ch. 5 Structural Similarity, Ch. 10 Data Clustering), and the project-1 framing that the patching pipeline implements.
- K. Zhang and D. Shasha, *Simple Fast Algorithms for the Editing Distance between Trees and Related Problems*, SIAM J. on Computing, 1989.
- M. Ester et al., *A Density-Based Algorithm for Discovering Clusters in Large Spatial Databases with Noise* (DBSCAN), KDD 1996.
- U. von Luxburg, *A Tutorial on Spectral Clustering*, Statistics and Computing 17(4), 2007.
- L. Kaufman and P. Rousseeuw, *Finding Groups in Data* (PAM / k-medoids), Wiley 1990.
- P. Rousseeuw, *Silhouettes*, J. Computational and Applied Mathematics 20, 1987.
- D. Davies and D. Bouldin, *A Cluster Separation Measure*, IEEE TPAMI 1979.
- Wikipedia infobox scraper — the original data extraction pipeline used to build `data/clean/countries`.

---

*SIMILICA · v1.0 · COE 543/743 · Spring 2026*
