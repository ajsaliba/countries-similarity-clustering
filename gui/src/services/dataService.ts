import { CountryData, MetricValue, TreeNode } from '../types';

const BASE = '/api/countries';

/** List files in a Data sub-directory (e.g. "JSON", "XML"). */
export async function listDataFiles(subdir: 'JSON' | 'XML'): Promise<string[]> {
  const res = await fetch(`${BASE}/${subdir}/`);
  if (!res.ok) throw new Error(`Failed to list ${subdir} files`);
  return res.json();
}

/** Load a single country JSON file by slug (e.g. "lebanon"). */
export async function loadCountryJSON(slug: string): Promise<CountryData> {
  const res = await fetch(`${BASE}/JSON/${slug}.json`);
  if (!res.ok) throw new Error(`Country file not found: ${slug}.json`);
  return res.json();
}

/** Load a single country XML as text. */
export async function loadCountryXML(slug: string): Promise<string> {
  const res = await fetch(`${BASE}/XML/${slug}.xml`);
  if (!res.ok) throw new Error(`Country file not found: ${slug}.xml`);
  return res.text();
}

/** Explicit overrides where the display name differs from the World Bank filename slug. */
const SLUG_OVERRIDES: Record<string, string> = {
  'Syria':        'syrian_arab_republic',
  'Russia':       'russian_federation',
  'United States':'united_states_of_america',
  'Vietnam':      'viet_nam',
  'Turkey':       'turkiye',
  'South Korea':  'republic_of_korea',
  'North Korea':  'democratic_people_s_republic_of_korea',
  'Laos':         'lao_people_s_democratic_republic',
  'Tanzania':     'united_republic_of_tanzania',
  'Brunei':       'brunei_darussalam',
  'Czech Republic':'czechia',
  'Congo (DRC)':  'democratic_republic_of_the_congo',
  'Guinea-Bissau':'guinea_bissau',
  'Timor-Leste':  'timor_leste',
  'Vatican City': 'holy_see',
  "Cote d'Ivoire":'cote_d_ivoire',
};

/** Convert a display country name to a file slug used by the Python scripts. */
export function countryNameToSlug(name: string): string {
  if (SLUG_OVERRIDES[name]) return SLUG_OVERRIDES[name];
  return name
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * Compute the normalised relabelling cost between two node labels.
 *
 * Distinguishes between structural KEY labels (category/metric names) and
 * VALUE labels (leaf numeric data):
 *
 *   • If both parse as finite numbers (VALUE nodes):
 *       cost = |v1 - v2| / max(|v1|, |v2|, ε)   ∈ [0, 1]
 *     This gives a proportional cost — large-magnitude fields (GDP in USD)
 *     and small-magnitude fields (% values) are treated consistently.
 *
 *   • If either is a non-numeric string (KEY / structural nodes):
 *       cost = 0 if identical, 1 otherwise (binary).
 *
 * Rule 1 (Structural Symmetry): null values must be stored as "0" before
 * calling this function so that a null field in one country gets a numeric
 * cost against the other country's value rather than always costing 1.
 */
export function relabelCost(label1: string, label2: string): number {
  if (label1 === label2) return 0;

  const v1 = Number(label1);
  const v2 = Number(label2);

  if (isFinite(v1) && isFinite(v2)) {
    // Numeric (VALUE) comparison — normalised proportional difference ∈ [0,1]
    const maxAbs = Math.max(Math.abs(v1), Math.abs(v2), Number.EPSILON);
    return Math.min(1, Math.abs(v1 - v2) / maxAbs);
  }

  // Structural (KEY) comparison — binary
  return 1;
}

/**
 * Convert a CountryData JSON object into a TreeNode tree.
 *
 * Tree structure (3 levels):
 *   country (root, depth 0)
 *   └── <category> (depth 1)          e.g. demographics, economy …
 *       └── <metric> (depth 2, leaf)  label = metric key, value = numeric string
 *
 * The year field from MetricValue is intentionally discarded — only the
 * numeric value is retained.  Metrics whose value is null are kept as leaves
 * (value = undefined) so they are still structurally present in the tree.
 */
export function countryDataToTree(data: CountryData): TreeNode {
  let id = 0;
  const nid = () => String(id++);

  // Canonical category order (Rule 5: fixed hierarchy)
  const categories: (keyof Omit<CountryData, 'country' | 'iso3'>)[] = [
    'demographics', 'economy', 'trade', 'debt', 'education', 'health',
    'infrastructure', 'energy_and_environment', 'governance', 'security',
  ];

  const rootId = nid();

  const children: TreeNode[] = [];
  for (const cat of categories) {
    const catData = data[cat] as Record<string, MetricValue> | undefined;
    if (!catData) continue;

    const catId = nid();

    // Rule 5 (Key Sorting): sort metrics alphabetically for canonical sibling order
    // Rule 1 (Structural Symmetry): null values → "0" so every key is present as a
    //   numeric leaf in every tree (prevents structural gaps from dominating TED)
    const metrics: TreeNode[] = Object.entries(catData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, mv]) => ({
        id: nid(),
        label: key,
        // Rule 1: null → "0" so TED sees a numeric cost, not a structural mismatch
        value: mv.value !== null && mv.value !== undefined ? String(mv.value) : '0',
        numericValue: mv.value ?? 0,
        children: [],
        depth: 2,
      }));

    children.push({ id: catId, label: cat, value: undefined, children: metrics, depth: 1 });
  }

  return { id: rootId, label: 'country', value: data.country, children, depth: 0 };
}

/**
 * Parse a country XML file into a TreeNode tree that matches the structure
 * produced by countryDataToTree.
 *
 * Expected XML format (produced by the Python converter):
 *   <countries>
 *     <country>Lebanon</country>
 *     <iso3>LBN</iso3>
 *     <demographics>
 *       <total_population>
 *         <value>5805962</value>
 *         <year>2024</year>          ← discarded
 *       </total_population>
 *       …
 *     </demographics>
 *     …
 *   </countries>
 *
 * Resulting tree (identical structure to countryDataToTree output):
 *   country (root, depth 0)
 *   └── <category> (depth 1)
 *       └── <metric> (depth 2, leaf)  value = text of <value> child
 */
export function xmlStringToTree(xmlText: string): TreeNode {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  let id = 0;
  const nid = () => String(id++);

  const root = doc.documentElement; // <countries>

  const KNOWN_CATEGORIES = new Set([
    'demographics', 'economy', 'trade', 'debt', 'education', 'health',
    'infrastructure', 'energy_and_environment', 'governance', 'security',
  ]);

  // Extract country name from <country> text child
  const countryEl = Array.from(root.children).find(c => c.tagName === 'country');
  const countryName = countryEl?.textContent?.trim() ?? 'unknown';

  const rootId = nid();
  const categoryNodes: TreeNode[] = [];

  for (const catEl of Array.from(root.children)) {
    if (!KNOWN_CATEGORIES.has(catEl.tagName)) continue;

    const catId = nid();
    const metrics: TreeNode[] = [];

    for (const metricEl of Array.from(catEl.children)) {
      // Each metric element has <value> and <year> children.
      // Extract only the <value> text; discard <year>.
      const valueEl = Array.from(metricEl.children).find(c => c.tagName === 'value');
      const rawValue = valueEl?.textContent?.trim() || undefined;
      const numValue = rawValue !== undefined ? parseFloat(rawValue) : NaN;

      metrics.push({
        id: nid(),
        label: metricEl.tagName,
        // Rule 1: null/missing → "0" (same as JSON parser)
        value: (rawValue !== undefined && rawValue !== '' && rawValue !== 'None') ? rawValue : '0',
        numericValue: isNaN(numValue) ? 0 : numValue,
        children: [],
        depth: 2,
      });
    }

    if (metrics.length > 0) {
      // Rule 5: sort metrics alphabetically for canonical sibling order
      metrics.sort((a, b) => a.label.localeCompare(b.label));
      categoryNodes.push({
        id: catId,
        label: catEl.tagName,
        value: undefined,
        children: metrics,
        depth: 1,
      });
    }
  }

  return { id: rootId, label: 'country', value: countryName, children: categoryNodes, depth: 0 };
}

/**
 * Return a copy of `tree` that contains only the metric nodes whose labels
 * are in `selectedMetrics`.  Categories that become empty are also removed.
 * If `selectedMetrics` is empty the original tree is returned unchanged.
 */
export function filterTreeByMetrics(tree: TreeNode, selectedMetrics: string[]): TreeNode {
  if (selectedMetrics.length === 0) return tree;
  const selected = new Set(selectedMetrics);
  const filteredCats = tree.children
    .map(cat => ({ ...cat, children: cat.children.filter(m => selected.has(m.label)) }))
    .filter(cat => cat.children.length > 0);
  return { ...tree, children: filteredCats };
}

/** Build a flat label string suitable for display from a numeric metric value. */
export function formatMetricValue(value: number | null): string {
  if (value === null) return 'N/A';
  if (Math.abs(value) >= 1e9) return (value / 1e9).toFixed(2) + 'B';
  if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(2) + 'M';
  if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(2) + 'K';
  return value.toFixed(value % 1 === 0 ? 0 : 2);
}
