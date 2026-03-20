import React from 'react';
import { Stepper } from './components/Stepper';
import { CountrySelection } from './components/CountrySelection';
import { MetricsSelection } from './components/MetricsSelection';
import { WorldMapView } from './components/WorldMapView';
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
    addCountry,
    removeCountry,
    generatePairs,
    updatePairMetrics,
    setSelectedAlgorithm,
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
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <header className="shrink-0 border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-3">
            {/* Logo */}
            <div className="w-9 h-9 rounded-lg bg-primary-600 flex items-center justify-center font-bold text-sm">
              CS
            </div>
            <div>
              <h1 className="text-base font-bold text-white leading-none">
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

          <div className="text-xs text-gray-600 font-mono">
            Phase {currentPhase + 1}/{totalPhases}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <div className="max-w-screen-2xl mx-auto px-6 py-5 h-full" style={{ height: 'calc(100vh - 72px)' }}>
          {currentPhase === 0 && (
            <CountrySelection
              selectedCountries={selectedCountries}
              onAddCountry={addCountry}
              onRemoveCountry={removeCountry}
              onNext={nextPhase}
            />
          )}

          {currentPhase === 1 && (
            <MetricsSelection
              selectedCountries={selectedCountries}
              countryPairs={countryPairs}
              onUpdatePairMetrics={updatePairMetrics}
              onGeneratePairs={generatePairs}
              onNext={nextPhase}
              onPrev={prevPhase}
            />
          )}

          {currentPhase === 2 && (
            <WorldMapView
              selectedCountries={selectedCountries}
              selectedAlgorithm={selectedAlgorithm}
              onSelectAlgorithm={setSelectedAlgorithm}
              onNext={nextPhase}
              onPrev={prevPhase}
            />
          )}

          {currentPhase === 3 && (
            <DataCollection
              selectedCountries={selectedCountries}
              onNext={nextPhase}
              onPrev={prevPhase}
            />
          )}

          {currentPhase === 4 && (
            <TreeBuilding
              selectedCountries={selectedCountries}
              countryPairs={countryPairs}
              onNext={nextPhase}
              onPrev={prevPhase}
            />
          )}

          {currentPhase === 5 && (
            <AlgorithmExecution
              selectedAlgorithm={selectedAlgorithm}
              onNext={nextPhase}
              onPrev={prevPhase}
            />
          )}

          {currentPhase === 6 && (
            <ResultsView
              selectedAlgorithm={selectedAlgorithm}
              onNext={nextPhase}
              onPrev={prevPhase}
            />
          )}

          {currentPhase === 7 && (
            <SummaryView
              selectedCountries={selectedCountries}
              countryPairs={countryPairs}
              selectedAlgorithm={selectedAlgorithm}
              onRestart={handleRestart}
            />
          )}
        </div>
      </main>
    </div>
  );
}
