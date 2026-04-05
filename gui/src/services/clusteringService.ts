// ── Clustering algorithms implemented in TypeScript ──────────────────────────

export interface DendrogramNode {
  id: string;
  left?: DendrogramNode;
  right?: DendrogramNode;
  height: number;
  indices: number[];
  label?: string;
}

export interface ClusteringResult {
  labels: number[];
  k: number;
  dendrogram?: DendrogramNode;
  algorithm: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function cloneMatrix(m: number[][]): number[][] {
  return m.map(row => [...row]);
}

/** Euclidean distance between two rows of the distance matrix (used as feature vectors) */
function rowDist(m: number[][], i: number, j: number): number {
  let s = 0;
  for (let k = 0; k < m[i].length; k++) {
    const d = m[i][k] - m[j][k];
    s += d * d;
  }
  return Math.sqrt(s);
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ── K-Means ──────────────────────────────────────────────────────────────────

export function kMeans(matrix: number[][], k: number, maxIter: number): number[] {
  const n = matrix.length;
  if (n === 0 || k <= 0) return [];
  const kk = Math.min(k, n);

  // Initialise centroids as first k rows
  let centroids: number[][] = matrix.slice(0, kk).map(row => [...row]);
  let labels = new Array<number>(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign
    const newLabels = matrix.map(row => {
      let best = 0;
      let bestDist = Infinity;
      centroids.forEach((c, ci) => {
        let d = 0;
        for (let j = 0; j < row.length; j++) d += (row[j] - c[j]) ** 2;
        if (d < bestDist) { bestDist = d; best = ci; }
      });
      return best;
    });

    // Check convergence
    if (newLabels.every((l, i) => l === labels[i])) break;
    labels = newLabels;

    // Update centroids
    centroids = Array.from({ length: kk }, (_, ci) => {
      const members = matrix.filter((_, i) => labels[i] === ci);
      if (members.length === 0) return [...matrix[ci]];
      return matrix[0].map((_, j) => mean(members.map(row => row[j])));
    });
  }

  return labels;
}

// ── Agglomerative ─────────────────────────────────────────────────────────────

function linkageDist(
  dist: number[][],
  a: number[],
  b: number[],
  linkage: 'single' | 'complete' | 'average' | 'ward',
): number {
  const dists = a.flatMap(i => b.map(j => dist[i][j]));
  switch (linkage) {
    case 'single': return Math.min(...dists);
    case 'complete': return Math.max(...dists);
    case 'average': return mean(dists);
    case 'ward': {
      const n1 = a.length, n2 = b.length;
      const c1 = a.reduce((s, i) => a.map((_, j) => s[j] + dist[i][j] / n1), new Array(dist.length).fill(0));
      const c2 = b.reduce((s, i) => b.map((_, j) => s[j] + dist[i][j] / n2), new Array(dist.length).fill(0));
      return mean(c1.map((v, i) => (v - c2[i]) ** 2));
    }
  }
}

export function agglomerative(
  matrix: number[][],
  k: number,
  linkage: 'single' | 'complete' | 'average' | 'ward',
): { labels: number[]; dendrogram: DendrogramNode } {
  const n = matrix.length;
  const dist = cloneMatrix(matrix);

  // Each node starts as its own cluster
  let clusters: number[][] = Array.from({ length: n }, (_, i) => [i]);
  let nodes: DendrogramNode[] = clusters.map((_, i) => ({
    id: String(i),
    height: 0,
    indices: [i],
    label: String(i),
  }));

  let nextId = n;

  while (clusters.length > Math.max(k, 1)) {
    let minD = Infinity;
    let mergeA = 0, mergeB = 1;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = linkageDist(dist, clusters[i], clusters[j], linkage);
        if (d < minD) { minD = d; mergeA = i; mergeB = j; }
      }
    }

    const merged = [...clusters[mergeA], ...clusters[mergeB]];
    const mergedNode: DendrogramNode = {
      id: String(nextId++),
      left: nodes[mergeA],
      right: nodes[mergeB],
      height: minD,
      indices: merged,
    };

    clusters.splice(mergeB, 1);
    clusters.splice(mergeA, 1, merged);
    nodes.splice(mergeB, 1);
    nodes.splice(mergeA, 1, mergedNode);
  }

  const labels = new Array<number>(n).fill(0);
  clusters.forEach((cluster, ci) => {
    cluster.forEach(i => { labels[i] = ci; });
  });

  const root = nodes.length === 1 ? nodes[0] : {
    id: String(nextId),
    left: nodes[0],
    right: nodes[1],
    height: 0,
    indices: Array.from({ length: n }, (_, i) => i),
  };

  return { labels, dendrogram: root };
}

// ── Divisive ──────────────────────────────────────────────────────────────────

function maxIntraDist(dist: number[][], cluster: number[]): number {
  if (cluster.length <= 1) return 0;
  let max = 0;
  for (let i = 0; i < cluster.length; i++) {
    for (let j = i + 1; j < cluster.length; j++) {
      max = Math.max(max, dist[cluster[i]][cluster[j]]);
    }
  }
  return max;
}

function bisect(dist: number[][], cluster: number[]): [number[], number[]] {
  // Find the point with the highest avg dissimilarity; split around it
  const avgDists = cluster.map(i =>
    mean(cluster.filter(j => j !== i).map(j => dist[i][j])),
  );
  const pivot = cluster[avgDists.indexOf(Math.max(...avgDists))];

  const a: number[] = [];
  const b: number[] = [];
  cluster.forEach(i => {
    if (i === pivot) { a.push(i); return; }
    (dist[i][pivot] > mean(cluster.map(j => dist[i][j])) ? b : a).push(i);
  });

  if (a.length === 0) a.push(b.pop()!);
  if (b.length === 0) b.push(a.pop()!);

  return [a, b];
}

export function divisive(matrix: number[][], threshold: number): number[] {
  const n = matrix.length;
  // Convert similarity to distance (1 - sim)
  const dist = matrix.map(row => row.map(v => 1 - v));

  let clusters: number[][] = [Array.from({ length: n }, (_, i) => i)];

  let changed = true;
  while (changed) {
    changed = false;
    const next: number[][] = [];
    for (const cluster of clusters) {
      if (cluster.length > 1 && maxIntraDist(dist, cluster) > threshold) {
        const [a, b] = bisect(dist, cluster);
        next.push(a, b);
        changed = true;
      } else {
        next.push(cluster);
      }
    }
    clusters = next;
  }

  const labels = new Array<number>(n).fill(0);
  clusters.forEach((cluster, ci) => {
    cluster.forEach(i => { labels[i] = ci; });
  });

  return labels;
}

// ── Spectral ─────────────────────────────────────────────────────────────────

function matMul(A: number[][], B: number[][]): number[][] {
  const n = A.length, m = B[0].length, p = B.length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: m }, (_, j) =>
      Array.from({ length: p }, (_, k) => A[i][k] * B[k][j]).reduce((a, b) => a + b, 0),
    ),
  );
}

function normalize(v: number[]): number[] {
  const len = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map(x => x / len);
}

/** Power iteration for the top eigenvector of a symmetric matrix */
function powerIter(A: number[][], iters = 100): number[] {
  const n = A.length;
  let v = Array.from({ length: n }, () => Math.random() - 0.5);
  v = normalize(v);
  for (let i = 0; i < iters; i++) {
    const Av = A.map(row => row.reduce((s, aij, j) => s + aij * v[j], 0));
    v = normalize(Av);
  }
  return v;
}

/** Deflate: A -= λ * v * vT */
function deflate(A: number[][], v: number[]): number[][] {
  const lambda = v.reduce((s, vi, i) => s + A[i].map((aij, j) => aij * v[j]).reduce((a, b) => a + b, 0), 0) / v.length;
  return A.map((row, i) => row.map((aij, j) => aij - lambda * v[i] * v[j]));
}

export function spectral(matrix: number[][], k: number): number[] {
  const n = matrix.length;
  const kk = Math.min(k, n);

  // Normalized graph Laplacian
  // D = degree matrix (sum of similarity row), L = D^{-1/2}(D-W)D^{-1/2}
  const degrees = matrix.map(row => row.reduce((a, b) => a + b, 0));
  const D_inv_sqrt = degrees.map(d => (d > 0 ? 1 / Math.sqrt(d) : 0));

  // Normalized Laplacian: I - D^{-1/2} W D^{-1/2}
  const L: number[][] = matrix.map((row, i) =>
    row.map((w, j) => {
      const norm = D_inv_sqrt[i] * w * D_inv_sqrt[j];
      return i === j ? 1 - norm : -norm;
    }),
  );

  // Get top-k eigenvectors via power iteration with deflation
  const eigvecs: number[][] = [];
  let Lwork = L.map(row => [...row]);

  for (let e = 0; e < kk; e++) {
    const v = powerIter(Lwork);
    eigvecs.push(v);
    Lwork = deflate(Lwork, v);
  }

  // Build feature matrix: rows = countries, cols = eigenvectors
  const features: number[][] = Array.from({ length: n }, (_, i) =>
    eigvecs.map(v => v[i]),
  );

  return kMeans(features, kk, 300);
}

// ── MDS (Classical Multi-Dimensional Scaling) ─────────────────────────────────

export function classicalMDS(distMatrix: number[][], dims = 2): number[][] {
  const n = distMatrix.length;
  if (n <= 1) return [[0, 0]];

  // Convert similarity to squared distances
  const D2 = distMatrix.map(row => row.map(v => (1 - v) ** 2));

  // Double-centering
  const rowMeans = D2.map(row => mean(row));
  const totalMean = mean(rowMeans);

  const B: number[][] = D2.map((row, i) =>
    row.map((d, j) => -0.5 * (d - rowMeans[i] - rowMeans[j] + totalMean)),
  );

  // Top-dims eigenvectors of B
  const points: number[][] = Array.from({ length: n }, () => new Array(dims).fill(0));
  let Bwork = B.map(row => [...row]);

  for (let d = 0; d < Math.min(dims, n - 1); d++) {
    const v = powerIter(Bwork, 200);
    const lambda = v.reduce((s, vi, i) =>
      s + Bwork[i].reduce((ss, bij, j) => ss + bij * v[j], 0) * vi, 0);
    const scale = Math.sqrt(Math.abs(lambda));
    for (let i = 0; i < n; i++) points[i][d] = v[i] * scale;
    Bwork = deflate(Bwork, v);
  }

  return points;
}

// ── Evaluation metrics ────────────────────────────────────────────────────────

export function silhouette(matrix: number[][], labels: number[]): number {
  const n = matrix.length;
  if (n <= 1) return 0;

  const scores = labels.map((ci, i) => {
    const same = labels.map((c, j) => c === ci && j !== i ? j : -1).filter(j => j >= 0);
    const diff = [...new Set(labels.filter(c => c !== ci))];

    if (same.length === 0) return 0;

    const a = mean(same.map(j => 1 - matrix[i][j])); // intra-cluster dist
    const b = Math.min(...diff.map(c => {
      const peers = labels.map((lc, j) => lc === c ? j : -1).filter(j => j >= 0);
      return mean(peers.map(j => 1 - matrix[i][j]));
    }));

    if (isNaN(b) || !isFinite(b)) return 0;
    return (b - a) / Math.max(a, b);
  });

  return mean(scores);
}

export function daviesBouldin(matrix: number[][], labels: number[]): number {
  const k = Math.max(...labels) + 1;
  const clusterIndices = Array.from({ length: k }, (_, c) =>
    labels.map((l, i) => l === c ? i : -1).filter(i => i >= 0),
  );

  // Average intra-cluster distance (scatter)
  const scatter = clusterIndices.map(cl => {
    if (cl.length <= 1) return 0;
    const dists: number[] = [];
    for (let a = 0; a < cl.length; a++) {
      for (let b = a + 1; b < cl.length; b++) {
        dists.push(1 - matrix[cl[a]][cl[b]]);
      }
    }
    return mean(dists);
  });

  // Centroid-to-centroid distance (approximated as avg inter-cluster similarity)
  const centDist = (ci: number, cj: number): number => {
    const iI = clusterIndices[ci];
    const iJ = clusterIndices[cj];
    const dists = iI.flatMap(a => iJ.map(b => 1 - matrix[a][b]));
    return mean(dists);
  };

  const dbIndex = clusterIndices.map((_, i) => {
    const ratios = clusterIndices.map((_, j) => {
      if (i === j) return -Infinity;
      const d = centDist(i, j);
      return d > 0 ? (scatter[i] + scatter[j]) / d : 0;
    });
    return Math.max(...ratios);
  });

  return mean(dbIndex.filter(v => isFinite(v) && !isNaN(v)));
}

export function dunnIndex(matrix: number[][], labels: number[]): number {
  const k = Math.max(...labels) + 1;
  const clusterIndices = Array.from({ length: k }, (_, c) =>
    labels.map((l, i) => l === c ? i : -1).filter(i => i >= 0),
  );

  // Min inter-cluster distance
  let minInter = Infinity;
  for (let ci = 0; ci < k; ci++) {
    for (let cj = ci + 1; cj < k; cj++) {
      for (const a of clusterIndices[ci]) {
        for (const b of clusterIndices[cj]) {
          minInter = Math.min(minInter, 1 - matrix[a][b]);
        }
      }
    }
  }

  // Max intra-cluster distance
  let maxIntra = 0;
  for (const cl of clusterIndices) {
    for (let a = 0; a < cl.length; a++) {
      for (let b = a + 1; b < cl.length; b++) {
        maxIntra = Math.max(maxIntra, 1 - matrix[cl[a]][cl[b]]);
      }
    }
  }

  return maxIntra > 0 ? minInter / maxIntra : 0;
}