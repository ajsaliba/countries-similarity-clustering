import React, { useState, useEffect, useMemo } from 'react';
import { Check, ChevronDown, ChevronRight, Info, AlertTriangle } from 'lucide-react';
import { Country, CountryPair, Metric } from '../types';
import { allMetrics, metricCategories, getCommonMetrics, getAvailableMetrics } from '../data/metrics';
import { countries } from '../data/countries';

interface MetricsSelectionProps {
  selectedCountries: Country[];
  countryPairs: CountryPair[];
  onUpdatePairMetrics: (country1: string, country2: string, metrics: string[]) => void;
  onGeneratePairs: () => CountryPair[];
  onNext: () => void;
  onPrev: () => void;
}

export const MetricsSelection: React.FC<MetricsSelectionProps> = ({
  selectedCountries,
  countryPairs,
  onUpdatePairMetrics,
  onGeneratePairs,
  onNext,
  onPrev,
}) => {
  const [activePairIndex, setActivePairIndex] = useState(0);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(metricCategories));
  const [showCommonOnly, setShowCommonOnly] = useState(true);

  useEffect(() => {
    if (countryPairs.length === 0) {
      onGeneratePairs();
    }
  }, []);

  const getCountryName = (code: string) => {
    return countries.find(c => c.code === code)?.name || code;
  };

  const activePair = countryPairs[activePairIndex];

  const commonMetrics = useMemo(() => {
    if (!activePair) return [];
    return getCommonMetrics([activePair.country1, activePair.country2]);
  }, [activePair]);

  const country1Metrics = useMemo(() => {
    if (!activePair) return [];
    return getAvailableMetrics(activePair.country1);
  }, [activePair]);

  const country2Metrics = useMemo(() => {
    if (!activePair) return [];
    return getAvailableMetrics(activePair.country2);
  }, [activePair]);

  const displayMetrics = useMemo(() => {
    if (showCommonOnly) return commonMetrics;
    return allMetrics;
  }, [showCommonOnly, commonMetrics]);

  const groupedMetrics = useMemo(() => {
    const grouped: Record<string, Metric[]> = {};
    displayMetrics.forEach(m => {
      if (!grouped[m.category]) grouped[m.category] = [];
      grouped[m.category].push(m);
    });
    return grouped;
  }, [displayMetrics]);

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const toggleMetric = (metricId: string) => {
    if (!activePair) return;
    const current = activePair.selectedMetrics;
    const updated = current.includes(metricId)
      ? current.filter(id => id !== metricId)
      : [...current, metricId];
    onUpdatePairMetrics(activePair.country1, activePair.country2, updated);
  };

  const selectAllInCategory = (category: string) => {
    if (!activePair) return;
    const categoryMetricIds = groupedMetrics[category]?.map(m => m.id) || [];
    const currentSet = new Set(activePair.selectedMetrics);
    const allSelected = categoryMetricIds.every(id => currentSet.has(id));
    let updated: string[];
    if (allSelected) {
      updated = activePair.selectedMetrics.filter(id => !categoryMetricIds.includes(id));
    } else {
      const newIds = categoryMetricIds.filter(id => !currentSet.has(id));
      updated = [...activePair.selectedMetrics, ...newIds];
    }
    onUpdatePairMetrics(activePair.country1, activePair.country2, updated);
  };

  const selectAllCommon = () => {
    if (!activePair) return;
    onUpdatePairMetrics(
      activePair.country1,
      activePair.country2,
      commonMetrics.map(m => m.id)
    );
  };

  const clearAll = () => {
    if (!activePair) return;
    onUpdatePairMetrics(activePair.country1, activePair.country2, []);
  };

  const isMetricAvailable = (metricId: string, countryCode: string) => {
    const available = countryCode === activePair?.country1 ? country1Metrics : country2Metrics;
    return available.some(m => m.id === metricId);
  };

  const allPairsHaveMetrics = countryPairs.every(p => p.selectedMetrics.length > 0);

  if (countryPairs.length === 0) {
    return <div className="text-center text-gray-500 py-12">Loading pairs...</div>;
  }

  return (
    <div className="animate-fade-in flex flex-col h-full">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold text-white mb-2">Select Comparison Metrics</h2>
        <p className="text-gray-400">
          Choose which metrics to compare for each pair of countries. Not all countries have all metrics available.
        </p>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left: Pair selector */}
        <div className="w-64 glass-card p-3 flex flex-col">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Country Pairs ({countryPairs.length})
          </h3>
          <div className="flex-1 overflow-y-auto space-y-1">
            {countryPairs.map((pair, index) => (
              <button
                key={`${pair.country1}-${pair.country2}`}
                onClick={() => setActivePairIndex(index)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-all text-sm ${
                  index === activePairIndex
                    ? 'bg-primary-900/50 border border-primary-600 text-white'
                    : 'bg-gray-800/30 border border-transparent text-gray-400 hover:bg-gray-800/60'
                }`}
              >
                <div className="font-medium">
                  {getCountryName(pair.country1)} <span className="text-gray-600">vs</span>{' '}
                  {getCountryName(pair.country2)}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      pair.selectedMetrics.length > 0
                        ? 'bg-accent-900/50 text-accent-400'
                        : 'bg-yellow-900/50 text-yellow-400'
                    }`}
                  >
                    {pair.selectedMetrics.length} metrics
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: Metrics panel */}
        <div className="flex-1 glass-card p-4 flex flex-col">
          {activePair && (
            <>
              {/* Header */}
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-800">
                <div>
                  <h3 className="text-lg font-semibold text-white">
                    {getCountryName(activePair.country1)} vs {getCountryName(activePair.country2)}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {activePair.selectedMetrics.length} of {commonMetrics.length} common metrics selected
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showCommonOnly}
                      onChange={e => setShowCommonOnly(e.target.checked)}
                      className="rounded border-gray-600 bg-gray-800 text-primary-600 focus:ring-primary-500"
                    />
                    Common only
                  </label>
                  <button onClick={selectAllCommon} className="text-xs text-primary-400 hover:text-primary-300 px-2 py-1">
                    Select all common
                  </button>
                  <button onClick={clearAll} className="text-xs text-gray-500 hover:text-gray-400 px-2 py-1">
                    Clear
                  </button>
                </div>
              </div>

              {/* Metrics List */}
              <div className="flex-1 overflow-y-auto space-y-2">
                {Object.entries(groupedMetrics).map(([category, metrics]) => {
                  const expanded = expandedCategories.has(category);
                  const selectedInCat = metrics.filter(m =>
                    activePair.selectedMetrics.includes(m.id)
                  ).length;

                  return (
                    <div key={category} className="border border-gray-800 rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleCategory(category)}
                        className="w-full flex items-center gap-3 px-4 py-3 bg-gray-800/50 hover:bg-gray-800 transition-colors"
                      >
                        {expanded ? (
                          <ChevronDown size={16} className="text-gray-500" />
                        ) : (
                          <ChevronRight size={16} className="text-gray-500" />
                        )}
                        <span className="font-medium text-gray-200">{category}</span>
                        <span className="text-xs text-gray-500 ml-auto">
                          {selectedInCat}/{metrics.length} selected
                        </span>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            selectAllInCategory(category);
                          }}
                          className="text-xs text-primary-400 hover:text-primary-300 px-2 py-0.5 rounded border border-primary-800 hover:border-primary-600"
                        >
                          {selectedInCat === metrics.length ? 'Deselect all' : 'Select all'}
                        </button>
                      </button>

                      {expanded && (
                        <div className="p-2 space-y-1">
                          {metrics.map(metric => {
                            const isCommon =
                              isMetricAvailable(metric.id, activePair.country1) &&
                              isMetricAvailable(metric.id, activePair.country2);
                            const selected = activePair.selectedMetrics.includes(metric.id);

                            return (
                              <button
                                key={metric.id}
                                onClick={() => isCommon && toggleMetric(metric.id)}
                                disabled={!isCommon}
                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all ${
                                  !isCommon
                                    ? 'opacity-40 cursor-not-allowed'
                                    : selected
                                    ? 'bg-primary-900/30 border border-primary-700/50'
                                    : 'hover:bg-gray-800/50 border border-transparent'
                                }`}
                              >
                                <div
                                  className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                                    selected
                                      ? 'bg-primary-600 border-primary-600'
                                      : 'border-gray-600'
                                  }`}
                                >
                                  {selected && <Check size={12} className="text-white" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-200">
                                    {metric.name}
                                  </div>
                                  <div className="text-xs text-gray-500 truncate">
                                    {metric.description}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {!isMetricAvailable(metric.id, activePair.country1) && (
                                    <span className="text-[10px] px-1.5 py-0.5 bg-red-900/50 text-red-400 rounded">
                                      N/A: {getCountryName(activePair.country1).substring(0, 3)}
                                    </span>
                                  )}
                                  {!isMetricAvailable(metric.id, activePair.country2) && (
                                    <span className="text-[10px] px-1.5 py-0.5 bg-red-900/50 text-red-400 rounded">
                                      N/A: {getCountryName(activePair.country2).substring(0, 3)}
                                    </span>
                                  )}
                                </div>
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
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-800">
        <button onClick={onPrev} className="btn-secondary">
          Back
        </button>
        <div className="flex items-center gap-2">
          {!allPairsHaveMetrics && (
            <span className="flex items-center gap-1 text-sm text-yellow-500">
              <AlertTriangle size={14} />
              Some pairs have no metrics selected
            </span>
          )}
        </div>
        <button onClick={onNext} disabled={!allPairsHaveMetrics} className="btn-primary">
          Continue to Map View
        </button>
      </div>
    </div>
  );
};
