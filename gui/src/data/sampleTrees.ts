import { TreeNode, TedMatrixCell, EditOperation } from '../types';

// Sample tree for Lebanon infobox
export const sampleTreeLebanon: TreeNode = {
  id: 'root',
  label: 'country',
  depth: 0,
  children: [
    {
      id: 'name',
      label: 'common_name',
      value: 'Lebanon',
      depth: 1,
      children: [],
    },
    {
      id: 'official',
      label: 'official_name',
      value: 'Lebanese Republic',
      depth: 1,
      children: [],
    },
    {
      id: 'capital',
      label: 'capital',
      depth: 1,
      children: [
        { id: 'cap_name', label: 'name', value: 'Beirut', depth: 2, children: [] },
        { id: 'cap_coord', label: 'coordinates', value: '33.89°N 35.50°E', depth: 2, children: [] },
      ],
    },
    {
      id: 'gov',
      label: 'government',
      depth: 1,
      children: [
        { id: 'gov_type', label: 'type', value: 'Unitary parliamentary', depth: 2, children: [] },
        { id: 'gov_pres', label: 'president', value: 'Joseph Aoun', depth: 2, children: [] },
        { id: 'gov_pm', label: 'prime_minister', value: 'Nawaf Salam', depth: 2, children: [] },
      ],
    },
    {
      id: 'area',
      label: 'area',
      depth: 1,
      children: [
        { id: 'area_total', label: 'total_km2', value: '10,452', depth: 2, children: [] },
        { id: 'area_rank', label: 'area_rank', value: '161st', depth: 2, children: [] },
      ],
    },
    {
      id: 'pop',
      label: 'population',
      depth: 1,
      children: [
        { id: 'pop_est', label: 'estimate', value: '5,489,739', depth: 2, children: [] },
        { id: 'pop_dens', label: 'density_km2', value: '525', depth: 2, children: [] },
      ],
    },
    {
      id: 'econ',
      label: 'economy',
      depth: 1,
      children: [
        { id: 'gdp', label: 'gdp_nominal', value: '$18.077 billion', depth: 2, children: [] },
        { id: 'gdp_pc', label: 'gdp_per_capita', value: '$4,136', depth: 2, children: [] },
        { id: 'currency', label: 'currency', value: 'Lebanese pound (LBP)', depth: 2, children: [] },
      ],
    },
  ],
};

// Sample tree for France infobox
export const sampleTreeFrance: TreeNode = {
  id: 'root',
  label: 'country',
  depth: 0,
  children: [
    {
      id: 'name',
      label: 'common_name',
      value: 'France',
      depth: 1,
      children: [],
    },
    {
      id: 'official',
      label: 'official_name',
      value: 'French Republic',
      depth: 1,
      children: [],
    },
    {
      id: 'capital',
      label: 'capital',
      depth: 1,
      children: [
        { id: 'cap_name', label: 'name', value: 'Paris', depth: 2, children: [] },
        { id: 'cap_coord', label: 'coordinates', value: '48.86°N 2.35°E', depth: 2, children: [] },
      ],
    },
    {
      id: 'gov',
      label: 'government',
      depth: 1,
      children: [
        { id: 'gov_type', label: 'type', value: 'Unitary semi-presidential', depth: 2, children: [] },
        { id: 'gov_pres', label: 'president', value: 'Emmanuel Macron', depth: 2, children: [] },
        { id: 'gov_pm', label: 'prime_minister', value: 'François Bayrou', depth: 2, children: [] },
        { id: 'gov_leg', label: 'legislature', value: 'Parliament', depth: 2, children: [] },
      ],
    },
    {
      id: 'area',
      label: 'area',
      depth: 1,
      children: [
        { id: 'area_total', label: 'total_km2', value: '640,679', depth: 2, children: [] },
        { id: 'area_rank', label: 'area_rank', value: '42nd', depth: 2, children: [] },
      ],
    },
    {
      id: 'pop',
      label: 'population',
      depth: 1,
      children: [
        { id: 'pop_est', label: 'estimate', value: '68,042,591', depth: 2, children: [] },
        { id: 'pop_dens', label: 'density_km2', value: '106', depth: 2, children: [] },
      ],
    },
    {
      id: 'econ',
      label: 'economy',
      depth: 1,
      children: [
        { id: 'gdp', label: 'gdp_nominal', value: '$2.78 trillion', depth: 2, children: [] },
        { id: 'gdp_pc', label: 'gdp_per_capita', value: '$40,886', depth: 2, children: [] },
        { id: 'currency', label: 'currency', value: 'Euro (EUR)', depth: 2, children: [] },
        { id: 'hdi', label: 'hdi', value: '0.903', depth: 2, children: [] },
      ],
    },
  ],
};

// Generate sample TED matrix
export function generateSampleMatrix(rows: number, cols: number): TedMatrixCell[][] {
  const matrix: TedMatrixCell[][] = [];
  for (let i = 0; i <= rows; i++) {
    matrix[i] = [];
    for (let j = 0; j <= cols; j++) {
      if (i === 0) {
        matrix[i][j] = { value: j, computed: true, backtrack: j > 0 ? 'left' : undefined };
      } else if (j === 0) {
        matrix[i][j] = { value: i, computed: true, backtrack: 'up' };
      } else {
        const diag = matrix[i - 1][j - 1].value + (i === j ? 0 : 1);
        const left = matrix[i][j - 1].value + 1;
        const up = matrix[i - 1][j].value + 1;
        const min = Math.min(diag, left, up);
        matrix[i][j] = {
          value: min,
          computed: false,
          backtrack: min === diag ? 'diagonal' : min === up ? 'up' : 'left',
        };
      }
    }
  }
  return matrix;
}

// Sample edit operations
export const sampleEditOperations: EditOperation[] = [
  { type: 'update', node: 'common_name', from: 'Lebanon', to: 'France', cost: 1 },
  { type: 'update', node: 'official_name', from: 'Lebanese Republic', to: 'French Republic', cost: 1 },
  { type: 'update', node: 'capital/name', from: 'Beirut', to: 'Paris', cost: 1 },
  { type: 'update', node: 'capital/coordinates', from: '33.89°N 35.50°E', to: '48.86°N 2.35°E', cost: 1 },
  { type: 'update', node: 'government/type', from: 'Unitary parliamentary', to: 'Unitary semi-presidential', cost: 1 },
  { type: 'update', node: 'government/president', from: 'Joseph Aoun', to: 'Emmanuel Macron', cost: 1 },
  { type: 'update', node: 'government/prime_minister', from: 'Nawaf Salam', to: 'François Bayrou', cost: 1 },
  { type: 'insert', node: 'government/legislature', value: 'Parliament', cost: 1 },
  { type: 'update', node: 'area/total_km2', from: '10,452', to: '640,679', cost: 1 },
  { type: 'update', node: 'area/area_rank', from: '161st', to: '42nd', cost: 1 },
  { type: 'update', node: 'population/estimate', from: '5,489,739', to: '68,042,591', cost: 1 },
  { type: 'update', node: 'population/density_km2', from: '525', to: '106', cost: 1 },
  { type: 'update', node: 'economy/gdp_nominal', from: '$18.077 billion', to: '$2.78 trillion', cost: 1 },
  { type: 'update', node: 'economy/gdp_per_capita', from: '$4,136', to: '$40,886', cost: 1 },
  { type: 'update', node: 'economy/currency', from: 'Lebanese pound (LBP)', to: 'Euro (EUR)', cost: 1 },
  { type: 'insert', node: 'economy/hdi', value: '0.903', cost: 1 },
];
