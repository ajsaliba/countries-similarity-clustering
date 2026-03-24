/**
 * similarityService.ts
 *
 * Complete implementation of every structural similarity method described in
 * Ch.5 (TED-based), Ch.6 (Approximation), and Ch.7 (IR-based) of the course
 * material, together with all normalisation formulas.
 */

import {
  TreeNode,
  SimilarityConfig,
  SimilarityResult,
  EditOperation,
  TFVariant,
} from '../types';
import { relabelCost, filterTreeByMetrics } from './dataService';

/**
 * Effective label for TED relabeling:
 * - Leaf nodes (no children): use the stored numeric value string so that
 *   e.g. "5805962" vs "68042591" gets a normalised numeric cost, not cost=1.
 * - Internal nodes: use the structural label (category / metric name).
 */
function tedLabel(n: TreeNode): string {
  return n.children.length === 0 && n.value != null ? n.value : n.label;
}

// ─────────────────────────────────────────────────────────────────────────────
// NORMALISATION FORMULAS  (Ch.5 §2 / §3)
// ─────────────────────────────────────────────────────────────────────────────

/** Formula 1 (Ch.5): Sim = 1/(1+ED) — maps [0,∞) → ]0,1]
 *  ⚠ Appropriate only for small TED values; degenerates to near-0 for trees
 *  with many leaves. Not recommended for large structured-data trees. */
export function normFormula1(ed: number): number {
  return 1 / (1 + ed);
}

/** Formula 2 (Ch.5): Sim = 1 − ED/(|A|+|B|) — maps [0,|A|+|B|] → [0,1] */
export function normFormula2(ed: number, sizeA: number, sizeB: number): number {
  const denom = sizeA + sizeB;
  return denom === 0 ? 1 : Math.max(0, 1 - ed / denom);
}

/**
 * Formula 3 (Rule 6 — Distance Normalization):
 *   Sim = 1 − ED / max(|A|, |B|)   ∈ [0, 1]
 *
 * This is the recommended formula for benchmarking country data because:
 *  • It gives a true [0,1] score regardless of tree size.
 *  • A score of 0.1 = 90% similar; 0.9 = 10% similar.
 *  • Correctly handles structurally identical trees (same schema) that differ
 *    only in leaf values — the dominant case for our country data files.
 */
export function normFormula3(ed: number, sizeA: number, sizeB: number): number {
  const maxSize = Math.max(sizeA, sizeB);
  return maxSize === 0 ? 1 : Math.max(0, 1 - ed / maxSize);
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY — frequency maps & TF weighting (Ch.7 §2.3)
// ─────────────────────────────────────────────────────────────────────────────

export function frequencies(items: string[]): Record<string, number> {
  const f: Record<string, number> = {};
  for (const x of items) f[x] = (f[x] || 0) + 1;
  return f;
}

function applyTF(freq: number, maxFreq: number, variant: TFVariant): number {
  if (variant === 'normalized') return maxFreq === 0 ? 0 : freq / maxFreq;
  if (variant === 'log')        return Math.log(freq + 1);
  return freq; // raw
}

function buildVectorPair(
  fa: Record<string, number>,
  fb: Record<string, number>,
  tf: TFVariant,
): [number[], number[]] {
  const dims = [...new Set([...Object.keys(fa), ...Object.keys(fb)])];
  const maxA = Math.max(...Object.values(fa), 1);
  const maxB = Math.max(...Object.values(fb), 1);
  return [
    dims.map(d => applyTF(fa[d] || 0, maxA, tf)),
    dims.map(d => applyTF(fb[d] || 0, maxB, tf)),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// SET-BASED MEASURES  (Ch.6 §2.2)
// ─────────────────────────────────────────────────────────────────────────────

/** Raw intersection normalised by max set size → [0,1] */
export function setIntersectionSim(a: string[], b: string[]): number {
  const sa = new Set(a), sb = new Set(b);
  const inter = [...sa].filter(x => sb.has(x)).length;
  return inter / Math.max(sa.size, sb.size, 1);
}

/** Jaccard: |A∩B| / |A∪B| — Ch.6 §2.2 */
export function setJaccard(a: string[], b: string[]): number {
  const sa = new Set(a), sb = new Set(b);
  const inter = [...sa].filter(x => sb.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : inter / union;
}

/** Dice (set): 2|A∩B| / (|A|+|B|) — Ch.6 §2.2 */
export function setDice(a: string[], b: string[]): number {
  const sa = new Set(a), sb = new Set(b);
  const inter = [...sa].filter(x => sb.has(x)).length;
  return (sa.size + sb.size) === 0 ? 1 : (2 * inter) / (sa.size + sb.size);
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTISET-BASED MEASURES  (Ch.6 §2.2)
// ─────────────────────────────────────────────────────────────────────────────

export function multiIntersectionSim(a: string[], b: string[]): number {
  const fa = frequencies(a), fb = frequencies(b);
  const all = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  let inter = 0;
  for (const k of all) inter += Math.min(fa[k] || 0, fb[k] || 0);
  return inter / Math.max(a.length, b.length, 1);
}

/** Jaccard (multiset): Σmin(fa,fb) / Σmax(fa,fb) */
export function multiJaccard(a: string[], b: string[]): number {
  const fa = frequencies(a), fb = frequencies(b);
  const all = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  let inter = 0, union = 0;
  for (const k of all) {
    inter += Math.min(fa[k] || 0, fb[k] || 0);
    union += Math.max(fa[k] || 0, fb[k] || 0);
  }
  return union === 0 ? 1 : inter / union;
}

/** Dice (multiset): 2Σmin / (|A|+|B|) */
export function multiDice(a: string[], b: string[]): number {
  const fa = frequencies(a), fb = frequencies(b);
  const all = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  let inter = 0;
  for (const k of all) inter += Math.min(fa[k] || 0, fb[k] || 0);
  return (a.length + b.length) === 0 ? 1 : (2 * inter) / (a.length + b.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// VECTOR-BASED MEASURES  (Ch.6 §2.3)
// ─────────────────────────────────────────────────────────────────────────────

/** Cosine: (A·B) / (|A|·|B|) — Ch.6 §2.3 */
export function vecCosine(a: string[], b: string[], tf: TFVariant = 'raw'): number {
  const [va, vb] = buildVectorPair(frequencies(a), frequencies(b), tf);
  const dot = va.reduce((s, v, i) => s + v * vb[i], 0);
  const na  = Math.sqrt(va.reduce((s, v) => s + v * v, 0));
  const nb  = Math.sqrt(vb.reduce((s, v) => s + v * v, 0));
  return na * nb === 0 ? 0 : Math.max(0, dot / (na * nb));
}

/** Pearson Correlation Coefficient — Ch.6 §2.3 */
export function vecPCC(a: string[], b: string[], tf: TFVariant = 'raw'): number {
  const [va, vb] = buildVectorPair(frequencies(a), frequencies(b), tf);
  const n   = va.length || 1;
  const mA  = va.reduce((s, v) => s + v, 0) / n;
  const mB  = vb.reduce((s, v) => s + v, 0) / n;
  const num = va.reduce((s, v, i) => s + (v - mA) * (vb[i] - mB), 0);
  const dA  = Math.sqrt(va.reduce((s, v) => s + (v - mA) ** 2, 0));
  const dB  = Math.sqrt(vb.reduce((s, v) => s + (v - mB) ** 2, 0));
  return dA * dB === 0 ? 0 : Math.max(0, num / (dA * dB));
}

/** Euclidean: Sim = 1/(1+dist) — Ch.6 §2.3 */
export function vecEuclidean(a: string[], b: string[], tf: TFVariant = 'raw'): number {
  const [va, vb] = buildVectorPair(frequencies(a), frequencies(b), tf);
  const dist = Math.sqrt(va.reduce((s, v, i) => s + (v - vb[i]) ** 2, 0));
  return 1 / (1 + dist);
}

/** Manhattan: Sim = 1/(1+dist) — Ch.6 §2.3 */
export function vecManhattan(a: string[], b: string[], tf: TFVariant = 'raw'): number {
  const [va, vb] = buildVectorPair(frequencies(a), frequencies(b), tf);
  const dist = va.reduce((s, v, i) => s + Math.abs(v - vb[i]), 0);
  return 1 / (1 + dist);
}

/** Tanimoto: (A·B) / (|A|²+|B|²−A·B) — equivalent to Jaccard on positive vectors — Ch.6 §2.3 */
export function vecTanimoto(a: string[], b: string[], tf: TFVariant = 'raw'): number {
  const [va, vb] = buildVectorPair(frequencies(a), frequencies(b), tf);
  const dot = va.reduce((s, v, i) => s + v * vb[i], 0);
  const na2 = va.reduce((s, v) => s + v * v, 0);
  const nb2 = vb.reduce((s, v) => s + v * v, 0);
  const den = na2 + nb2 - dot;
  return den === 0 ? 1 : Math.max(0, dot / den);
}

/** Dice (vector): 2(A·B) / (|A|²+|B|²) — Ch.6 §2.3 */
export function vecDice(a: string[], b: string[], tf: TFVariant = 'raw'): number {
  const [va, vb] = buildVectorPair(frequencies(a), frequencies(b), tf);
  const dot = va.reduce((s, v, i) => s + v * vb[i], 0);
  const na2 = va.reduce((s, v) => s + v * v, 0);
  const nb2 = vb.reduce((s, v) => s + v * v, 0);
  return (na2 + nb2) === 0 ? 1 : Math.max(0, (2 * dot) / (na2 + nb2));
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE EXTRACTORS  (Ch.6 §3)
// ─────────────────────────────────────────────────────────────────────────────

/** Tag-based: pre-order sequence of all node labels — Ch.6 §3.1 */
export function extractTags(node: TreeNode): string[] {
  return [node.label, ...node.children.flatMap(c => extractTags(c))];
}

/** Edge-based: "parent/child" strings for every edge — Ch.6 §3.2 */
export function extractEdges(node: TreeNode): string[] {
  return [
    ...node.children.map(c => `${node.label}/${c.label}`),
    ...node.children.flatMap(c => extractEdges(c)),
  ];
}

/** Path-based (root paths): root-to-leaf paths — Ch.6 §3.3 */
export function extractRootPaths(node: TreeNode, prefix = ''): string[] {
  const path = prefix ? `${prefix}/${node.label}` : node.label;
  if (node.children.length === 0) return [path];
  return node.children.flatMap(c => extractRootPaths(c, path));
}

/** Path-based (all paths): root-to-every-node paths — Ch.6 §3.3 */
export function extractAllPaths(node: TreeNode, prefix = ''): string[] {
  const path = prefix ? `${prefix}/${node.label}` : node.label;
  return [path, ...node.children.flatMap(c => extractAllPaths(c, path))];
}

/**
 * XPath-based: paths augmented with sibling position index.
 * e.g. root/gov[1]/type[1]  — Ch.6 §3.3
 */
export function extractXPaths(node: TreeNode, prefix = ''): string[] {
  const labelIdx: Record<string, number> = {};
  const results: string[] = [];
  for (const child of node.children) {
    labelIdx[child.label] = (labelIdx[child.label] || 0) + 1;
    const xp = `${prefix ? prefix + '/' : ''}${child.label}[${labelIdx[child.label]}]`;
    results.push(xp, ...extractXPaths(child, xp));
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// FFT APPROACH  (Ch.6 §3.4)
// ─────────────────────────────────────────────────────────────────────────────

function buildSkeleton(node: TreeNode): string[] {
  return [`<${node.label}>`, ...node.children.flatMap(buildSkeleton), `</${node.label}>`];
}

/** O(N²) DFT — sufficient for small demo trees */
function dft(signal: number[]): { re: number; im: number }[] {
  const N = signal.length;
  return signal.map((_, k) => {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const θ = (2 * Math.PI * k * n) / N;
      re += signal[n] * Math.cos(θ);
      im -= signal[n] * Math.sin(θ);
    }
    return { re: re / N, im: im / N };
  });
}

export function fftSimilarity(t1: TreeNode, t2: TreeNode): number {
  const skel1 = buildSkeleton(t1);
  const skel2 = buildSkeleton(t2);

  // Assign distinct amplitude per distinct open tag; close tag = negative
  const allTags = [...new Set([...skel1, ...skel2])];
  const ampMap: Record<string, number> = {};
  let amp = 1;
  for (const tag of allTags) {
    if (tag.startsWith('</')) {
      const open = tag.replace('</', '<');
      ampMap[tag] = -(ampMap[open] ?? amp);
    } else {
      ampMap[tag] = amp++;
    }
  }

  const maxLen = Math.max(skel1.length, skel2.length);
  const sig1 = [...skel1.map(t => ampMap[t] ?? 0), ...Array(maxLen - skel1.length).fill(0)];
  const sig2 = [...skel2.map(t => ampMap[t] ?? 0), ...Array(maxLen - skel2.length).fill(0)];

  const mag1 = dft(sig1).map(c => Math.sqrt(c.re ** 2 + c.im ** 2));
  const mag2 = dft(sig2).map(c => Math.sqrt(c.re ** 2 + c.im ** 2));

  const dot = mag1.reduce((s, v, i) => s + v * mag2[i], 0);
  const n1  = Math.sqrt(mag1.reduce((s, v) => s + v * v, 0));
  const n2  = Math.sqrt(mag2.reduce((s, v) => s + v * v, 0));
  return n1 * n2 === 0 ? 0 : Math.max(0, Math.min(1, dot / (n1 * n2)));
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAWATHE LD-PAIR TED  (Ch.5 §3.2)
// ─────────────────────────────────────────────────────────────────────────────

interface LDPair { label: string; depth: number; }

function treeToLD(node: TreeNode): LDPair[] {
  // Use tedLabel so leaf nodes are compared by their stored value, not just name
  return [{ label: tedLabel(node), depth: node.depth }, ...node.children.flatMap(treeToLD)];
}

/** Condition 1 (Chawathe): update only when nodes are at the same depth */
function ldRelabelCost(a: LDPair, b: LDPair): number {
  if (a.depth !== b.depth) return Infinity;
  return relabelCost(a.label, b.label);
}

export function chawatheED(
  t1: TreeNode,
  t2: TreeNode,
): { ted: number; sizeA: number; sizeB: number } {
  const A = treeToLD(t1), B = treeToLD(t2);
  const n = A.length, m = B.length;
  const D: number[][] = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const rc  = ldRelabelCost(A[i - 1], B[j - 1]);
      const upd = rc === Infinity ? Infinity : D[i - 1][j - 1] + rc;
      D[i][j]   = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, upd);
    }
  }
  return { ted: D[n][m], sizeA: n, sizeB: m };
}

// ─────────────────────────────────────────────────────────────────────────────
// NIERMAN & JAGADISH RECURSIVE TED  (Ch.5 §3.3)
// ─────────────────────────────────────────────────────────────────────────────

export function countNodes(n: TreeNode): number {
  return 1 + n.children.reduce((s, c) => s + countNodes(c), 0);
}

/** T1 is contained-in T2 when all T1 nodes appear in T2 with same relative parent/child order */
function isContainedIn(a: TreeNode, b: TreeNode): boolean {
  if (a.label !== b.label) return false;
  let bi = 0;
  for (const ac of a.children) {
    let found = false;
    while (bi < b.children.length) {
      if (isContainedIn(ac, b.children[bi++])) { found = true; break; }
    }
    if (!found) return false;
  }
  return true;
}

function niermanRec(t1: TreeNode, t2: TreeNode): number {
  const fls1 = t1.children, fls2 = t2.children;
  const k = fls1.length, l = fls2.length;
  const D: number[][] = Array.from({ length: k + 1 }, (_, i) =>
    Array.from({ length: l + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= k; i++) {
    for (let j = 1; j <= l; j++) {
      // Cost = 1 when sub-tree is contained-in opposite tree; else full node count
      const ins = isContainedIn(fls2[j - 1], t1) ? 1 : countNodes(fls2[j - 1]);
      const del = isContainedIn(fls1[i - 1], t2) ? 1 : countNodes(fls1[i - 1]);
      const sub = niermanRec(fls1[i - 1], fls2[j - 1])
                + relabelCost(tedLabel(fls1[i - 1]), tedLabel(fls2[j - 1]));
      D[i][j] = Math.min(D[i - 1][j] + del, D[i][j - 1] + ins, D[i - 1][j - 1] + sub);
    }
  }
  return D[k][l] + relabelCost(tedLabel(t1), tedLabel(t2));
}

export function niermanED(
  t1: TreeNode,
  t2: TreeNode,
): { ted: number; sizeA: number; sizeB: number } {
  return { ted: niermanRec(t1, t2), sizeA: countNodes(t1), sizeB: countNodes(t2) };
}

// ─────────────────────────────────────────────────────────────────────────────
// ZHANG-SHASHA TED  (Zhang & Shasha 1989)
// ─────────────────────────────────────────────────────────────────────────────

interface ZSData {
  nodes: TreeNode[];   // postorder ordering, index 0 = first postorder node, so node i is at nodes[i-1]
  lmd: number[];       // lmd[i] (1-based) = postorder index of leftmost leaf descendant of node i
  keyroots: number[];  // sorted keyroot postorder indices (1-based)
}

function buildZSData(root: TreeNode): ZSData {
  const nodes: TreeNode[] = [];
  const postIdx = new Map<string, number>(); // node.id → 1-based postorder index

  // Postorder traversal
  function postorder(node: TreeNode): void {
    for (const child of node.children) postorder(child);
    nodes.push(node);
    postIdx.set(node.id, nodes.length);
  }
  postorder(root);

  const n = nodes.length;
  const lmd: number[] = new Array(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    const node = nodes[i - 1];
    if (node.children.length === 0) {
      lmd[i] = i;
    } else {
      // Leftmost leaf descendant of i = lmd of leftmost child of i
      const leftChild = node.children[0];
      lmd[i] = lmd[postIdx.get(leftChild.id)!];
    }
  }

  // Keyroots: for each distinct lmd value, keep the largest postorder index
  const lmdToMax = new Map<number, number>();
  for (let i = 1; i <= n; i++) lmdToMax.set(lmd[i], i);
  const keyroots = [...lmdToMax.values()].sort((a, b) => a - b);

  return { nodes, lmd, keyroots };
}

export function zhangShashaED(
  t1: TreeNode,
  t2: TreeNode,
): { ted: number; sizeA: number; sizeB: number } {
  const d1 = buildZSData(t1);
  const d2 = buildZSData(t2);
  const n = d1.nodes.length;
  const m = d2.nodes.length;

  // TD[i][j] = TED between subtree rooted at postorder node i in T1 and j in T2
  const TD: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  const computeForestDist = (i: number, j: number) => {
    const l1 = d1.lmd[i];
    const l2 = d2.lmd[j];
    // FD is indexed as FD[ip - (l1-1)][jp - (l2-1)], with index 0 = empty forest (l1-1 or l2-1)
    const FD: number[][] = Array.from(
      { length: i - l1 + 2 },
      () => new Array(j - l2 + 2).fill(0),
    );
    // Base cases
    for (let ip = l1; ip <= i; ip++) FD[ip - (l1 - 1)][0] = FD[ip - (l1 - 1) - 1][0] + 1;
    for (let jp = l2; jp <= j; jp++) FD[0][jp - (l2 - 1)] = FD[0][jp - (l2 - 1) - 1] + 1;

    for (let ip = l1; ip <= i; ip++) {
      for (let jp = l2; jp <= j; jp++) {
        const a = ip - (l1 - 1);
        const b = jp - (l2 - 1);
        const del = FD[a - 1][b] + 1;
        const ins = FD[a][b - 1] + 1;
        if (d1.lmd[ip] === l1 && d2.lmd[jp] === l2) {
          // Both are subtrees — compute relabel cost and record in TD
          const rc = relabelCost(tedLabel(d1.nodes[ip - 1]), tedLabel(d2.nodes[jp - 1]));
          FD[a][b] = Math.min(del, ins, FD[a - 1][b - 1] + rc);
          TD[ip][jp] = FD[a][b];
        } else {
          // Forest across keyroot boundary: use previously computed subtree TED
          const prevA = d1.lmd[ip] - l1; // = lmd(ip) - (l1-1) - 1
          const prevB = d2.lmd[jp] - l2; // = lmd(jp) - (l2-1) - 1
          FD[a][b] = Math.min(del, ins, FD[prevA][prevB] + TD[ip][jp]);
        }
      }
    }
  };

  for (const i of d1.keyroots) {
    for (const j of d2.keyroots) {
      computeForestDist(i, j);
    }
  }

  return { ted: TD[n][m], sizeA: n, sizeB: m };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DISPATCHER
// ─────────────────────────────────────────────────────────────────────────────

export function computeSimilarity(
  t1: TreeNode,
  t2: TreeNode,
  cfg: SimilarityConfig,
  selectedMetrics?: string[],
): SimilarityResult {
  // Filter to only the user-selected metrics (if provided)
  const ft1 = selectedMetrics && selectedMetrics.length > 0 ? filterTreeByMetrics(t1, selectedMetrics) : t1;
  const ft2 = selectedMetrics && selectedMetrics.length > 0 ? filterTreeByMetrics(t2, selectedMetrics) : t2;

  // ── TED-based ──────────────────────────────────────────────────────────────
  if (cfg.category === 'ted') {
    const { ted, sizeA, sizeB } = cfg.tedMethod === 'nierman'
      ? niermanED(ft1, ft2)
      : cfg.tedMethod === 'zhang-shasha'
        ? zhangShashaED(ft1, ft2)
        : chawatheED(ft1, ft2);

    // Default to formula3 (Rule 6 normalized distance): 1 − TED/max(|A|,|B|)
    // This gives meaningful [0,1] scores for large structured-data trees.
    const norm = cfg.tedNormalization ?? 'formula3';
    const sim  = norm === 'formula1'
      ? normFormula1(ted)
      : norm === 'formula2'
        ? normFormula2(ted, sizeA, sizeB)
        : normFormula3(ted, sizeA, sizeB);

    const algName = cfg.tedMethod === 'nierman'
      ? 'Nierman & Jagadish'
      : cfg.tedMethod === 'zhang-shasha'
        ? 'Zhang-Shasha'
        : 'Chawathe';
    const fmtNorm = norm === 'formula1'
      ? '1/(1+TED)'
      : norm === 'formula2'
        ? '1−TED/(|A|+|B|)'
        : '1−TED/max(|A|,|B|)';
    return { sim, ted, sizeA, sizeB, label: `${algName} — ${fmtNorm}` };
  }

  // ── FFT ────────────────────────────────────────────────────────────────────
  if (cfg.approxMethod === 'fft') {
    return { sim: fftSimilarity(ft1, ft2), featuresA: [], featuresB: [], label: 'FFT Spectrum (Cosine)' };
  }

  // ── Approximation (tag / edge / path) ─────────────────────────────────────
  const getFeatures = (): [string[], string[]] => {
    switch (cfg.approxMethod) {
      case 'tag':        return [extractTags(ft1),      extractTags(ft2)];
      case 'edge':       return [extractEdges(ft1),     extractEdges(ft2)];
      case 'path-root':  return [extractRootPaths(ft1), extractRootPaths(ft2)];
      case 'path-all':   return [extractAllPaths(ft1),  extractAllPaths(ft2)];
      case 'path-xpath': return [extractXPaths(ft1),    extractXPaths(ft2)];
      default:           return [[], []];
    }
  };
  const [fa, fb] = getFeatures();

  const variant = cfg.approxVariant ?? 'set';
  const measure = cfg.approxMeasure ?? 'jaccard';
  const tf      = cfg.tfVariant ?? 'raw';

  let sim = 0;
  if (variant === 'set') {
    if (measure === 'intersection') sim = setIntersectionSim(fa, fb);
    else if (measure === 'jaccard') sim = setJaccard(fa, fb);
    else if (measure === 'dice')    sim = setDice(fa, fb);
    else                            sim = setJaccard(fa, fb);
  } else if (variant === 'multiset') {
    if (measure === 'intersection') sim = multiIntersectionSim(fa, fb);
    else if (measure === 'jaccard') sim = multiJaccard(fa, fb);
    else if (measure === 'dice')    sim = multiDice(fa, fb);
    else                            sim = multiJaccard(fa, fb);
  } else {
    // vector
    if      (measure === 'cosine')    sim = vecCosine(fa, fb, tf);
    else if (measure === 'pcc')       sim = vecPCC(fa, fb, tf);
    else if (measure === 'euclidean') sim = vecEuclidean(fa, fb, tf);
    else if (measure === 'manhattan') sim = vecManhattan(fa, fb, tf);
    else if (measure === 'tanimoto')  sim = vecTanimoto(fa, fb, tf);
    else if (measure === 'dice')      sim = vecDice(fa, fb, tf);
    else                              sim = vecCosine(fa, fb, tf);
  }

  const tfSuffix = variant === 'vector' ? `/${tf}` : '';
  return {
    sim: Math.max(0, Math.min(1, sim)),
    featuresA: fa,
    featuresB: fb,
    label: `${cfg.approxMethod} · ${variant}/${measure}${tfSuffix}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPARE ALL METHODS  (used by "Compare" panel in AlgorithmExecution)
// ─────────────────────────────────────────────────────────────────────────────

const ALL_CONFIGS: SimilarityConfig[] = [
  // TED-based — formula3 first (recommended Rule 6)
  { category: 'ted', tedMethod: 'chawathe',     tedNormalization: 'formula3' },
  { category: 'ted', tedMethod: 'nierman',      tedNormalization: 'formula3' },
  { category: 'ted', tedMethod: 'zhang-shasha', tedNormalization: 'formula3' },
  { category: 'ted', tedMethod: 'chawathe',     tedNormalization: 'formula2' },
  { category: 'ted', tedMethod: 'nierman',      tedNormalization: 'formula2' },
  { category: 'ted', tedMethod: 'zhang-shasha', tedNormalization: 'formula2' },
  { category: 'ted', tedMethod: 'chawathe',     tedNormalization: 'formula1' },
  { category: 'ted', tedMethod: 'nierman',      tedNormalization: 'formula1' },
  { category: 'ted', tedMethod: 'zhang-shasha', tedNormalization: 'formula1' },
  // Approximation — tag
  { category: 'approximation', approxMethod: 'tag', approxVariant: 'set',      approxMeasure: 'jaccard' },
  { category: 'approximation', approxMethod: 'tag', approxVariant: 'multiset', approxMeasure: 'jaccard' },
  { category: 'approximation', approxMethod: 'tag', approxVariant: 'vector',   approxMeasure: 'cosine', tfVariant: 'raw' },
  { category: 'approximation', approxMethod: 'tag', approxVariant: 'vector',   approxMeasure: 'cosine', tfVariant: 'log' },
  // Approximation — edge
  { category: 'approximation', approxMethod: 'edge', approxVariant: 'set',     approxMeasure: 'jaccard' },
  { category: 'approximation', approxMethod: 'edge', approxVariant: 'vector',  approxMeasure: 'cosine', tfVariant: 'raw' },
  // Approximation — path
  { category: 'approximation', approxMethod: 'path-root',  approxVariant: 'set',    approxMeasure: 'jaccard' },
  { category: 'approximation', approxMethod: 'path-all',   approxVariant: 'set',    approxMeasure: 'jaccard' },
  { category: 'approximation', approxMethod: 'path-xpath', approxVariant: 'set',    approxMeasure: 'jaccard' },
  { category: 'approximation', approxMethod: 'path-root',  approxVariant: 'vector', approxMeasure: 'cosine', tfVariant: 'raw' },
  // FFT
  { category: 'approximation', approxMethod: 'fft' },
];

export function computeAllMethods(
  t1: TreeNode,
  t2: TreeNode,
  selectedMetrics?: string[],
): SimilarityResult[] {
  return ALL_CONFIGS.map(c => computeSimilarity(t1, t2, c, selectedMetrics));
}

// ─────────────────────────────────────────────────────────────────────────────
// EDIT SCRIPT & NODE COUNT
// ─────────────────────────────────────────────────────────────────────────────

function preorderLabelsList(node: TreeNode): string[] {
  return [node.label, ...node.children.flatMap(c => preorderLabelsList(c))];
}

/** Compute an edit script between two trees via preorder-sequence edit distance. */
export function computeEditScript(T1: TreeNode, T2: TreeNode): EditOperation[] {
  const labels1 = preorderLabelsList(T1);
  const labels2 = preorderLabelsList(T2);
  const n = labels1.length;
  const m = labels2.length;

  // Build DP table
  const dp: number[][] = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = labels1[i - 1] === labels2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + sub);
    }
  }

  // Backtrack
  const ops: EditOperation[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const sub = labels1[i - 1] === labels2[j - 1] ? 0 : 1;
      if (dp[i][j] === dp[i - 1][j - 1] + sub) {
        if (sub === 1) {
          ops.unshift({ type: 'update', node: labels1[i - 1], from: labels1[i - 1], to: labels2[j - 1], cost: 1 });
        }
        i--; j--;
        continue;
      }
    }
    if (i > 0 && (j === 0 || dp[i][j] === dp[i - 1][j] + 1)) {
      ops.unshift({ type: 'delete', node: labels1[i - 1], cost: 1 });
      i--;
    } else {
      ops.unshift({ type: 'insert', node: labels2[j - 1], cost: 1 });
      j--;
    }
  }
  return ops;
}
