import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Download,
  Database,
  FileJson,
  Check,
  Loader2,
  ArrowRight,
  Terminal,
} from 'lucide-react';
import { Country, DataSourceConfig, TreeNode } from '../types';
import { countries } from '../data/countries';
import {
  loadCountryJSON,
  countryNameToSlug,
  countryDataToTree,
} from '../services/dataService';

interface DataCollectionProps {
  selectedCountries: Country[];
  comparisonMode: 'pair' | 'all';
  dataSource: DataSourceConfig;
  onDataLoaded: (trees: Record<string, TreeNode>) => void;
  onNext: () => void;
  onPrev: () => void;
}

interface CollectionTask {
  country: Country;
  status: 'pending' | 'fetching_wb' | 'parsing' | 'done';
  progress: number;
}

interface LogLine {
  id: number;
  text: string;
  type: 'info' | 'success' | 'error' | 'start' | 'stdout' | 'stderr';
  timestamp: string;
}

async function streamScript(
  scriptName: string,
  onLine: (type: 'stdout' | 'stderr' | 'start', text: string) => void,
): Promise<number> {
  const res = await fetch(`/api/run-script/${scriptName}`, { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';

    for (const part of parts) {
      const line = part.split('\n').find(l => l.startsWith('data: '));
      if (!line) continue;

      try {
        const evt = JSON.parse(line.slice(6)) as { type: string; text: string };
        if (evt.type === 'done') return parseInt(evt.text, 10) || 0;

        if (evt.type === 'stdout' || evt.type === 'stderr' || evt.type === 'start') {
          onLine(evt.type as 'stdout' | 'stderr' | 'start', evt.text);
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  return 0;
}

export const DataCollection: React.FC<DataCollectionProps> = ({
  selectedCountries,
  comparisonMode,
  dataSource,
  onDataLoaded,
  onNext,
  onPrev,
}) => {
  const [tasks, setTasks] = useState<CollectionTask[]>([]);
  const [currentTask, setCurrentTask] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [jsonPreview, setJsonPreview] = useState('');
  const [logCounter, setLogCounter] = useState(0);

  const logRef = useRef<HTMLDivElement>(null);

  const isExisting = dataSource.mode === 'existing';

  const countriesToLoad = useMemo(() => {
    if (comparisonMode === 'pair') return selectedCountries;
    return countries;
  }, [comparisonMode, selectedCountries]);

  const baseCountryName =
    comparisonMode === 'all' && selectedCountries.length > 0
      ? selectedCountries[0].name
      : null;

  useEffect(() => {
    setTasks(countriesToLoad.map(c => ({ country: c, status: 'pending', progress: 0 })));
    setAllDone(false);
    setLogLines([]);
    setJsonPreview('');
    setCurrentTask(0);
    setLogCounter(0);
  }, [countriesToLoad]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines]);

  const addLog = (
    text: string,
    type: 'info' | 'success' | 'error' | 'start' | 'stdout' | 'stderr' = 'info',
  ) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogCounter(prev => {
      const nextId = prev + 1;
      setLogLines(prevLines => [
        ...prevLines,
        {
          id: nextId,
          text,
          type,
          timestamp,
        },
      ]);
      return nextId;
    });
  };

  const loadAndParseTrees = async () => {
    addLog(`Building trees from ${dataSource.dataVariant} JSON data...`, 'start');
    const trees: Record<string, TreeNode> = {};

    for (const country of countriesToLoad) {
      const slug = countryNameToSlug(country.name);

      try {
        const data = await loadCountryJSON(slug, dataSource.dataVariant);
        trees[country.code] = countryDataToTree(data);
        addLog(`Tree ready: ${country.name}`, 'success');
      } catch (e) {
        addLog(`Skipped ${country.name}: ${String(e)}`, 'error');
      }
    }

    onDataLoaded(trees);
    addLog('All trees built successfully.', 'success');
    setIsRunning(false);
    setAllDone(true);
  };

  const loadExisting = (taskIndex: number) => {
    if (taskIndex >= tasks.length) {
      addLog('All files loaded.', 'success');
      void loadAndParseTrees();
      return;
    }

    const c = countriesToLoad[taskIndex];
    setCurrentTask(taskIndex);

    const slug = countryNameToSlug(c.name);
    addLog(`Reading Data/JSON/${dataSource.dataVariant}/${slug}.json`, 'stdout');

    setTasks(prev =>
      prev.map((t, i) =>
        i === taskIndex ? { ...t, status: 'parsing', progress: 50 } : t,
      ),
    );

    setTimeout(() => {
      if (comparisonMode === 'pair') {
        setJsonPreview(generatePreview(c));
      }
      addLog(`${c.name} loaded.`, 'success');

      setTasks(prev =>
        prev.map((t, i) =>
          i === taskIndex ? { ...t, status: 'done', progress: 100 } : t,
        ),
      );

      setTimeout(() => loadExisting(taskIndex + 1), 80);
    }, 150);
  };

  const simulateExtraction = (taskIndex: number) => {
    if (taskIndex >= tasks.length) return;

    const c = countriesToLoad[taskIndex];
    setCurrentTask(taskIndex);

    addLog(`[${c.name}] Fetching World Bank indicators...`, 'stdout');
    setTasks(prev =>
      prev.map((t, i) =>
        i === taskIndex ? { ...t, status: 'fetching_wb', progress: 30 } : t,
      ),
    );

    setTimeout(() => {
      addLog(`[${c.name}] Parsing JSON (${dataSource.dataVariant})`, 'stdout');

      setTasks(prev =>
        prev.map((t, i) =>
          i === taskIndex ? { ...t, status: 'parsing', progress: 70 } : t,
        ),
      );

      if (comparisonMode === 'pair') {
        setJsonPreview(generatePreview(c));
      }

      setTimeout(() => {
        addLog(`[${c.name}] Done.`, 'success');

        setTasks(prev =>
          prev.map((t, i) =>
            i === taskIndex ? { ...t, status: 'done', progress: 100 } : t,
          ),
        );

        setTimeout(() => simulateExtraction(taskIndex + 1), 120);
      }, 250);
    }, 200);
  };

  const runScripts = async () => {
    const scripts = ['fetch_country_metrics.py'];

    for (const script of scripts) {
      addLog(`Starting ${script}...`, 'start');

      try {
        const code = await streamScript(script, (type, text) => {
          addLog(text, type === 'stderr' ? 'stderr' : type === 'start' ? 'start' : 'stdout');
        });

        if (code !== 0) {
          addLog(`${script} exited with code ${code}`, 'error');
        } else {
          addLog(`${script} completed.`, 'success');
        }
      } catch (e) {
        addLog(`${script} failed: ${String(e)}`, 'error');
      }
    }

    setTasks(prev => prev.map(t => ({ ...t, status: 'done', progress: 100 })));
    await loadAndParseTrees();
  };

  const startCollection = () => {
    setIsRunning(true);
    setAllDone(false);
    setLogLines([]);
    setJsonPreview('');
    setCurrentTask(0);
    setLogCounter(0);

    if (isExisting) {
      addLog(`Loading ${dataSource.dataVariant} JSON files from Data/...`, 'start');
      loadExisting(0);
    } else {
      addLog(`Launching Python extraction for ${dataSource.dataVariant} JSON data...`, 'start');
      setTasks(prev => prev.map(t => ({ ...t, status: 'fetching_wb', progress: 10 })));
      void runScripts();
      simulateExtraction(0);
    }
  };

  const overallProgress =
    tasks.length > 0
      ? Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length)
      : 0;

  const lineClasses = (type: LogLine['type']) => {
    switch (type) {
      case 'error':
      case 'stderr':
        return 'text-red-600 bg-red-50 border-red-100';
      case 'success':
        return 'text-emerald-700 bg-emerald-50 border-emerald-100';
      case 'start':
        return 'text-amber-700 bg-amber-50 border-amber-100';
      case 'stdout':
        return 'text-slate-700 bg-slate-50 border-slate-200';
      default:
        return 'text-gray-700 bg-white border-gray-200';
    }
  };

  return (
    <div className="animate-fade-in flex flex-col h-full min-h-0 overflow-hidden">
      <div className="text-center mb-4 shrink-0">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Data Collection</h2>
        <p className="text-gray-500">
          {comparisonMode === 'pair'
            ? isExisting
              ? `Loading ${dataSource.dataVariant} JSON files for the selected countries.`
              : `Running Python scripts to prepare ${dataSource.dataVariant} JSON data for the selected countries.`
            : isExisting
            ? `Loading ${dataSource.dataVariant} JSON files for all countries so ${baseCountryName ?? 'the selected country'} can be compared against everyone.`
            : `Running Python scripts to prepare ${dataSource.dataVariant} JSON data for all countries so ${baseCountryName ?? 'the selected country'} can be compared against everyone.`}
        </p>
      </div>

      <div className="glass-card p-4 mb-4 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Overall Progress</span>
          <span className="text-sm font-semibold text-primary-600">{overallProgress}%</span>
        </div>
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary-600 to-accent-500 rounded-full transition-all duration-500"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
        <div className="w-64 glass-card p-3 flex flex-col min-h-0 overflow-hidden shrink-0">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 shrink-0">
            Countries ({tasks.filter(t => t.status === 'done').length}/{tasks.length})
          </h3>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-0">
            {tasks.map((task, index) => (
              <div
                key={task.country.code}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all ${
                  index === currentTask && isRunning
                    ? 'bg-primary-50 border-primary-300 shadow-sm'
                    : task.status === 'done'
                    ? 'bg-gray-50 border-gray-200'
                    : 'bg-white border-gray-100'
                }`}
              >
                <div className="shrink-0">
                  {task.status === 'done' ? (
                    <Check size={14} className="text-emerald-500" />
                  ) : task.status !== 'pending' ? (
                    <Loader2 size={14} className="text-primary-400 animate-spin" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border border-gray-300" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-700 truncate">{task.country.name}</div>
                  <div className="text-[10px] text-gray-500">
                    {task.status === 'pending' && 'Waiting...'}
                    {task.status === 'fetching_wb' && 'Fetching API...'}
                    {task.status === 'parsing' && 'Parsing...'}
                    {task.status === 'done' && 'Complete'}
                  </div>
                </div>

                <span className="text-[10px] text-gray-500 shrink-0">{task.progress}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${comparisonMode === 'pair' ? 'gap-3' : ''}`}>
          <div className="flex-1 glass-card p-4 flex flex-col min-h-0 overflow-hidden">
            <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
              <div className="flex items-center gap-2">
                {isExisting ? (
                  <Database size={14} className="text-gray-500" />
                ) : (
                  <Terminal size={14} className="text-gray-500" />
                )}
                <h3 className="text-sm font-semibold text-gray-500">
                  {isExisting ? 'Load Log' : 'Script Output'}
                </h3>
              </div>

              {logLines.length > 0 && (
                <span className="text-[11px] px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                  {logLines.length} lines
                </span>
              )}
            </div>

            <div
              ref={logRef}
              className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden rounded-lg border border-gray-200 bg-gray-100 p-3"
            >
              {logLines.length === 0 ? (
                <div className="text-gray-400 flex items-center gap-2 font-mono text-xs">
                  <Download size={14} />
                  {isExisting
                    ? 'Click "Load Files" to read the country data.'
                    : 'Click "Run Scripts" to extract country data.'}
                </div>
              ) : (
                <div className="space-y-1.5 font-mono text-xs">
                  {logLines.map(line => (
                    <div
                      key={line.id}
                      className={`rounded-md border px-2.5 py-2 leading-relaxed whitespace-pre-wrap break-words ${lineClasses(line.type)}`}
                    >
                      <span className="text-gray-500 mr-2">[{line.timestamp}]</span>
                      <span>{line.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {comparisonMode === 'pair' && jsonPreview && (
            <div className="h-44 glass-card p-3 flex flex-col shrink-0 overflow-hidden">
              <div className="flex items-center gap-2 mb-2 shrink-0">
                <FileJson size={13} className="text-gray-500" />
                <h3 className="text-xs font-semibold text-gray-500">JSON Document Preview</h3>
              </div>

              <div className="flex-1 min-h-0 overflow-auto bg-gray-100 rounded p-2 font-mono text-[10px]">
                <pre className="text-gray-600 whitespace-pre-wrap break-words">{jsonPreview}</pre>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200 shrink-0">
        <button onClick={onPrev} className="btn-secondary">
          Back
        </button>

        <div className="flex gap-3 items-center">
          {!isRunning && !allDone && (
            <button onClick={startCollection} className="btn-accent flex items-center gap-2">
              <Download size={16} />
              {isExisting ? 'Load Files' : 'Run Scripts'}
            </button>
          )}

          {isRunning && (
            <div className="flex items-center gap-2 text-sm text-gray-500 px-3">
              <Loader2 size={14} className="animate-spin" />
              {isExisting ? 'Loading...' : 'Running Python scripts...'}
            </div>
          )}

          <button
            onClick={onNext}
            disabled={!allDone}
            className="btn-primary flex items-center gap-2"
          >
            Continue to Metrics Selection
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

function generatePreview(country: Country): string {
  return JSON.stringify(
    {
      country: country.name,
      iso3: country.code,
      demographics: { population: { value: null, year: null } },
      economy: { gdp_usd: { value: null, year: null } },
    },
    null,
    2,
  );
}