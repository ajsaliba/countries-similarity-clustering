import React, { useState, useEffect, useMemo } from 'react';
import { Check, ChevronDown, ChevronRight, AlertTriangle, Database } from 'lucide-react';
import { Country, CountryPair, TreeNode } from '../types';
import { countries } from '../data/countries';
import { formatMetricValue } from '../services/dataService';

interface MetricsSelectionProps {
  selectedCountries: Country[];
  comparisonMode: 'pair' | 'all';
  countryPairs: CountryPair[];
  loadedTrees: Record<string, TreeNode>;
  onUpdatePairMetrics: (country1: string, country2: string, metrics: string[]) => void;
  onGeneratePairs: () => CountryPair[];
  onNext: () => void;
  onPrev: () => void;
}

/** Extract depth-2 leaf fields grouped by category from a loaded tree. */
function getTreeFields(tree: TreeNode): Map<string, { label: string; value: string | undefined }[]> {
  const map = new Map<string, { label: string; value: string | undefined }[]>();
  for (const catNode of tree.children) {
    const leaves = catNode.children.filter(n => n.children.length === 0);
    if (leaves.length > 0) {
      map.set(
        catNode.label,
        leaves.map(n => ({ label: n.label, value: n.value })),
      );
    }
  }
  return map;
}

/** Return fields present in both trees, grouped by category. */
function getCommonFields(t1: TreeNode, t2: TreeNode): Map<string, string[]> {
  const m1 = getTreeFields(t1);
  const m2 = getTreeFields(t2);
  const result = new Map<string, string[]>();

  for (const [cat, f1] of m1) {
    const f2 = m2.get(cat);
    if (!f2) continue;
    const set2 = new Set(f2.map(f => f.label));
    const common = f1.filter(f => set2.has(f.label)).map(f => f.label);
    if (common.length > 0) result.set(cat, common);
  }

  return result;
}

/** Get the stored value for a specific category + field from a tree. */
function fieldValue(tree: TreeNode, category: string, field: string): string {
  const catNode = tree.children.find(c => c.label === category);
  if (!catNode) return '—';

  const leaf = catNode.children.find(n => n.label === field);
  if (!leaf?.value) return '—';

  const num = parseFloat(leaf.value);
  return isNaN(num) ? leaf.value : formatMetricValue(num);
}

/** "total_population" → "Total Population" */
function prettyLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export const MetricsSelection: React.FC<MetricsSelectionProps> = ({
  selectedCountries,
  comparisonMode,
  countryPairs,
  loadedTrees,
  onUpdatePairMetrics,
  onGeneratePairs,
  onNext,
  onPrev,
}) => {
  const [activePairIndex, setActivePairIndex] = useState(0);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const hasData = Object.keys(loadedTrees).length > 0;

  const getCountryName = (code: string) =>
    countries.find(c => c.code === code)?.name ?? code;

  const effectivePairs = useMemo(
    () => (countryPairs.length > 0 ? countryPairs : onGeneratePairs()),
    [countryPairs, onGeneratePairs],
  );

  useEffect(() => {
    if (!hasData || effectivePairs.length === 0) return;

    effectivePairs.forEach(pair => {
      if (pair.selectedMetrics.length === 0) {
        const t1 = loadedTrees[pair.country1];
        const t2 = loadedTrees[pair.country2];
        if (t1 && t2) {
          const allCommon: string[] = [];
          for (const fields of getCommonFields(t1, t2).values()) {
            allCommon.push(...fields);
          }
          if (allCommon.length > 0) {
            onUpdatePairMetrics(pair.country1, pair.country2, allCommon);
          }
        }
      }
    });

    const firstPair = effectivePairs[0];
    if (firstPair) {
      const t1 = loadedTrees[firstPair.country1];
      const t2 = loadedTrees[firstPair.country2];
      if (t1 && t2) {
        setExpandedCategories(new Set(getCommonFields(t1, t2).keys()));
      }
    }
  }, [effectivePairs, hasData, loadedTrees, onUpdatePairMetrics]);

  useEffect(() => {
    if (activePairIndex >= effectivePairs.length) {
      setActivePairIndex(0);
    }
  }, [activePairIndex, effectivePairs.length]);

  const activePair = effectivePairs[activePairIndex];

  const commonFields = useMemo(() => {
    if (!activePair) return new Map<string, string[]>();
    const t1 = loadedTrees[activePair.country1];
    const t2 = loadedTrees[activePair.country2];
    if (!t1 || !t2) return new Map<string, string[]>();
    return getCommonFields(t1, t2);
  }, [activePair, loadedTrees]);

  const totalCommon = useMemo(
    () => [...commonFields.values()].reduce((s, f) => s + f.length, 0),
    [commonFields],
  );

  const toggleCategory = (cat: string) =>
    setExpandedCategories(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });

  const toggleField = (field: string) => {
    if (!activePair) return;
    const cur = activePair.selectedMetrics;
    onUpdatePairMetrics(
      activePair.country1,
      activePair.country2,
      cur.includes(field) ? cur.filter(f => f !== field) : [...cur, field],
    );
  };

  const toggleCategoryAll = (_cat: string, fields: string[]) => {
    if (!activePair) return;
    const cur = new Set(activePair.selectedMetrics);
    const allOn = fields.every(f => cur.has(f));
    let next: string[];

    if (allOn) {
      next = activePair.selectedMetrics.filter(f => !fields.includes(f));
    } else {
      next = [...activePair.selectedMetrics, ...fields.filter(f => !cur.has(f))];
    }

    onUpdatePairMetrics(activePair.country1, activePair.country2, next);
  };

  const selectAll = () => {
    if (!activePair) return;
    const all: string[] = [];
    for (const f of commonFields.values()) all.push(...f);
    onUpdatePairMetrics(activePair.country1, activePair.country2, all);
  };

  const clearAll = () => {
    if (!activePair) return;
    onUpdatePairMetrics(activePair.country1, activePair.country2, []);
  };

  const allPairsHaveFields =
    effectivePairs.length > 0 && effectivePairs.every(p => p.selectedMetrics.length > 0);

  const baseCountryName =
    comparisonMode === 'all' && selectedCountries[0]
      ? selectedCountries[0].name
      : null;

  if (!hasData) {
    return (
      <div className="animate-fade-in flex flex-col h-full items-center justify-center gap-4">
        <Database size={48} className="text-gray-300" />
        <h2 className="text-xl font-bold text-gray-900">No Data Loaded</h2>
        <p className="text-gray-500 text-center max-w-sm">
          Go back to Data Collection and complete the data loading step first.
          Field selection is based on the actual indicators present in your data files.
        </p>
        <button onClick={onPrev} className="btn-secondary">Back</button>
      </div>
    );
  }

  if (effectivePairs.length === 0) {
    return <div className="text-center text-gray-400 py-12">Generating pairs…</div>;
  }

  return (
    <div className="animate-fade-in flex flex-col h-full">
      <div className="text-center mb-4 shrink-0">
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Select Comparison Fields</h2>
        <p className="text-gray-500 text-sm">
          {comparisonMode === 'pair'
            ? 'Choose which indicators to include for the selected country pair.'
            : `Choose which indicators to include for each comparison against ${baseCountryName ?? 'the selected country'}.`}
        </p>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        <div className="w-60 glass-card p-3 flex flex-col">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            {comparisonMode === 'pair'
              ? `Country Pairs (${effectivePairs.length})`
              : `Comparisons (${effectivePairs.length})`}
          </h3>

          <div className="flex-1 overflow-y-auto space-y-1">
            {effectivePairs.map((pair, i) => {
              const t1 = loadedTrees[pair.country1];
              const t2 = loadedTrees[pair.country2];
              const total =
                t1 && t2
                  ? [...getCommonFields(t1, t2).values()].reduce((s, f) => s + f.length, 0)
                  : 0;

              return (
                <button
                  key={`${pair.country1}-${pair.country2}`}
                  onClick={() => setActivePairIndex(i)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-all text-sm ${
                    i === activePairIndex
                      ? 'bg-primary-50 border border-primary-600 text-gray-900'
                      : 'bg-white border border-transparent text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <div className="font-medium truncate text-xs">
                    {getCountryName(pair.country1)}
                    <span className="text-gray-400 mx-1">vs</span>
                    {getCountryName(pair.country2)}
                  </div>
                  <div className="mt-1">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        pair.selectedMetrics.length > 0
                          ? 'bg-accent-50 text-accent-600'
                          : 'bg-yellow-50 text-yellow-600'
                      }`}
                    >
                      {pair.selectedMetrics.length}/{total} fields
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 glass-card p-4 flex flex-col min-h-0">
          {activePair && (() => {
            const t1 = loadedTrees[activePair.country1];
            const t2 = loadedTrees[activePair.country2];
            const name1 = getCountryName(activePair.country1);
            const name2 = getCountryName(activePair.country2);

            if (!t1 || !t2) {
              return (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-gray-500 text-sm">No data available for this pair.</p>
                </div>
              );
            }

            return (
              <>
                <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-200 shrink-0">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">
                      {name1} <span className="text-gray-400">vs</span> {name2}
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {activePair.selectedMetrics.length} of {totalCommon} common fields selected
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={selectAll}
                      className="text-xs text-primary-600 hover:text-primary-700 px-2 py-1 rounded border border-primary-200 hover:border-primary-300 transition-colors"
                    >
                      Select all
                    </button>
                    <button
                      onClick={clearAll}
                      className="text-xs text-gray-500 hover:text-gray-600 px-2 py-1 rounded border border-gray-200 hover:border-gray-300 transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 px-3 pb-1 shrink-0">
                  <div className="flex-1 text-[10px] text-gray-600 uppercase tracking-wider">Field</div>
                  <div className="w-28 text-[10px] text-gray-600 uppercase tracking-wider text-right truncate">{name1}</div>
                  <div className="w-28 text-[10px] text-gray-600 uppercase tracking-wider text-right truncate">{name2}</div>
                </div>

                <div className="flex-1 overflow-y-auto space-y-1.5">
                  {[...commonFields.entries()].map(([cat, fields]) => {
                    const expanded = expandedCategories.has(cat);
                    const selCount = fields.filter(f => activePair.selectedMetrics.includes(f)).length;
                    const allSel = selCount === fields.length;

                    return (
                      <div key={cat} className="border border-gray-200 rounded-lg overflow-hidden">
                        <button
                          onClick={() => toggleCategory(cat)}
                          className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
                        >
                          {expanded ? (
                            <ChevronDown size={14} className="text-gray-500 shrink-0" />
                          ) : (
                            <ChevronRight size={14} className="text-gray-500 shrink-0" />
                          )}
                          <span className="font-medium text-gray-700 text-sm">{prettyLabel(cat)}</span>
                          <span className="text-[10px] text-gray-500 ml-auto">
                            {selCount}/{fields.length}
                          </span>
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              toggleCategoryAll(cat, fields);
                            }}
                            className="text-[10px] text-primary-600 hover:text-primary-700 px-2 py-0.5 rounded border border-primary-200 hover:border-primary-300 ml-1"
                          >
                            {allSel ? 'Deselect all' : 'Select all'}
                          </button>
                        </button>

                        {expanded && (
                          <div className="divide-y divide-gray-100">
                            {fields.map(field => {
                              const selected = activePair.selectedMetrics.includes(field);
                              const v1 = fieldValue(t1, cat, field);
                              const v2 = fieldValue(t2, cat, field);

                              return (
                                <button
                                  key={field}
                                  onClick={() => toggleField(field)}
                                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                                    selected ? 'bg-primary-50 hover:bg-primary-100' : 'hover:bg-gray-50'
                                  }`}
                                >
                                  <div
                                    className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                                      selected ? 'bg-primary-600 border-primary-600' : 'border-gray-300'
                                    }`}
                                  >
                                    {selected && <Check size={10} className="text-white" />}
                                  </div>

                                  <span className="flex-1 text-xs text-gray-700 text-left truncate">
                                    {prettyLabel(field)}
                                  </span>

                                  <span className="w-28 text-[10px] text-gray-400 font-mono text-right truncate">
                                    {v1}
                                  </span>
                                  <span className="w-28 text-[10px] text-gray-400 font-mono text-right truncate">
                                    {v2}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200 shrink-0">
        <button onClick={onPrev} className="btn-secondary">Back</button>
        <div className="flex items-center gap-3">
          {!allPairsHaveFields && (
            <span className="flex items-center gap-1 text-sm text-yellow-500">
              <AlertTriangle size={14} />
              Select at least one field per pair
            </span>
          )}
          <button onClick={onNext} disabled={!allPairsHaveFields} className="btn-primary">
            Continue to Tree Building
          </button>
        </div>
      </div>
    </div>
  );
};