import React, { useState, useEffect } from 'react';
import {
  ArrowRight,
  Check,
  Database,
  Sparkles,
  FlaskConical,
} from 'lucide-react';
import { DataSourceConfig, DataVariant } from '../types';

interface DataSourceSelectionProps {
  dataSource: DataSourceConfig;
  onSetDataSource: (cfg: DataSourceConfig) => void;
  onNext: () => void;
  onPrev: () => void;
}

export const DataSourceSelection: React.FC<DataSourceSelectionProps> = ({
  dataSource,
  onSetDataSource,
  onNext,
  onPrev,
}) => {
  const [countryCount, setCountryCount] = useState<number | null>(null);
  const [probing, setProbing] = useState(true);

  useEffect(() => {
    (async () => {
      setProbing(true);
      try {
        const res = await fetch(`/api/ted/countries?dataset=${dataSource.dataVariant}`);
        if (res.ok) {
          const names: string[] = await res.json();
          setCountryCount(names.length);
        } else {
          setCountryCount(null);
        }
      } catch {
        setCountryCount(null);
      } finally {
        setProbing(false);
      }
    })();
  }, [dataSource.dataVariant]);

  // Auto-set mode to 'existing' since we always load from the JSON files
  useEffect(() => {
    if (dataSource.mode !== 'existing') {
      onSetDataSource({ ...dataSource, mode: 'existing' });
    }
  }, []);

  const selectVariant = (dataVariant: DataVariant) =>
    onSetDataSource({ mode: 'existing', dataVariant });

  const datasetFile = dataSource.dataVariant === 'clean'
    ? 'all_countries_clean_final.json'
    : 'all_countries.json';

  return (
    <div className="animate-fade-in flex flex-col h-full">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Data Source</h2>
        <p className="text-gray-500">
          Choose which dataset to use for the comparison: clean (simplified infobox)
          or raw (full Wikipedia infobox content).
        </p>
      </div>

      <div className="flex gap-5 flex-1 min-h-0">
        <div className="flex-1 flex gap-5">
          {(['clean', 'raw'] as DataVariant[]).map(variant => {
            const isSelected = dataSource.dataVariant === variant;
            const file = variant === 'clean' ? 'all_countries_clean_final.json' : 'all_countries.json';
            return (
              <button
                key={variant}
                onClick={() => selectVariant(variant)}
                className={`flex-1 flex flex-col rounded-xl border-2 p-6 text-left transition-all duration-200 ${
                  isSelected
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${
                    isSelected ? 'bg-primary-100' : 'bg-gray-100'
                  }`}>
                    {variant === 'clean' ? (
                      <Sparkles size={24} className={isSelected ? 'text-primary-600' : 'text-gray-400'} />
                    ) : (
                      <FlaskConical size={24} className={isSelected ? 'text-primary-600' : 'text-gray-400'} />
                    )}
                  </div>

                  <div>
                    <h3 className="text-lg font-bold text-gray-900">
                      {variant === 'clean' ? 'Clean Data' : 'Raw Data'}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {variant === 'clean'
                        ? 'Simplified and normalized infobox content'
                        : 'Full Wikipedia infobox with richer detail'}
                    </p>
                  </div>

                  {isSelected && (
                    <div className="ml-auto w-6 h-6 rounded-full bg-primary-600 flex items-center justify-center shrink-0">
                      <Check size={14} className="text-white" />
                    </div>
                  )}
                </div>

                <div className="space-y-3 flex-1">
                  <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                    <div className="text-xs text-gray-500 mb-1">Source file</div>
                    <div className="text-sm font-mono text-gray-700">{file}</div>
                  </div>

                  <div className="text-xs text-gray-500 leading-relaxed">
                    {variant === 'clean'
                      ? 'Cleaned and standardized fields: Capital, Languages, Ethnic groups, Religion, Government, Area, Population, GDP, Gini, HDI, Currency.'
                      : 'Raw Wikipedia infobox data with original field names, coordinate strings, footnotes, and nested structures.'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="w-72 flex flex-col gap-4">
          <div className="glass-card p-4 flex-1">
            <div className="flex items-center gap-2 mb-3">
              <Database size={14} className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-700">Data Pipeline</h3>
            </div>

            <ol className="space-y-3">
              {[
                {
                  n: 1,
                  title: 'Dataset selection',
                  desc: 'Choose clean or raw infobox data.',
                },
                {
                  n: 2,
                  title: 'Country loading',
                  desc: 'Countries are loaded from the selected JSON dataset file.',
                },
                {
                  n: 3,
                  title: 'Tree building',
                  desc: 'The Python backend converts each country\'s infobox into a labeled tree.',
                },
                {
                  n: 4,
                  title: 'TED comparison',
                  desc: 'Zhang-Shasha TED is computed by the Python algorithm.',
                },
              ].map(s => (
                <li key={s.n} className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-primary-50 border border-primary-200 flex items-center justify-center text-[10px] font-bold text-primary-700 shrink-0 mt-0.5">
                    {s.n}
                  </span>
                  <div>
                    <div className="text-xs font-semibold text-gray-700">{s.title}</div>
                    <div className="text-[10px] text-gray-500 leading-snug">{s.desc}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="glass-card p-4">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Current Selection
            </h4>
            <p className="text-xs text-gray-500 leading-relaxed">
              Dataset:{' '}
              <span className="text-primary-600 font-mono">{dataSource.dataVariant}</span>
            </p>
            <p className="text-xs text-gray-500 leading-relaxed mt-1">
              File: <span className="text-primary-600 font-mono">{datasetFile}</span>
            </p>
            {countryCount !== null && (
              <p className="text-xs text-gray-500 leading-relaxed mt-1">
                Countries: <span className="text-primary-600 font-mono">{countryCount}</span>
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
        <button onClick={onPrev} className="btn-secondary">
          Back
        </button>

        <button
          onClick={onNext}
          disabled={probing || countryCount === null}
          className="btn-primary flex items-center gap-2"
        >
          Continue to Data Collection
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};
