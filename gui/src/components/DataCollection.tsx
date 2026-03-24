import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Download,
  Database,
  FileJson,
  Check,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import { Country, DataSourceConfig, TreeNode } from '../types';
import { countries } from '../data/countries';

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
  status: 'pending' | 'loading' | 'done' | 'error';
  progress: number;
  error?: string;
}

interface LogLine {
  id: number;
  text: string;
  type: 'info' | 'success' | 'error' | 'start';
  timestamp: string;
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
    type: 'info' | 'success' | 'error' | 'start' = 'info',
  ) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogCounter(prev => {
      const nextId = prev + 1;
      setLogLines(prevLines => [
        ...prevLines,
        { id: nextId, text, type, timestamp },
      ]);
      return nextId;
    });
  };

  const startCollection = async () => {
    setIsRunning(true);
    setAllDone(false);
    setLogLines([]);
    setJsonPreview('');
    setCurrentTask(0);
    setLogCounter(0);

    const dataset = dataSource.dataVariant;
    addLog(`Loading ${dataset} data from Python backend...`, 'start');

    const trees: Record<string, TreeNode> = {};
    let errorCount = 0;

    for (let i = 0; i < countriesToLoad.length; i++) {
      const country = countriesToLoad[i];
      setCurrentTask(i);

      setTasks(prev =>
        prev.map((t, idx) =>
          idx === i ? { ...t, status: 'loading', progress: 50 } : t,
        ),
      );

      try {
        const res = await fetch('/api/ted/build-tree', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: country.name, dataset }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        trees[country.code] = data.tree;

        // Show preview for first country in pair mode
        if (comparisonMode === 'pair' && i === countriesToLoad.length - 1) {
          // Fetch the raw country data for preview
          try {
            const previewRes = await fetch(
              `/api/ted/country?name=${encodeURIComponent(country.name)}&dataset=${dataset}`,
            );
            if (previewRes.ok) {
              const previewData = await previewRes.json();
              setJsonPreview(JSON.stringify(previewData, null, 2).slice(0, 2000));
            }
          } catch {
            // Preview is optional
          }
        }

        addLog(`${data.name}: tree built (${data.size} nodes)`, 'success');

        setTasks(prev =>
          prev.map((t, idx) =>
            idx === i ? { ...t, status: 'done', progress: 100 } : t,
          ),
        );
      } catch (e) {
        errorCount++;
        const errMsg = String(e instanceof Error ? e.message : e);
        addLog(`${country.name}: ${errMsg}`, 'error');

        setTasks(prev =>
          prev.map((t, idx) =>
            idx === i ? { ...t, status: 'error', progress: 0, error: errMsg } : t,
          ),
        );
      }
    }

    onDataLoaded(trees);
    const loaded = countriesToLoad.length - errorCount;
    addLog(`Done. ${loaded} trees built successfully${errorCount > 0 ? `, ${errorCount} failed` : ''}.`, 'success');
    setIsRunning(false);
    setAllDone(true);
  };

  const overallProgress =
    tasks.length > 0
      ? Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length)
      : 0;

  const lineClasses = (type: LogLine['type']) => {
    switch (type) {
      case 'error':
        return 'text-red-600 bg-red-50 border-red-100';
      case 'success':
        return 'text-emerald-700 bg-emerald-50 border-emerald-100';
      case 'start':
        return 'text-amber-700 bg-amber-50 border-amber-100';
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
            ? `Building trees from ${dataSource.dataVariant} dataset for the selected countries.`
            : `Building trees from ${dataSource.dataVariant} dataset for all countries so ${baseCountryName ?? 'the selected country'} can be compared against everyone.`}
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
                    : task.status === 'error'
                    ? 'bg-red-50 border-red-200'
                    : 'bg-white border-gray-100'
                }`}
              >
                <div className="shrink-0">
                  {task.status === 'done' ? (
                    <Check size={14} className="text-emerald-500" />
                  ) : task.status === 'loading' ? (
                    <Loader2 size={14} className="text-primary-400 animate-spin" />
                  ) : task.status === 'error' ? (
                    <div className="w-3.5 h-3.5 rounded-full bg-red-400" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border border-gray-300" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-700 truncate">{task.country.name}</div>
                  <div className="text-[10px] text-gray-500">
                    {task.status === 'pending' && 'Waiting...'}
                    {task.status === 'loading' && 'Building tree...'}
                    {task.status === 'done' && 'Complete'}
                    {task.status === 'error' && 'Failed'}
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
                <Database size={14} className="text-gray-500" />
                <h3 className="text-sm font-semibold text-gray-500">Load Log</h3>
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
                  Click &quot;Load &amp; Build Trees&quot; to fetch country data from the Python backend.
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
                <h3 className="text-xs font-semibold text-gray-500">Country Data Preview</h3>
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
              Load &amp; Build Trees
            </button>
          )}

          {isRunning && (
            <div className="flex items-center gap-2 text-sm text-gray-500 px-3">
              <Loader2 size={14} className="animate-spin" />
              Building trees via Python backend...
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
