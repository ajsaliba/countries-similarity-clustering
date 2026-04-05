import { useState, useEffect } from 'react';
import { Play, Zap } from 'lucide-react';
import { TreeNode } from '../types';

function tokenizeValue(val: string): string[] {
  return val.split(/[\s,;/()]+/).filter(t => t.length > 0);
}

function syntaxHighlight(json: string): string {
  return json
    .replace(/("(?:[^"\\]|\\.)*")\s*:/g, '<span style="color:#f59e0b">$1</span>:')
    .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span style="color:#22c55e">$1</span>')
    .replace(/:\s*(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g, ': <span style="color:#60a5fa">$1</span>');
}

interface FlatLeaf { path: string; type: string; value: string; tokens: string[] }

function collectLeaves(node: TreeNode, path: string[] = []): FlatLeaf[] {
  const currPath = [...path, node.label];
  if (node.children.length === 0 && node.value !== undefined) {
    const val = node.value ?? '';
    return [{ path: currPath.join(' / '), type: 'leaf', value: val, tokens: tokenizeValue(val) }];
  }
  return node.children.flatMap(c => collectLeaves(c, currPath));
}

const TYPE_COLORS: Record<string, string> = {
  dict: 'bg-purple-100 text-purple-700',
  list: 'bg-blue-100 text-blue-700',
  str: 'bg-green-100 text-green-700',
  num: 'bg-orange-100 text-orange-700',
  dist: 'bg-pink-100 text-pink-700',
};

function NodePill({ node, tokenize }: { node: TreeNode; tokenize: boolean; indent: number }) {
  const [hoveredValue, setHoveredValue] = useState<string | null>(null);
  const isLeaf = node.children.length === 0;
  const typeColor = TYPE_COLORS['str'] ?? 'bg-gray-100 text-gray-600';

  return (
    <div>
      <div
        className="flex items-center gap-2 py-0.5 group"
        onMouseEnter={() => isLeaf && node.value ? setHoveredValue(node.value) : null}
        onMouseLeave={() => setHoveredValue(null)}
      >
        <span className="text-sm text-gray-800 font-medium">{node.label}</span>
        {isLeaf && node.value !== undefined && (
          <span className="text-xs text-gray-400 font-mono truncate max-w-xs">{node.value}</span>
        )}
        {!isLeaf && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${typeColor}`}>
            dict
          </span>
        )}
      </div>

      {/* Token chips on hover */}
      {hoveredValue && tokenize && (
        <div className="flex flex-wrap gap-1 ml-4 mb-1">
          {tokenizeValue(hoveredValue).map((tok, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 bg-accent-100 text-accent-700 rounded-full">
              {tok}
            </span>
          ))}
        </div>
      )}

      {!isLeaf && (
        <div className="ml-4 border-l border-gray-200 pl-2">
          {node.children.map(child => (
            <NodePill key={child.id} node={child} tokenize={tokenize} indent={1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function PreProcessingPage() {
  const [countryNames, setCountryNames] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [rawJson, setRawJson] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [tokenize, setTokenize] = useState(false);
  const [loadingRaw, setLoadingRaw] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);
  const [treeVisible, setTreeVisible] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    fetch('/api/ted/countries?dataset=clean')
      .then(r => r.ok ? r.json() as Promise<string[]> : [])
      .then(names => { setCountryNames(names); if (names.length) setSelected(names[0]); })
      .catch(() => { /* offline */ });
  }, []);

  const loadRaw = async () => {
    if (!selected) return;
    setLoadingRaw(true);
    setRawJson(null);
    try {
      const res = await fetch(`/api/ted/country?name=${encodeURIComponent(selected)}&dataset=raw`);
      const data = res.ok ? JSON.stringify(await res.json(), null, 2) : 'Error loading data';
      setRawJson(data);
    } catch {
      setRawJson('Backend offline');
    } finally {
      setLoadingRaw(false);
    }
  };

  const generateTree = async () => {
    if (!selected) return;
    setLoadingTree(true);
    setTree(null);
    setTreeVisible(false);
    setVisibleCount(0);
    try {
      const res = await fetch('/api/ted/build-tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: selected, dataset: 'clean' }),
      });
      if (res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await res.json() as { tree: TreeNode };
        setTree(data.tree);
        setTreeVisible(true);
        // Stagger nodes
        const total = countNodes(data.tree);
        let count = 0;
        const interval = setInterval(() => {
          count += 3;
          setVisibleCount(count);
          if (count >= total) clearInterval(interval);
        }, 30);
      }
    } catch { /* offline */ }
    finally {
      setLoadingTree(false);
    }
  };

  function countNodes(node: TreeNode): number {
    return 1 + node.children.reduce((s, c) => s + countNodes(c), 0);
  }

  const leaves = tree ? collectLeaves(tree) : [];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Pre-Processing Visual Tool</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Input */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-700">Input</h2>

          <div className="flex gap-3">
            <select
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-300"
              value={selected}
              onChange={e => setSelected(e.target.value)}
            >
              {countryNames.map(n => <option key={n}>{n}</option>)}
            </select>
            <button
              onClick={loadRaw}
              disabled={loadingRaw}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              {loadingRaw ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Play size={14} />}
              Load Raw Data
            </button>
          </div>

          {rawJson && (
            <pre
              className="text-xs font-mono bg-gray-950 text-gray-100 p-3 rounded-lg overflow-auto max-h-72"
              dangerouslySetInnerHTML={{ __html: syntaxHighlight(rawJson) }}
            />
          )}

          {/* Toggle */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">Single Text Node</span>
            <button
              onClick={() => setTokenize(v => !v)}
              className={`relative w-10 h-5 rounded-full transition-colors ${tokenize ? 'bg-primary-600' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${tokenize ? 'translate-x-5' : ''}`} />
            </button>
            <span className="text-xs text-gray-500">Tokenized Nodes</span>
          </div>
        </div>

        {/* Right: Animated Tree */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700">Animated Tree</h2>
            <button
              onClick={generateTree}
              disabled={loadingTree || !selected}
              className="flex items-center gap-2 px-4 py-2 bg-accent-600 text-white text-sm rounded-lg hover:bg-accent-700 disabled:opacity-50"
            >
              {loadingTree ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Zap size={14} />}
              Generate Tree
            </button>
          </div>

          {tree && treeVisible && (
            <div className="overflow-auto max-h-80">
              <NodePill node={tree} tokenize={tokenize} indent={0} />
              {visibleCount < countNodes(tree) && (
                <p className="text-xs text-gray-400 mt-2">Loading nodes… ({visibleCount})</p>
              )}
            </div>
          )}

          {!tree && !loadingTree && (
            <p className="text-sm text-gray-400 text-center py-8">Click "Generate Tree" to visualize</p>
          )}
        </div>
      </div>

      {/* Attribute table */}
      {leaves.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-700 mb-3">Attribute Ordering Table</h2>
          <div className="overflow-auto max-h-72">
            <table className="w-full text-xs text-left">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-gray-500 font-medium">Path</th>
                  <th className="px-3 py-2 text-gray-500 font-medium">Type</th>
                  <th className="px-3 py-2 text-gray-500 font-medium">Value</th>
                  {tokenize && <th className="px-3 py-2 text-gray-500 font-medium">Token Count</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {leaves.map((leaf, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-gray-600 truncate max-w-xs">{leaf.path}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded-full text-[10px]">{leaf.type}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-700 truncate max-w-xs">{leaf.value}</td>
                    {tokenize && <td className="px-3 py-2 text-gray-700">{leaf.tokens.length}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}