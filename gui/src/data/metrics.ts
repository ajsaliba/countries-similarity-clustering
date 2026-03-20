import { Metric } from '../types';

export const allMetrics: Metric[] = [
  // Demographics
  { id: 'population', name: 'Population', category: 'Demographics', description: 'Total population count' },
  { id: 'population_density', name: 'Population Density', category: 'Demographics', description: 'People per square kilometer' },
  { id: 'population_growth', name: 'Population Growth Rate', category: 'Demographics', description: 'Annual population growth rate (%)' },
  { id: 'urban_population', name: 'Urban Population', category: 'Demographics', description: 'Percentage of population in urban areas' },
  { id: 'life_expectancy', name: 'Life Expectancy', category: 'Demographics', description: 'Average life expectancy at birth' },
  { id: 'median_age', name: 'Median Age', category: 'Demographics', description: 'Median age of the population' },
  { id: 'birth_rate', name: 'Birth Rate', category: 'Demographics', description: 'Births per 1,000 population' },
  { id: 'death_rate', name: 'Death Rate', category: 'Demographics', description: 'Deaths per 1,000 population' },

  // Economy
  { id: 'gdp', name: 'GDP', category: 'Economy', description: 'Gross Domestic Product (USD)' },
  { id: 'gdp_per_capita', name: 'GDP per Capita', category: 'Economy', description: 'GDP per capita (USD)' },
  { id: 'gdp_growth', name: 'GDP Growth Rate', category: 'Economy', description: 'Annual GDP growth rate (%)' },
  { id: 'inflation', name: 'Inflation Rate', category: 'Economy', description: 'Annual inflation rate (%)' },
  { id: 'unemployment', name: 'Unemployment Rate', category: 'Economy', description: 'Unemployment rate (%)' },
  { id: 'gini_index', name: 'Gini Index', category: 'Economy', description: 'Income inequality index (0-100)' },
  { id: 'hdi', name: 'Human Development Index', category: 'Economy', description: 'Human Development Index (0-1)' },
  { id: 'exports', name: 'Exports', category: 'Economy', description: 'Total exports (USD)' },
  { id: 'imports', name: 'Imports', category: 'Economy', description: 'Total imports (USD)' },

  // Geography
  { id: 'area', name: 'Area', category: 'Geography', description: 'Total area in square kilometers' },
  { id: 'coastline', name: 'Coastline', category: 'Geography', description: 'Length of coastline (km)' },
  { id: 'elevation', name: 'Highest Elevation', category: 'Geography', description: 'Highest point elevation (m)' },
  { id: 'climate_zones', name: 'Climate Zones', category: 'Geography', description: 'Number of distinct climate zones' },
  { id: 'forest_area', name: 'Forest Area', category: 'Geography', description: 'Percentage of land covered by forest' },
  { id: 'arable_land', name: 'Arable Land', category: 'Geography', description: 'Percentage of arable land' },

  // Governance
  { id: 'government_type', name: 'Government Type', category: 'Governance', description: 'Type of government system' },
  { id: 'freedom_index', name: 'Freedom Index', category: 'Governance', description: 'Political freedom score' },
  { id: 'corruption_index', name: 'Corruption Perception Index', category: 'Governance', description: 'Transparency International CPI' },
  { id: 'press_freedom', name: 'Press Freedom Index', category: 'Governance', description: 'Press freedom ranking' },

  // Social
  { id: 'literacy_rate', name: 'Literacy Rate', category: 'Social', description: 'Adult literacy rate (%)' },
  { id: 'education_expenditure', name: 'Education Expenditure', category: 'Social', description: 'Government spending on education (% GDP)' },
  { id: 'health_expenditure', name: 'Health Expenditure', category: 'Social', description: 'Government spending on health (% GDP)' },
  { id: 'internet_users', name: 'Internet Users', category: 'Social', description: 'Percentage of population using internet' },
  { id: 'mobile_subscriptions', name: 'Mobile Subscriptions', category: 'Social', description: 'Mobile phone subscriptions per 100 people' },
  { id: 'languages', name: 'Official Languages', category: 'Social', description: 'Number of official languages' },
  { id: 'religions', name: 'Major Religions', category: 'Social', description: 'Predominant religious groups' },

  // Infrastructure
  { id: 'roads', name: 'Road Network', category: 'Infrastructure', description: 'Total road network (km)' },
  { id: 'railways', name: 'Railway Network', category: 'Infrastructure', description: 'Total railway length (km)' },
  { id: 'airports', name: 'Airports', category: 'Infrastructure', description: 'Number of airports' },
  { id: 'electricity_access', name: 'Electricity Access', category: 'Infrastructure', description: 'Population with access to electricity (%)' },

  // Environment
  { id: 'co2_emissions', name: 'CO2 Emissions', category: 'Environment', description: 'CO2 emissions (metric tons per capita)' },
  { id: 'renewable_energy', name: 'Renewable Energy', category: 'Environment', description: 'Renewable energy share of total energy (%)' },
  { id: 'water_access', name: 'Clean Water Access', category: 'Environment', description: 'Population with access to clean water (%)' },
];

export const metricCategories = [...new Set(allMetrics.map(m => m.category))];

// Simulate which metrics are available for each country (in real app, this comes from the Python backend)
export function getAvailableMetrics(countryCode: string): Metric[] {
  // Use a deterministic "random" based on country code to simulate missing metrics
  const hash = countryCode.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  return allMetrics.filter((_, i) => {
    const available = ((hash * (i + 1)) % 10) > 1; // ~80% availability
    return available;
  });
}

export function getCommonMetrics(countryCodes: string[]): Metric[] {
  const metricSets = countryCodes.map(code => {
    const available = getAvailableMetrics(code);
    return new Set(available.map(m => m.id));
  });

  return allMetrics.filter(metric =>
    metricSets.every(set => set.has(metric.id))
  );
}
