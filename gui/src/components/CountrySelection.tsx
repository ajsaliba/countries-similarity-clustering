import React, { useState, useMemo } from 'react';
import { Search, X, ChevronDown, Globe2, MapPin } from 'lucide-react';
import { Country } from '../types';
import { countries, regions } from '../data/countries';

interface CountrySelectionProps {
  selectedCountries: Country[];
  onAddCountry: (country: Country) => void;
  onRemoveCountry: (code: string) => void;
  onNext: () => void;
}

export const CountrySelection: React.FC<CountrySelectionProps> = ({
  selectedCountries,
  onAddCountry,
  onRemoveCountry,
  onNext,
}) => {
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState<string>('All');
  const [showDropdown, setShowDropdown] = useState(false);

  const filteredCountries = useMemo(() => {
    return countries.filter(c => {
      const matchesSearch =
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.code.toLowerCase().includes(search.toLowerCase());
      const matchesRegion = regionFilter === 'All' || c.region === regionFilter;
      return matchesSearch && matchesRegion;
    });
  }, [search, regionFilter]);

  const isSelected = (code: string) => selectedCountries.some(c => c.code === code);

  const regionCounts = useMemo(() => {
    const counts: Record<string, number> = { All: countries.length };
    regions.forEach(r => {
      counts[r] = countries.filter(c => c.region === r).length;
    });
    return counts;
  }, []);

  const selectedByRegion = useMemo(() => {
    const grouped: Record<string, Country[]> = {};
    selectedCountries.forEach(c => {
      if (!grouped[c.region]) grouped[c.region] = [];
      grouped[c.region].push(c);
    });
    return grouped;
  }, [selectedCountries]);

  return (
    <div className="animate-fade-in flex flex-col h-full">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-white mb-2">Select Countries</h2>
        <p className="text-gray-400">
          Choose the UN-recognized countries you want to compare. Select at least 2 countries to proceed.
        </p>
      </div>

      <div className="flex gap-6 flex-1 min-h-0">
        {/* Left: Country browser */}
        <div className="flex-1 flex flex-col glass-card p-4">
          {/* Search & Filter */}
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search countries..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="input-field pl-10"
              />
            </div>
            <div className="relative">
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="btn-secondary flex items-center gap-2 min-w-[160px]"
              >
                <Globe2 size={16} />
                {regionFilter}
                <ChevronDown size={14} className="ml-auto" />
              </button>
              {showDropdown && (
                <div className="absolute top-full mt-1 right-0 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-10 py-1">
                  {['All', ...regions].map(r => (
                    <button
                      key={r}
                      onClick={() => {
                        setRegionFilter(r);
                        setShowDropdown(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-700 transition-colors flex justify-between ${
                        regionFilter === r ? 'text-primary-400' : 'text-gray-300'
                      }`}
                    >
                      <span>{r}</span>
                      <span className="text-gray-500">{regionCounts[r]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Country Grid */}
          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {filteredCountries.map(country => {
                const selected = isSelected(country.code);
                return (
                  <button
                    key={country.code}
                    onClick={() => (selected ? onRemoveCountry(country.code) : onAddCountry(country))}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-200 ${
                      selected
                        ? 'bg-primary-900/50 border border-primary-600 text-white'
                        : 'bg-gray-800/50 border border-gray-800 text-gray-300 hover:border-gray-600 hover:bg-gray-800'
                    }`}
                  >
                    <span className="text-lg leading-none">
                      {countryCodeToFlag(country.code2)}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{country.name}</div>
                      <div className="text-[10px] text-gray-500">{country.subregion}</div>
                    </div>
                    {selected && (
                      <X size={14} className="ml-auto text-primary-400 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
            {filteredCountries.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                No countries match your search.
              </div>
            )}
          </div>

          <div className="mt-3 text-sm text-gray-500 border-t border-gray-800 pt-3">
            Showing {filteredCountries.length} of {countries.length} countries
          </div>
        </div>

        {/* Right: Selected countries */}
        <div className="w-80 flex flex-col glass-card p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">
              Selected ({selectedCountries.length})
            </h3>
            {selectedCountries.length > 0 && (
              <button
                onClick={() => selectedCountries.forEach(c => onRemoveCountry(c.code))}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          {selectedCountries.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-600">
              <MapPin size={40} className="mb-3 opacity-40" />
              <p className="text-sm">No countries selected yet</p>
              <p className="text-xs mt-1">Click on countries to select them</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-4">
              {Object.entries(selectedByRegion).map(([region, regionCountries]) => (
                <div key={region}>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    {region} ({regionCountries.length})
                  </h4>
                  <div className="space-y-1">
                    {regionCountries.map(country => (
                      <div
                        key={country.code}
                        className="flex items-center gap-2 px-3 py-2 bg-gray-800/50 rounded-lg group"
                      >
                        <span className="text-sm">{countryCodeToFlag(country.code2)}</span>
                        <span className="text-sm text-gray-300 flex-1">{country.name}</span>
                        <button
                          onClick={() => onRemoveCountry(country.code)}
                          className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-gray-800">
            <div className="text-xs text-gray-500 mb-3">
              {selectedCountries.length < 2
                ? `Select ${2 - selectedCountries.length} more ${selectedCountries.length === 1 ? 'country' : 'countries'} to continue`
                : `${(selectedCountries.length * (selectedCountries.length - 1)) / 2} pairs will be compared`}
            </div>
            <button
              onClick={onNext}
              disabled={selectedCountries.length < 2}
              className="btn-primary w-full"
            >
              Continue to Metrics Selection
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

function countryCodeToFlag(code2: string): string {
  try {
    return code2
      .toUpperCase()
      .split('')
      .map(char => String.fromCodePoint(0x1f1e6 + char.charCodeAt(0) - 65))
      .join('');
  } catch {
    return '🏳️';
  }
}
