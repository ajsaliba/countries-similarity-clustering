import React, { useState, useEffect } from 'react';
import {
  FolderOpen,
  RefreshCw,
  ArrowRight,
  FileJson,
  FileCode2,
  Check,
  Terminal,
  Info,
  Database,
} from 'lucide-react';
import { DataSourceConfig, DataFormat } from '../types';

interface DataSourceSelectionProps {
  dataSource: DataSourceConfig;
  onSetDataSource: (cfg: DataSourceConfig) => void;
  onNext: () => void;
  onPrev: () => void;
}

interface FileStats {
  jsonCount: number;
  xmlCount: number;
  jsonSizeKb: number;
  xmlSizeKb: number;
  available: boolean;
}

export const DataSourceSelection: React.FC<DataSourceSelectionProps> = ({
  dataSource,
  onSetDataSource,
  onNext,
  onPrev,
}) => {
  const [fileStats, setFileStats] = useState<FileStats | null>(null);
  const [probing, setProbing] = useState(true);

  // Probe the data API to see if pre-extracted files are present
  useEffect(() => {
    (async () => {
      setProbing(true);
      try {
        const [jsonFiles, xmlFiles] = await Promise.all([
          fetch('/api/countries/JSON/').then(r => r.json()),
          fetch('/api/countries/XML/').then(r => r.json()),
        ]);
        const jc: string[] = jsonFiles;
        const xc: string[] = xmlFiles;
        setFileStats({
          jsonCount: jc.filter((f: string) => f.endsWith('.json') && f !== 'all_countries.json').length,
          xmlCount:  xc.filter((f: string) => f.endsWith('.xml')  && f !== 'all_countries.xml').length,
          jsonSizeKb: jc.length * 6,   // ~6 KB per file (approximate)
          xmlSizeKb:  xc.length * 8,
          available: jc.length > 0,
        });
      } catch {
        setFileStats({ jsonCount: 0, xmlCount: 0, jsonSizeKb: 0, xmlSizeKb: 0, available: false });
      } finally {
        setProbing(false);
      }
    })();
  }, []);

  const selectMode = (mode: 'existing' | 'extract') =>
    onSetDataSource({ ...dataSource, mode });

  const selectFormat = (format: DataFormat) =>
    onSetDataSource({ ...dataSource, format });

  const pythonCommand = `cd "$(git rev-parse --show-toplevel)"
python script/fetch_country_metrics.py
python script/json_to_xml_converter.py`;

  return (
    <div className="animate-fade-in flex flex-col h-full">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Data Source</h2>
        <p className="text-gray-500">
          Choose whether to load the pre-extracted World Bank data or run the
          Python scripts to pull fresh data from the API.
        </p>
      </div>

      <div className="flex gap-5 flex-1 min-h-0">
        {/* ── Option A: Use existing data ─────────────────────────── */}
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
              <p className="text-sm text-gray-500">Load pre-extracted files from Data/</p>
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
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1 bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <div className="flex items-center gap-2 mb-1">
                    <FileJson size={14} className="text-yellow-600" />
                    <span className="text-xs font-semibold text-yellow-600">JSON</span>
                  </div>
                  <div className="text-xl font-bold text-gray-900">{fileStats.jsonCount}</div>
                  <div className="text-[10px] text-gray-500">country files</div>
                  <div className="text-[10px] text-gray-500">~{fileStats.jsonSizeKb.toLocaleString()} KB</div>
                </div>
                <div className="flex-1 bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <div className="flex items-center gap-2 mb-1">
                    <FileCode2 size={14} className="text-blue-600" />
                    <span className="text-xs font-semibold text-blue-600">XML</span>
                  </div>
                  <div className="text-xl font-bold text-gray-900">{fileStats.xmlCount}</div>
                  <div className="text-[10px] text-gray-500">country files</div>
                  <div className="text-[10px] text-gray-500">~{fileStats.xmlSizeKb.toLocaleString()} KB</div>
                </div>
              </div>

              {/* Format selector */}
              <div>
                <p className="text-xs text-gray-400 mb-2">Select format to use for tree building:</p>
                <div className="flex gap-2">
                  {(['json', 'xml'] as DataFormat[]).map(fmt => (
                    <button
                      key={fmt}
                      onClick={e => { e.stopPropagation(); selectMode('existing'); selectFormat(fmt); }}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all ${
                        dataSource.format === fmt && dataSource.mode === 'existing'
                          ? 'bg-primary-700 border-primary-500 text-white'
                          : 'bg-white border-gray-300 text-gray-500 hover:border-gray-400'
                      }`}
                    >
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-start gap-2 p-2 bg-accent-50 rounded-lg border border-accent-200">
                <Check size={14} className="text-accent-600 mt-0.5 shrink-0" />
                <p className="text-xs text-accent-700">
                  Data already extracted — fastest option, no network calls required.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
              <Info size={14} className="text-yellow-600 mt-0.5 shrink-0" />
              <p className="text-xs text-yellow-700">
                No pre-extracted files found at <code className="font-mono">Data/JSON/</code>.
                Run the Python scripts first or use the extract option.
              </p>
            </div>
          )}
        </button>

        {/* ── Option B: Extract fresh data ────────────────────────── */}
        <button
          onClick={() => selectMode('extract')}
          className={`flex-1 flex flex-col rounded-xl border-2 p-6 text-left transition-all duration-200 ${
            dataSource.mode === 'extract'
              ? 'border-accent-500 bg-accent-50'
              : 'border-gray-200 bg-white hover:border-gray-300'
          }`}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-accent-50 flex items-center justify-center shrink-0">
              <RefreshCw size={24} className="text-accent-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">Extract Fresh Data</h3>
              <p className="text-sm text-gray-500">Pull latest metrics from the World Bank API</p>
            </div>
            {dataSource.mode === 'extract' && (
              <div className="ml-auto w-6 h-6 rounded-full bg-accent-600 flex items-center justify-center shrink-0">
                <Check size={14} className="text-white" />
              </div>
            )}
          </div>

          <div className="space-y-3 flex-1">
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: '60+ metrics', sub: 'across 11 categories' },
                { label: '195 countries', sub: 'all UN members' },
                { label: 'JSON + XML', sub: 'both formats generated' },
                { label: 'World Bank API', sub: 'latest available values' },
              ].map(item => (
                <div key={item.label} className="bg-gray-50 rounded-lg p-2 border border-gray-200">
                  <div className="font-semibold text-gray-900">{item.label}</div>
                  <div className="text-gray-500">{item.sub}</div>
                </div>
              ))}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <Terminal size={13} className="text-gray-500" />
                <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Command to run</span>
              </div>
              <pre className="bg-gray-100 rounded-lg p-3 font-mono text-[11px] text-green-600 leading-relaxed border border-gray-200">
                {pythonCommand}
              </pre>
            </div>

            {dataSource.mode === 'extract' && (
              <div className="flex gap-2">
                {(['json', 'xml'] as DataFormat[]).map(fmt => (
                  <button
                    key={fmt}
                    onClick={e => { e.stopPropagation(); selectFormat(fmt); }}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all ${
                      dataSource.format === fmt
                        ? 'bg-accent-700 border-accent-500 text-white'
                        : 'bg-white border-gray-300 text-gray-500 hover:border-gray-400'
                    }`}
                  >
                    {fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-start gap-2 p-2 bg-gray-50 rounded-lg border border-gray-200">
              <Info size={14} className="text-gray-500 mt-0.5 shrink-0" />
              <p className="text-xs text-gray-500">
                Extraction requires an internet connection and may take 5–10 minutes.
                The simulator will visualise the collection phase for each country.
              </p>
            </div>
          </div>
        </button>

        {/* ── Info panel ──────────────────────────────────────────── */}
        <div className="w-72 flex flex-col gap-4">
          <div className="glass-card p-4 flex-1">
            <div className="flex items-center gap-2 mb-3">
              <Database size={14} className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-700">Data Pipeline</h3>
            </div>
            <ol className="space-y-3">
              {[
                { n: 1, title: 'World Bank API', desc: 'fetch_country_metrics.py queries 60+ indicators per country' },
                { n: 2, title: 'JSON files', desc: 'One file per country (e.g. lebanon.json) with {value, year} per metric' },
                { n: 3, title: 'XML conversion', desc: 'json_to_xml_converter.py mirrors JSON structure into well-formed XML' },
                { n: 4, title: 'Tree building', desc: 'GUI parses the selected format into an ordered labeled tree for TED' },
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
              Numeric value comparison
            </h4>
            <p className="text-xs text-gray-500 leading-relaxed">
              Leaf values for metrics like GDP or population are numbers. The TED
              uses a <span className="text-primary-600 font-mono">normalised relabel cost</span>:
            </p>
            <div className="mt-2 font-mono text-xs bg-gray-100 p-2 rounded text-yellow-600 border border-gray-200">
              cost = |v₁ − v₂| / max(|v₁|, |v₂|, ε)
            </div>
            <p className="text-[10px] text-gray-500 mt-1">
              Equal values → 0, vastly different → ≈ 1.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
        <button onClick={onPrev} className="btn-secondary">Back</button>
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
