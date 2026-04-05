# Implementation Prompt: Countries Similarity Clustering — Full Feature Expansion

## Project Context

You are implementing a major feature expansion on an existing React + Flask application for comparing and clustering Wikipedia country infoboxes using Tree Edit Distance (TED). Read everything below carefully before writing a single line of code.

---

## Existing Stack (DO NOT CHANGE THESE)

### Frontend
- React 18 + TypeScript 5.2 + Vite 6.4, dev server on port 3000
- Tailwind CSS 3.3 with custom colors: `primary` (blue), `accent` (green); custom animations: `fade-in`, `slide-up`, `slide-in-right`
- Lucide React for icons; react-simple-maps for world map
- Root: `gui/src/`
  - `components/` — UI components (one per phase)
  - `data/` — static data (countries.ts, algorithms.ts, metrics.ts, sampleTrees.ts)
  - `services/` — dataService.ts (HTTP + tree building), similarityService.ts (TS-side TED approximations)
  - `types/index.ts` — all shared TypeScript types
- App state managed via a single `useAppState` hook
- Vite config: proxies `/api/ted/*` → `http://localhost:5001`; serves `../Data/` at `/api/countries/*`

### Backend
- Flask + flask-cors, port 5001, file: `scripts/ted_api.py`
- Existing endpoints:
  - `GET /api/ted/countries?dataset=clean` → list country names
  - `GET /api/ted/country?name=Lebanon&dataset=clean` → raw country JSON
  - `POST /api/ted/build-tree` → returns frontend TreeNode shape
  - `POST /api/ted/compare` → TED distance, similarity, edit script, patch, verification

### Core Python Library (`ted/` package)
- `node.py` — `Node` dataclass (label, node_type, value, children, parent)
- `tree_builder.py` — `build_country_tree()`, `tree_size()`, `tree_summary()`
- `cost_functions.py` — `CostFunction` with weighted insert/delete/update; feature weights dict
- `zhang_shasha.py` — full Zhang-Shasha TED; `zhang_shasha_with_script()` returns edit script strings
- `similarity.py` — `ted_similarity()` with 4 normalization methods; `compute_matrix()` for pairwise
- `run_ted.py` — `load_countries()`, `normalize_country()`, `diff_trees()`, `apply_edit_script()`, `verify_patch()`, `postprocess_to_json()`, `postprocess_to_infobox_text()`

### Data
- `data/raw/all_countries.json` — ~195 countries, raw Wikipedia infobox strings
- `data/clean/all_countries_clean.json` + `data/clean/countries/<Name>.json` — normalized per-country JSON
- `data/outputs/` — pre-computed edit scripts, patched trees, infobox text, flat CSV
- Country JSON schema: `{ country, area, codes, economy, general, government, history, population, time }`

### Current UI Architecture
The existing UI is a linear **8-phase wizard** managed by one large `useAppState` hook in `hooks/useAppState.ts`.

| Phase | Component | Purpose |
|---|---|---|
| 0 | `CountrySelection` | Pick countries via search + region filter + world map |
| 1 | `DataSourceSelection` | Choose data variant: clean or raw |
| 2 | `DataCollection` | Loads country trees from Flask backend |
| 3 | `MetricsSelection` | Shows common tree fields; lets user filter which to compare |
| 4 | `TreeBuilding` | Visual animated tree construction + XML preview |
| 5 | `AlgorithmExecution` | Runs TED; shows animated TED matrix + pseudocode |
| 6 | `ResultsView` | Shows similarity score, edit script, patch diff, post-processed output |
| 7 | `SummaryView` | Algorithm complexity summary, all pair results, restart option |

A `Stepper.tsx` horizontal progress bar drives navigation. No routing library. All state in one top-level `App.tsx`. The wizard is the entire application — no sidebar, no home dashboard, no navigation menu.

---

## Architecture Transition

The current wizard-only single-page app must be **refactored into a multi-module application with a persistent left sidebar navigation**. The wizard remains intact as the "Country Comparison" module accessible from the sidebar. Every new module described below is a new top-level page/view.

**Install React Router v6** (`react-router-dom`) and restructure `App.tsx` to use a layout with:
- A **fixed left vertical sidebar** (collapsed icon-only at ≤1280px, expanded with labels at >1280px)
- A **main content area** that renders the active page
- The sidebar contains navigation links to every module

Sidebar nav items (in order):

| # | Label | Route | Icon |
|---|---|---|---|
| 1 | Home | `/` | LayoutDashboard |
| 2 | Dataset Browser | `/dataset` | Database |
| 3 | Pre-Processing | `/preprocessing` | Sliders |
| 4 | Compare Countries | `/compare` | GitCompare |
| 5 | Diff Viewer | `/diff` | FileDiff |
| 6 | Tree Patcher | `/patcher` | Layers |
| 7 | Infobox Reconstruction | `/reconstruction` | FileText |
| 8 | Clustering | `/clustering` | Network |
| 9 | Cluster Evaluation | `/cluster-evaluation` | BarChart3 |
| 10 | Settings | `/settings` | Settings |
| 11 | Developer API | `/developer` | Code2 |
| 12 | Reports | `/reports` | Download |

---

## File Structure to Create

```
gui/src/
  pages/
    HomePage.tsx
    DatasetBrowserPage.tsx
    PreProcessingPage.tsx
    ComparePage.tsx               ← wraps existing wizard unchanged
    DiffViewerPage.tsx
    PatcherPage.tsx
    ReconstructionPage.tsx
    ClusteringPage.tsx
    ClusterEvaluationPage.tsx
    SettingsPage.tsx
    DeveloperPage.tsx
    ReportsPage.tsx
  components/
    Layout.tsx                    ← sidebar + content area wrapper
    Sidebar.tsx                   ← nav menu
    TreeView.tsx                  ← shared recursive collapsible tree renderer
    SvgBarChart.tsx               ← reusable pure-SVG bar chart
    SvgHeatmap.tsx                ← reusable pure-SVG heatmap
    CountryCard.tsx               ← dataset browser card
    OperationBadge.tsx            ← colored diff operation chip
    ... (all existing components unchanged)
  contexts/
    SettingsContext.tsx
  hooks/
    useApi.ts                     ← shared loading/error/data hook
    useAppState.ts                ← existing hook, moved here, unchanged
  services/
    clusteringService.ts          ← K-Means, Agglomerative, Divisive, Spectral in TS
    ... (existing services unchanged)
```

---

## Module Specifications

Implement each module as a standalone React page component under `gui/src/pages/`. Use Tailwind CSS for all styling, Lucide React for all icons, and keep the existing dark/glassmorphism aesthetic (dark backgrounds, semi-transparent card panels, blue `primary` + green `accent` color palette defined in `tailwind.config.js`).

---

### Module 1: Home Dashboard (`/`)

**Layout:** Card grid (3 columns desktop, 1 column mobile) with a stats row at the top.

**Stats row** (4 metric chips):
- Total countries in dataset — call `GET /api/ted/countries?dataset=clean`, display count
- Pre-computed comparisons available — count files matching `data/outputs/edit_script_*.json` (call `GET /api/ted/stats`)
- Clustering runs performed — read `localStorage` key `clusteringRuns`, default 0
- Algorithms available — hardcode: 3

**Cards** (each is a button navigating to the respective route):
- "Compare Countries" → `/compare`
- "View Diffs" → `/diff`
- "Run Clustering" → `/clustering`
- "Dataset Browser" → `/dataset`
- "Tree Patcher" → `/patcher`
- "Reports" → `/reports`

Each card: icon (top), title (bold), short description, arrow button bottom-right.

**Analytics widgets (bottom section, 2-column):**
- Pure-SVG bar chart of the 8 pre-computed country pairs (hardcode pair names from `data/outputs/` filenames: France↔Germany, Greece↔Lebanon, Iran↔Iraq, Lebanon↔France, Syria↔Lebanon, US↔CAR, US↔China, US↔Lebanon), labeled "Pre-computed Comparisons"
- Cluster count indicator widget (reads `localStorage` key `clusteringRuns`)

Do not add any charting library. Implement bars as `<rect>` elements inside an `<svg>` with labels on the x-axis.

---

### Module 2: Dataset Browser (`/dataset`)

**Layout:** Full-width page with a top toolbar and a main content area.

**Top toolbar:**
- Search input — filters country cards by name (case-insensitive substring)
- Region filter dropdown: `All Regions | Africa | Americas | Asia | Europe | Oceania` (use `region` field from `gui/src/data/countries.ts`)
- Sort dropdown: `Name A–Z | Name Z–A | Region`

**Country grid** (paginated, 20 per page):
- Each country card shows: flag emoji (derive from ISO alpha-2 code using Unicode regional indicator letters), country name, region/subregion badge, status dot
- Clicking a card opens a **detail drawer** sliding in from the right showing two tabs:

  **Tab 1 — Raw JSON:** Fetch `GET /api/ted/country?name=<name>&dataset=clean`. Display in a scrollable `<pre>` with lightweight syntax highlighting (strings = green, numbers = blue, keys = yellow — implement with regex replace + `dangerouslySetInnerHTML`, no library).

  **Tab 2 — Parsed Tree:** Fetch `POST /api/ted/build-tree` with `{ "country": name, "dataset": "clean" }`. Render using the shared `TreeView.tsx` component.

**Infobox Import Tool** (top-right "Import Data" button opens a modal):
- Tab "Auto-fetch": country name input + "Fetch from Wikipedia" button (calls `/api/run-script` → show toast if unavailable)
- Tab "Manual Upload": drag-and-drop `.json` or `.xml` file area; on drop show parsed content in preview + "Save to dataset" button (client-side only, shows success toast, no actual write)

---

### Module 3: Pre-Processing Visual Tool (`/preprocessing`)

**Layout:** Two-panel side-by-side.

**Left panel — Input:**
- Country selector dropdown (populated from `GET /api/ted/countries?dataset=clean`)
- "Load Raw Data" button → `GET /api/ted/country?name=<name>&dataset=raw`
- Raw JSON displayed in a scrollable syntax-highlighted code block
- Toggle switch: `[ Single Text Node | Tokenized Nodes ]`

**Right panel — Animated Tree:**
- "Generate Tree" button → `POST /api/ted/build-tree`
- Nodes appear one by one with 30ms stagger delay, sliding in from the left (`slide-in-right` animation)
- Each node rendered as a pill: label left, type badge (dict/list/str/num/dist) color-coded right
- Hovering a string leaf shows token chips below it (split by `/[\s,;/()]+/`)
- The tokenize toggle controls whether the visual shows one node per full value or one per token

**Attribute ordering table** (below tree):
A table of all leaf nodes in traversal order: path | type | value | token count (if tokenized).

**Tokenization logic (TypeScript):**
```typescript
function tokenizeValue(val: string): string[] {
  return val.split(/[\s,;/()]+/).filter(t => t.length > 0)
}
```

No new Flask endpoint needed — uses existing `GET /api/ted/country` and `POST /api/ted/build-tree`.

---

### Module 4: Country Comparison (`/compare`)

**This is the existing 8-phase wizard. Preserve it exactly.**

Move all wizard content (`useAppState`, all 8 phase components, `Stepper.tsx`) into `gui/src/pages/ComparePage.tsx` and render it inside the new `Layout`. Adjust any `h-screen` / `min-h-screen` Tailwind classes so the wizard fits the layout content area instead of the full viewport.

**One addition only:** After a successful comparison (phase 6 ResultsView mounts with results), push to `localStorage`:
```typescript
const recent = JSON.parse(localStorage.getItem('recentComparisons') || '[]')
recent.unshift({ a: countryA, b: countryB, score: similarity, date: new Date().toISOString() })
localStorage.setItem('recentComparisons', JSON.stringify(recent.slice(0, 20)))
```

---

### Module 5: Diff Viewer (`/diff`)

**Layout:** Top selector bar + split pane (40% left diff list / 60% right dual-tree view).

**Top selector bar:**
- Country A dropdown + Country B dropdown (populated from `GET /api/ted/countries`)
- "Compute Diff" button → `POST /api/ted/compare`; extracts `edit_script` from response
- "Load Pre-computed" dropdown listing the 8 available pairs from `data/outputs/` (hardcode names); selecting one loads via `GET /api/ted/precomputed`
- Export buttons: "Export JSON", "Export XML"

**Left pane — Operation List:**
- Summary row at top: "X insertions, Y deletions, Z updates"
- Each operation row, color-coded left border:
  - Insert → `border-green-500 bg-green-950`
  - Delete → `border-red-500 bg-red-950`
  - Update → `border-yellow-500 bg-yellow-950`
- Row content: badge (`INS` / `DEL` / `UPD`), node path, old→new value, cost badge (right-aligned float)
- Clicking a row sets `highlightedPath` state, which highlights the corresponding node in both trees

**Right pane — Dual Tree View:**
- Country A tree (left half) + Country B tree (right half) using `TreeView.tsx`
- Pass `highlightedPaths` prop to `TreeView` — highlighted node gets a colored outline matching its operation type; non-affected nodes dimmed to `opacity-50`

**Export:**
- "Export JSON" → `Blob` download of the raw `edit_script` array as `diff_<A>_<B>.json`
- "Export XML" → convert ops to `<editScript><operation type="..." path="..." from="..." to="..." cost="..."/></editScript>` and download as `diff_<A>_<B>.xml`

---

### Module 6: Tree Patcher (`/patcher`)

**Layout:** Source/target selectors at the top, timeline player below, tree panel at the bottom.

**Source/Target Selection:**
- Source country dropdown + Target country dropdown
- "Load Patch" button → `POST /api/ted/compare`; stores `edit_script` and `tree_a`
- "Load Pre-computed" dropdown (same 8 pairs as Diff Viewer)

**Patch Timeline Player:**
- Horizontal step indicator: operations as dots on a line, current step dot is highlighted
- Controls: `|◀ Restart` `◀ Prev` `▶ Play / ⏸ Pause` `Next ▶|`
- Speed selector: `0.5× | 1× | 2× | 4×`
- Current step label: "Step 3 of 17 — Update: economy/gdp_ppp"

**Tree Panel:**
- Shows the state of Tree A after applying the first `currentStep` operations
- Implement `applyEditOps(tree: TreeNode, ops: EditOperation[], upTo: number): TreeNode` in TypeScript (deep-clone tree, apply insert/delete/update operations up to index `upTo`)
- The node affected by the current operation is highlighted with a tooltip showing operation type + old → new value
- "Before / After" toggle: side-by-side view of tree state before and after the current step

**Validation Banner** (visible after all steps applied):
- Green: "Patch verified ✓ — Patched tree matches target" (use `patch_verified` from API response)
- Red: "Patch failed — N nodes differ"

**No new Flask endpoint needed** — implement step-by-step patching in TypeScript to avoid round-trips.

---

### Module 7: Infobox Reconstruction (`/reconstruction`)

**Layout:** Two-column side-by-side with download buttons in the top bar.

**Left column — Wikitext Input:**
- Country selector dropdown + "Load Patched Infobox" button → `POST /api/ted/compare`; uses `patched_infobox` string from response
- The `patched_infobox` text (format: `Key: Value\n` lines) is shown in an editable `<textarea>`
- OR load from `sessionStorage` if a comparison was just run at `/compare`

**Right column — Rendered Infobox Preview:**
- Parse the textarea content as `Key: Value` lines
- Render as a Wikipedia-style two-column `<table>`: key cell (bold, grey bg, right-aligned) + value cell (white bg)
- Updates live as the textarea content changes (use `onChange`)

**Top bar export buttons:**
- "Export HTML" → `Blob` download of the rendered table's `outerHTML` as `.html`
- "Export JSON" → download `{ key: value }` object as `.json`
- "Export XML" → download `<infobox><field name="key">value</field>...</infobox>` as `.xml`

---

### Module 8: Document Clustering (`/clustering`)

**This is the most complex new module.**

**Layout:** Left configuration panel (30%) + right visualization area (70%).

**Left Panel — Algorithm Configuration:**

Section 1: Algorithm radio group
- K-Means (partitional)
- Agglomerative (hierarchical)
- Divisive
- Spectral

Section 2: Algorithm parameters (rendered dynamically based on selection):
- K-Means: `k` number input (2–20, default 5), max iterations slider (10–500)
- Agglomerative: linkage dropdown (`single | complete | average | ward`), `k` clusters input
- Divisive: threshold slider (0.0–1.0, step 0.01)
- Spectral: `n_clusters` input, similarity matrix dropdown (`TED | Structure-only | Content-only`)

Section 3: Similarity metric radio group
- TED (full, default)
- Structure-only TED
- Content-only TED

Section 4: Country subset
- "All countries" radio — uses a 20-country random sample with a warning banner ("Showing results for 20 sampled countries for performance")
- "Select subset" radio — shows a multi-select searchable dropdown (country list from `gui/src/data/countries.ts`)

Section 5: "Run Clustering" button (primary, full-width)

**Clustering Computation (TypeScript in `clusteringService.ts`):**

1. Build pairwise distance matrix: call `POST /api/ted/clustering/matrix` (new endpoint) with the selected countries; receives `{ matrix: number[][], countries: string[] }`.

2. Implement all four algorithms:

```typescript
// K-Means on distance matrix (treat rows as feature vectors)
function kMeans(matrix: number[][], k: number, maxIter: number): number[]

// Agglomerative with selectable linkage
function agglomerative(matrix: number[][], k: number, linkage: 'single'|'complete'|'average'|'ward'): { labels: number[], dendrogram: DendrogramNode }

// Divisive: recursive bisection; split cluster if max intra-distance > threshold
function divisive(matrix: number[][], threshold: number): number[]

// Spectral: normalized Laplacian → top-k eigenvectors via power iteration → K-Means
function spectral(matrix: number[][], k: number): number[]
```

3. After clustering, increment `localStorage` key `clusteringRuns` and save full result to `localStorage` key `lastClusteringResult` for use by the evaluation module.

**Right Panel — Visualization (4 tabs):**

**Tab 1 — Bubble Chart:**
- Each cluster = one large colored SVG circle
- Inside each circle: country ISO code chips as small `<text>` elements
- Cluster centroids at evenly-spaced angles on a circle (r = 200px), country nodes orbiting each centroid
- Color palette: `hsl(i * 360/k, 70%, 50%)` per cluster

**Tab 2 — Dendrogram:**
- Rendered as SVG, implemented without any library
- For agglomerative: use the `DendrogramNode` tree returned by `agglomerative()` to draw horizontal merge lines at heights proportional to merge distance
- Leaves at the bottom with country labels (rotated 90°)
- Zoom via SVG `viewBox` manipulation on a zoom slider
- Only rendered for ≤50 countries (show warning otherwise)

**Tab 3 — Heatmap:**
- NxN grid of colored cells using `SvgHeatmap.tsx`
- Cell color: `hsl(similarity * 120, 70%, 50%)` (red=0, green=1)
- Row/column headers: country names (abbreviated to ISO code if >10 countries)
- Tooltip on hover: "Country A vs Country B: 0.73"

**Tab 4 — World Map:**
- Reuse the existing `WorldMapView.tsx` component (react-simple-maps)
- Pass cluster assignments as a `clusterColors: Record<string, string>` prop mapping ISO alpha-2 codes to HSL color strings
- Countries not in the result remain grey
- Legend below the map: colored swatches + "Cluster N (X countries)"

---

### Module 9: Cluster Evaluation (`/cluster-evaluation`)

If no `lastClusteringResult` exists in `localStorage`, show empty state: "Run clustering first" with a link to `/clustering`.

**Metric Score Cards (3 cards in a row):**

| Card | Formula | Better when |
|---|---|---|
| Silhouette | `mean((b(i) - a(i)) / max(a(i), b(i)))` where a=intra, b=nearest-cluster dist | Higher (max 1.0) |
| Davies-Bouldin | `mean(max_j((s_i + s_j) / d(c_i, c_j)))` | Lower (min 0.0) |
| Dunn Index | `min_inter / max_intra` | Higher |

Each card shows: metric name, computed value (2 decimal places), quality badge ("Good" / "Fair" / "Poor") based on thresholds:
- Silhouette: >0.5 Good, >0.25 Fair, else Poor
- DB: <1.0 Good, <2.0 Fair, else Poor
- Dunn: >1.0 Good, >0.5 Fair, else Poor

Implement all three metrics in `clusteringService.ts`.

**2D Scatter Plot (SVG):**
- Reduce NxN distance matrix to 2D using Classical MDS (implement in TypeScript: double-center squared distance matrix, compute top-2 eigenvectors via power iteration, project points)
- Alternatively, add a Flask endpoint `POST /api/ted/clustering/pca` that accepts `{ matrix, labels, countries }` and returns `{ points: [{x, y, country, cluster}] }`
- Render as SVG: colored circle per country, cluster colors matching the bubble chart palette
- Country name label appears on hover as a tooltip

**Per-Cluster Statistics Table:**

| Cluster | Countries | Avg Intra-Similarity | Representative Country |
|---|---|---|---|
| 1 | 42 | 0.81 | Germany |

Representative country = country with highest average similarity to others in its cluster.

---

### Module 10: Settings (`/settings`)

**All settings persisted to `localStorage` under `appSettings`.** Provide a `SettingsContext.tsx` React context so all components can read the current settings.

**Sections:**

**TED Algorithm:**
Radio: `Zhang-Shasha (default) | Chawathe | Nierman-Jagadish`
(passed as `method` in `/api/ted/compare` body)

**Operation Costs:**
- Insert cost: slider + number input (0.5–3.0, step 0.1, default 1.0)
- Delete cost: same
- Update cost: same
(passed as `costs: { insert, delete, update }` in `/api/ted/compare` body)

**Similarity Normalization:**
Dropdown: `exp_size (default) | norm | exp | inv`

**Tokenization:**
Toggle: Enable tokenization (default off)
If on: radio `Whitespace | Punctuation | Full`

**Diff Output Format:**
Radio: `JSON | XML | Custom`

**Display:**
- Toggle: Show algorithm pseudocode during execution
- Toggle: Show TED matrix animation
- Animation speed: slider `0.5×–4×`

**Backend:**
- Flask API URL display (localhost:5001, read-only)
- "Test Connection" button → `GET /api/ted/countries` → show "Connected ✓" or "Failed ✗" badge

**"Restore Defaults" button** — resets all settings to the values above.

---

### Module 11: Developer API (`/developer`)

**Layout:** Endpoint list on the left, request builder + response on the right.

**Documented endpoints:**

| Method | Path | Description |
|---|---|---|
| GET | `/api/ted/countries` | List all country names |
| GET | `/api/ted/country` | Get raw country JSON |
| POST | `/api/ted/build-tree` | Build tree for one country |
| POST | `/api/ted/compare` | Full TED comparison |
| POST | `/api/ted/clustering/matrix` | Compute pairwise distance matrix |

**For each endpoint:**
- Method badge (GET = blue, POST = green)
- Path and description
- Collapsible "Try it out" panel with editable JSON `<textarea>` pre-filled with an example request body
- "Send Request" button → actual `fetch()` call to the Vite proxy → response shown in syntax-highlighted `<pre>` with status code + elapsed time in ms

**Code snippet tabs** (below each endpoint):
- `cURL` — static string
- `Python (requests)` — static string
- `JavaScript (fetch)` — static string

All snippets are static hardcoded strings, not dynamically generated.

---

### Module 12: Reports (`/reports`)

**Layout:** Left configurator (40%) + right preview panel (60%).

**Report type radio (top):**
- Comparison Report
- Clustering Summary

**Comparison Report configurator:**
- Country A + Country B dropdowns
- "Load Data" button → `POST /api/ted/compare`
- Section toggles: High-level summary | Tree structure match | Similarity score | Edit script | Patched infobox
- "Generate Preview" button

**Clustering Summary configurator:**
- Reads `lastClusteringResult` from `localStorage`
- Section toggles: Algorithm used | Cluster assignments | Evaluation metrics | Heatmap

**Preview panel:**
- White background, print-ready styled `<div class="print-area">`
- Comparison Report preview includes:
  - Header: "Country Similarity Report" + current date
  - Similarity gauge: a semi-circular SVG arc drawn up to `score * 180°`; label showing score as percentage
  - Breakdown: structure similarity % + content similarity % as horizontal bar rows
  - Edit script summary: counts table + top 5 operations list
- Clustering Summary includes:
  - Cluster assignment table (all countries + cluster IDs)
  - Metric score cards (reuse Evaluation module cards)

**Download buttons:**
- "Download PDF" → `window.print()` with injected `<style>@media print { body > *:not(.print-area) { display: none } }</style>`
- "Download JSON" → `Blob` download of the full comparison/clustering result

---

## New Backend Endpoints to Add

Add these to `scripts/ted_api.py`:

### `GET /api/ted/stats`
Returns filesystem counts:
```json
{ "country_count": 195, "precomputed_count": 8 }
```
Read `data/clean/countries/` directory for count; count `data/outputs/edit_script_*.json` files.

### `GET /api/ted/precomputed`
Lists available pre-computed edit scripts and returns their parsed content:
```json
{
  "files": [
    { "name": "France_Germany", "label": "France → Germany", "edit_script": [...] }
  ]
}
```
Reads all `data/outputs/edit_script_*.json` files.

### `POST /api/ted/clustering/matrix`
Computes pairwise similarity matrix for a set of countries:
```json
// Request
{ "countries": ["Lebanon", "France", "Germany"], "dataset": "clean", "method": "exp_size" }

// Response
{ "matrix": [[1.0, 0.78, 0.65], [0.78, 1.0, 0.91], [0.65, 0.91, 1.0]], "countries": ["Lebanon", "France", "Germany"], "elapsed_seconds": 0.42 }
```
Uses `ted_similarity()` for each pair. Cache results in-memory keyed by `(frozenset(countries), method)`.

### `POST /api/ted/clustering/pca` (optional, for cluster evaluation scatter plot)
Reduces an NxN similarity matrix to 2D using sklearn PCA:
```json
// Request
{ "matrix": [[...]], "labels": [0, 1, 0, 1], "countries": ["Lebanon", "France", "Germany", "Greece"] }

// Response
{ "points": [{ "x": 0.12, "y": -0.34, "country": "Lebanon", "cluster": 0 }, ...] }
```

All endpoints must return `{ "error": "message" }` with appropriate HTTP status codes on failure.

---

## Shared Components to Create

### `TreeView.tsx`
Recursive collapsible tree renderer used by Dataset Browser, Diff Viewer, and Tree Patcher.
```typescript
interface TreeViewProps {
  node: TreeNode
  highlightedPaths?: string[]   // node paths to highlight
  highlightColor?: string       // Tailwind color class, e.g. 'green'|'red'|'yellow'
  depth?: number                // internal, for indentation
}
```
Each node renders as a `<details>` / `<summary>` pair. Leaf nodes show label + value inline. Non-leaf nodes expand to show children. Highlighted nodes get a colored left border + background tint.

### `SvgBarChart.tsx`
```typescript
interface SvgBarChartProps {
  data: { label: string; value: number }[]
  width?: number
  height?: number
  color?: string   // Tailwind-safe hex or CSS color
}
```
Renders bars as `<rect>` elements, labels as `<text>` elements rotated 45°, y-axis as a `<line>`.

### `SvgHeatmap.tsx`
```typescript
interface SvgHeatmapProps {
  matrix: number[][]      // values 0.0–1.0
  labels: string[]        // row/column labels
  cellSize?: number       // default 20px
}
```
Renders a grid of `<rect>` cells, colored by value. Tooltip on hover via a floating `<div>` using `onMouseEnter` / `onMouseLeave`.

### `useApi.ts`
```typescript
function useApi<T>(url: string, options?: RequestInit): {
  data: T | null
  loading: boolean
  error: string | null
  execute: (body?: unknown) => Promise<T | null>
}
```
All API calls in page components use this hook. When `loading = true`, show a spinner overlay. When `error` is set, show a red dismissible banner.

---

## Implementation Constraints

### Must Not:
- Break any existing wizard functionality
- Add npm dependencies beyond `react-router-dom`
- Use any charting library (Chart.js, Recharts, D3, Victory, etc.)
- Modify `ted/zhang_shasha.py`, `ted/cost_functions.py`, `ted/similarity.py`, `ted/node.py`
- Modify any file in `data/raw/` or `data/clean/`
- Add Redux or any global state manager beyond the existing `useAppState` hook and the new `SettingsContext`

### Must:
- All Tailwind only — no inline `style` props except for dynamic SVG attributes (`cx`, `cy`, `width`, `fill` computed at runtime)
- TypeScript strict mode — no `any` types; mark unavoidable exceptions with `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
- All Flask endpoints return `{ "error": "..." }` + correct HTTP status on failure
- The app must not crash when Flask is offline — show a persistent "Backend Offline" banner in the header but keep all client-side features accessible
- `localStorage` keys must include a version prefix: `csc_v1_settings`, `csc_v1_clusteringRuns`, `csc_v1_lastClusteringResult`, `csc_v1_recentComparisons`. On version mismatch, reset to defaults.
- Responsive: sidebar collapses to icons-only at `<1280px`, becomes a hamburger drawer at `<768px`
- Active sidebar item highlighted with `bg-primary-100 text-primary-700 font-semibold` (or dark-mode equivalent)

---

## Deliverables Checklist

- [ ] `react-router-dom` installed, `App.tsx` refactored to router + layout
- [ ] `Layout.tsx` and `Sidebar.tsx` components
- [ ] `SettingsContext.tsx` with `localStorage` persistence
- [ ] `TreeView.tsx` shared recursive collapsible tree component
- [ ] `SvgBarChart.tsx` and `SvgHeatmap.tsx` shared SVG chart components
- [ ] `useApi.ts` custom hook with loading/error/data state
- [ ] `clusteringService.ts` implementing K-Means, Agglomerative, Divisive, Spectral, MDS/PCA, Silhouette, DB Index, Dunn Index
- [ ] All 12 page components under `gui/src/pages/`
- [ ] `scripts/ted_api.py` updated with 4 new endpoints (`/stats`, `/precomputed`, `/clustering/matrix`, `/clustering/pca`)
- [ ] Existing wizard (all 8 phases + `useAppState`) preserved exactly and functional at `/compare`
- [ ] `localStorage` integration: settings, clustering results, run counter, recent comparisons
- [ ] App does not crash when Flask is offline