import React, { useState, useMemo } from 'react';
import {
  Cpu,
  HardDrive,
  BarChart3,
  Info,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Zap,
  Globe,
  TrendingUp,
  TrendingDown,
  Sigma,
} from 'lucide-react';
import {
  AlgorithmConfig,
  Country,
  CountryPair,
  SimilarityConfig,
  TreeNode,
  DataSourceConfig,
  BackendCompareResult,
} from '../types';
import { countries } from '../data/countries';

function makePairKey(c1: string, c2: string): string {
  return `${c1}__${c2}`;
}

interface SummaryViewProps {
  selectedCountries: Country[];
  comparisonMode: 'pair' | 'all';
  countryPairs: CountryPair[];
  loadedTrees: Record<string, TreeNode>;
  similarityConfig: SimilarityConfig;
  selectedAlgorithm: AlgorithmConfig | null;
  dataSource: DataSourceConfig;
  backendResults: Record<string, BackendCompareResult>;
  onRestart: () => void;
}

export const SummaryView: React.FC<SummaryViewProps> = ({
  selectedCountries,
  comparisonMode,
  countryPairs,
  loadedTrees,
  similarityConfig,
  selectedAlgorithm,
  dataSource,
  backendResults,
  onRestart,
}) => {
  const [showComplexity, setShowComplexity] = useState(false);

  const getCountryName = (code: string) =>
    countries.find(c => c.code === code)?.name ?? code;

  const pairResults = useMemo(
    () =>
      countryPairs.map(pair => {
        const key = makePairKey(pair.country1, pair.country2);
        const br = backendResults[key];
        if (!br) return null;
        return {
          sim: br.similarity,
          ted: br.distance,
          label: 'Zhang-Shasha TED',
          totalOps: br.total_operations,
          patchVerified: br.patch_verified,
        };
      }),
    [countryPairs, backendResults],
  );

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
      ? rankedResults.reduce((sum, item) => sum + item.result.sim, 0) / rankedResults.length
      : 0;

  const isOneVsAll =
    countryPairs.length > 0 &&
    selectedCountries.length > 0 &&
    countryPairs.every(pair => pair.country1 === selectedCountries[0].code);

  const baseCountry = isOneVsAll ? selectedCountries[0] : null;

  const pipelineStages = [
    { label: 'Country Selection', color: 'bg-blue-500' },
    { label: 'Map & Algorithm Config', color: 'bg-cyan-500' },
    { label: 'Data Source Selection', color: 'bg-teal-500' },
    { label: 'Data Collection', color: 'bg-green-500' },
    { label: 'Field Selection', color: 'bg-yellow-500' },
    { label: 'Tree Building', color: 'bg-orange-500' },
    { label: 'Algorithm Execution', color: 'bg-red-500' },
    { label: 'Results Analysis', color: 'bg-purple-500' },
  ];

  return (
    <div className="animate-fade-in flex flex-col h-full">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Processing Summary</h2>
        <p className="text-gray-500">
          Complete overview of the comparison process and complexity analysis.
        </p>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="glass-card p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center">
                <Globe size={20} className="text-primary-600" />
              </div>
              <div>
                <div className="text-[10px] text-gray-500 uppercase">Countries Compared</div>
                <div className="text-2xl font-bold text-gray-900">
                  {isOneVsAll ? rankedResults.length + 1 : selectedCountries.length}
                </div>
              </div>
            </div>
          </div>

          <div className="glass-card p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent-50 flex items-center justify-center">
                <BarChart3 size={20} className="text-accent-600" />
              </div>
              <div>
                <div className="text-[10px] text-gray-500 uppercase">Pairs Processed</div>
                <div className="text-2xl font-bold text-gray-900">{countryPairs.length}</div>
              </div>
            </div>
          </div>

          <div className="glass-card p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-yellow-50 flex items-center justify-center">
                <Zap size={20} className="text-yellow-600" />
              </div>
              <div>
                <div className="text-[10px] text-gray-500 uppercase">Algorithm</div>
                <div className="text-base font-bold text-gray-900 truncate">
                  {selectedAlgorithm?.name ?? 'Zhang-Shasha TED'}
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  Dataset: {dataSource.dataVariant} · Mode: {comparisonMode}
                </div>
              </div>
            </div>
          </div>
        </div>

        {isOneVsAll && rankedResults.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <div className="glass-card p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Globe size={20} className="text-blue-600" />
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 uppercase">Base Country</div>
                  <div className="text-lg font-bold text-gray-900">
                    {baseCountry?.name ?? '—'}
                  </div>
                </div>
              </div>
            </div>

            <div className="glass-card p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
                  <TrendingUp size={20} className="text-green-600" />
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 uppercase">Closest Country</div>
                  <div className="text-lg font-bold text-green-600">
                    {closest ? getCountryName(closest.pair.country2) : '—'}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {closest ? `${(closest.result.sim * 100).toFixed(1)}% similarity` : ''}
                  </div>
                </div>
              </div>
            </div>

            <div className="glass-card p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
                  <TrendingDown size={20} className="text-red-600" />
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 uppercase">Farthest Country</div>
                  <div className="text-lg font-bold text-red-600">
                    {farthest ? getCountryName(farthest.pair.country2) : '—'}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {farthest ? `${(farthest.result.sim * 100).toFixed(1)}% similarity` : ''}
                  </div>
                </div>
              </div>
            </div>

            <div className="glass-card p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
                  <Sigma size={20} className="text-purple-600" />
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 uppercase">Average Similarity</div>
                  <div className="text-lg font-bold text-purple-600">
                    {(averageSimilarity * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="glass-card p-5 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Processing Pipeline</h3>
          <div className="space-y-3">
            {pipelineStages.map((stage, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${stage.color}`} />
                <span className="text-sm text-gray-700 flex-1">{stage.label}</span>
                <span className="text-xs text-accent-600 font-mono">✓ completed</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card p-5 mb-6">
          <button
            onClick={() => setShowComplexity(!showComplexity)}
            className="w-full flex items-center justify-between"
          >
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Cpu size={18} />
              Time &amp; Space Complexity Analysis
            </h3>
            {showComplexity ? (
              <ChevronDown size={18} className="text-gray-500" />
            ) : (
              <ChevronRight size={18} className="text-gray-500" />
            )}
          </button>

          {showComplexity && selectedAlgorithm && (
            <div className="mt-4 space-y-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-primary-600 mb-3">
                  {selectedAlgorithm.name}
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                    <div className="flex items-center gap-2 mb-2">
                      <Cpu size={14} className="text-yellow-600" />
                      <h5 className="text-sm font-semibold text-yellow-600">
                        Time Complexity
                      </h5>
                    </div>
                    <div className="text-xl font-mono text-gray-900 mb-2">
                      {selectedAlgorithm.timeComplexity}
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      {selectedAlgorithm.type === 'chawathe'
                        ? 'Where n and m are the number of nodes in Tree 1 and Tree 2 respectively. The top-down matching phase dominates the cost, iterating over all node pairs and comparing paths up to the maximum tree depth.'
                        : selectedAlgorithm.type === 'zhang-shasha'
                        ? 'Where n and m are the number of postorder nodes. The keyroot forest-distance DP runs once per keyroot pair; total work is bounded by O(n·m) across all pairs.'
                        : 'Where n and m are the number of nodes in Tree 1 and Tree 2 respectively. The dynamic programming table has O(n·m) entries, each requiring additional forest distance work in the worst case.'}
                    </p>
                  </div>

                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                    <div className="flex items-center gap-2 mb-2">
                      <HardDrive size={14} className="text-cyan-600" />
                      <h5 className="text-sm font-semibold text-cyan-600">
                        Space Complexity
                      </h5>
                    </div>
                    <div className="text-xl font-mono text-gray-900 mb-2">
                      {selectedAlgorithm.spaceComplexity}
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      {selectedAlgorithm.type === 'chawathe'
                        ? 'Storage for the matching table between node pairs, plus the edit script operations list.'
                        : 'The TED matrix stores distances between subtree pairs. Additional space is used for forest-distance tables and backtrack information.'}
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  <h5 className="text-sm font-semibold text-gray-700 mb-2">
                    Step-by-step Complexity
                  </h5>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-300">
                        <th className="text-left py-2 text-gray-500 font-normal">Step</th>
                        <th className="text-left py-2 text-gray-500 font-normal">Time</th>
                        <th className="text-left py-2 text-gray-500 font-normal">Space</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getStepComplexities(selectedAlgorithm.type).map((step, i) => (
                        <tr key={i} className="border-b border-gray-100">
                          <td className="py-2 text-gray-700">{step.name}</td>
                          <td className="py-2 font-mono text-yellow-600 text-xs">
                            {step.time}
                          </td>
                          <td className="py-2 font-mono text-cyan-600 text-xs">
                            {step.space}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">
                  Practical Performance Notes
                </h4>
                <ul className="space-y-2 text-xs text-gray-500">
                  <li className="flex items-start gap-2">
                    <Info size={12} className="text-primary-600 mt-0.5 shrink-0" />
                    <span>
                      Country data usually produces medium-size trees, so TED computation is
                      generally fast for a single comparison.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Info size={12} className="text-primary-600 mt-0.5 shrink-0" />
                    <span>
                      In practice, data collection and preprocessing often take longer than the
                      similarity computation itself.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Info size={12} className="text-primary-600 mt-0.5 shrink-0" />
                    <span>
                      This run processed {countryPairs.length} pair
                      {countryPairs.length !== 1 ? 's' : ''} in total.
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="glass-card p-5 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Comparison Results per Pair
          </h3>

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-300">
                  <th className="text-left py-2 text-gray-500 font-normal">Country Pair</th>
                  <th className="text-center py-2 text-gray-500 font-normal">TED</th>
                  <th className="text-center py-2 text-gray-500 font-normal">Similarity</th>
                  <th className="text-center py-2 text-gray-500 font-normal">Edit Ops</th>
                  <th className="text-center py-2 text-gray-500 font-normal">Patch</th>
                </tr>
              </thead>
              <tbody>
                {countryPairs.map((pair, i) => {
                  const result = pairResults[i];
                  const simPct = result ? Math.round(result.sim * 100) : null;

                  return (
                    <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2.5 text-gray-700">
                        {getCountryName(pair.country1)}{' '}
                        <span className="text-gray-400">vs</span>{' '}
                        {getCountryName(pair.country2)}
                      </td>
                      <td className="py-2.5 text-center font-mono text-yellow-600">
                        {result?.ted !== undefined ? result.ted.toFixed(2) : '—'}
                      </td>
                      <td className="py-2.5 text-center">
                        {simPct !== null ? (
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-semibold ${
                              simPct >= 70
                                ? 'bg-green-50 text-green-600'
                                : simPct >= 40
                                ? 'bg-yellow-50 text-yellow-600'
                                : 'bg-red-50 text-red-600'
                            }`}
                          >
                            {simPct}%
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">no data</span>
                        )}
                      </td>
                      <td className="py-2.5 text-center text-gray-500 font-mono">
                        {result?.totalOps ?? '—'}
                      </td>
                      <td className="py-2.5 text-center">
                        {result?.patchVerified !== undefined ? (
                          <span className={`text-xs font-semibold ${result.patchVerified ? 'text-green-600' : 'text-red-600'}`}>
                            {result.patchVerified ? 'OK' : 'FAIL'}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center mt-4 pt-4 border-t border-gray-200 shrink-0">
        <button onClick={onRestart} className="btn-primary flex items-center gap-2">
          <RotateCcw size={16} />
          Start New Comparison
        </button>
      </div>
    </div>
  );
};

function getStepComplexities(algoType: string) {
  if (algoType === 'chawathe') {
    return [
      { name: 'Parse JSON to Tree', time: 'O(n)', space: 'O(n)' },
      { name: 'Top-down Matching', time: 'O(n·m·d)', space: 'O(n·m)' },
      { name: 'Children Alignment (LCS)', time: 'O(n·m)', space: 'O(min(n,m))' },
      { name: 'Edit Script Generation', time: 'O(n+m)', space: 'O(n+m)' },
      { name: 'Diff Output Generation', time: 'O(|script|)', space: 'O(|script|)' },
    ];
  }

  if (algoType === 'zhang-shasha') {
    return [
      { name: 'Parse JSON to Tree', time: 'O(n)', space: 'O(n)' },
      { name: 'Postorder Numbering', time: 'O(n+m)', space: 'O(n+m)' },
      { name: 'Leftmost Leaf Desc. (lmd)', time: 'O(n+m)', space: 'O(n+m)' },
      { name: 'Keyroot Computation', time: 'O(n+m)', space: 'O(n+m)' },
      { name: 'Forest Distance DP', time: 'O(n·m)', space: 'O(n·m)' },
      { name: 'Backtrack & Edit Script', time: 'O(n+m)', space: 'O(n+m)' },
      { name: 'Diff Output Generation', time: 'O(|script|)', space: 'O(|script|)' },
    ];
  }

  return [
    { name: 'Parse JSON to Tree', time: 'O(n)', space: 'O(n)' },
    { name: 'Key Root Computation', time: 'O(n+m)', space: 'O(n+m)' },
    { name: 'Forest Distance Tables', time: 'O(n²·m²)', space: 'O(n·m)' },
    { name: 'TED Matrix Fill', time: 'O(n·m)', space: 'O(n·m)' },
    { name: 'Backtrack & Edit Script', time: 'O(n+m)', space: 'O(n+m)' },
    { name: 'Diff Output Generation', time: 'O(|script|)', space: 'O(|script|)' },
  ];
}