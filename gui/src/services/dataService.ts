import { CountryData, MetricValue, TreeNode } from '../types';

const BASE = '/api/countries';

export type DataVariant = 'clean' | 'raw';

/** Resolve the API sub-directory for the selected dataset variant. */
function getJsonSubdir(variant: DataVariant): string {
  return variant === 'clean' ? 'JSON_CLEAN' : 'JSON';
}

/** List files in the JSON data folder for the selected variant. */
export async function listDataFiles(variant: DataVariant = 'raw'): Promise<string[]> {
  const subdir = getJsonSubdir(variant);
  const res = await fetch(`${BASE}/${subdir}/`);
  if (!res.ok) throw new Error(`Failed to list ${subdir} files`);
  return res.json();
}

/** Load a single country JSON file by slug (e.g. "lebanon"). */
export async function loadCountryJSON(
  slug: string,
  variant: DataVariant = 'raw',
): Promise<CountryData> {
  const subdir = getJsonSubdir(variant);
  const res = await fetch(`${BASE}/${subdir}/${slug}.json`);
  if (!res.ok) {
    throw new Error(`Country file not found: ${subdir}/${slug}.json`);
  }
  return res.json();
}

/** Explicit overrides where the display name differs from the World Bank filename slug. */
const SLUG_OVERRIDES: Record<string, string> = {
  Syria: 'syrian_arab_republic',
  Russia: 'russian_federation',
  'United States': 'united_states_of_america',
  Vietnam: 'viet_nam',
  Turkey: 'turkiye',
  'South Korea': 'republic_of_korea',
  'North Korea': 'democratic_people_s_republic_of_korea',
  Laos: 'lao_people_s_democratic_republic',
  Tanzania: 'united_republic_of_tanzania',
  Brunei: 'brunei_darussalam',
  'Czech Republic': 'czechia',
  'Congo (DRC)': 'democratic_republic_of_the_congo',
  'Guinea-Bissau': 'guinea_bissau',
  'Timor-Leste': 'timor_leste',
  'Vatican City': 'holy_see',
  "Cote d'Ivoire": 'cote_d_ivoire',
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
 *
 *   • If either is a non-numeric string (KEY / structural nodes):
 *       cost = 0 if identical, 1 otherwise
 */
export function relabelCost(label1: string, label2: string): number {
  if (label1 === label2) return 0;

  const v1 = Number(label1);
  const v2 = Number(label2);

  if (isFinite(v1) && isFinite(v2)) {
    const maxAbs = Math.max(Math.abs(v1), Math.abs(v2), Number.EPSILON);
    return Math.min(1, Math.abs(v1 - v2) / maxAbs);
  }

  return 1;
}

/**
 * Convert a CountryData JSON object into a TreeNode tree.
 *
 * Tree structure:
 *   country (root, depth 0)
 *   └── <category> (depth 1)
 *       └── <metric> (depth 2, leaf)
 */
export function countryDataToTree(data: CountryData): TreeNode {
  let id = 0;
  const nid = () => String(id++);

  const categories: (keyof Omit<CountryData, 'country' | 'iso3'>)[] = [
    'demographics',
    'economy',
    'trade',
    'debt',
    'education',
    'health',
    'infrastructure',
    'energy_and_environment',
    'governance',
    'security',
  ];

  const rootId = nid();
  const children: TreeNode[] = [];

  for (const cat of categories) {
    const catData = data[cat] as Record<string, MetricValue> | undefined;
    if (!catData) continue;

    const catId = nid();

    const metrics: TreeNode[] = Object.entries(catData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, mv]) => ({
        id: nid(),
        label: key,
        value: mv.value !== null && mv.value !== undefined ? String(mv.value) : '0',
        numericValue: mv.value ?? 0,
        children: [],
        depth: 2,
      }));

    children.push({
      id: catId,
      label: cat,
      value: undefined,
      children: metrics,
      depth: 1,
    });
  }

  return {
    id: rootId,
    label: 'country',
    value: data.country,
    children,
    depth: 0,
  };
}

/**
 * Return a copy of `tree` that contains only the metric nodes whose labels
 * are in `selectedMetrics`. Categories that become empty are also removed.
 */
export function filterTreeByMetrics(tree: TreeNode, selectedMetrics: string[]): TreeNode {
  if (selectedMetrics.length === 0) return tree;

  const selected = new Set(selectedMetrics);
  const filteredCats = tree.children
    .map(cat => ({
      ...cat,
      children: cat.children.filter(m => selected.has(m.label)),
    }))
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