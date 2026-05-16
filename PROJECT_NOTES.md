# Project Notes — Countries Similarity & Clustering

Session-level brain dump covering everything read, built, and tested in this
repository. Organised so a teammate (or future-you) can pick up cold.

---

## 1. Repository at a glance

| Path | Role |
|---|---|
| [Chapter/](Chapter/) | 7 course PDFs (LAU **COE 543/743** — Intelligent Data Processing, Spring 2026, J. Tekli) |
| [Reference/](Reference/) | 7 academic / industry papers backing the algorithms |
| [Project Proposals/](Project%20Proposals/) | The two graded deliverables for the course |
| [data/raw/all_countries.json](data/raw/all_countries.json) | Wikipedia-infobox scrape — 195 UN members, full schema |
| [data/cleaned-data/](data/cleaned-data/) | 195 per-country JSONs, hand-cleaned schema |
| [scripts/algoOriginal_clean_v2_with_patching_fixed.py](scripts/algoOriginal_clean_v2_with_patching_fixed.py) | Main algorithm (TED + diff + patch + clustering) |
| [outputs/](outputs/) | Generated diff scripts, patched trees, target snapshots |

The repo implements **Tree Edit Distance (TED)** between Wikipedia country
infoboxes, plus patching and clustering. It directly serves the two project
proposals.

---

## 2. Theoretical foundations

### 2.1 Chapters — detailed summaries

LAU course **COE 543/743 — Intelligent Data Processing and Applications**, Spring
2026, taught by Prof. Joe Tekli. Seven PDFs that walk from the abstract
notion of similarity through structural and semantic algorithms to the final
clustering layer.

---

#### Ch. 4 — Overview of Similarity Processing ([file](Chapter/Ch.%204%20-%20Overview%20of%20Similarity%20Processing%20(4).pdf))

The framing chapter. Establishes vocabulary and the three families every
subsequent chapter falls under.

**Formal definition.** Similarity is the inverse of a metric distance:

- `Sim(S₁, S₂) ∈ [0, 1]`
- `Sim(S₁, S₂) = 1` iff `S₁ ≡ S₂` (identical)
- `Sim(S₁, S₂) = 0` iff no shared characteristics
- Metric properties: reflexivity `Sim(S, S)=1`, symmetry, triangular
  inequality `Sim(S₁,S₃) ≥ Sim(S₁,S₂) × Sim(S₂,S₃)` (which is equivalent to
  `Dist(S₁,S₃) ≤ Dist(S₁,S₂) + Dist(S₂,S₃)`)

**Three categories of approaches** (the taxonomy the whole course uses):

1. **Edit-Distance based (CPM — Combinatorial Pattern Matching).**
   Rigorously structured, fine-grained, target is *data structure*. Applications:
   data-warehousing and structural clustering. → **Ch. 5**.
2. **IR-based (Vector Space Model).** Loosely structured, coarse-grained,
   target is *data content*. Applications: fast ranked querying. → **Ch. 7**.
3. **Other** — tag/edge/path-based, FFT, leaf-clustering, entropy, Bayesian.
   Usually approximations of TED. → **Ch. 6**.

**Edit-distance operation families** that differ in cost / quality:

- Insert/delete inner *and* leaf nodes — generic but `O(N²·D²)` (Zhang &
  Shasha).
- Insert/delete only leaf nodes, relabel anywhere — `O(N²)` (Chawathe).
- Add `insert_tree` / `delete_tree` / `move_tree` — sacrifices optimality but
  drops to `O(N log N)`.

**Current issues** identified — and addressed by the algorithm we built:

- *Enhancing structural similarity*: detect repetitions of similar sub-trees;
  compare sub-trees at different depths.
- *Integrating semantic similarity*: most existing TED methods ignore label
  semantics entirely. Need a hybrid that combines structure + meaning.

**Web-evolution context** (Tim Berners-Lee timeline): Web 1.0 (static docs) →
2.0 (collaborative / social) → 3.0 (semantic, RDF/OWL) → 4.0 (intelligent /
IoT). Every category in (1)–(3) above plays a role in this evolution.

> **Wired into our code as:** the overall three-family taxonomy. Our algorithm
> sits in family (1) — TED — but borrows the VSM idea from family (2) for
> `Sem_RBS` and the soft-fallback logic from family (3).

---

#### Ch. 5 — Structural Similarity ([file](Chapter/Ch.%205%20-%20Structural%20Similarity%20(4).pdf))

The core algorithmic chapter. Builds tree edit distance from string edit
distance.

**String Edit Distance — Wagner & Fisher (1974).**

Three operations on a string `S = s₁…sₘ`:

- `Ins(c, i)`: insert character `c` at position `i`
- `Del(c)`: remove `c`
- `Upd(c₁, c₂)`: replace `c₁` with `c₂`

Intuitive cost model: `CostIns = CostDel = 1`; `CostUpd(c₁, c₂) = 1` if
`c₁ ≠ c₂` else `0`. The DP matrix `Dist[i][j]` builds bottom-up:

```
Dist[i][j] = min(
    Dist[i-1][j-1] + CostUpd(A[i], B[j]),
    Dist[i-1][j]   + CostDel(A[i]),
    Dist[i][j-1]   + CostIns(B[j])
)
```

Complexity `O(|A|·|B|)` time and space. Maximum ED bounded by `|A| + |B|`.

**Two similarity formulas** derivable from ED — both used in our code:

- Unbounded: `Sim = 1 / (1 + ED)`
- Bounded: `Sim = 1 − ED / (|A| + |B|)` ← **our `normalized_similarity`**

**Tree Edit Distance.**

XML/JSON documents → Rooted Ordered Labelled Trees (ROLTs). `T[i]` = i-th
node in *preorder traversal*; `T[i].ℓ` = label; `T[i].d` = depth.

##### Chawathe (1999)

Direct adaptation of W&F. Pre-processing step: convert each tree to an
**ld-pair sequence** of `(label, depth)` pairs in preorder.

```
LD-pair(A) = ⟨("Faculty",0), ("Department",1), ("name",2), ("ECE",3), …⟩
```

Then apply the W&F DP on these sequences with three *heuristic conditions*:

1. **Update** allowed only when `A*[i].d == B*[j].d` (same depth).
2. **Delete** allowed when `A*[i].d ≥ B*[j].d` (so all descendants are
   deleted first).
3. **Insert** allowed when `A*[i].d ≤ B*[j].d` (parent inserted before
   children).

Operations: leaf insert, leaf delete, node update. **Complexity `O(|A|·|B|)`
= `O(N²)`.** The conditions trade optimality for speed: sub-tree
similarities are missed because the algorithm sees the tree as a string.

##### Nierman & Jagadish (2002) ← **our base algorithm**

Adds two complex operations to handle the missing sub-tree similarities:

- `InsTree(SbT, p, i)`: insert a whole sub-tree as the i-th child of `p`.
- `DelTree(SbT)`: delete a whole sub-tree.

**Contained-in relation.** Tree `T₁` is *contained in* `T₂` if every node
of `T₁` occurs in `T₂` with the same parent/child edge relationship and
relative order (additional nodes allowed in `T₂`).

**Cost model.**

- Atomic ops (Ins/Del/Upd on individual nodes): unit cost.
- `CostInsTree(SbT) = 1` if `SbT` is contained-in the source tree, else
  `Σ CostIns(n)` over all nodes — i.e. the sum of node-insert costs.
- Symmetric for `CostDelTree`.

Recursive DP over *first-level sub-trees*: each cell of the outer matrix is
itself a TED call on a child pair. Complexity still `O(N²)` overall plus a
pre-computation phase. Sub-tree repetitions get a cheap reorder cost.

> **Wired into our code as:** the entire `nj_ted_cost` function. The
> `contained_anywhere` check is our `contained-in` test; `REORDER_COST = 0.25`
> is the `InsTree`/`DelTree` cheap-cost branch.

---

#### Ch. 6 — Structural Similarity Approximations ([file](Chapter/Ch.%206%20-%20Structural%20Similarity%20Appoximations%20(3).pdf))

When TED is too slow, use a filter step to drop the cardinality before the
expensive measure. Filter-Refinement architecture:

```
sample S ─ filter (cheap)──→ candidates C ──refine (TED)──→ ranked answer
```

Filter must be **complete** (an upper bound of TED): `SimFilter ≥ SimTED`.

**Prerequisites** (set / multi-set / vector similarity formulas):

- **Jaccard** `|A ∩ B| / |A ∪ B|`
- **Dice** `2|A ∩ B| / (|A| + |B|)` — semi-metric (no triangular inequality)
- **Cosine** `(A · B) / (‖A‖·‖B‖) ∈ [-1, 1]`
- **PCC** like cosine but on centered vectors
- **Euclidean / Manhattan / Tanimoto** distances → similarity via
  `1 / (1 + Dist)`

**Approximation families:**

1. **Tag-based** — bag of element/attribute names. Set / multi-set / vector
   forms. Loses parent-child information.
2. **Edge-based** — ordered pairs `(parent, child)`. Captures parent-child
   but misses siblings.
3. **Path-based** — *root paths*, *all paths*, or *XPaths*. XPaths optionally
   encode sibling order.
4. **FFT** — encode tree as a time series, compare frequency spectra.
   Detailed below in §2.2.

All run in `O(N)` (or `O(N log N)` for FFT) but are less accurate than TED.

> **Wired into our code as:** none directly, but `Sem_RBS` borrows the
> vector-space idea from this family (subtree → label bag → vector → cosine).
> Could be added later as a filter step before TED for the 195×195 matrix.

---

#### Ch. 7 — Structure & Content Similarity ([file](Chapter/Ch.%207%20-%20Structure%20&%20Content%20Similarity(1)%20(1).pdf))

Traditional IR + its extension to semi-structured data.

**IR vs DB at a glance:**

| Axis | IR | DB |
|---|---|---|
| Data model | Loose / free text | Rigid schema |
| Query model | Keywords / natural language | SQL |
| Matching | Approximate | Exact |
| Result | Ranked | Unordered set |

**Vector Space Model (VSM).** Each document `D` and query `Q` becomes a
weighted vector `V_D` / `V_Q`. Dimensions = *indexing units* (terms).
Similarity = a vector measure (Cosine, PCC, Dice).

**TF-IDF weighting.** `w_D(t_i) = TF(t_i, D) × IDF(t_i, C)`:

```
TF(t_i, D)    = Freq_D(t_i)
IDF(t_i, C)   = log( N / DF(t_i, C) )
```

Variants normalise TF by `max(TF(D))` or apply `log(TF + 1)`.

**Data selection operators.**

- **Range query** `θ_R`: all docs within `ε` of the query.
- **kNN** `θ_kNN`: top-k closest.
- **Combined** range + kNN.

**Feature representations.**

- **N-grams** — contiguous n-token windows (character / word / amino-acid /
  base-pair). Useful when sequence matters.
- **Word-based syntactic** — tokenize → stop-word removal → stemming →
  bag-of-words vector.
- **Word-based POS** — tag tokens with grammar (NNP, VB, JJ, …) and build
  parse trees.
- **Word-based semantic** — disambiguate to a WordNet concept per token
  (covered in Ch. 9).

**Evaluation metrics** (the ones we re-use in the clustering module):

```
Precision = TP / (TP + FP)        ∈ [0, 1]
Recall    = TP / (TP + FN)        ∈ [0, 1]
F-value   = 2·PR·R / (PR + R)
```

Plus the PR-vs-R curve and Mean Average Precision (MAP) — `MAP =
(1/N)·Σ PR[j]·rel[j]` over the ranked hit list.

**Semi-structured IR extensions** (for the rest of the chapter): node
indexing, base/augmented vector models, single/multi-category retrieval,
term-in-context indexing, matrix model. All address the fact that semantic
text on the Web lives at *different levels* of the document tree, not in flat
prose.

> **Wired into our code as:** the precision/recall/F-value formulas in
> `compute_external_metrics`. The IDF-style weighting is a fix #3 in §7.3 of
> these notes — *not yet implemented*.

---

#### Ch. 8 — Semantic Similarity Evaluation ([file](Chapter/IDPA%20-%20Chap.%208%20-%20Semantic%20Similarity%20(1).pdf))

Two paradigms; we use the second.

**Corpus-based semantic analysis.** Premise: *semantically similar words
have similar syntactic distributions in a corpus*. Uses co-occurrence,
contextual lexico-syntactic patterns, statistical analysis, machine learning.
Limitations: depends on lexico-syntactic surface, requires huge corpora and
training data.

**Knowledge-based semantic analysis.** Premise: *predefined semantic
knowledge is required to identify semantic meaning.* Building blocks:

- **Controlled vocabulary** — ordered list of words with explicit meanings.
- **Taxonomy** — vocabulary in a tree (Is-A, Part-Of).
- **Thesaurus** — taxonomy + non-hierarchical links (Related-To, Attribute-
  Of, See-Also).
- **Ontology** — taxonomy/thesaurus + formal grammar (RDFS / OWL).

Each *concept* groups synonymous words and carries a *gloss* (textual
definition). The standard reference is **WordNet**.

**Three families of measures.**

##### Edge-based

```
SimEdge(c₁, c₂) = 1 − MinPath(c₁, c₂) / (2·MaxDepth(SN))
```

Treats every hop as uniform distance. Limitation: in a real semantic network
link distance varies with density, depth, link type, link direction, and
human perception. (E.g. Auto and Bicycle are both `Machine` children but
Auto is "more like" a car than a bicycle is.)

##### Node-based (Resnik, Lin)

Augments the taxonomy with **occurrence probability**:

```
p(c) = Freq(c) / N            where Freq(c) sums word occurrences of c and its descendants
IC(c) = −log p(c)             information content (information theory)
```

`Freq(c)` increases as we move up the hierarchy → root has `p=1`, `IC=0`
(maximally vague). Lowest Common Ancestor (LCA) of `c₁, c₂` is the
information they share.

**Resnik:** `SimNode(c₁, c₂) = IC(LCA(c₁, c₂))` — measures commonality only.

**Lin (1998):** improves by considering both commonality *and* difference:

```
SimLin(c₁, c₂) = 2·log p(LCA(c₁, c₂)) / ( log p(c₁) + log p(c₂) )
```

Increases with commonality (IC of LCA), decreases with difference (own ICs).
Lin's experiments show higher correlation with human judgement than Resnik.

##### Gloss-based (Lesk family)

```
SimGloss(c₁, c₂)  = |gloss(c₁) ∩ gloss(c₂)|                    (word overlap)
SimGloss+(c₁, c₂) = |gloss(c₁) LCS gloss(c₂)|                  (n²-weighted phrase)
SimGloss++(c₁, c₂) = |ext_gloss(c₁) LCS ext_gloss(c₂)|        where ext = gloss ∪ syn ∪ gloss(rel)
```

Banerjee–Pedersen's extended version: weight a *k-word* overlap as `k²`
because longer overlaps are exponentially rarer (Zipf-style).

**Mathematical properties.** Most semantic measures are *generalized
metrics / semi-metrics* — they fail triangular inequality:

> Tversky's example: Jamaica ≈ Cuba (geography), Cuba ≈ Russia (politics),
> but Jamaica ≢ Russia. Triangular inequality would predict otherwise.

> **Wired into our code as:** SBERT cosine plays the same role as
> `SimLin` — it is plug-compatible because of Tekli's note that "the measure
> used is not a sensitivity of the algorithm; any decent similarity will do."
> The `Sem_RBS` mean-pool is conceptually a gloss-overlap analogue applied to
> sub-tree label bags.

---

#### Ch. 9 — Semantic Disambiguation ([file](Chapter/Ch.%209.%20Semantic%20Disambiguation%20(1).pdf))

Word Sense Disambiguation (WSD) = pick the right concept for a polysemous
word given context.

Brief history: 1940s Weaver (machine translation) → 1970s rule-based →
1980s large lexical resources → 1990s knowledge-based → 2000s
supervised learning at human accuracy → today hybrid (knowledge + corpus).

WSD is an *intermediate* task — feeds machine translation, IR, named-entity
resolution, text classification.

**Five elements** every WSD method has to specify:

1. **Word selection** — *all-words* (exhaustive but slow) vs *lexical-sample*
   (target a few ambiguous words per sentence).
2. **Context representation** — window of `k` words around target; or POS
   tags + dependency parse; or full bag-of-words.
3. **Reference knowledge** — *corpus-based* (SemCor, OntoNotes — sense-
   tagged) or *knowledge-based* (WordNet, Yago).
4. **Sense association** — *supervised* (ML on tagged corpus) or
   *unsupervised* (compare to KB).
5. **Semantic-similarity measure** for matching the target word's context to
   each candidate sense.

**Lesk's algorithm.** Pick the sense whose gloss overlaps most with the
glosses of the surrounding words.

Example for keyword query `pine cone`:

```
overlap(pine#1 "evergreen tree", cone#3 "fruit of certain evergreen tree") = 2
                                                                              ↑ selected pair
```

**Problem:** combinatorial explosion. `"I saw a man who is 98 years old…"`
with 9 ambiguous words → 43 929 600 sense combinations.

**Simplified Lesk.** Don't disambiguate every word — only the target. For
each candidate sense of the target, compute overlap with the *raw text
context*. Cheap and surprisingly effective.

**WSD for semi-structured data.** Tags are subjective (`<star>` could mean
celestial body, champion, lead actor, plane figure, network topology…).
Need to combine structural and lexical context. The chapter motivates the
hybrid algorithms in Ch. 10 / Journal_7.

> **Wired into our code as:** not directly invoked, but the SBERT model
> implicitly disambiguates labels by embedding them in context-aware vector
> space, which is the modern stand-in for Lesk + WordNet.

---

#### Ch. 10 — Data Clustering ([file](Chapter/Ch.%2010.%20Data%20Clustering%20(4).pdf))

The Project 2 backbone.

**Definition.** Find groups such that *intra-cluster similarity is high* and
*inter-cluster similarity is low*. Unsupervised — no labels.

**ML paradigms:**

- *Supervised*: training pairs `(X, y)` → learn `h ≈ f`. Classification (when
  `y` is categorical) or regression (numeric).
- *Unsupervised*: clustering + feature extraction + dimension transform/
  reduction (PCA, ICA).

**Cluster types** (helpful for choosing an algorithm):

1. **Well-separated** — every object closer to its cluster than to any other.
2. **Center-based** — closeness to a centroid (mean) or medoid
   (representative member).
3. **Contiguous** — closer to *one or more* in-cluster objects.
4. **Density-based** — dense region surrounded by low density. Handles noise.
5. **Shared-property / conceptual** — common attribute.

**Two ingredients.** (a) similarity / distance measure, (b) clustering
algorithm. Similarity is *feature-dependent* — same data clustered on
different features gives different groupings.

**Algorithm families.**

##### Partitional — K-means

```
1. Pick k initial centroids (random or heuristic).
2. Repeat:
   2a. Assignment: each point → nearest centroid.
   2b. Update: centroid := mean of its points.
3. Until convergence (no membership change, or SSE delta < ε).
```

Sum of Squared Error: `SSE = Σ_i Σ_{x ∈ C_i} Dist(x, m_i)²`. Lower = tighter
clusters. Complexity `O(n·k·i)` time, `O(n)` space.

Pros: simple, fast. Cons: needs `k`, sensitive to initial centroids
(converges to local optimum), can't handle non-globular shapes or noise.

##### Hierarchical — Agglomerative & Divisive

Produces a **dendrogram** (binary tree where leaves are data, internal nodes
are clusters, branch length is merge distance).

- **Agglomerative (bottom-up):** start with `n` singleton clusters; merge the
  closest pair; repeat until 1 cluster or a stopping rule fires.
- **Divisive (top-down):** start with one cluster; split using a partitional
  sub-routine; repeat.

Intra-cluster similarity options:

- **SSE** (lower = tighter)
- **PGMA** (Pair Group Method Average): `(1/N_i)·Σ Sim(x_p, x_q)` over all
  in-cluster pairs.

Inter-cluster similarity options (drives merge order):

- **Single Link** — max similarity. Long thin clusters, handles non-globular.
- **Complete Link** — min similarity. Compact clusters, breaks large ones.
- **Average Link** — mean similarity. Most robust, biased toward globular.

Complexity `O(n²·log n)` time, `O(n²)` space. Decisions are irreversible.

##### Density-based — DBSCAN

Inputs: neighbourhood radius `ε`, min points `minPts`. Classifies each point
as **core** (≥ `minPts` neighbours), **border** (reachable from a core), or
**outlier**. Expands clusters from cores. Pros: no `k`, handles non-globular,
detects noise. Cons: needs `ε` and `minPts`, `O(n²)` worst case.

##### Fuzzy — C-means

Same skeleton as k-means but each point has a *membership degree* per
cluster. Updates centroids as weighted means. Hard partition = argmax of
memberships.

##### Other — incremental, constrained agglomerative, spectral

- **Incremental**: stream model. Each new point either joins the most similar
  cluster or seeds a new one. `O(n)` time. Lower quality.
- **Constrained agglomerative**: partitional pre-clustering produces
  constrained sets; agglomerative builds a dendrogram inside each.
- **Spectral**: eigen-decomposition of similarity matrix → low-dim
  representation → cluster there.

**Evaluation.**

- **Internal** (no labels needed):
  - *Davies–Bouldin index*: `DB = (1/k)·Σ max_{i≠j} (σ_i + σ_j)/Dist(m_i, m_j)`.
    Lower = better.
  - *Dunn index*: `min_{i≠j} InterDist(C_i,C_j) / max_r IntraDist(C_r)`.
    Higher = better.
  - *Silhouette* (our choice): `(b − a)/max(a, b)` per point, average over
    cluster. Higher = better.
- **External** (need reference labels):
  - For each cluster `C_i` count `a_i` correctly assigned, `b_i`
    miss-clustered, `c_i` missed.
  - `Precision = Σa_i / Σ(a_i + b_i)`
  - `Recall    = Σa_i / Σ(a_i + c_i)`
  - `F-value   = 2·PR·R / (PR + R)`
  - **Purity** (Bodinga et al. variant we used): for each cluster, the
    fraction belonging to its majority class; averaged weighted by cluster
    size.
  - **Entropy**: `(1/log q)·Σ (N_i^r / N_i)·log(N_i^r / N_i)`. Lower = better.

> **Wired into our code as:** `agglomerative_cluster` (single / complete /
> average / ward), `kmeans_cluster` (via MDS), `compute_internal_metrics`
> (silhouette + intra-cluster mean dist), `compute_external_metrics` (purity
> / entropy / F-value), `export_dendrogram`.

---

### 2.2 Reference papers — detailed summaries

Seven papers. Three are by Tekli & collaborators and form the spine of the
algorithm; the other four supply orthogonal techniques (FFT, attribute-value
trees, fuzzy strings, BERT clustering).

---

#### Journal_7 — *A Novel XML Document Structure Comparison Framework based on Sub-tree Commonalities and Label Semantics* (Tekli & Chbeir) ([file](Reference/Journal_7.pdf))

The main paper. Defines the hybrid framework we now implement. Four
modules feeding each other:

##### 1. Struct_CBS — structural commonality between sub-trees

Detects the structural similarity that Chawathe and Nierman & Jagadish
miss. Runs W&F-style ED on ld-pair representations of *sub-trees* (not full
trees), but disables the update operation so the cost is purely Ins/Del.

```
StructCom(SbT_i, SbT_j) = set of node pairs (a_r, b_u) where
    a_r.label = b_u.label, a_r.d = b_u.d, and relative order is preserved.

|StructCom| = (|SbT_i| + |SbT_j| − Dist[|SbT_i|][|SbT_j|]) / 2

Struct_CBS = |StructCom| / max(|SbT_i|, |SbT_j|)     ∈ [0, 1]
```

Captures four scenarios that Nierman & Jagadish miss: repetition of similar
sub-trees, sub-trees at different depths, sub-tree-vs-whole-tree similarity,
and leaf-node repetition.

##### 2. Sem_RBS — semantic resemblance between sub-trees

Each sub-tree is turned into a *semantically weighted vector*. Dimensions =
distinct node labels in the union of the two sub-trees.

For node `v_r` of label `ℓ_r` in `SbT_i`:

```
w(v_r ∈ V_i) = SimLabel(ℓ_r, V_j) · D-factor(v_r)
```

where

```
SimLabel(ℓ, V) = max over v ∈ V of SimSem(ℓ, v.label)        ← Lin's measure
D-factor(v)    = 1 / (1 + v.d)                              ← depth attenuation
Sem_RBS(SbT_i, SbT_j) = Cos(V_i, V_j)
```

Result: root-level matches matter more than leaf-level; identical labels
contribute weight 1·D-factor; semantically related labels contribute
fractionally; unrelated labels contribute ~0.

##### 3. TOC — Tree Operations Cost

Combines (1) and (2) into a single sub-tree similarity score:

```
SS(SbT_i, SbT_j, α) = α · Struct_CBS + (1 − α) · Sem_RBS        α ∈ [0, 1]
```

`α` is **user-tunable** — `α = 1` is purely structural (existing methods),
`α = 0` is purely semantic, in between is hybrid. Then:

```
CostInsTree(SbT_i)   = min(
    Σ over nodes in SbT_i of CostIns(x),         ← maximum cost (nothing matched)
    min over SbT_j ⊆ B of [
        Σ CostIns(x) / (1 + SS(SbT_i, SbT_j))    ← cheaper if a similar sub-tree exists in B
    ]
)
```

Symmetric for `CostDelTree`. Maximum tree-op cost = sum of node-op costs (=
`|SbT|`). Minimum = half of max. This guarantees tree operations are never
cheaper than the cheapest single node operation.

##### 4. TED — adapted Nierman & Jagadish

Same recursive DP as N&J, but with the new TOC costs **and** a depth-aware
update cost:

```
CostUpd(a, b, α) =
    D-factor(a.d) / (1 + D-factor(a.d)) · [1 − (1 − α) · SimLabel(a, b)]    if a.ℓ ≠ b.ℓ
    0                                                                       otherwise
```

Final similarity:

```
SimXDoc(A, B) = 1 − TED(A, B) / (|A| + |B|)
```

**Properties.** Generalized metric — verifies reflexivity, minimality,
symmetry, but **not** triangular inequality (because of Lin's measure
inside; see Tversky's Jamaica example).

**Complexity.** `O(|A|·|B|·|SN|·Depth(SN))` where SN is the semantic
network. Drops to `O(|A|·|B|)` when semantics is off (`α = 1`).

**Formal lower-bound theorems** (proven in the paper):

- `SimChawathe(A, B) ≤ SimXDoc(A, B)` for all A, B.
- `SimDalamagas(A, B) ≤ SimXDoc(A, B)` for all A, B.

Meaning: our method always sees *at least* as much similarity as Chawathe
or Dalamagas, because we exploit sub-tree similarities they miss.

> **Wired into our code as:** the algorithm. `Struct_CBS` is implicit in our
> `contained_anywhere` + soft-reorder path; `Sem_RBS` is the
> `subtree_semantic_vector` + `sem_rbs` pair; `TOC` is the
> `_soft_reorder_cost` interpolation; `TED` is `nj_ted_cost` with the
> updated `cost_upd` (D-factor + section-mismatch + STRUCTURE_MISMATCH).
> The `α` knob is implicit — we set it via the `USE_SEMANTIC_SUBTREES`,
> `USE_DEPTH_FACTOR`, and the various multipliers.

---

#### tekli_Conf_14 — *A Hybrid Approach for XML Similarity* ([file](Reference/tekli_Conf_14.pdf))

The conference precursor to Journal_7. Smaller scope: combines Chawathe's
TED with a **Semantic Cost Model (SCM)** for the three node-level operations.

```
CostSem_Upd(x, y)  = 1 − SimSem(x.ℓ, y.ℓ)
CostSem_Ins(x)     = 1 − SimSem(ℓ, p.ℓ)        p = parent
CostSem_Del(x)     = 1 − SimSem(x.ℓ, p.ℓ)
CostDepth_Op(x)    = 1 / (1 + x.d)
CostOp(x, y)       = CostSem_Op(x, y) · CostDepth_Op(x)
```

Sample experimental result: `SimSCM(A, B) = 0.7361` vs `SimSCM(A, C) =
0.4418` — proves that adding semantics distinguishes "Academy/College" from
"Academy/Factory" where pure structure rates them identically.

Validated against a WordNet-based taxonomy of 677 nodes. Storage detail:
semantic similarities are pre-computed once and stored in an indexed Oracle
table (~0.25 s saved per pair).

> **Wired into our code as:** the conceptual seed for `cost_upd`'s D-factor
> multiplication. Our SBERT `1 − cos` plays the same role as `1 − SimSem`.

---

#### tekli_Inter_Work_3 — *XS3 Prototype: Semantic and Structure Based XML Similarity* ([file](Reference/tekli_Inter%20Work_3.pdf))

A workshop demo of the **XS3** tool (C#). Four components:

- **Validation** — XML well-formedness, transforms to ld-pair rep.
- **Edit distance** — Chawathe + SCM (above paper).
- **Synthetic XML generator** — accepts a DTD + `MaxRepeats` + `NbDocs`.
- **Taxonomic analyzer** — computes Lin's semantic similarity between
  nodes in a stored taxonomy.

Four comparison modes: 1/1, 1/∞, ∞/∞ (enables clustering), and *set
comparison* (average inter-set / intra-set similarity, used in
clustering-quality experiments).

> **Wired into our code as:** the architectural blueprint. Our
> `compare_countries` ↔ 1/1, `build_distance_matrix` ↔ ∞/∞, and the
> hybrid SBERT cache plays the role of the indexed Oracle table.

---

#### Flesca et al. — *Detecting Structural Similarities Between XML Documents* ([file](Reference/detecting-structural-similarities-between-xml-documents-4okp38pxoq.pdf))

A completely different approach: turn the tree into a *time series* and
compare via Fourier transform.

##### Pipeline

1. **Skeleton.** Sequence of open/close tags in preorder.
   ```
   ⟨<a>, <b>, <c>, </c>, <d>, </d>, </b>, </a>⟩
   ```
2. **Tag encoding γ.** Inject distinct tag names to integers (random or by
   nesting level). *Symmetric* version: `γ(</t>) = −γ(<t>)`. Recommended:
   the **multilevel** encoding:
   ```
   S_i = γ(t_i)·B^(maxdepth − l_ti) + Σ_{t_j ∈ nest(t_i)} γ(t_j)·B^(maxdepth − l_tj)
   ```
   with `B = |tnames| + 1` — guarantees losslessness (Without Structural
   Loss = WSL).
3. **Time series.** Each tag occupies one unit of time; the impulse height
   is `S_i`.
4. **DFT.** Take the magnitude spectrum.
5. **Distance.**
   ```
   dist(d₁, d₂) = √( Σ_k (|DFT(h₁)|_k − |DFT(h₂)|_k)² )
   ```

##### Properties

Complexity `O(N log N)` — faster than TED. Parseval's theorem makes energy
invariant, so length differences don't dominate.

Experimental results: tested on synthetic DTDs and real corpora (NASA
astronomy, ACM SIGMOD, LIXTO wrapper). Multilevel encoding sharply
distinguishes documents with similar DTDs from those with different DTDs.

> **Wired into our code as:** not used. Listed as a candidate filter step
> for future scaling (per Ch. 6 filter-refinement architecture).

---

#### Candillier et al. — *Transforming XML trees for efficient classification and clustering* (INEX'05) ([file](Reference/INEX05.pdf))

Sidesteps tree-edit-distance entirely. Maps every XML tree to a flat
attribute-value vector, then applies off-the-shelf supervised / unsupervised
methods.

##### Five attribute classes

1. **A₁ — Tags.** Bag of element names.
2. **A₂ — Parent–child relations.** Bag of `(parent, child)` pairs.
3. **A₃ — Next-sibling relations.** Bag of `(left, right)` sibling pairs.
4. **A₄ — Node positions.** Tree paths coded `0.1.2`; attribute value =
   arity (child count) at that position.
5. **A₅ — Paths.** All sub-paths from the root.

For a given training set, every attribute that appears at least once becomes
a column. Values = occurrence counts (or arities for A₄).

##### Algorithms

- **Boosted C5** classifier (Quinlan) — uses C5.0 + 10 boosting rounds.
- **SSC (Statistical Subspace Clustering)** — mixture of Gaussians via EM,
  with a *hard feature-selection* step that keeps the most-informative
  dimensions per cluster:
  ```
  W_kd = 1 − σ²_kd / σ²_d
  ```
  Higher weight ⇒ tighter intra-cluster spread on dimension `d` relative to
  the global spread. Cluster description = the smallest rule (in fewest
  dimensions) that recovers the cluster's support.

##### Results on the INEX 2005 collections

Error rates 0.011–0.062 across `inex-s` and `m-db-s-{0..3}` with growing
noise — robust.

> **Wired into our code as:** not used. The A₂–A₅ attributes are conceptual
> precursors to using subtree label-bags / path-bags as feature vectors,
> which is *exactly* what `Sem_RBS` does for sub-trees (just with continuous
> SBERT embeddings instead of discrete counts).

---

#### Javadi-Moghaddam & Kollias — *A Fuzzy Similarity Measure for XML Documents* ([file](Reference/icencct2013_submission_2.pdf))

Linear-time, fuzzy-set based.

##### Pipeline

For each XML document:

1. Build three views of the tree:
   - **Ordered Labeled Tree** (semantics) — labels = element/attribute names.
   - **Level Labeled Tree** (position) — labels = depth numbers.
   - **Weighted Tree** (path emphasis) — root weight 1; each child weight =
     parent's weight / (# of siblings + a depth correction).
2. **DFS traversal** of each → three strings:
   - **ES** — Element String (semantic order)
   - **NS** — Numeral String (depth sequence)
   - **WS** — Weight String (path influence factor)

##### Similarity

Sørensen–Dice on character bigrams:

```
Dice(x, y) = 2·n_t / (n_x + n_y)        n_t = bigrams in both, n_x / n_y in each
```

Structure similarity = Dice on NS bigrams. Content similarity uses ES + WS
through a **fuzzy set** where membership = weight from WS, and intersection
uses Zadeh's `min`. Equality of labels can be combined name/value:

```
Eql(S₁, S₂) = λ · E_name(S₁, S₂) + (1 − λ) · E_value(S₁, S₂)
```

with WordNet for the name half. Final score:

```
FSim(d_x, d_y) = CSim · W_c + SSim · W_s         W_c + W_s = 1
```

Both weights are user-tunable.

##### Properties

Complexity `O(2n)` — linear in tree size. Tested on Lotus Hill image
annotations: intra-category similarity > inter-category as expected, with
0.5 as a clean threshold.

> **Wired into our code as:** the `W_c + W_s = 1` weighting idea matches the
> Tekli `α` and our `_soft_reorder_cost` interpolation. The bigram-Dice trick
> is not used — we rely on SBERT instead.

---

#### Bodinga et al. (2024) — *WEClusterX: BERT-based XML clustering* ([file](Reference/AN%20EFFECTIVE%20XML%20DOCUMENTS%20120-140.pdf))

State-of-the-art (2024) BERT-driven clustering for *heterogeneous* XML
collections.

##### Pipeline

1. **Pre-process.** SAX parse → text token extraction → stop-word removal →
   stemming (e.g. `banking → bank`) → drop tokens with `len < 3`.
2. **Embed.** Run pre-trained `bert-base-uncased` over each sentence →
   768-dim vector per sentence. Drop stop-word / punctuation / digit
   embeddings.
3. **Cluster the embeddings.** Stack all `(n, 768)` sentence vectors, run
   k-means with `k = k_conc` chosen by elbow → vocabulary of "concepts"
   (each is a centroid in embedding space). Vocabulary size drops from tens
   of thousands of words to fewer than a hundred concepts.
4. **Build the Context–Document matrix.** For each document `d_i` and
   concept `c_j`, score by TF-IDF over the tokens that map to that
   concept:
   ```
   CD_ij = Σ_t TF-IDF(W_jt)                    t = tokens belonging to concept c_j in d_i
   TF       = freq(W_jk)
   IDF(W)   = log((|D| + 1) / (doc_count(W) + 1)) + 1
   ```
5. **Final clustering.** k-means on the `(|D| × |concepts|)` matrix.

##### Evaluation

Datasets: Niagara (496), DBLP (4 910), Publication (5 289). All
heterogeneous (multiple structures per dataset). Metrics: purity and
entropy.

Results: WEClusterX outperforms the Samadi & Ravana (2023) baseline:

| Dataset | Purity (baseline → WEClusterX) | Entropy (lower better) |
|---|---|---|
| Niagara | 0.856 → **1.000** | 0.458 → **0.232** |
| DBLP | 0.842 → **0.970** | 0.264 → **0.151** |
| Publication | 0.911 → 0.961 | 0.159 → 0.243* |

(*entropy slightly worse on the smallest dataset because there are fewer
contexts to cluster cleanly — they note this in §5.)

> **Wired into our code as:** the BERT idea — we use SBERT (sentence-
> transformers) instead of raw BERT, which is essentially the
> production-friendly sibling. The mean-pooled embedding in
> `subtree_semantic_vector` is the same shape as their per-sentence vector,
> just over labels instead of full text. Their *concept vocabulary* idea is
> a natural extension we haven't implemented — could replace SBERT cosine
> with concept-cluster membership for richer Sem_RBS scoring on the full
> 195-country dataset.

---

## 3. Project proposals

### 3.1 [Project 1 — Wikipedia Infobox Comparison & Differencing](Project%20Proposals/Project%201%20Proposal%20-%202026%20(3).pdf)

Build a tool that, for any two UN-member countries, reports:

1. **Pre-processing** — Wikipedia infobox → rooted ordered labelled tree.
   Attributes appear sorted before sub-elements. Textual values either as a
   single text node or per-token; the choice must be justified.
2. **TED algorithm** — Chawathe or Nierman & Jagadish. Outputs a numeric
   distance / similarity.
3. **Edit-script extraction** — back-trace the DP matrix to produce a readable
   diff (own syntax, or DeltaXML / XyDiff style).
4. **Patching** — apply diff(T1, T2) to T1 to reconstruct T2.
5. **Post-processing** — patched tree → JSON → infobox-flavoured text.

Driving questions: *How similar are A and B? How are they similar? What would
it take to transform A into B?*

Due **2026-03-24** — 5-page report + 10-min demo per group.

### 3.2 [Project 2 — Wikipedia Infobox Clustering Tool](Project%20Proposals/Project%202%20Proposal%20-%202026%20(5).pdf)

Build on Project 1's similarity measure to:

- Build a pairwise similarity matrix over the country corpus.
- Implement **two** clustering algorithms (partitional, agglomerative,
  divisive, spectral, …).
- Allow user to tune all parameters.
- Bonus: dendrogram visualisation + internal/external evaluation metrics.

Driving question: *Which countries naturally group together?*

Same submission format. End-of-semester demo.

---

## 4. Algorithm architecture (`algoOriginal_clean_v2_with_patching_fixed.py`)

### 4.1 Data preprocessing pipeline

```
raw JSON
  └─> _unwrap_raw_item       (flatten {country, url, infobox} → flat dict)
        └─> load_dataset
              └─> DatasetNumericNormalizer.fit
                    └─> normalize_document     (detect numeric fields, quantile-rank or min-max)
                          └─> build_tree_from_country_json   (canonical-sorted children, depth-tracked)
                                └─> TreeNode root
```

Key design choices:

- **Canonical sort** of dict children at build time so cross-country DP
  alignment is stable (the original Python dict insertion order varied between
  files).
- **Quantile-rank** normalisation for long-tail numeric fields (GDP,
  population, area, density) — `bisect_left + bisect_right` rank.
- **spaCy** schema-normalisation helpers exist for legislature / language /
  religion but are flag-gated off (`USE_SCHEMA_NORMALIZATION = False`) — the
  cleaned-data already covers those buckets.

### 4.2 Tree representation

[`TreeNode`](scripts/algoOriginal_clean_v2_with_patching_fixed.py#L13-L65)
carries: `label`, `raw_value`, `norm_value`, `norm_number`, `kind`
(`internal` | `atomic_text` | `numeric`), `top_section`, `numeric_field`,
`patch_id` (stable across mutations), `depth`, `children`.

### 4.3 Tree Edit Distance

Nierman & Jagadish (2002) style:

- **Atomic ops** — `update_node`, `update_value` (single-node).
- **Tree ops** — `insert_tree`, `delete_tree`.
- **`contained_anywhere`** memoised short-circuit → cheap `REORDER_COST` when
  a sub-tree already lives somewhere in the other side.

The cost model:

```
cost_upd(a, b)        = (label_cost × {structure × section × D-factor}) + value_cost
cost_ins_tree(s, A)   = REORDER_COST                            (s contained in A)
                        soft_reorder_cost(s, sem_score)         (Sem_RBS ≥ 0.80)
                        INSERT_DELETE_PENALTY_MULTIPLIER × |s|  (otherwise)
cost_del_tree         (symmetric)
```

`label_cost = 1 - hybrid_similarity(a.label, b.label)` where the hybrid is
`max(Levenshtein_ratio, SBERT_cosine)` using `all-MiniLM-L6-v2`.

### 4.4 Patching & verification

- `_assign_patch_ids` walks the source tree pre-order, attaches `n000001`-style
  ids.
- `recover_edit_script` back-tracks the DP matrix into a JSON op list with
  `path`, `cost`, `subtree`, `source_uid` / `parent_uid`.
- `apply_edit_script_to_tree` applies **deletes (deepest-first)** →
  **updates** → **inserts (left-to-right within a parent)**, resolving nodes by
  `patch_id` to survive sibling drift.
- `verify_patch` re-runs TED on `(patched_tree, target_tree)`; reports
  `exact_match` when distance is 0.

### 4.5 Clustering module (Project 2)

| Function | Purpose |
|---|---|
| `build_distance_matrix` | Fits normaliser once, builds all trees, batch-warms SBERT cache, fills full N×N matrix |
| `agglomerative_cluster` | `scipy.cluster.hierarchy.linkage` + `fcluster` (single / complete / average / ward) |
| `kmeans_cluster` | `sklearn.manifold.MDS` → `sklearn.cluster.KMeans` |
| `compute_internal_metrics` | silhouette + intra-cluster mean distance |
| `compute_external_metrics` | **purity, entropy, F-value** vs. a reference grouping |
| `export_dendrogram` | matplotlib PNG of the agglomerative linkage |
| `run_clustering_pipeline` | end-to-end: matrix → cluster → metrics → report |

---

## 5. What changed in this session (refactor delta)

Preserved every prior decision (SBERT label similarity, custom cost
multipliers, patch-id resolution). The additions:

1. **Tekli D-factor** — `1 / (1 + depth)` multiplies label-update cost, so
   root-level relabels hurt more than deep-leaf relabels.
2. **Section-mismatch guard** — extra multiplier on `cost_upd` when
   `a.top_section != b.top_section`, blocks pathological cross-section pairings.
3. **Canonical key sort** at build time — kills phantom reordering edits.
4. **`Sem_RBS` sub-tree resemblance** — label-bag → mean-pooled SBERT vector →
   cosine. Used as a **soft fallback** when the strict `contained_anywhere`
   check fails, so semantically-equivalent sub-trees (e.g. `Area` blocks with
   different numbers) get a cheap reorder cost instead of full insert/delete.
5. **Section-level diff rollup** — `summarize_edit_script_by_section` so the
   reader can see *where* the cost is concentrated at a glance.
6. **Project 2 clustering module** — fully new code, runnable via
   `--mode cluster`.
7. **`_unwrap_raw_item`** — pipeline now accepts the raw
   `{country, url, infobox}` scrape with no extra adapter.
8. **CLI dispatch** — `--mode compare|matrix|cluster`, plus `--k`, `--linkage`,
   `--clustering`, `--reference-labels`, `--countries`.

The refactor brought the script from 2020 → 2715 lines. Backward-compatible:
default mode is still `compare` with `--a` / `--b`.

---

## 6. Test results

### 6.1 Project 1 — Compare / patch round-trip

| Pair | Source | Tree A | Tree B | Distance | Similarity | `exact_match` |
|---|---|---|---|---|---|---|
| Lebanon ↔ Switzerland | cleaned | 45 | 38 | 15.77 | 0.905 | ✓ |
| France ↔ Germany | cleaned | 34 | 29 | 11.01 | 0.913 | ✓ |
| United States ↔ China | cleaned | 46 | 41 | 35.42 | 0.796 | ✓ |
| Lebanon ↔ Switzerland | raw | 70 | 73 | 37.35 | 0.869 | ✓ |
| **Vatican City ↔ Russia** | cleaned | **21** | **41** | **21.59** | **0.826** | ✓ |

All patch round-trips work — `distance_after_patch == 0` regardless of input.

### 6.2 Project 2 — 11-country cluster, k=3, vs Europe/MiddleEast/Asia reference

| Dataset | Algo | Silhouette | Purity | Entropy | F-value |
|---|---|---|---|---|---|
| cleaned | agglomerative (avg) | 0.425 | 0.818 | 0.501 | 0.791 |
| cleaned | kmeans | 0.425 | 0.818 | 0.501 | 0.791 |
| raw | agglomerative (avg) | 0.239 | 0.636 | 1.246 | 0.621 |
| raw | kmeans | 0.326 | 0.455 | 1.354 | 0.533 |

Observations:
- Cleaned data outperforms raw substantially — confirms the cleaning step
  removes real noise (per-country sections like `Codes`, formatted Wikipedia
  values, divergent `History` sub-trees).
- On cleaned data the two algorithms agree perfectly. On raw they diverge —
  useful talking point for Project 2's discussion section.

---

## 7. Known issue — cost-model produces inflated similarity for size-asymmetric pairs

Discovered while spot-checking: **Vatican City vs Russia ≈ 0.826** is clearly
wrong. They share almost nothing — different government, language, religion
distribution, area (six orders of magnitude apart), population (five orders),
GDP scale, demographics, geography.

### 7.1 Root cause — the similarity denominator

```python
similarity = 1 - distance / (INSERT_DELETE_PENALTY_MULTIPLIER × (|A| + |B|))
           = 1 - 21.59 / (2 × (21 + 41))
           = 1 - 21.59 / 124
           = 0.826
```

The denominator `max_cost = 2 × (|A| + |B|)` represents the **worst case**: delete
every Vatican node, then insert every Russia node. That bound is far too
generous — even a totally unrelated tree pair rarely approaches it because
matching anything (even loosely) is cheaper. The result is a **floor effect**:
similarity is pulled toward ~0.8 for nearly every pair.

For Vatican vs Russia specifically:
- Russia has 7 sections / sub-trees that Vatican lacks entirely (`Ethnic
  Groups`, `GDP Nominal`, `Gini`, `HDI`, more `Religions` branches, more `Area`
  fields). Each is inserted as a sub-tree at cost `2 × size`.
- That's the dominant chunk of the 21.59 distance.
- But the denominator is dragged up to 124 by Russia's larger size — so the
  inserted material looks *smaller* than it really is, relative to the
  comparison.

### 7.2 Contributing flaws beyond the denominator

1. **No information-content weighting.** Inserting `GDP Nominal` (a deeply
   informative section) and inserting an extra item in `Government structure`
   cost the same flat `2 × size`. A top-level section completely missing from
   one side should be much more expensive than a leaf-level field tweak.
2. **D-factor isn't applied to tree ops.** It is applied to `cost_upd`, but
   `cost_ins_tree` / `cost_del_tree` ignore depth. A whole missing section
   (depth 1) carries the same flat penalty per-node as a missing leaf at depth
   4.
3. **`Sem_RBS` softens insertion cost too aggressively.** Vatican's `GDP PPP`
   sub-tree and Russia's `GDP PPP` sub-tree share the same labels — the soft
   reorder cost drives that down to ~`REORDER_COST`, masking the fact that the
   numeric *values* are eight orders of magnitude apart.
4. **Section guard isn't reciprocal.** It blocks bad updates but does not
   penalise missing sections.

### 7.3 Suggested fixes (in priority order)

| # | Fix | Where | Effect |
|---|---|---|---|
| 1 | Replace `max_cost = 2 × (|A|+|B|)` with `max_cost = 2 × max(|A|, |B|)` — anchor to the larger tree so similarity actually has to *cover* the larger side | `normalized_similarity` | Pulls Vatican/Russia from 0.826 toward ~0.65 immediately |
| 2 | Apply **D-factor inside `cost_ins_tree` / `cost_del_tree`** (sub-tree-at-depth-1 = full cost; deeper sub-trees diminish). Mirrors Tekli Journal_7 §4.4 hybrid TOC | tree-op cost helpers | Missing whole sections become genuinely expensive |
| 3 | **Information-content weight per section** — multiply tree-op cost by `IC(section) = log(195 / df(section))` (TF-IDF style across the corpus), so sections appearing in *every* country (`Capital`) cost less to miss than rare ones (`Gini`, `HDI`) | new helper + cache in `DatasetNumericNormalizer` | High-signal omissions stop being averaged away |
| 4 | When Sem_RBS triggers the soft reorder path, **multiply by `(1 - value_distance)`** for numeric leaves inside the matched sub-tree, so identical-shaped GDP blocks with vastly different numbers still pay value-cost | `_soft_reorder_cost` | Stops the "same shape, different numbers" loophole |
| 5 | Cap similarity at `min(|A|, |B|) / max(|A|, |B|)` — physical bound: a tree can never be more similar to a much larger tree than the size ratio allows | `normalized_similarity` post-step | Hard ceiling for asymmetric pairs |

Fix #1 alone is a one-line change with the largest effect. Fixes #2 and #3
together restore the Tekli framework's intended behaviour. Fix #5 is a
safety net.

---

## 8. CLI reference

```bash
# Project 1 — pairwise diff (default mode)
python scripts/algoOriginal_clean_v2_with_patching_fixed.py \
  --a Lebanon --b Switzerland --out-dir outputs

# Project 1 on the raw scrape directly
python scripts/algoOriginal_clean_v2_with_patching_fixed.py \
  --dataset data/raw/all_countries.json \
  --a Lebanon --b Switzerland --out-dir outputs_raw

# Project 2 — full clustering pipeline
python scripts/algoOriginal_clean_v2_with_patching_fixed.py \
  --mode cluster --k 8 --linkage average --clustering both \
  --reference-labels regions.csv --out-dir outputs_cluster

# Restrict to a subset of countries (faster for experiments)
python scripts/algoOriginal_clean_v2_with_patching_fixed.py \
  --mode cluster --countries "France,Germany,Lebanon,Iran,Japan,China" \
  --k 3 --out-dir outputs_small

# Just dump the similarity / distance matrices
python scripts/algoOriginal_clean_v2_with_patching_fixed.py \
  --mode matrix --out-dir outputs_matrix
```

Tunable constants (top of the script):

```python
INSERT_DELETE_PENALTY_MULTIPLIER = 2.0
STRUCTURE_MISMATCH_MULTIPLIER    = 3.0
REORDER_COST                     = 0.25
NUMERIC_VALUE_TOLERANCE          = 0.02
NUMERIC_VALUE_WEIGHT             = 3.0
NUMERIC_VALUE_MODE               = "linear"     # or "quadratic"
TEXT_VALUE_COST                  = 0.0

USE_SEMANTIC_LABELS              = True
SEMANTIC_MODEL_NAME              = "all-MiniLM-L6-v2"
SEMANTIC_MIN_LABEL_LEN           = 3
SEMANTIC_MATCH_THRESHOLD         = 0.65

USE_DEPTH_FACTOR                 = True
USE_SECTION_GUARD                = True
SECTION_MISMATCH_MULTIPLIER      = 2.0
CANONICAL_SORT_KEYS              = True

USE_SEMANTIC_SUBTREES            = True
SUBTREE_SEMANTIC_THRESHOLD       = 0.80
SUBTREE_SEMANTIC_MAX_DEPTH       = 2
```

---

## 9. Open follow-ups

- Implement fixes #1–#5 from §7.3 and re-run the Vatican / Russia test plus
  the 11-country cluster benchmark to confirm purity climbs.
- Run a full 195×195 matrix on cleaned data (~10–20 min) and produce a global
  dendrogram for the Project 2 report.
- Enable `USE_SCHEMA_NORMALIZATION = True` on the raw dataset and re-measure
  cluster quality — the spaCy helpers were built for exactly that input.
- Add a `--report` flag that emits a one-page Markdown summary per compare
  pair (numbers + section rollup + top-5 edit ops) for the Project 1 writeup.
