import { Stepper } from '../components/Stepper';
import { CountrySelection } from '../components/CountrySelection';
import { MetricsSelection } from '../components/MetricsSelection';
import { DataSourceSelection } from '../components/DataSourceSelection';
import { DataCollection } from '../components/DataCollection';
import { TreeBuilding } from '../components/TreeBuilding';
import { AlgorithmExecution } from '../components/AlgorithmExecution';
import { ResultsView } from '../components/ResultsView';
import { SummaryView } from '../components/SummaryView';
import { useAppState } from '../hooks/useAppState';
import { useEffect } from 'react';
import { BackendCompareResult } from '../types';

export function ComparePage() {
  const {
    currentPhase,
    selectedCountries,
    countryPairs,
    selectedAlgorithm,
    similarityConfig,
    dataSource,
    comparisonMode,
    setComparisonMode,
    addCountry,
    removeCountry,
    generatePairs,
    updatePairMetrics,
    setDataSource,
    loadedTrees,
    setLoadedTrees,
    backendResults,
    setBackendResults,
    nextPhase,
    prevPhase,
    goToPhase,
    resetSimulation,
    totalPhases,
  } = useAppState();

  // Save recent comparisons to localStorage when a result is loaded (phase 6)
  useEffect(() => {
    if (currentPhase === 6 && Object.keys(backendResults).length > 0) {
      const firstKey = Object.keys(backendResults)[0];
      const result = backendResults[firstKey] as BackendCompareResult | undefined;
      if (result) {
        try {
          const recent: { a: string; b: string; score: number; date: string }[] = JSON.parse(
            localStorage.getItem('csc_v1_recentComparisons') ?? '[]',
          );
          recent.unshift({
            a: result.country_a,
            b: result.country_b,
            score: result.similarity,
            date: new Date().toISOString(),
          });
          localStorage.setItem('csc_v1_recentComparisons', JSON.stringify(recent.slice(0, 20)));
        } catch { /* ignore storage errors */ }
      }
    }
  }, [currentPhase, backendResults]);

  const handleRestart = () => {
    goToPhase(0);
    resetSimulation();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Wizard header with stepper */}
      <header className="shrink-0 border-b border-gray-200 bg-white/90 shadow-sm backdrop-blur-sm">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center gap-4">
          <div className="flex-1">
            <Stepper
              currentPhase={currentPhase}
              totalPhases={totalPhases}
              onGoToPhase={goToPhase}
            />
          </div>
          <div className="text-xs text-gray-400 font-mono shrink-0">
            Phase {currentPhase + 1}/{totalPhases}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="max-w-screen-2xl mx-auto px-6 py-5">
          {currentPhase === 0 && (
            <CountrySelection
              selectedCountries={selectedCountries}
              comparisonMode={comparisonMode}
              onSetComparisonMode={setComparisonMode}
              onAddCountry={addCountry}
              onRemoveCountry={removeCountry}
              onNext={nextPhase}
            />
          )}

          {currentPhase === 1 && (
            <DataSourceSelection
              dataSource={dataSource}
              onSetDataSource={setDataSource}
              onNext={nextPhase}
              onPrev={prevPhase}
            />
          )}

          {currentPhase === 2 && (
            <DataCollection
              selectedCountries={selectedCountries}
              comparisonMode={comparisonMode}
              dataSource={dataSource}
              onDataLoaded={setLoadedTrees}
              onNext={nextPhase}
              onPrev={prevPhase}
            />
          )}

          {currentPhase === 3 && (
            <MetricsSelection
              selectedCountries={selectedCountries}
              comparisonMode={comparisonMode}
              countryPairs={countryPairs}
              loadedTrees={loadedTrees}
              onUpdatePairMetrics={updatePairMetrics}
              onGeneratePairs={generatePairs}
              onNext={nextPhase}
              onPrev={prevPhase}
            />
          )}

          {currentPhase === 4 && (
            <TreeBuilding
              selectedCountries={selectedCountries}
              comparisonMode={comparisonMode}
              countryPairs={countryPairs}
              loadedTrees={loadedTrees}
              onNext={nextPhase}
              onPrev={prevPhase}
            />
          )}

          {currentPhase === 5 && (
            <AlgorithmExecution
              similarityConfig={similarityConfig}
              selectedCountries={selectedCountries}
              comparisonMode={comparisonMode}
              countryPairs={countryPairs}
              loadedTrees={loadedTrees}
              dataSource={dataSource}
              backendResults={backendResults}
              onSetBackendResults={setBackendResults}
              onNext={nextPhase}
              onPrev={prevPhase}
            />
          )}

          {currentPhase === 6 && (
            <ResultsView
              selectedCountries={selectedCountries}
              comparisonMode={comparisonMode}
              countryPairs={countryPairs}
              loadedTrees={loadedTrees}
              similarityConfig={similarityConfig}
              selectedAlgorithm={selectedAlgorithm}
              backendResults={backendResults}
              onNext={nextPhase}
              onPrev={prevPhase}
            />
          )}

          {currentPhase === 7 && (
            <SummaryView
              selectedCountries={selectedCountries}
              comparisonMode={comparisonMode}
              countryPairs={countryPairs}
              loadedTrees={loadedTrees}
              similarityConfig={similarityConfig}
              selectedAlgorithm={selectedAlgorithm}
              dataSource={dataSource}
              backendResults={backendResults}
              onRestart={handleRestart}
            />
          )}
        </div>
      </div>
    </div>
  );
}