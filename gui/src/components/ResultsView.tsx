import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowRight,
  FileOutput,
  GitCompare,
  ArrowLeftRight,
  Percent,
  FileJson,
  CheckCircle2,
  XCircle,
  PlusCircle,
  Pencil,
  MoveHorizontal,
  Database,
} from 'lucide-react';
import {
  AlgorithmConfig,
  Country,
  CountryPair,
  EditOperation,
  SimilarityConfig,
  TreeNode,
  BackendCompareResult,
} from '../types';
import { countries } from '../data/countries';
import { filterTreeByMetrics } from '../services/dataService';

interface ResultsViewProps {
  selectedCountries: Country[];
  comparisonMode: 'pair' | 'all';
  countryPairs: CountryPair[];
  loadedTrees: Record<string, TreeNode>;
  similarityConfig: SimilarityConfig;
  selectedAlgorithm: AlgorithmConfig | null;
  backendResults: Record<string, BackendCompareResult>;
  onNext: () => void;
  onPrev: () => void;
}

type Tab = 'similarity' | 'editscript' | 'patch' | 'diff' | 'postprocess';

type DiffLineType = 'unchanged' | 'removed' | 'added' | 'modified';

interface DiffLine {
  text?: string;
  source?: string;
  target?: string;
  type: DiffLineType;
}

function buildDiffLines(t1: TreeNode, t2: TreeNode): DiffLine[] {
  const lines: DiffLine[] = [];
  lines.push({ text: `<${t1.label}>`, type: 'unchanged' });

  const cats1 = new Map(t1.children.map(c => [c.label, c]));
  const cats2 = new Map(t2.children.map(c => [c.label, c]));
  const allCats = [...new Set([...cats1.keys(), ...cats2.keys()])];

  for (const cat of allCats) {
    const c1 = cats1.get(cat);
    const c2 = cats2.get(cat);

    lines.push({ text: `  <${cat}>`, type: 'unchanged' });

    const fields1 = new Map(c1?.children.map(n => [n.label, n.value ?? '']) ?? []);
    const fields2 = new Map(c2?.children.map(n => [n.label, n.value ?? '']) ?? []);
    const allFields = [...new Set([...fields1.keys(), ...fields2.keys()])];

    for (const field of allFields) {
      const v1 = fields1.get(field);
      const v2 = fields2.get(field);

      if (v1 !== undefined && v2 !== undefined) {
        if (v1 === v2) {
          lines.push({
            text: `    <${field}>${v1}</${field}>`,
            type: 'unchanged',
          });
        } else {
          lines.push({
            source: `    <${field}>${v1}</${field}>`,
            target: `    <${field}>${v2}</${field}>`,
            type: 'modified',
          });
        }
      } else if (v1 !== undefined) {
        lines.push({
          source: `    <${field}>${v1}</${field}>`,
          target: '',
          type: 'removed',
        });
      } else {
        lines.push({
          source: '',
          target: `    <${field}>${v2}</${field}>`,
          type: 'added',
        });
      }
    }

    lines.push({ text: `  </${cat}>`, type: 'unchanged' });
  }

  lines.push({ text: `</${t1.label}>`, type: 'unchanged' });
  return lines;
}

function treeToXmlPreview(tree: TreeNode, maxFields = 10): string {
  const lines: string[] = [`<${tree.label}>`];
  let count = 0;

  for (const cat of tree.children) {
    if (count >= maxFields) {
      lines.push(`  <!-- … -->`);
      break;
    }

    lines.push(`  <${cat.label}>`);

    for (const field of cat.children) {
      if (count >= maxFields) {
        lines.push(`    <!-- … -->`);
        break;
      }

      lines.push(`    <${field.label}>${field.value ?? ''}</${field.label}>`);
      count++;
    }

    lines.push(`  </${cat.label}>`);
  }

  lines.push(`</${tree.label}>`);
  return lines.join('\n');
}

function makePairKey(c1: string, c2: string): string {
  return `${c1}__${c2}`;
}

export const ResultsView: React.FC<ResultsViewProps> = ({
  selectedCountries,
  comparisonMode,
  countryPairs,
  loadedTrees,
  similarityConfig,
  selectedAlgorithm,
  backendResults,
  onNext,
  onPrev,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('similarity');
  const [activePairIndex, setActivePairIndex] = useState(0);
  const [patchStep, setPatchStep] = useState(0);
  const [isPatching, setIsPatching] = useState(false);

  const getCountryName = (code: string) =>
    countries.find(c => c.code === code)?.name ?? code;

  useEffect(() => {
    if (countryPairs.length === 0) return;
    if (activePairIndex > countryPairs.length - 1) {
      setActivePairIndex(0);
    }
  }, [countryPairs, activePairIndex]);

  const activePair: CountryPair | undefined = countryPairs[activePairIndex];

  const pairKey = activePair ? makePairKey(activePair.country1, activePair.country2) : '';
  const backendResult = pairKey ? backendResults[pairKey] ?? null : null;

  const t1 = backendResult?.tree_a ?? (activePair ? loadedTrees[activePair.country1] : undefined);
  const t2 = backendResult?.tree_b ?? (activePair ? loadedTrees[activePair.country2] : undefined);

  const editOps = useMemo((): EditOperation[] => {
    return backendResult?.edit_script ?? [];
  }, [backendResult]);

  const diffLines = useMemo((): DiffLine[] => {
    if (!t1 || !t2) return [];
    return buildDiffLines(t1, t2);
  }, [t1, t2]);

  const nodes1 = backendResult?.tree_a_size ?? 0;
  const nodes2 = backendResult?.tree_b_size ?? 0;

  const simPct = (backendResult?.similarity ?? 0) * 100;

  useEffect(() => {
    setPatchStep(0);
    setIsPatching(false);
  }, [activePairIndex, activeTab]);

  useEffect(() => {
    if (!isPatching || editOps.length === 0) return;

    const timer = setInterval(() => {
      setPatchStep(prev => {
        if (prev >= editOps.length - 1) {
          setIsPatching(false);
          return prev;
        }
        return prev + 1;
      });
    }, 400);

    return () => clearInterval(timer);
  }, [isPatching, editOps.length]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'similarity', label: 'Similarity Score', icon: <Percent size={14} /> },
    { id: 'editscript', label: 'Edit Script', icon: <FileOutput size={14} /> },
    { id: 'patch', label: 'Patching', icon: <GitCompare size={14} /> },
    { id: 'diff', label: 'Diff View', icon: <ArrowLeftRight size={14} /> },
    { id: 'postprocess', label: 'Post-Processing', icon: <FileJson size={14} /> },
  ];

  const getOpIcon = (type: EditOperation['type']) => {
    switch (type) {
      case 'insert':
        return <PlusCircle size={12} className="text-green-400" />;
      case 'delete':
        return <XCircle size={12} className="text-red-400" />;
      case 'update':
        return <Pencil size={12} className="text-yellow-400" />;
      case 'move':
        return <MoveHorizontal size={12} className="text-blue-400" />;
    }
  };

  const pairResults = useMemo(() => {
    return countryPairs.map(pair => {
      const key = makePairKey(pair.country1, pair.country2);
      const br = backendResults[key];
      if (!br) return null;
      return {
        sim: br.similarity,
        ted: br.distance,
        label: 'Zhang-Shasha TED',
      };
    });
  }, [countryPairs, backendResults]);

  const rankedResults = useMemo(() => {
    return countryPairs
      .map((pair, i) => {
        const result = pairResults[i];
        if (!result) return null;
        return { pair, result, index: i };
      })
      .filter(
        (
          item,
        ): item is {
          pair: CountryPair;
          result: NonNullable<(typeof pairResults)[number]>;
          index: number;
        } => !!item,
      )
      .sort((a, b) => b.result.sim - a.result.sim);
  }, [countryPairs, pairResults]);

  const closest = rankedResults[0] ?? null;
  const farthest = rankedResults[rankedResults.length - 1] ?? null;

  const averageSimilarity =
    rankedResults.length > 0
      ? rankedResults.reduce((sum, r) => sum + r.result.sim, 0) / rankedResults.length
      : 0;

  if (countryPairs.length === 0 || Object.keys(loadedTrees).length === 0) {
    return (
      <div className="animate-fade-in flex flex-col h-full min-h-0 items-center justify-center gap-4">
        <Database size={48} className="text-gray-300" />
        <h2 className="text-xl font-bold text-gray-900">No Results Available</h2>
        <p className="text-gray-500 text-center max-w-sm">
          Complete the previous steps first.
        </p>
        <button onClick={onPrev} className="btn-secondary">
          Back
        </button>
      </div>
    );
  }

  const name1 = activePair ? getCountryName(activePair.country1) : '—';
  const name2 = activePair ? getCountryName(activePair.country2) : '—';

  return (
    <div className="animate-fade-in flex flex-col h-full min-h-0 overflow-hidden">
      <div className="text-center mb-3 shrink-0">
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Results &amp; Analysis</h2>
        <p className="text-gray-500 text-sm">
          {comparisonMode === 'pair'
            ? 'Similarity score, edit script, patching, and diff for the selected country pair.'
            : 'Similarity ranking and detailed inspection for one-vs-all comparisons.'}
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {comparisonMode === 'all' && rankedResults.length > 0 && (
          <div className="mb-4 space-y-4 shrink-0">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="glass-card p-4">
                <div className="text-[10px] text-gray-500 uppercase mb-1">Base Country</div>
                <div className="text-lg font-bold text-gray-900">
                  {selectedCountries[0]?.name ?? '—'}
                </div>
              </div>

              <div className="glass-card p-4">
                <div className="text-[10px] text-gray-500 uppercase mb-1">Closest Country</div>
                <div className="text-lg font-bold text-green-600">
                  {closest ? getCountryName(closest.pair.country2) : '—'}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {closest ? `${(closest.result.sim * 100).toFixed(1)}% similarity` : ''}
                </div>
              </div>

              <div className="glass-card p-4">
                <div className="text-[10px] text-gray-500 uppercase mb-1">Farthest Country</div>
                <div className="text-lg font-bold text-red-600">
                  {farthest ? getCountryName(farthest.pair.country2) : '—'}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {farthest ? `${(farthest.result.sim * 100).toFixed(1)}% similarity` : ''}
                </div>
              </div>

              <div className="glass-card p-4">
                <div className="text-[10px] text-gray-500 uppercase mb-1">
                  Average Similarity
                </div>
                <div className="text-lg font-bold text-primary-600">
                  {(averageSimilarity * 100).toFixed(1)}%
                </div>
              </div>
            </div>

            <div className="glass-card p-4">
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <h3 className="text-sm font-semibold text-gray-700">Similarity Ranking</h3>
                <div className="text-xs text-gray-500">
                  Click a row or use the selector below to inspect a country.
                </div>
              </div>

              <div className="max-h-64 overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-300">
                      <th className="text-left py-2 text-gray-500 font-normal">Rank</th>
                      <th className="text-left py-2 text-gray-500 font-normal">Country</th>
                      <th className="text-center py-2 text-gray-500 font-normal">TED</th>
                      <th className="text-center py-2 text-gray-500 font-normal">Similarity</th>
                      <th className="text-center py-2 text-gray-500 font-normal">Fields</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankedResults.map((item, idx) => (
                      <tr
                        key={`${item.pair.country1}-${item.pair.country2}`}
                        onClick={() => setActivePairIndex(item.index)}
                        className={`border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${
                          activePairIndex === item.index ? 'bg-primary-50' : ''
                        }`}
                      >
                        <td className="py-2.5 text-gray-700">{idx + 1}</td>
                        <td className="py-2.5 text-gray-700">
                          {getCountryName(item.pair.country2)}
                        </td>
                        <td className="py-2.5 text-center font-mono text-yellow-600">
                          {item.result.ted ?? '—'}
                        </td>
                        <td className="py-2.5 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-semibold ${
                              item.result.sim >= 0.7
                                ? 'bg-green-50 text-green-600'
                                : item.result.sim >= 0.4
                                ? 'bg-yellow-50 text-yellow-600'
                                : 'bg-red-50 text-red-600'
                            }`}
                          >
                            {(item.result.sim * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-2.5 text-center text-gray-500">
                          {item.pair.selectedMetrics.length}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="glass-card p-4">
              <div className="text-sm font-semibold text-gray-700 mb-3">
                Inspect Comparison
              </div>
              <div className="overflow-x-auto">
                <div className="flex gap-2 min-w-max pr-1">
                  {rankedResults.map(item => (
                    <button
                      key={`inspect-${item.pair.country1}-${item.pair.country2}`}
                      onClick={() => setActivePairIndex(item.index)}
                      className={`px-3 py-2 rounded-lg border text-sm whitespace-nowrap transition-all ${
                        activePairIndex === item.index
                          ? 'bg-primary-50 border-primary-600 text-gray-900'
                          : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {getCountryName(item.pair.country2)} ·{' '}
                      {(item.result.sim * 100).toFixed(1)}%
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {comparisonMode === 'pair' && countryPairs.length > 1 && (
          <div className="flex items-center gap-2 mb-3 shrink-0 flex-wrap">
            <span className="text-xs text-gray-500">Pair:</span>
            {countryPairs.map((pair, i) => (
              <button
                key={`${pair.country1}-${pair.country2}`}
                onClick={() => setActivePairIndex(i)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                  i === activePairIndex
                    ? 'bg-primary-50 border-primary-600 text-gray-900'
                    : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                {getCountryName(pair.country1)} vs {getCountryName(pair.country2)}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 mb-3 shrink-0 flex-wrap">
          <div className="text-sm text-gray-600">
            Inspecting:{' '}
            <span className="font-semibold text-gray-900">
              {name1} vs {name2}
            </span>
          </div>

          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg overflow-x-auto">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-[420px]">
          {activeTab === 'similarity' && (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="xl:col-span-1 glass-card p-6 flex flex-col items-center justify-center">
                <div className="relative w-44 h-44">
                  <svg viewBox="0 0 200 200" className="w-full h-full -rotate-90">
                    <circle
                      cx="100"
                      cy="100"
                      r="85"
                      fill="none"
                      stroke="#e5e7eb"
                      strokeWidth="12"
                    />
                    <circle
                      cx="100"
                      cy="100"
                      r="85"
                      fill="none"
                      stroke="url(#gaugeGradient)"
                      strokeWidth="12"
                      strokeLinecap="round"
                      strokeDasharray={`${(simPct / 100) * 534} 534`}
                      className="transition-all duration-1000"
                    />
                    <defs>
                      <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#3b82f6" />
                        <stop offset="100%" stopColor="#22c55e" />
                      </linearGradient>
                    </defs>
                  </svg>

                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-4xl font-bold text-gray-900">
                      {simPct.toFixed(1)}%
                    </span>
                    <span className="text-xs text-gray-500">Similarity</span>
                  </div>
                </div>

                <div className="mt-4 text-center">
                  {backendResult && (
                    <div className="text-lg font-semibold text-gray-900">
                      TED: {backendResult.distance.toFixed(2)}
                    </div>
                  )}
                  <div className="text-sm text-gray-500 mt-1">
                    {name1} vs {name2}
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    {selectedAlgorithm?.name ?? 'Zhang-Shasha TED'}
                  </div>
                  {backendResult && (
                    <div className={`text-xs mt-1 ${backendResult.patch_verified ? 'text-green-600' : 'text-red-600'}`}>
                      Patch: {backendResult.patch_verified ? 'Verified OK' : 'FAILED'}
                    </div>
                  )}
                </div>
              </div>

              <div className="xl:col-span-2 glass-card p-4">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
                  Comparison Summary
                </h3>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <StatCard
                    label="Total Edit Operations"
                    value={String(editOps.length)}
                    color="text-yellow-500"
                  />
                  <StatCard
                    label="Insert Operations"
                    value={String(editOps.filter(o => o.type === 'insert').length)}
                    color="text-green-500"
                  />
                  <StatCard
                    label="Update Operations"
                    value={String(editOps.filter(o => o.type === 'update').length)}
                    color="text-blue-500"
                  />
                  <StatCard
                    label="Delete Operations"
                    value={String(editOps.filter(o => o.type === 'delete').length)}
                    color="text-red-500"
                  />
                  <StatCard label="Tree 1 Nodes" value={String(nodes1)} color="text-primary-600" />
                  <StatCard label="Tree 2 Nodes" value={String(nodes2)} color="text-accent-600" />
                  <StatCard
                    label="Selected Fields"
                    value={String(activePair?.selectedMetrics.length ?? 0)}
                    color="text-cyan-500"
                  />
                  <StatCard label="Patch Verified" value={backendResult?.patch_verified ? 'OK' : '—'} color={backendResult?.patch_verified ? 'text-green-500' : 'text-gray-500'} />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'editscript' && (
            <div className="flex gap-4 flex-col xl:flex-row">
              <div className="flex-1 glass-card p-4 flex flex-col min-h-0">
                <h3 className="text-sm font-semibold text-gray-500 mb-3">
                  Edit Script ({editOps.length} operations · Total cost:{' '}
                  {editOps.reduce((s, o) => s + o.cost, 0)})
                </h3>

                <div className="max-h-[520px] overflow-auto space-y-1.5">
                  {editOps.slice(0, 300).map((op, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
                    >
                      <span className="text-xs text-gray-600 font-mono mt-0.5 w-5">
                        {i + 1}
                      </span>
                      {getOpIcon(op.type)}

                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${
                              op.type === 'insert'
                                ? 'bg-green-50 text-green-600'
                                : op.type === 'delete'
                                ? 'bg-red-50 text-red-600'
                                : op.type === 'update'
                                ? 'bg-yellow-50 text-yellow-600'
                                : 'bg-blue-50 text-blue-600'
                            }`}
                          >
                            {op.type}
                          </span>
                          <span className="text-sm text-gray-700 font-mono">{op.node}</span>
                        </div>

                        {op.from && (
                          <div className="mt-1 text-xs">
                            <span className="text-red-500 line-through">{op.from}</span>
                            <span className="text-gray-600 mx-2">→</span>
                            <span className="text-green-500">{op.to}</span>
                          </div>
                        )}
                      </div>

                      <span className="text-[10px] text-gray-600 font-mono">
                        cost: {op.cost}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="w-full xl:w-96 glass-card p-4 flex flex-col">
                <h3 className="text-sm font-semibold text-gray-500 mb-3">
                  Edit Script (XML Format)
                </h3>
                <div className="max-h-[520px] overflow-auto bg-gray-100 rounded-lg p-3 font-mono text-[11px]">
                  <pre className="text-gray-600">
{`<?xml version="1.0" encoding="UTF-8"?>
<edit_script>
  <metadata>
    <source>${name1}</source>
    <target>${name2}</target>
    <algorithm>${selectedAlgorithm?.name ?? 'Similarity'}</algorithm>
    <total_cost>${editOps.reduce((s, o) => s + o.cost, 0)}</total_cost>
    <operations_count>${editOps.length}</operations_count>
  </metadata>
  <operations>`}
                    {editOps.slice(0, 100).map((op, i) => (
                      <div
                        key={i}
                        className={
                          op.type === 'insert'
                            ? 'text-green-500'
                            : op.type === 'delete'
                            ? 'text-red-500'
                            : op.type === 'update'
                            ? 'text-yellow-600'
                            : 'text-blue-600'
                        }
                      >
{`    <${op.type} node="${op.node}" cost="${op.cost}"${
  op.from ? ` old="${op.from}" new="${op.to}"` : ''
}/>`}
                      </div>
                    ))}
{`  </operations>
</edit_script>`}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'patch' && (
            <div className="flex gap-4 flex-col xl:flex-row">
              <div className="flex-1 glass-card p-4 flex flex-col">
                <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                  <h3 className="text-sm font-semibold text-gray-500">
                    Patching: Applying Edit Script to {name1}
                  </h3>
                  <button
                    onClick={() => {
                      setPatchStep(0);
                      if (editOps.length > 0) setIsPatching(true);
                    }}
                    disabled={isPatching || editOps.length === 0}
                    className="btn-accent text-xs py-1.5 px-3"
                  >
                    {isPatching
                      ? `Applying ${Math.min(patchStep + 1, editOps.length)}/${editOps.length}…`
                      : 'Start Patching'}
                  </button>
                </div>

                <div className="max-h-[520px] overflow-auto">
                  <div className="space-y-2">
                    {editOps.slice(0, 150).map((op, i) => {
                      const patchComplete =
                        !isPatching && editOps.length > 0 && patchStep >= editOps.length - 1;
                      const isApplied = isPatching ? i <= patchStep : patchComplete;
                      const isCurrent = i === patchStep && isPatching;

                      return (
                        <div
                          key={i}
                          className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-300 ${
                            isCurrent
                              ? 'bg-primary-50 border-primary-600 ring-1 ring-primary-500/30'
                              : isApplied
                              ? 'bg-accent-50 border-accent-200'
                              : 'bg-gray-50 border-gray-100 opacity-50'
                          }`}
                        >
                          <div className="shrink-0">
                            {isApplied ? (
                              <CheckCircle2 size={16} className="text-accent-500" />
                            ) : (
                              <div className="w-4 h-4 rounded-full border border-gray-300" />
                            )}
                          </div>

                          {getOpIcon(op.type)}

                          <span className="text-sm font-mono text-gray-700">{op.node}</span>

                          {op.from && (
                            <span className="text-xs text-gray-500">
                              <span className="text-red-500">{op.from}</span> →{' '}
                              <span className="text-green-500">{op.to}</span>
                            </span>
                          )}

                          {isCurrent && (
                            <span className="ml-auto text-[10px] text-primary-600 animate-pulse">
                              Applying…
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {editOps.length > 0 && !isPatching && patchStep >= editOps.length - 1 && (
                  <div className={`mt-3 p-3 rounded-lg flex items-center gap-2 ${
                    backendResult?.patch_verified
                      ? 'bg-accent-50 border border-accent-200'
                      : 'bg-red-50 border border-red-200'
                  }`}>
                    <CheckCircle2 size={16} className={backendResult?.patch_verified ? 'text-accent-500' : 'text-red-500'} />
                    <span className={`text-sm ${backendResult?.patch_verified ? 'text-accent-600' : 'text-red-600'}`}>
                      Patching complete! Verification: {backendResult?.patch_verified ? 'OK — patched tree matches target.' : 'FAILED'}
                    </span>
                  </div>
                )}
              </div>

              <div className="w-full xl:w-80 flex flex-col gap-4">
                <div className="glass-card p-4 flex flex-col">
                  <h3 className="text-sm font-semibold text-red-600 mb-2">
                    Before — {name1}
                  </h3>
                  <div className="max-h-[240px] bg-gray-100 rounded-lg p-3 font-mono text-[10px] overflow-auto">
                    <pre className="text-gray-500">{t1 ? treeToXmlPreview(t1) : '(no data)'}</pre>
                  </div>
                </div>

                <div className="glass-card p-4 flex flex-col">
                  <h3 className="text-sm font-semibold text-green-600 mb-2">
                    After — {name2}
                  </h3>
                  <div className="max-h-[240px] bg-gray-100 rounded-lg p-3 font-mono text-[10px] overflow-auto">
                    <pre className="text-gray-500">{t2 ? treeToXmlPreview(t2) : '(no data)'}</pre>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'diff' && (
            <div className="glass-card p-4 flex flex-col">
              <h3 className="text-sm font-semibold text-gray-500 mb-3">
                Side-by-Side Diff View — {name1} vs {name2}
              </h3>

              <div className="overflow-auto">
                <div className="flex gap-4 min-w-[900px]">
                  <div className="flex-1">
                    <h4 className="text-xs text-red-600 font-semibold mb-2">
                      Source: {name1}
                    </h4>
                    <div className="bg-gray-100 rounded-lg p-3 font-mono text-[11px] space-y-0.5">
                      {diffLines.map((line, i) => (
                        <div
                          key={i}
                          className={`px-2 py-0.5 rounded ${
                            line.type === 'removed'
                              ? 'bg-red-50 text-red-600'
                              : line.type === 'modified'
                              ? 'bg-yellow-50 text-yellow-700'
                              : line.type === 'added'
                              ? 'bg-green-50/50 text-gray-400'
                              : 'text-gray-500'
                          }`}
                        >
                          <span className="text-gray-400 mr-2">
                            {String(i + 1).padStart(3)}
                          </span>
                          {line.source !== undefined ? line.source : line.text}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex-1">
                    <h4 className="text-xs text-green-600 font-semibold mb-2">
                      Target: {name2}
                    </h4>
                    <div className="bg-gray-100 rounded-lg p-3 font-mono text-[11px] space-y-0.5">
                      {diffLines.map((line, i) => (
                        <div
                          key={i}
                          className={`px-2 py-0.5 rounded ${
                            line.type === 'added'
                              ? 'bg-green-50 text-green-600'
                              : line.type === 'modified'
                              ? 'bg-yellow-50 text-yellow-700'
                              : line.type === 'removed'
                              ? 'bg-red-50/50 text-gray-400'
                              : 'text-gray-500'
                          }`}
                        >
                          <span className="text-gray-400 mr-2">
                            {String(i + 1).padStart(3)}
                          </span>
                          {line.target !== undefined ? line.target : line.text}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'postprocess' && (
            <div className="flex gap-4">
              <div className="flex-1 glass-card p-4 flex flex-col">
                <h3 className="text-sm font-semibold text-gray-500 mb-1">
                  Post-Processing: Patched Output
                </h3>
                <p className="text-xs text-gray-400 mb-3">
                  {backendResult
                    ? `Result of patching ${backendResult.country_a} → ${backendResult.country_b}. Patch verified: ${backendResult.patch_verified ? 'OK' : 'FAILED'}.`
                    : 'No backend result available for this pair.'}
                </p>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="flex flex-col">
                    <h4 className="text-xs text-primary-600 font-semibold mb-2">
                      Patched JSON Output
                    </h4>
                    <div className="max-h-[420px] bg-gray-100 rounded-lg p-3 font-mono text-[10px] overflow-auto">
                      <pre className="text-gray-500 whitespace-pre-wrap break-words">
                        {backendResult?.patched_json ?? '(no data)'}
                      </pre>
                    </div>
                  </div>

                  <div className="flex flex-col">
                    <h4 className="text-xs text-accent-600 font-semibold mb-2">
                      Patched Infobox Text
                    </h4>
                    <div className="max-h-[420px] bg-gray-100 rounded-lg p-3 font-mono text-[10px] overflow-auto">
                      <pre className="text-gray-500 whitespace-pre-wrap break-words">
                        {backendResult?.patched_infobox ?? '(no data)'}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="h-4" />
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200 shrink-0 bg-white">
        <button onClick={onPrev} className="btn-secondary">
          Back
        </button>

        <button onClick={onNext} className="btn-primary flex items-center gap-2">
          View Summary &amp; Complexity
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string; color: string }> = ({
  label,
  value,
  color,
}) => (
  <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
    <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
    <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
  </div>
);