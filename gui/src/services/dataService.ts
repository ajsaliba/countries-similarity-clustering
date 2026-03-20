import { CountryData } from '../types';

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

/** Convert a display country name to a file slug used by the Python scripts. */
export function countryNameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * Compute the normalised relabelling cost between two node labels.
 *
 * For purely numeric labels the cost is the normalised absolute difference:
 *   cost = |v1 - v2| / max(|v1|, |v2|, ε)   ∈ [0, 1]
 *
 * For string labels (or labels that cannot be parsed as numbers) the cost
 * is binary: 0 if identical, 1 otherwise.
 *
 * This follows best practice for TED on heterogeneous data where leaf values
 * can be large magnitudes (e.g. GDP in USD) that would otherwise dominate an
 * edit-script cost computed with a simple string-equality check.
 */
export function relabelCost(label1: string, label2: string): number {
  if (label1 === label2) return 0;

  const v1 = Number(label1);
  const v2 = Number(label2);

  if (!isNaN(v1) && !isNaN(v2)) {
    const maxAbs = Math.max(Math.abs(v1), Math.abs(v2), Number.EPSILON);
    return Math.min(1, Math.abs(v1 - v2) / maxAbs);
  }

  return 1;
}

/** Build a flat label string suitable for display from a numeric metric value. */
export function formatMetricValue(value: number | null): string {
  if (value === null) return 'N/A';
  if (Math.abs(value) >= 1e9) return (value / 1e9).toFixed(2) + 'B';
  if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(2) + 'M';
  if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(2) + 'K';
  return value.toFixed(value % 1 === 0 ? 0 : 2);
}
