import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GitCompare,
  FileDiff,
  Network,
  Database,
  Layers,
  Download,
  ArrowRight,
  Globe,
  Cpu,
  BarChart2,
  Clock,
} from 'lucide-react';
import { SvgBarChart } from '../components/SvgBarChart';

interface StatsData {
  country_count: number;
  precomputed_count: number;
}

const PAIR_LABELS = [
  'France↔Germany',
  'Greece↔Lebanon',
  'Iran↔Iraq',
  'Lebanon↔France',
  'Syria↔Lebanon',
  'US↔CAR',
  'US↔China',
  'US↔Lebanon',
];

const moduleCards = [
  { label: 'Compare Countries', desc: 'Run Tree Edit Distance comparisons between two countries.', route: '/compare', Icon: GitCompare, color: 'text-primary-600' },
  { label: 'View Diffs', desc: 'Inspect edit scripts and visualize structural differences.', route: '/diff', Icon: FileDiff, color: 'text-yellow-600' },
  { label: 'Run Clustering', desc: 'Cluster countries using K-Means, Agglomerative, and more.', route: '/clustering', Icon: Network, color: 'text-accent-600' },
  { label: 'Dataset Browser', desc: 'Browse all countries, inspect raw JSON and parsed trees.', route: '/dataset', Icon: Database, color: 'text-purple-600' },
  { label: 'Tree Patcher', desc: 'Replay an edit script step-by-step on a country tree.', route: '/patcher', Icon: Layers, color: 'text-orange-600' },
  { label: 'Reports', desc: 'Generate and download comparison or clustering reports.', route: '/reports', Icon: Download, color: 'text-pink-600' },
];

export function HomePage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [clusteringRuns, setClusteringRuns] = useState(0);

  useEffect(() => {
    const runs = parseInt(localStorage.getItem('csc_v1_clusteringRuns') ?? '0', 10);
    setClusteringRuns(isNaN(runs) ? 0 : runs);

    fetch('/api/ted/stats')
      .then(r => r.ok ? r.json() as Promise<StatsData> : null)
      .then(d => { if (d) setStats(d); })
      .catch(() => { /* backend offline */ });
  }, []);

  const barData = PAIR_LABELS.map((label, i) => ({ label, value: i + 1 }));

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Country Similarity &amp; Clustering</h1>
        <p className="text-sm text-gray-500 mt-1">COE 543/743 · Lebanese American University</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Countries', value: stats?.country_count ?? '—', Icon: Globe, color: 'bg-primary-50 text-primary-700' },
          { label: 'Pre-computed Pairs', value: stats?.precomputed_count ?? '—', Icon: Clock, color: 'bg-yellow-50 text-yellow-700' },
          { label: 'Clustering Runs', value: clusteringRuns, Icon: BarChart2, color: 'bg-accent-50 text-accent-700' },
          { label: 'Algorithms Available', value: 3, Icon: Cpu, color: 'bg-purple-50 text-purple-700' },
        ].map(({ label, value, Icon, color }) => (
          <div key={label} className={`rounded-xl p-4 flex items-center gap-3 ${color.split(' ')[0]} border border-gray-100`}>
            <Icon size={22} className={color.split(' ')[1]} />
            <div>
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Module cards */}
      <div>
        <h2 className="text-base font-semibold text-gray-700 mb-3">Modules</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {moduleCards.map(({ label, desc, route, Icon, color }) => (
            <button
              key={route}
              onClick={() => navigate(route)}
              className="bg-white rounded-xl border border-gray-200 p-5 text-left hover:border-primary-300 hover:shadow-md transition-all group"
            >
              <Icon size={28} className={`${color} mb-3`} />
              <h3 className="font-semibold text-gray-900 text-sm mb-1">{label}</h3>
              <p className="text-xs text-gray-500 mb-4">{desc}</p>
              <div className="flex justify-end">
                <span className="w-7 h-7 rounded-full bg-gray-100 group-hover:bg-primary-100 flex items-center justify-center transition-colors">
                  <ArrowRight size={14} className="text-gray-400 group-hover:text-primary-600" />
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Pre-computed Comparisons</h3>
          <SvgBarChart data={barData} color="#3b82f6" height={200} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col items-center justify-center">
          <Network size={40} className="text-accent-500 mb-3" />
          <p className="text-4xl font-bold text-gray-900">{clusteringRuns}</p>
          <p className="text-sm text-gray-500 mt-1">Clustering Runs Performed</p>
          <button
            onClick={() => navigate('/clustering')}
            className="mt-4 px-4 py-2 bg-accent-600 text-white text-xs font-medium rounded-lg hover:bg-accent-700 transition-colors"
          >
            Run Clustering
          </button>
        </div>
      </div>
    </div>
  );
}