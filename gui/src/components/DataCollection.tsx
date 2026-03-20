import React, { useState, useEffect, useRef } from 'react';
import { Download, Database, FileJson, Check, Loader2, ArrowRight } from 'lucide-react';
import { Country } from '../types';

interface DataCollectionProps {
  selectedCountries: Country[];
  onNext: () => void;
  onPrev: () => void;
}

interface CollectionTask {
  country: Country;
  status: 'pending' | 'fetching_wiki' | 'fetching_wb' | 'parsing' | 'done';
  progress: number;
  wikiData?: string;
  worldBankData?: string;
}

export const DataCollection: React.FC<DataCollectionProps> = ({
  selectedCountries,
  onNext,
  onPrev,
}) => {
  const [tasks, setTasks] = useState<CollectionTask[]>([]);
  const [currentTask, setCurrentTask] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [xmlPreview, setXmlPreview] = useState<string>('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTasks(
      selectedCountries.map(c => ({
        country: c,
        status: 'pending',
        progress: 0,
      }))
    );
  }, [selectedCountries]);

  const addLog = (line: string) => {
    setLogLines(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);
  };

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines]);

  const startCollection = () => {
    setIsRunning(true);
    setLogLines([]);
    addLog('Starting data collection process...');
    simulateCollection(0);
  };

  const simulateCollection = (taskIndex: number) => {
    if (taskIndex >= tasks.length) {
      addLog('All data collection complete!');
      setIsRunning(false);
      return;
    }

    const country = selectedCountries[taskIndex];
    setCurrentTask(taskIndex);

    // Phase 1: Fetching Wikipedia
    addLog(`[${country.name}] Fetching Wikipedia infobox...`);
    setTasks(prev =>
      prev.map((t, i) => (i === taskIndex ? { ...t, status: 'fetching_wiki', progress: 10 } : t))
    );

    setTimeout(() => {
      addLog(`[${country.name}] Wikipedia infobox retrieved (${Math.floor(Math.random() * 50 + 20)} fields)`);
      setTasks(prev =>
        prev.map((t, i) => (i === taskIndex ? { ...t, progress: 30 } : t))
      );

      // Phase 2: Fetching World Bank
      addLog(`[${country.name}] Fetching World Bank indicators...`);
      setTasks(prev =>
        prev.map((t, i) => (i === taskIndex ? { ...t, status: 'fetching_wb', progress: 40 } : t))
      );

      setTimeout(() => {
        addLog(`[${country.name}] World Bank data retrieved (${Math.floor(Math.random() * 30 + 15)} indicators)`);
        setTasks(prev =>
          prev.map((t, i) => (i === taskIndex ? { ...t, progress: 65 } : t))
        );

        // Phase 3: Parsing to XML/JSON
        addLog(`[${country.name}] Parsing and converting to XML format...`);
        setTasks(prev =>
          prev.map((t, i) => (i === taskIndex ? { ...t, status: 'parsing', progress: 80 } : t))
        );

        // Show XML preview
        setXmlPreview(generateXmlPreview(country));

        setTimeout(() => {
          addLog(`[${country.name}] Data collection complete. XML document generated.`);
          setTasks(prev =>
            prev.map((t, i) => (i === taskIndex ? { ...t, status: 'done', progress: 100 } : t))
          );

          setTimeout(() => simulateCollection(taskIndex + 1), 300);
        }, 800);
      }, 700);
    }, 600);
  };

  const allDone = tasks.length > 0 && tasks.every(t => t.status === 'done');
  const overallProgress =
    tasks.length > 0 ? Math.round(tasks.reduce((sum, t) => sum + t.progress, 0) / tasks.length) : 0;

  return (
    <div className="animate-fade-in flex flex-col h-full">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold text-white mb-2">Data Collection</h2>
        <p className="text-gray-400">
          Fetching country infobox data from Wikipedia and World Bank for each selected country.
        </p>
      </div>

      {/* Overall progress */}
      <div className="glass-card p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-300">Overall Progress</span>
          <span className="text-sm text-primary-400">{overallProgress}%</span>
        </div>
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary-600 to-accent-500 rounded-full transition-all duration-500"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left: Country task list */}
        <div className="w-72 glass-card p-3 flex flex-col">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Countries ({tasks.filter(t => t.status === 'done').length}/{tasks.length})
          </h3>
          <div className="flex-1 overflow-y-auto space-y-1.5">
            {tasks.map((task, index) => (
              <div
                key={task.country.code}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${
                  index === currentTask && isRunning
                    ? 'bg-primary-900/30 border-primary-700'
                    : task.status === 'done'
                    ? 'bg-gray-800/30 border-gray-800'
                    : 'bg-gray-800/20 border-gray-800/50'
                }`}
              >
                <div className="shrink-0">
                  {task.status === 'done' ? (
                    <Check size={16} className="text-accent-500" />
                  ) : task.status !== 'pending' ? (
                    <Loader2 size={16} className="text-primary-400 animate-spin" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-gray-700" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-300 truncate">{task.country.name}</div>
                  <div className="text-[10px] text-gray-600">
                    {task.status === 'pending' && 'Waiting...'}
                    {task.status === 'fetching_wiki' && 'Fetching Wikipedia...'}
                    {task.status === 'fetching_wb' && 'Fetching World Bank...'}
                    {task.status === 'parsing' && 'Parsing data...'}
                    {task.status === 'done' && 'Complete'}
                  </div>
                </div>
                <div className="w-10 text-right">
                  <span className="text-[10px] text-gray-500">{task.progress}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Center: Log output */}
        <div className="flex-1 flex flex-col gap-4">
          <div className="flex-1 glass-card p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <Database size={14} className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-400">Collection Log</h3>
            </div>
            <div
              ref={logRef}
              className="flex-1 overflow-y-auto bg-gray-950 rounded-lg p-3 font-mono text-xs leading-relaxed"
            >
              {logLines.length === 0 ? (
                <div className="text-gray-600 flex items-center gap-2">
                  <Download size={14} />
                  Click "Start Collection" to begin fetching data
                </div>
              ) : (
                logLines.map((line, i) => (
                  <div key={i} className={`${i === logLines.length - 1 ? 'text-primary-400' : 'text-gray-500'}`}>
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* XML Preview */}
          {xmlPreview && (
            <div className="h-48 glass-card p-4 flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <FileJson size={14} className="text-gray-500" />
                <h3 className="text-sm font-semibold text-gray-400">XML Document Preview</h3>
              </div>
              <div className="flex-1 overflow-auto bg-gray-950 rounded-lg p-3 font-mono text-xs">
                <pre className="text-gray-400">
                  {xmlPreview.split('\n').map((line, i) => {
                    const isHighlighted = i >= xmlPreview.split('\n').length - 5;
                    return (
                      <div
                        key={i}
                        className={isHighlighted ? 'text-primary-400 code-highlight' : ''}
                      >
                        <span className="text-gray-700 select-none mr-3">{String(i + 1).padStart(3)}</span>
                        {colorizeXml(line)}
                      </div>
                    );
                  })}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-800">
        <button onClick={onPrev} className="btn-secondary">
          Back
        </button>
        <div className="flex gap-3">
          {!isRunning && !allDone && (
            <button onClick={startCollection} className="btn-accent flex items-center gap-2">
              <Download size={16} />
              Start Collection
            </button>
          )}
          <button onClick={onNext} disabled={!allDone} className="btn-primary flex items-center gap-2">
            Continue to Tree Building
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

function generateXmlPreview(country: Country): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<country code="${country.code}">
  <common_name>${country.name}</common_name>
  <region>${country.region}</region>
  <subregion>${country.subregion}</subregion>
  <capital>
    <name>Capital City</name>
    <coordinates lat="0.00" lon="0.00"/>
  </capital>
  <government>
    <type>Government Type</type>
    <head_of_state>Head of State</head_of_state>
    <head_of_government>Head of Government</head_of_government>
  </government>
  <demographics>
    <population>0</population>
    <population_density>0</population_density>
    <life_expectancy>0</life_expectancy>
    <median_age>0</median_age>
  </demographics>
  <economy>
    <gdp currency="USD">0</gdp>
    <gdp_per_capita currency="USD">0</gdp_per_capita>
    <inflation_rate>0</inflation_rate>
    <unemployment_rate>0</unemployment_rate>
  </economy>
  <geography>
    <area unit="km2">0</area>
    <coastline unit="km">0</coastline>
    <climate>Tropical</climate>
  </geography>
</country>`;
}

function colorizeXml(line: string): React.ReactNode {
  return line
    .replace(/(<\/?[\w_]+)/g, '§tag§$1§/tag§')
    .replace(/(\w+)=/g, '§attr§$1§/attr§=')
    .replace(/"([^"]*)"/g, '"§val§$1§/val§"')
    .split(/§(tag|attr|val|\/tag|\/attr|\/val)§/)
    .map((part, i) => {
      if (part === 'tag') return <span key={i} className="text-blue-400">{''}</span>;
      if (part === '/tag') return null;
      if (part === 'attr') return <span key={i} className="text-yellow-400">{''}</span>;
      if (part === '/attr') return null;
      if (part === 'val') return <span key={i} className="text-green-400">{''}</span>;
      if (part === '/val') return null;
      return <span key={i}>{part}</span>;
    })
    .filter(Boolean);
}
