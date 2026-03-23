import React, { useState, useEffect } from 'react';
import {
  FolderOpen,
  RefreshCw,
  ArrowRight,
  FileJson,
  Check,
  Info,
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

interface FileStats {
  jsonCount: number;
  jsonSizeKb: number;
  available: boolean;
}

function getJsonFolder(variant: DataVariant): string {
  return variant === 'clean' ? 'JSON_CLEAN' : 'JSON';
}

export const DataSourceSelection: React.FC<DataSourceSelectionProps> = ({
  dataSource,
  onSetDataSource,
  onNext,
  onPrev,
}) => {
  const [fileStats, setFileStats] = useState<FileStats | null>(null);
  const [probing, setProbing] = useState(true);

  useEffect(() => {
    (async () => {
      setProbing(true);
      try {
        const folder = getJsonFolder(dataSource.dataVariant);
        const jsonFiles = await fetch(`/api/countries/${folder}/`).then(r => r.json());
        const jc: string[] = jsonFiles;

        const jsonCountryFiles = jc.filter(
          (f: string) => f.endsWith('.json') && f !== 'all_countries.json',
        );

        setFileStats({
          jsonCount: jsonCountryFiles.length,
          jsonSizeKb: jsonCountryFiles.length * 6,
          available: jsonCountryFiles.length > 0,
        });
      } catch {
        setFileStats({
          jsonCount: 0,
          jsonSizeKb: 0,
          available: false,
        });
      } finally {
        setProbing(false);
      }
    })();
  }, [dataSource.dataVariant]);

  const selectMode = (mode: 'existing' | 'extract') =>
    onSetDataSource({ ...dataSource, mode });

  const selectVariant = (dataVariant: DataVariant) =>
    onSetDataSource({ ...dataSource, dataVariant });

  const selectedFolder = getJsonFolder(dataSource.dataVariant);

  return (
    <div className="animate-fade-in flex flex-col h-full">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Data Source</h2>
        <p className="text-gray-500">
          Choose whether to load the pre-extracted JSON data, then choose whether
          to use the clean dataset or the raw dataset.
        </p>
      </div>

      <div className="flex gap-5 flex-1 min-h-0">
        <button
          onClick={() => selectMode('existing')}
          className={`flex-1 flex flex-col rounded-xl border-2 p-6 text-left transition-all duration-200 ${
            dataSource.mode === 'existing'
              ? 'border-primary-500 bg-primary-50'
              : 'border-gray-200 bg-white hover:border-gray-300'
          }`}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-primary-50 flex items-center justify-center shrink-0">
              <FolderOpen size={24} className="text-primary-600" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-gray-900">Use Existing Data</h3>
              <p className="text-sm text-gray-500">
                Load pre-extracted JSON files from Data/{selectedFolder}/
              </p>
            </div>

            {dataSource.mode === 'existing' && (
              <div className="ml-auto w-6 h-6 rounded-full bg-primary-600 flex items-center justify-center shrink-0">
                <Check size={14} className="text-white" />
              </div>
            )}
          </div>

          {probing ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <RefreshCw size={14} className="animate-spin" />
              Checking for files…
            </div>
          ) : fileStats?.available ? (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <div className="flex items-center gap-2 mb-1">
                  <FileJson size={14} className="text-yellow-600" />
                  <span className="text-xs font-semibold text-yellow-600">JSON</span>
                </div>
                <div className="text-xl font-bold text-gray-900">{fileStats.jsonCount}</div>
                <div className="text-[10px] text-gray-500">country files</div>
                <div className="text-[10px] text-gray-500">
                  ~{fileStats.jsonSizeKb.toLocaleString()} KB
                </div>
              </div>

              <div>
                <p className="text-xs text-gray-400 mb-2">Select which JSON dataset to use:</p>
                <div className="flex gap-2">
                  {(['clean', 'raw'] as DataVariant[]).map(variant => (
                    <button
                      key={variant}
                      onClick={e => {
                        e.stopPropagation();
                        selectMode('existing');
                        selectVariant(variant);
                      }}
                      className={`flex-1 py-3 rounded-lg text-sm font-medium border transition-all ${
                        dataSource.dataVariant === variant && dataSource.mode === 'existing'
                          ? 'bg-primary-700 border-primary-500 text-white'
                          : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
                      }`}
                    >
                      <div className="flex items-center justify-center gap-2">
                        {variant === 'clean' ? (
                          <Sparkles size={15} />
                        ) : (
                          <FlaskConical size={15} />
                        )}
                        {variant === 'clean' ? 'Clean Data' : 'Raw Data'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-start gap-2 p-2 bg-accent-50 rounded-lg border border-accent-200">
                <Check size={14} className="text-accent-600 mt-0.5 shrink-0" />
                <p className="text-xs text-accent-700">
                  JSON is the only format used now. You only choose between clean and raw data.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
              <Info size={14} className="text-yellow-600 mt-0.5 shrink-0" />
              <p className="text-xs text-yellow-700">
                No pre-extracted files found at{' '}
                <code className="font-mono">Data/{selectedFolder}/</code>.
              </p>
            </div>
          )}
        </button>

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
                  title: 'JSON files',
                  desc: 'One JSON file per country is loaded from the selected dataset folder.',
                },
                {
                  n: 2,
                  title: 'Dataset choice',
                  desc: 'You choose whether to use the clean version or the raw version.',
                },
                {
                  n: 3,
                  title: 'Tree building',
                  desc: 'The GUI parses JSON into an ordered labeled tree for TED.',
                },
                {
                  n: 4,
                  title: 'Comparison',
                  desc: 'Similarity is computed using the chosen dataset variant.',
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
              Format: <span className="text-primary-600 font-mono">JSON</span>
            </p>
            <p className="text-xs text-gray-500 leading-relaxed mt-1">
              Dataset:{' '}
              <span className="text-primary-600 font-mono">{dataSource.dataVariant}</span>
            </p>
            <p className="text-xs text-gray-500 leading-relaxed mt-1">
              Folder: <span className="text-primary-600 font-mono">{selectedFolder}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
        <button onClick={onPrev} className="btn-secondary">
          Back
        </button>

        <button
          onClick={onNext}
          disabled={!dataSource.mode || (dataSource.mode === 'existing' && !fileStats?.available)}
          className="btn-primary flex items-center gap-2"
        >
          Continue to Data Collection
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};