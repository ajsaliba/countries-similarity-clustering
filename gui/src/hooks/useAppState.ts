import { useState, useCallback } from 'react';
import { Country, CountryPair, AlgorithmConfig, SimulationState } from '../types';
import { getCommonMetrics } from '../data/metrics';

const TOTAL_PHASES = 8;

const initialSimulation: SimulationState = {
  currentStep: 0,
  totalSteps: 0,
  steps: [],
};

export function useAppState() {
  const [currentPhase, setCurrentPhase] = useState(0);
  const [selectedCountries, setSelectedCountries] = useState<Country[]>([]);
  const [countryPairs, setCountryPairs] = useState<CountryPair[]>([]);
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<AlgorithmConfig | null>(null);
  const [simulation, setSimulation] = useState<SimulationState>(initialSimulation);

  const addCountry = useCallback((country: Country) => {
    setSelectedCountries(prev => {
      if (prev.find(c => c.code === country.code)) return prev;
      return [...prev, country];
    });
  }, []);

  const removeCountry = useCallback((code: string) => {
    setSelectedCountries(prev => prev.filter(c => c.code !== code));
    setCountryPairs(prev => prev.filter(p => p.country1 !== code && p.country2 !== code));
  }, []);

  const generatePairs = useCallback(() => {
    const pairs: CountryPair[] = [];
    for (let i = 0; i < selectedCountries.length; i++) {
      for (let j = i + 1; j < selectedCountries.length; j++) {
        const c1 = selectedCountries[i].code;
        const c2 = selectedCountries[j].code;
        const existing = countryPairs.find(
          p => (p.country1 === c1 && p.country2 === c2) || (p.country1 === c2 && p.country2 === c1)
        );
        if (existing) {
          pairs.push(existing);
        } else {
          const common = getCommonMetrics([c1, c2]);
          pairs.push({
            country1: c1,
            country2: c2,
            selectedMetrics: common.map(m => m.id),
          });
        }
      }
    }
    setCountryPairs(pairs);
    return pairs;
  }, [selectedCountries, countryPairs]);

  const updatePairMetrics = useCallback((country1: string, country2: string, metrics: string[]) => {
    setCountryPairs(prev =>
      prev.map(p =>
        (p.country1 === country1 && p.country2 === country2) ||
        (p.country1 === country2 && p.country2 === country1)
          ? { ...p, selectedMetrics: metrics }
          : p
      )
    );
  }, []);

  const nextPhase = useCallback(() => {
    setCurrentPhase(prev => Math.min(prev + 1, TOTAL_PHASES - 1));
  }, []);

  const prevPhase = useCallback(() => {
    setCurrentPhase(prev => Math.max(prev - 1, 0));
  }, []);

  const goToPhase = useCallback((phase: number) => {
    if (phase >= 0 && phase < TOTAL_PHASES) {
      setCurrentPhase(phase);
    }
  }, []);

  const resetSimulation = useCallback(() => {
    setSimulation(initialSimulation);
  }, []);

  return {
    currentPhase,
    selectedCountries,
    countryPairs,
    selectedAlgorithm,
    simulation,
    addCountry,
    removeCountry,
    generatePairs,
    updatePairMetrics,
    setSelectedAlgorithm,
    setSimulation,
    nextPhase,
    prevPhase,
    goToPhase,
    resetSimulation,
    totalPhases: TOTAL_PHASES,
  };
}
