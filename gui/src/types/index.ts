export interface Country {
  name: string;
  code: string;   // ISO 3166-1 alpha-3
  code2: string;  // ISO 3166-1 alpha-2
  region: string;
  subregion: string;
  lat: number;
  lon: number;
}

export interface Metric {
  id: string;
  name: string;
  category: string;
  description: string;
}

export interface CountryPair {
  country1: string;
  country2: string;
  selectedMetrics: string[];
}

export type AlgorithmType = 'chawathe' | 'nierman-chagathe';

export interface PseudocodeLine {
  line: number;
  indent: number;
  text: string;
  comment?: string;
}

export interface AlgorithmConfig {
  type: AlgorithmType;
  name: string;
  description: string;
  timeComplexity: string;
  spaceComplexity: string;
  steps: string[];
  pseudocode: PseudocodeLine[];
}

export interface TreeNode {
  id: string;
  label: string;
  value?: string;
  numericValue?: number;
  children: TreeNode[];
  highlighted?: boolean;
  depth: number;
}

export type EditOperationType = 'insert' | 'delete' | 'update' | 'move';

export interface EditOperation {
  type: EditOperationType;
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

// ── Data source ──────────────────────────────────────────────
export type DataSourceMode = 'existing' | 'extract' | null;
export type DataFormat = 'json' | 'xml';

export interface DataSourceConfig {
  mode: DataSourceMode;
  format: DataFormat;
}

// ── Real World Bank country data shape ───────────────────────
export interface MetricValue {
  value: number | null;
  year: number | null;
}

export interface CountryData {
  country: string;
  iso3: string;
  demographics: Record<string, MetricValue>;
  economy: Record<string, MetricValue>;
  trade: Record<string, MetricValue>;
  debt: Record<string, MetricValue>;
  education: Record<string, MetricValue>;
  health: Record<string, MetricValue>;
  infrastructure: Record<string, MetricValue>;
  energy_and_environment: Record<string, MetricValue>;
  governance: Record<string, MetricValue>;
  security: Record<string, MetricValue>;
}

export interface AppState {
  currentPhase: number;
  selectedCountries: Country[];
  countryPairs: CountryPair[];
  selectedAlgorithm: AlgorithmConfig | null;
  dataSource: DataSourceConfig;
  loadedCountryData: Record<string, CountryData>;
  simulation: SimulationState;
}
