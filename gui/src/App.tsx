import { Stepper } from './components/Stepper';
import { CountrySelection } from './components/CountrySelection';
import { MetricsSelection } from './components/MetricsSelection';
import { DataSourceSelection } from './components/DataSourceSelection';
import { DataCollection } from './components/DataCollection';
import { TreeBuilding } from './components/TreeBuilding';
import { AlgorithmExecution } from './components/AlgorithmExecution';
import { ResultsView } from './components/ResultsView';
import { SummaryView } from './components/SummaryView';
import { useAppState } from './hooks/useAppState';

export default function App() {
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

  const handleRestart = () => {
    goToPhase(0);
    resetSimulation();
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      <header className="shrink-0 border-b border-gray-200 bg-white/90 shadow-sm backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary-600 flex items-center justify-center font-bold text-sm text-white">
              CS
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-none">
                Country Similarity &amp; Clustering
              </h1>
              <p className="text-[10px] text-gray-500 leading-none mt-0.5">
                COE 543/743 · Lebanese American University
              </p>
            </div>
          </div>

          <div className="flex-1">
            <Stepper
              currentPhase={currentPhase}
              totalPhases={totalPhases}
              onGoToPhase={goToPhase}
            />
          </div>

          <div className="text-xs text-gray-400 font-mono">
            Phase {currentPhase + 1}/{totalPhases}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <div
          className="max-w-screen-2xl mx-auto px-6 py-5 h-full"
          style={{ height: 'calc(100vh - 72px)' }}
        >
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
      </main>
    </div>
  );
}