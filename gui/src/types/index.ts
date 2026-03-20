export interface Country {
  name: string;
  code: string; // ISO 3166-1 alpha-3
  code2: string; // ISO 3166-1 alpha-2
  region: string;
  subregion: string;
}

export interface Metric {
  id: string;
  name: string;
  category: string;
  description: string;
}

export interface CountryPair {
  country1: string; // country code
  country2: string;
  selectedMetrics: string[]; // metric ids
}

export type AlgorithmType = 'chawathe' | 'nierman-chagathe';

export interface AlgorithmConfig {
  type: AlgorithmType;
  name: string;
  description: string;
  timeComplexity: string;
  spaceComplexity: string;
  steps: string[];
}

export interface TreeNode {
  id: string;
  label: string;
  value?: string;
  children: TreeNode[];
  highlighted?: boolean;
  depth: number;
}

export interface EditOperation {
  type: 'insert' | 'delete' | 'update' | 'move';
  node: string;
  from?: string;
  to?: string;
  value?: string;
  cost: number;
}

export interface EditScript {
  operations: EditOperation[];
  totalCost: number;
}

export interface TedMatrixCell {
  value: number;
  computed: boolean;
  backtrack?: 'diagonal' | 'left' | 'up';
}

export interface ProcessingStep {
  id: number;
  name: string;
  description: string;
  status: 'pending' | 'running' | 'completed';
  progress: number;
  detail?: string;
}

export interface SimulationState {
  currentStep: number;
  totalSteps: number;
  steps: ProcessingStep[];
  tree1?: TreeNode;
  tree2?: TreeNode;
  tedMatrix?: TedMatrixCell[][];
  editScript?: EditScript;
  similarity?: number;
  timeTaken?: number;
}

export interface AppState {
  currentPhase: number;
  selectedCountries: Country[];
  countryPairs: CountryPair[];
  availableMetrics: Record<string, Metric[]>; // per country code
  selectedAlgorithm: AlgorithmConfig | null;
  simulation: SimulationState;
}
