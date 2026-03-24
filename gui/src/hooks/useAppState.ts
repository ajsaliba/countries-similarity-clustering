import { useState, useCallback, useMemo } from 'react';
import {
  Country,
  CountryPair,
  AlgorithmConfig,
  SimulationState,
  DataSourceConfig,
  SimilarityConfig,
  TreeNode,
  BackendCompareResult,
} from '../types';
import { algorithms } from '../data/algorithms';
import { countries } from '../data/countries';

const TOTAL_PHASES = 8;

const initialSimulation: SimulationState = {
  currentStep: 0,
  totalSteps: 0,
  steps: [],
};

const initialDataSource: DataSourceConfig = { mode: null, dataVariant: 'clean' };

const initialSimilarityConfig: SimilarityConfig = {
  category: 'ted',
  tedMethod: 'zhang-shasha',
  tedNormalization: 'formula3',
};

export function useAppState() {
  const [currentPhase, setCurrentPhase] = useState(0);
  const [selectedCountries, setSelectedCountries] = useState<Country[]>([]);
  const [countryPairs, setCountryPairs] = useState<CountryPair[]>([]);
  const [comparisonMode, setComparisonModeState] = useState<'pair' | 'all'>('pair');
  const [dataSource, setDataSource] = useState<DataSourceConfig>(initialDataSource);
  const [similarityConfig, setSimilarityConfig] = useState<SimilarityConfig>(initialSimilarityConfig);
  const [simulation, setSimulation] = useState<SimulationState>(initialSimulation);
  const [loadedTrees, setLoadedTrees] = useState<Record<string, TreeNode>>({});
  const [backendResults, setBackendResults] = useState<Record<string, BackendCompareResult>>({});

  const selectedAlgorithm = useMemo((): AlgorithmConfig | null => {
    if (similarityConfig.category !== 'ted') return null;
    const type =
      similarityConfig.tedMethod === 'nierman'
        ? 'nierman-chagathe'
        : similarityConfig.tedMethod === 'zhang-shasha'
        ? 'zhang-shasha'
        : 'chawathe';
    return algorithms.find(a => a.type === type) ?? null;
  }, [similarityConfig]);

  const addCountry = useCallback(
    (country: Country) => {
      setSelectedCountries(prev => {
        if (prev.find(c => c.code === country.code)) return prev;

        if (comparisonMode === 'pair') {
          if (prev.length >= 2) return prev;
          return [...prev, country];
        }

        if (comparisonMode === 'all') {
          if (prev.length >= 1) return prev;
          return [country];
        }

        return prev;
      });
    },
    [comparisonMode],
  );

  const removeCountry = useCallback((code: string) => {
    setSelectedCountries(prev => prev.filter(c => c.code !== code));
    setCountryPairs(prev => prev.filter(p => p.country1 !== code && p.country2 !== code));
  }, []);

  const setComparisonMode = useCallback((mode: 'pair' | 'all') => {
    setComparisonModeState(mode);

    setSelectedCountries(prev => {
      if (mode === 'pair') {
        return prev.slice(0, 2);
      }
      return prev.slice(0, 1);
    });

    setCountryPairs([]);
  }, []);

  const generatePairs = useCallback(() => {
    const pairs: CountryPair[] = [];

    if (comparisonMode === 'pair') {
      for (let i = 0; i < selectedCountries.length; i++) {
        for (let j = i + 1; j < selectedCountries.length; j++) {
          const c1 = selectedCountries[i].code;
          const c2 = selectedCountries[j].code;

          const existing = countryPairs.find(
            p =>
              (p.country1 === c1 && p.country2 === c2) ||
              (p.country1 === c2 && p.country2 === c1),
          );

          if (existing) {
            pairs.push(existing);
          } else {
            pairs.push({
              country1: c1,
              country2: c2,
              selectedMetrics: [],
            });
          }
        }
      }
    } else {
      const baseCountry = selectedCountries[0];

      if (baseCountry) {
        for (const otherCountry of countries) {
          if (otherCountry.code === baseCountry.code) continue;

          const c1 = baseCountry.code;
          const c2 = otherCountry.code;

          const existing = countryPairs.find(
            p =>
              (p.country1 === c1 && p.country2 === c2) ||
              (p.country1 === c2 && p.country2 === c1),
          );

          if (existing) {
            pairs.push(existing);
          } else {
            pairs.push({
              country1: c1,
              country2: c2,
              selectedMetrics: [],
            });
          }
        }
      }
    }

    setCountryPairs(pairs);
    return pairs;
  }, [comparisonMode, selectedCountries, countryPairs]);

  const updatePairMetrics = useCallback((country1: string, country2: string, metrics: string[]) => {
    setCountryPairs(prev =>
      prev.map(p =>
        (p.country1 === country1 && p.country2 === country2) ||
        (p.country1 === country2 && p.country2 === country1)
          ? { ...p, selectedMetrics: metrics }
          : p,
      ),
    );
  }, []);

  const nextPhase = useCallback(() => {
    setCurrentPhase(prev => Math.min(prev + 1, TOTAL_PHASES - 1));
  }, []);

  const prevPhase = useCallback(() => {
    setCurrentPhase(prev => Math.max(prev - 1, 0));
  }, []);

  const goToPhase = useCallback((phase: number) => {
    if (phase >= 0 && phase < TOTAL_PHASES) setCurrentPhase(phase);
  }, []);

  const resetSimulation = useCallback(() => {
    setSimulation(initialSimulation);
    setSelectedCountries([]);
    setCountryPairs([]);
    setLoadedTrees({});
    setBackendResults({});
    setDataSource(initialDataSource);
    setSimilarityConfig(initialSimilarityConfig);
    setComparisonModeState('pair');
  }, []);

  return {
    currentPhase,
    selectedCountries,
    countryPairs,
    selectedAlgorithm,
    similarityConfig,
    comparisonMode,
    dataSource,
    simulation,
    addCountry,
    removeCountry,
    setComparisonMode,
    generatePairs,
    updatePairMetrics,
    setSimilarityConfig,
    setDataSource,
    setSimulation,
    loadedTrees,
    setLoadedTrees,
    backendResults,
    setBackendResults,
    nextPhase,
    prevPhase,
    goToPhase,
    resetSimulation,
    totalPhases: TOTAL_PHASES,
  };
}