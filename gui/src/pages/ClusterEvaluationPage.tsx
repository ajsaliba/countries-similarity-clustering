import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Network } from 'lucide-react';
import {
  silhouette, daviesBouldin, dunnIndex, classicalMDS,
} from '../services/clusteringService';

interface StoredResult {
  algorithm: string;
  k: number;
  labels: number[];
  matrix: number[][];
  countries: string[];
  timestamp: string;
}

function quality(metric: 'silhouette' | 'db' | 'dunn', value: number): { label: string; color: string } {
  if (metric === 'silhouette') {
    if (value > 0.5) return { label: 'Good', color: 'text-accent-600 bg-accent-50' };
    if (value > 0.25) return { label: 'Fair', color: 'text-yellow-600 bg-yellow-50' };
    return { label: 'Poor', color: 'text-red-600 bg-red-50' };
  }
  if (metric === 'db') {
    if (value < 1.0) return { label: 'Good', color: 'text-accent-600 bg-accent-50' };
    if (value < 2.0) return { label: 'Fair', color: 'text-yellow-600 bg-yellow-50' };
    return { label: 'Poor', color: 'text-red-600 bg-red-50' };
  }
  // dunn
  if (value > 1.0) return { label: 'Good', color: 'text-accent-600 bg-accent-50' };
  if (value > 0.5) return { label: 'Fair', color: 'text-yellow-600 bg-yellow-50' };
  return { label: 'Poor', color: 'text-red-600 bg-red-50' };
}

function clusterColor(ci: number, k: number): string {
  return `hsl(${Math.round((ci * 360) / k)}, 70%, 50%)`;
}

// ── 2D Scatter Plot ────────────────────────────────────────────────────────────

function ScatterPlot({ points }: { points: { x: number; y: number; country: string; cluster: number }[]; k: number }) {
  const [hovered, setHovered] = useState<string | null>(null);
  if (points.length === 0) return null;

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const W = 500, H = 400, pad = 40;
  const toSvg = (x: number, y: number) => ({
    cx: pad + ((x - minX) / rangeX) * (W - 2 * pad),
    cy: H - pad - ((y - minY) / rangeY) * (H - 2 * pad),
  });

  const k = Math.max(...points.map(p => p.cluster)) + 1;

  return (
    <div className="relative">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* Axes */}
        <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="#e5e7eb" strokeWidth={1} />
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#e5e7eb" strokeWidth={1} />

        {points.map((p, i) => {
          const { cx, cy } = toSvg(p.x, p.y);
          const color = clusterColor(p.cluster, k);
          return (
            <g key={i}>
              <circle
                cx={cx} cy={cy} r={6}
                fill={color}
                opacity={0.85}
                onMouseEnter={() => setHovered(p.country)}
                onMouseLeave={() => setHovered(null)}
                className="cursor-pointer"
              />
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div className="absolute top-2 right-2 bg-gray-900 text-white text-xs px-2 py-1 rounded">
          {hovered}
        </div>
      )}
    </div>
  );
}

export function ClusterEvaluationPage() {
  const navigate = useNavigate();
  const [result, setResult] = useState<StoredResult | null>(null);
  const [sil, setSil] = useState<number | null>(null);
  const [db, setDb] = useState<number | null>(null);
  const [dunn, setDunn] = useState<number | null>(null);
  const [mdsPoints, setMdsPoints] = useState<{ x: number; y: number; country: string; cluster: number }[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('csc_v1_lastClusteringResult');
      if (!raw) return;
      const r = JSON.parse(raw) as StoredResult;
      setResult(r);

      const silVal = silhouette(r.matrix, r.labels);
      const dbVal = daviesBouldin(r.matrix, r.labels);
      const dunnVal = dunnIndex(r.matrix, r.labels);
      setSil(silVal);
      setDb(dbVal);
      setDunn(dunnVal);

      const pts2d = classicalMDS(r.matrix, 2);
      setMdsPoints(r.countries.map((name, i) => ({
        x: pts2d[i]?.[0] ?? 0,
        y: pts2d[i]?.[1] ?? 0,
        country: name,
        cluster: r.labels[i] ?? 0,
      })));
    } catch { /* invalid storage */ }
  }, []);

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 p-8">
        <Network size={48} className="mb-4 opacity-40" />
        <p className="text-lg font-medium text-gray-600 mb-2">No clustering result found</p>
        <p className="text-sm mb-6">Run clustering first to see evaluation metrics.</p>
        <button
          onClick={() => navigate('/clustering')}
          className="px-4 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700"
        >
          Go to Clustering
        </button>
      </div>
    );
  }

  const k = Math.max(...result.labels) + 1;
  const metrics = [
    { key: 'silhouette' as const, label: 'Silhouette', value: sil, formula: 'mean((b(i) − a(i)) / max(a(i), b(i)))', betterWhen: 'Higher (max 1.0)' },
    { key: 'db' as const, label: 'Davies-Bouldin', value: db, formula: 'mean(max_j((s_i + s_j) / d(c_i, c_j)))', betterWhen: 'Lower (min 0.0)' },
    { key: 'dunn' as const, label: 'Dunn Index', value: dunn, formula: 'min_inter / max_intra', betterWhen: 'Higher' },
  ];

  // Per-cluster stats
  const clusterStats = Array.from({ length: k }, (_, ci) => {
    const members = result.countries.filter((_, i) => result.labels[i] === ci);
    const memberIndices = result.labels.map((l, i) => l === ci ? i : -1).filter(i => i >= 0);

    let avgSim = 0;
    let representative = members[0] ?? '';
    if (memberIndices.length > 1) {
      const sims = memberIndices.map(i => {
        const avg = memberIndices.filter(j => j !== i).reduce((s, j) => s + result.matrix[i][j], 0) / (memberIndices.length - 1);
        return { country: result.countries[i], avg };
      });
      avgSim = sims.reduce((s, v) => s + v.avg, 0) / sims.length;
      representative = sims.reduce((best, v) => v.avg > best.avg ? v : best).country;
    }

    return { id: ci + 1, members, avgSim, representative };
  });

  return (
    <div className="p-6 space-y-6 overflow-y-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Cluster Evaluation</h1>
        <p className="text-sm text-gray-500">
          Algorithm: <span className="font-medium text-gray-700 capitalize">{result.algorithm}</span> ·
          {k} clusters · {result.countries.length} countries ·
          <span className="text-gray-400 ml-1">{new Date(result.timestamp).toLocaleString()}</span>
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {metrics.map(({ key, label, value, formula, betterWhen }) => {
          const q = value !== null ? quality(key, value) : null;
          return (
            <div key={key} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-gray-800">{label}</h3>
                {q && <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${q.color}`}>{q.label}</span>}
              </div>
              <p className="text-3xl font-bold text-gray-900 mb-1">
                {value !== null ? value.toFixed(2) : '—'}
              </p>
              <p className="text-[10px] font-mono text-gray-400 mb-1 truncate">{formula}</p>
              <p className="text-xs text-gray-500">{betterWhen}</p>
            </div>
          );
        })}
      </div>

      {/* Scatter plot */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-4">2D Projection (MDS)</h3>
        <ScatterPlot points={mdsPoints} k={k} />
      </div>

      {/* Per-cluster table */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-4">Per-Cluster Statistics</h3>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Cluster</th>
                <th className="px-4 py-2 text-left">Countries</th>
                <th className="px-4 py-2 text-right">Avg Intra-Similarity</th>
                <th className="px-4 py-2 text-left">Representative</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {clusterStats.map(cs => (
                <tr key={cs.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ background: clusterColor(cs.id - 1, k) }} />
                      {cs.id}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 max-w-xs truncate">{cs.members.join(', ')}</td>
                  <td className="px-4 py-3 text-right font-mono">{cs.avgSim.toFixed(3)}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{cs.representative}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}