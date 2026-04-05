import { useState, useCallback } from 'react';
import { Play, AlertTriangle } from 'lucide-react';
import { ComposableMap, Geographies, Geography } from 'react-simple-maps';
import { countries as allCountries } from '../data/countries';
import { SvgHeatmap } from '../components/SvgHeatmap';
import {
  kMeans, agglomerative, divisive, spectral, DendrogramNode,
} from '../services/clusteringService';

type Algorithm = 'kmeans' | 'agglomerative' | 'divisive' | 'spectral';
type Linkage = 'single' | 'complete' | 'average' | 'ward';
type Metric = 'ted' | 'structure' | 'content';
type CountrySubset = 'all' | 'select';

interface MatrixResponse {
  matrix: number[][];
  countries: string[];
}

function clusterColor(ci: number, k: number): string {
  return `hsl(${Math.round((ci * 360) / k)}, 70%, 50%)`;
}

// ── Dendrogram SVG ────────────────────────────────────────────────────────────

function DendrogramSvg({ root, labels }: { root: DendrogramNode; labels: string[] }) {
  const width = Math.max(600, labels.length * 24);
  const height = 300;
  const bottom = height - 60;
  const pad = 30;

  const leafPositions: Record<number, number> = {};
  const leafCount = labels.length;
  labels.forEach((_, i) => {
    leafPositions[i] = pad + (i / Math.max(leafCount - 1, 1)) * (width - 2 * pad);
  });

  const maxH = root.height;
  const yForHeight = (h: number) => bottom - (h / Math.max(maxH, 0.001)) * (bottom - 20);

  const lines: React.ReactNode[] = [];
  let key = 0;

  function drawNode(node: DendrogramNode): number {
    if (!node.left && !node.right) {
      return leafPositions[node.indices[0]] ?? pad;
    }
    const lx = node.left ? drawNode(node.left) : pad;
    const rx = node.right ? drawNode(node.right) : pad;
    const ny = yForHeight(node.height);
    const cx = (lx + rx) / 2;

    lines.push(
      <line key={key++} x1={lx} y1={ny} x2={rx} y2={ny} stroke="#6b7280" strokeWidth={1.5} />,
      <line key={key++} x1={lx} y1={yForHeight(node.left?.height ?? 0)} x2={lx} y2={ny} stroke="#6b7280" strokeWidth={1.5} />,
      <line key={key++} x1={rx} y1={yForHeight(node.right?.height ?? 0)} x2={rx} y2={ny} stroke="#6b7280" strokeWidth={1.5} />,
    );

    return cx;
  }

  drawNode(root);

  return (
    <svg width={width} height={height} className="w-full h-auto">
      {lines}
      {labels.map((lbl, i) => (
        <text
          key={i}
          x={leafPositions[i]}
          y={bottom + 8}
          textAnchor="end"
          fontSize={9}
          fill="#6b7280"
          transform={`rotate(-45, ${leafPositions[i]}, ${bottom + 8})`}
        >
          {lbl.length > 8 ? lbl.slice(0, 8) + '…' : lbl}
        </text>
      ))}
    </svg>
  );
}

// ── Bubble Chart SVG ─────────────────────────────────────────────────────────

function BubbleChart({ labels, clusterLabels, k }: { labels: string[]; clusterLabels: number[]; k: number }) {
  const svgSize = 500;
  const cx = svgSize / 2, cy = svgSize / 2;
  const clusterR = 160;
  const nodeR = 40;

  const clusterCenters = Array.from({ length: k }, (_, i) => ({
    x: cx + clusterR * Math.cos((i * 2 * Math.PI) / k - Math.PI / 2),
    y: cy + clusterR * Math.sin((i * 2 * Math.PI) / k - Math.PI / 2),
  }));

  const clusterMembers: number[][] = Array.from({ length: k }, () => []);
  clusterLabels.forEach((c, i) => clusterMembers[c]?.push(i));

  return (
    <svg width={svgSize} height={svgSize} viewBox={`0 0 ${svgSize} ${svgSize}`} className="w-full h-auto">
      {clusterMembers.map((members, ci) => {
        const { x: ccx, y: ccy } = clusterCenters[ci];
        const color = clusterColor(ci, k);
        return (
          <g key={ci}>
            <circle cx={ccx} cy={ccy} r={nodeR + 10 + members.length * 4} fill={color} opacity={0.15} />
            <text x={ccx} y={ccy - nodeR - 6} textAnchor="middle" fontSize={11} fill={color} fontWeight="bold">
              Cluster {ci + 1}
            </text>
            {members.map((mi, j) => {
              const angle = (j * 2 * Math.PI) / Math.max(members.length, 1);
              const r = nodeR + 4;
              const nx = ccx + r * Math.cos(angle);
              const ny = ccy + r * Math.sin(angle);
              return (
                <g key={mi}>
                  <circle cx={nx} cy={ny} r={10} fill={color} opacity={0.7} />
                  <text x={nx} y={ny + 3} textAnchor="middle" fontSize={7} fill="white">
                    {labels[mi]?.slice(0, 3) ?? mi}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

// ── Cluster World Map ─────────────────────────────────────────────────────────

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

function ClusterMap({ clusterColors }: { clusterColors: Record<string, string> }) {
  // Build a lookup from numeric ISO code to color
  // react-simple-maps uses numeric ISO codes in the geography data
  return (
    <ComposableMap projectionConfig={{ scale: 140 }} style={{ width: '100%', height: 'auto' }}>
      <Geographies geography={GEO_URL}>
        {({ geographies }) =>
          geographies.map(geo => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const props = geo.properties as Record<string, any>;
            const iso2 = (props['Alpha-2'] ?? props['iso_a2'] ?? '') as string;
            const fill = clusterColors[iso2] ?? '#e5e7eb';
            return (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill={fill}
                stroke="#ffffff"
                strokeWidth={0.3}
                style={{ default: { outline: 'none' }, hover: { outline: 'none', opacity: 0.8 }, pressed: { outline: 'none' } }}
              />
            );
          })
        }
      </Geographies>
    </ComposableMap>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const SAMPLE_SIZE = 20;

export function ClusteringPage() {
  const [algorithm, setAlgorithm] = useState<Algorithm>('kmeans');
  const [k, setK] = useState(5);
  const [maxIter, setMaxIter] = useState(100);
  const [linkage, setLinkage] = useState<Linkage>('average');
  const [threshold, setThreshold] = useState(0.5);
  const [nClusters, setNClusters] = useState(5);
  const [metric, setMetric] = useState<Metric>('ted');
  const [subsetMode, setSubsetMode] = useState<CountrySubset>('all');
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [tab, setTab] = useState<'bubble' | 'dendrogram' | 'heatmap' | 'map'>('bubble');

  const [running, setRunning] = useState(false);
  const [matrix, setMatrix] = useState<number[][] | null>(null);
  const [countryList, setCountryList] = useState<string[]>([]);
  const [clusterLabels, setClusterLabels] = useState<number[]>([]);
  const [dendrogram, setDendrogram] = useState<DendrogramNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runClustering = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      let subset: string[];
      if (subsetMode === 'all') {
        const shuffled = [...allCountries].sort(() => Math.random() - 0.5);
        subset = shuffled.slice(0, SAMPLE_SIZE).map(c => c.name);
      } else {
        subset = selectedCountries.length >= 2 ? selectedCountries : allCountries.slice(0, SAMPLE_SIZE).map(c => c.name);
      }

      const res = await fetch('/api/ted/clustering/matrix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countries: subset, dataset: 'clean', method: metric === 'ted' ? 'exp_size' : 'norm' }),
      });
      if (!res.ok) throw new Error(`Matrix computation failed: HTTP ${res.status}`);
      const data = await res.json() as MatrixResponse;
      const mat = data.matrix;
      const names = data.countries;

      setMatrix(mat);
      setCountryList(names);

      let labels: number[];
      let dend: DendrogramNode | null = null;

      if (algorithm === 'kmeans') {
        labels = kMeans(mat, k, maxIter);
      } else if (algorithm === 'agglomerative') {
        const result = agglomerative(mat, k, linkage);
        labels = result.labels;
        dend = result.dendrogram;
      } else if (algorithm === 'divisive') {
        labels = divisive(mat, threshold);
      } else {
        labels = spectral(mat, nClusters);
      }

      setClusterLabels(labels);
      setDendrogram(dend);

      // Persist to localStorage
      const runs = parseInt(localStorage.getItem('csc_v1_clusteringRuns') ?? '0', 10);
      localStorage.setItem('csc_v1_clusteringRuns', String((isNaN(runs) ? 0 : runs) + 1));
      localStorage.setItem('csc_v1_lastClusteringResult', JSON.stringify({
        algorithm,
        k,
        labels,
        matrix: mat,
        countries: names,
        timestamp: new Date().toISOString(),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setRunning(false);
    }
  }, [algorithm, k, maxIter, linkage, threshold, nClusters, metric, subsetMode, selectedCountries]);

  const actualK = clusterLabels.length > 0 ? Math.max(...clusterLabels) + 1 : k;

  // World map cluster colors
  const clusterColors: Record<string, string> = {};
  countryList.forEach((name, i) => {
    const country = allCountries.find(c => c.name === name);
    if (country) clusterColors[country.code2] = clusterColor(clusterLabels[i] ?? 0, actualK);
  });

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left config panel */}
      <div className="w-72 shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-5 space-y-6">
        <h2 className="font-bold text-gray-900">Clustering Configuration</h2>

        {/* Algorithm */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Algorithm</p>
          {([['kmeans', 'K-Means (Partitional)'], ['agglomerative', 'Agglomerative (Hierarchical)'], ['divisive', 'Divisive'], ['spectral', 'Spectral']] as [Algorithm, string][]).map(([val, label]) => (
            <label key={val} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="algo" value={val} checked={algorithm === val} onChange={() => setAlgorithm(val)} className="accent-primary-600" />
              <span className="text-sm text-gray-700">{label}</span>
            </label>
          ))}
        </div>

        {/* Parameters */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Parameters</p>

          {(algorithm === 'kmeans') && (
            <>
              <div>
                <label className="text-xs text-gray-600">k clusters: {k}</label>
                <input type="range" min={2} max={20} value={k} onChange={e => setK(Number(e.target.value))} className="w-full mt-1 accent-primary-600" />
              </div>
              <div>
                <label className="text-xs text-gray-600">Max iterations: {maxIter}</label>
                <input type="range" min={10} max={500} value={maxIter} onChange={e => setMaxIter(Number(e.target.value))} className="w-full mt-1 accent-primary-600" />
              </div>
            </>
          )}

          {algorithm === 'agglomerative' && (
            <>
              <div>
                <label className="text-xs text-gray-600">k clusters: {k}</label>
                <input type="range" min={2} max={20} value={k} onChange={e => setK(Number(e.target.value))} className="w-full mt-1 accent-primary-600" />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">Linkage</label>
                <select className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5" value={linkage} onChange={e => setLinkage(e.target.value as Linkage)}>
                  {(['single', 'complete', 'average', 'ward'] as Linkage[]).map(l => <option key={l}>{l}</option>)}
                </select>
              </div>
            </>
          )}

          {algorithm === 'divisive' && (
            <div>
              <label className="text-xs text-gray-600">Threshold: {threshold.toFixed(2)}</label>
              <input type="range" min={0} max={1} step={0.01} value={threshold} onChange={e => setThreshold(Number(e.target.value))} className="w-full mt-1 accent-primary-600" />
            </div>
          )}

          {algorithm === 'spectral' && (
            <div>
              <label className="text-xs text-gray-600">n_clusters: {nClusters}</label>
              <input type="range" min={2} max={20} value={nClusters} onChange={e => setNClusters(Number(e.target.value))} className="w-full mt-1 accent-primary-600" />
            </div>
          )}
        </div>

        {/* Metric */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Similarity Metric</p>
          {([['ted', 'TED (Full)'], ['structure', 'Structure-only TED'], ['content', 'Content-only TED']] as [Metric, string][]).map(([val, label]) => (
            <label key={val} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="metric" value={val} checked={metric === val} onChange={() => setMetric(val)} className="accent-primary-600" />
              <span className="text-sm text-gray-700">{label}</span>
            </label>
          ))}
        </div>

        {/* Country subset */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Country Subset</p>
          {([['all', 'All countries (20 sampled)'], ['select', 'Select subset']] as [CountrySubset, string][]).map(([val, label]) => (
            <label key={val} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="subset" value={val} checked={subsetMode === val} onChange={() => setSubsetMode(val)} className="accent-primary-600" />
              <span className="text-sm text-gray-700">{label}</span>
            </label>
          ))}

          {subsetMode === 'all' && (
            <div className="flex items-center gap-1 text-xs text-yellow-700 bg-yellow-50 rounded-lg p-2">
              <AlertTriangle size={12} /> Showing 20 sampled countries for performance
            </div>
          )}

          {subsetMode === 'select' && (
            <select
              multiple
              className="w-full text-xs border border-gray-200 rounded-lg h-32"
              value={selectedCountries}
              onChange={e => setSelectedCountries(Array.from(e.target.selectedOptions, o => o.value))}
            >
              {allCountries.map(c => <option key={c.code} value={c.name}>{c.name}</option>)}
            </select>
          )}
        </div>

        <button
          onClick={runClustering}
          disabled={running}
          className="w-full flex items-center justify-center gap-2 py-3 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          {running ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Play size={16} />}
          Run Clustering
        </button>
      </div>

      {/* Right visualization */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {error && (
          <div className="shrink-0 m-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-center gap-2">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        {/* Tabs */}
        <div className="shrink-0 flex border-b border-gray-200 bg-white">
          {(['bubble', 'dendrogram', 'heatmap', 'map'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-3 text-sm font-medium capitalize ${tab === t ? 'border-b-2 border-primary-500 text-primary-700' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-6">
          {clusterLabels.length === 0 && !running && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <Play size={40} className="mb-3 opacity-40" />
              <p className="text-sm">Configure and run clustering to see results</p>
            </div>
          )}

          {clusterLabels.length > 0 && (
            <>
              {tab === 'bubble' && (
                <div className="max-w-lg mx-auto">
                  <BubbleChart labels={countryList} clusterLabels={clusterLabels} k={actualK} />
                </div>
              )}

              {tab === 'dendrogram' && (
                dendrogram
                  ? countryList.length <= 50
                    ? <div className="overflow-auto"><DendrogramSvg root={dendrogram} labels={countryList} /></div>
                    : <p className="text-sm text-gray-400 text-center py-8">Dendrogram only shown for ≤50 countries</p>
                  : <p className="text-sm text-gray-400 text-center py-8">Dendrogram only available for Agglomerative algorithm</p>
              )}

              {tab === 'heatmap' && matrix && (
                <SvgHeatmap matrix={matrix} labels={countryList} cellSize={countryList.length > 15 ? 16 : 22} />
              )}

              {tab === 'map' && (
                <div className="space-y-4">
                  <ClusterMap clusterColors={clusterColors} />
                  {/* Legend */}
                  <div className="flex flex-wrap gap-3">
                    {Array.from({ length: actualK }, (_, i) => {
                      const members = countryList.filter((_, j) => clusterLabels[j] === i);
                      return (
                        <div key={i} className="flex items-center gap-2 text-xs text-gray-700">
                          <span className="w-4 h-4 rounded-full shrink-0" style={{ background: clusterColor(i, actualK) }} />
                          Cluster {i + 1} ({members.length} countries)
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}