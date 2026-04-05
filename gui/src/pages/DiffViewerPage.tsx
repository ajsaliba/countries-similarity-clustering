import { useState, useCallback } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { countries as allCountries } from '../data/countries';
import { TreeView } from '../components/TreeView';
import { OperationBadge } from '../components/OperationBadge';
import { EditOperation, EditOperationType, BackendCompareResult, TreeNode } from '../types';

const PRECOMPUTED_PAIRS = [
  { label: 'France → Germany', key: 'France_to_Germany', a: 'France', b: 'Germany' },
  { label: 'Greece → Lebanon', key: 'Greece_to_Lebanon', a: 'Greece', b: 'Lebanon' },
  { label: 'Iran → Iraq', key: 'Iran_to_Iraq', a: 'Iran', b: 'Iraq' },
  { label: 'Lebanon → France', key: 'Lebanon_to_France', a: 'Lebanon', b: 'France' },
  { label: 'Syria → Lebanon', key: 'Syria_to_Lebanon', a: 'Syria', b: 'Lebanon' },
  { label: 'US → CAR', key: 'United_States_to_Central_African_Republic', a: 'United States', b: 'Central African Republic' },
  { label: 'US → China', key: 'United_States_to_China', a: 'United States', b: 'China' },
  { label: 'US → Lebanon', key: 'United_States_to_Lebanon', a: 'United States', b: 'Lebanon' },
];

const opBorder: Record<EditOperationType, string> = {
  insert: 'border-l-4 border-green-500 bg-green-950/20',
  delete: 'border-l-4 border-red-500 bg-red-950/20',
  update: 'border-l-4 border-yellow-500 bg-yellow-950/20',
  move: 'border-l-4 border-blue-500 bg-blue-950/20',
};

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function DiffViewerPage() {
  const [countryA, setCountryA] = useState('France');
  const [countryB, setCountryB] = useState('Germany');
  const [ops, setOps] = useState<EditOperation[]>([]);
  const [treeA, setTreeA] = useState<TreeNode | null>(null);
  const [treeB, setTreeB] = useState<TreeNode | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCompare = useCallback(async (a: string, b: string) => {
    setLoading(true);
    setError(null);
    setOps([]);
    setTreeA(null);
    setTreeB(null);
    setHighlighted(null);
    try {
      const res = await fetch('/api/ted/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country_a: a, country_b: b, dataset: 'clean' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as BackendCompareResult;
      setOps(data.edit_script ?? []);
      setTreeA(data.tree_a ?? null);
      setTreeB(data.tree_b ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPrecomputed = useCallback(async (key: string, a: string, b: string) => {
    setCountryA(a);
    setCountryB(b);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ted/precomputed?key=${encodeURIComponent(key)}`);
      if (res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await res.json() as { edit_script: EditOperation[]; tree_a?: TreeNode; tree_b?: TreeNode };
        setOps(data.edit_script ?? []);
        setTreeA(data.tree_a ?? null);
        setTreeB(data.tree_b ?? null);
      } else {
        // Fall back to live compare
        await runCompare(a, b);
      }
    } catch {
      await runCompare(a, b);
    } finally {
      setLoading(false);
    }
  }, [runCompare]);

  const counts = { insert: 0, delete: 0, update: 0 };
  ops.forEach(op => {
    if (op.type in counts) counts[op.type as keyof typeof counts]++;
  });

  const highlightedPaths = highlighted ? [highlighted] : [];
  const highlightColor = highlighted
    ? ops.find(o => o.node === highlighted)?.type === 'insert' ? 'green'
    : ops.find(o => o.node === highlighted)?.type === 'delete' ? 'red' : 'yellow'
    : 'blue';

  const exportJson = () => downloadBlob(JSON.stringify(ops, null, 2), `diff_${countryA}_${countryB}.json`, 'application/json');
  const exportXml = () => {
    const lines = ops.map(op =>
      `  <operation type="${op.type}" path="${op.node}" from="${op.from ?? ''}" to="${op.to ?? ''}" cost="${op.cost}" />`,
    );
    downloadBlob(`<editScript>\n${lines.join('\n')}\n</editScript>`, `diff_${countryA}_${countryB}.xml`, 'application/xml');
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="shrink-0 bg-white border-b border-gray-200 p-4 flex flex-wrap items-center gap-3">
        <select
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-300"
          value={countryA}
          onChange={e => setCountryA(e.target.value)}
        >
          {allCountries.map(c => <option key={c.code}>{c.name}</option>)}
        </select>

        <span className="text-gray-400 text-sm">vs</span>

        <select
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-300"
          value={countryB}
          onChange={e => setCountryB(e.target.value)}
        >
          {allCountries.map(c => <option key={c.code}>{c.name}</option>)}
        </select>

        <button
          onClick={() => runCompare(countryA, countryB)}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <RefreshCw size={14} />}
          Compute Diff
        </button>

        <select
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-300"
          defaultValue=""
          onChange={e => {
            const p = PRECOMPUTED_PAIRS.find(pp => pp.key === e.target.value);
            if (p) void loadPrecomputed(p.key, p.a, p.b);
          }}
        >
          <option value="" disabled>Load Pre-computed…</option>
          {PRECOMPUTED_PAIRS.map(p => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>

        <div className="ml-auto flex gap-2">
          <button onClick={exportJson} className="flex items-center gap-1 px-3 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
            <Download size={12} /> JSON
          </button>
          <button onClick={exportXml} className="flex items-center gap-1 px-3 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
            <Download size={12} /> XML
          </button>
        </div>
      </div>

      {error && (
        <div className="shrink-0 m-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* Split pane */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: operation list */}
        <div className="w-2/5 border-r border-gray-200 flex flex-col overflow-hidden">
          {ops.length > 0 && (
            <div className="shrink-0 px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-600 flex gap-4">
              <span className="text-green-600">{counts.insert} insertions</span>
              <span className="text-red-600">{counts.delete} deletions</span>
              <span className="text-yellow-600">{counts.update} updates</span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {ops.length === 0 && !loading && (
              <p className="text-sm text-gray-400 text-center py-12">No diff loaded. Click "Compute Diff" or load a pre-computed pair.</p>
            )}
            {ops.map((op, i) => (
              <button
                key={i}
                onClick={() => setHighlighted(highlighted === op.node ? null : op.node)}
                className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${opBorder[op.type] ?? ''} ${highlighted === op.node ? 'ring-2 ring-inset ring-primary-400' : 'hover:bg-gray-50'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <OperationBadge type={op.type} />
                  <span className="text-xs font-mono text-gray-700 truncate flex-1">{op.node}</span>
                  <span className="text-[10px] text-gray-400 shrink-0">{op.cost.toFixed(2)}</span>
                </div>
                {op.type === 'update' && (
                  <div className="text-[10px] text-gray-500 truncate">
                    <span className="text-red-500">{op.from}</span> → <span className="text-green-500">{op.to}</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Right: dual tree */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden border-r border-gray-100">
            <div className="shrink-0 px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-600">
              {countryA} (Tree A)
            </div>
            <div className="flex-1 overflow-auto p-3">
              {treeA
                ? <TreeView node={treeA} highlightedPaths={highlightedPaths} highlightColor={highlightColor as 'green' | 'red' | 'yellow' | 'blue'} />
                : <p className="text-xs text-gray-400 text-center py-8">No tree loaded</p>
              }
            </div>
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="shrink-0 px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-600">
              {countryB} (Tree B)
            </div>
            <div className="flex-1 overflow-auto p-3">
              {treeB
                ? <TreeView node={treeB} highlightedPaths={highlightedPaths} highlightColor={highlightColor as 'green' | 'red' | 'yellow' | 'blue'} />
                : <p className="text-xs text-gray-400 text-center py-8">No tree loaded</p>
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}