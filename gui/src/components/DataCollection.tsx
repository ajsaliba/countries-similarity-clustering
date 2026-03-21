import React, { useState, useEffect, useRef } from 'react';
import { Download, Database, FileJson, Check, Loader2, ArrowRight, Terminal } from 'lucide-react';
import { Country, DataSourceConfig, TreeNode } from '../types';
import {
  loadCountryJSON, loadCountryXML, countryNameToSlug,
  countryDataToTree, xmlStringToTree,
} from '../services/dataService';

interface DataCollectionProps {
  selectedCountries: Country[];
  dataSource: DataSourceConfig;
  onDataLoaded: (trees: Record<string, TreeNode>) => void;
  onNext: () => void;
  onPrev: () => void;
}

interface CollectionTask {
  country: Country;
  status: 'pending' | 'fetching_wiki' | 'fetching_wb' | 'parsing' | 'done';
  progress: number;
}

// Stream a Python script over SSE and call onLine for each output line.
// Resolves when the script finishes (type:'done') or rejects on error.
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
      } catch { /* ignore parse errors */ }
    }
  }
  return 0;
}

export const DataCollection: React.FC<DataCollectionProps> = ({
  selectedCountries,
  dataSource,
  onDataLoaded,
  onNext,
  onPrev,
}) => {
  const [tasks, setTasks]               = useState<CollectionTask[]>([]);
  const [currentTask, setCurrentTask]   = useState(0);
  const [isRunning, setIsRunning]       = useState(false);
  const [allDone, setAllDone]           = useState(false);
  const [logLines, setLogLines]         = useState<{ text: string; type: string }[]>([]);
  const [xmlPreview, setXmlPreview]     = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  const isExisting = dataSource.mode === 'existing';

  useEffect(() => {
    setTasks(selectedCountries.map(c => ({ country: c, status: 'pending', progress: 0 })));
    setAllDone(false);
    setLogLines([]);
  }, [selectedCountries]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

  const addLog = (text: string, type = 'info') =>
    setLogLines(prev => [...prev, { text: `[${new Date().toLocaleTimeString()}] ${text}`, type }]);

  // ── Fetch + parse country files into trees ───────────────────────────────
  const loadAndParseTrees = async () => {
    addLog('Building trees from country data…', 'start');
    const trees: Record<string, TreeNode> = {};
    for (const country of selectedCountries) {
      const slug = countryNameToSlug(country.name);
      try {
        if (dataSource.format === 'json') {
          const data = await loadCountryJSON(slug);
          trees[country.code] = countryDataToTree(data);
        } else {
          const xml = await loadCountryXML(slug);
          trees[country.code] = xmlStringToTree(xml);
        }
        addLog(`✓ Tree ready: ${country.name}`, 'success');
      } catch (e) {
        addLog(`⚠ Skipped ${country.name}: ${String(e)}`, 'error');
      }
    }
    onDataLoaded(trees);
    addLog('All trees built.', 'success');
    setIsRunning(false);
    setAllDone(true);
  };

  // ── Load from existing files ─────────────────────────────────────────────
  const loadExisting = (taskIndex: number) => {
    if (taskIndex >= tasks.length) {
      addLog('All files loaded.', 'success');
      loadAndParseTrees();   // fetch real data and build trees
      return;
    }
    const c = selectedCountries[taskIndex];
    setCurrentTask(taskIndex);
    const slug = c.name.toLowerCase().replace(/ /g, '_');
    addLog(`Reading Data/${dataSource.format.toUpperCase()}/${slug}.${dataSource.format}`);
    setTasks(prev => prev.map((t, i) => i === taskIndex ? { ...t, status: 'parsing', progress: 50 } : t));
    setTimeout(() => {
      setXmlPreview(generatePreview(c, dataSource.format));
      addLog(`✓ ${c.name} loaded.`, 'success');
      setTasks(prev => prev.map((t, i) => i === taskIndex ? { ...t, status: 'done', progress: 100 } : t));
      setTimeout(() => loadExisting(taskIndex + 1), 150);
    }, 300);
  };

  // ── Simulate extraction (visual progress only) ───────────────────────────
  const simulateExtraction = (taskIndex: number) => {
    if (taskIndex >= tasks.length) return;  // completion handled by runScripts → loadAndParseTrees
    const c = selectedCountries[taskIndex];
    setCurrentTask(taskIndex);
    addLog(`[${c.name}] Fetching World Bank indicators…`);
    setTasks(prev => prev.map((t, i) => i === taskIndex ? { ...t, status: 'fetching_wb', progress: 30 } : t));
    setTimeout(() => {
      addLog(`[${c.name}] Parsing → ${dataSource.format.toUpperCase()}`);
      setTasks(prev => prev.map((t, i) => i === taskIndex ? { ...t, status: 'parsing', progress: 70 } : t));
      setXmlPreview(generatePreview(c, dataSource.format));
      setTimeout(() => {
        addLog(`[${c.name}] Done.`, 'success');
        setTasks(prev => prev.map((t, i) => i === taskIndex ? { ...t, status: 'done', progress: 100 } : t));
        setTimeout(() => simulateExtraction(taskIndex + 1), 200);
      }, 600);
    }, 500);
  };

  // ── Run real Python scripts via SSE ──────────────────────────────────────
  const runScripts = async () => {
    const scripts = ['fetch_country_metrics.py', 'json_to_xml_converter.py'];
    for (const script of scripts) {
      addLog(`▶ Starting ${script}…`, 'start');
      try {
        const code = await streamScript(script, (type, text) => {
          addLog(text, type === 'stderr' ? 'error' : 'stdout');
        });
        if (code !== 0) {
          addLog(`⚠ ${script} exited with code ${code}`, 'error');
        } else {
          addLog(`✓ ${script} completed.`, 'success');
        }
      } catch (e) {
        addLog(`✗ ${script} failed: ${String(e)}`, 'error');
      }
    }
    // Mark all tasks done then fetch + parse the real files
    setTasks(prev => prev.map(t => ({ ...t, status: 'done', progress: 100 })));
    await loadAndParseTrees();
  };

  const startCollection = () => {
    setIsRunning(true);
    setAllDone(false);
    setLogLines([]);
    if (isExisting) {
      addLog(`Loading pre-extracted ${dataSource.format.toUpperCase()} files from Data/…`);
      loadExisting(0);
    } else {
      addLog('Launching Python extraction scripts…', 'start');
      // Mark all tasks as in-progress while scripts run
      setTasks(prev => prev.map(t => ({ ...t, status: 'fetching_wb', progress: 10 })));
      runScripts();
      // Also kick off the simulation overlay so the task list shows movement
      simulateExtraction(0);
    }
  };

  const overallProgress = tasks.length > 0
    ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length)
    : 0;

  const lineColor = (type: string) => {
    if (type === 'error')   return 'text-red-600';
    if (type === 'success') return 'text-accent-600';
    if (type === 'start')   return 'text-yellow-600';
    if (type === 'stderr')  return 'text-orange-600';
    return 'text-gray-500';
  };

  return (
    <div className="animate-fade-in flex flex-col h-full">
      <div className="text-center mb-4 shrink-0">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Data Collection</h2>
        <p className="text-gray-500">
          {isExisting
            ? `Loading pre-extracted ${dataSource.format.toUpperCase()} files from Data/ for each selected country.`
            : 'Running Python scripts to pull fresh data from the World Bank API and convert to the selected format.'}
        </p>
      </div>

      {/* Overall progress */}
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

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left: Country task list */}
        <div className="w-64 glass-card p-3 flex flex-col">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Countries ({tasks.filter(t => t.status === 'done').length}/{tasks.length})
          </h3>
          <div className="flex-1 overflow-y-auto space-y-1.5">
            {tasks.map((task, index) => (
              <div
                key={task.country.code}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all ${
                  index === currentTask && isRunning
                    ? 'bg-primary-50 border-primary-300'
                    : task.status === 'done'
                    ? 'bg-gray-50 border-gray-200'
                    : 'bg-white border-gray-100'
                }`}
              >
                <div className="shrink-0">
                  {task.status === 'done'
                    ? <Check size={14} className="text-accent-500" />
                    : task.status !== 'pending'
                    ? <Loader2 size={14} className="text-primary-400 animate-spin" />
                    : <div className="w-3.5 h-3.5 rounded-full border border-gray-300" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-700 truncate">{task.country.name}</div>
                  <div className="text-[9px] text-gray-600">
                    {task.status === 'pending'     && 'Waiting…'}
                    {task.status === 'fetching_wb' && 'Fetching API…'}
                    {task.status === 'parsing'     && 'Parsing…'}
                    {task.status === 'done'        && 'Complete'}
                  </div>
                </div>
                <span className="text-[9px] text-gray-600">{task.progress}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Center: Log */}
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex-1 glass-card p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              {isExisting
                ? <Database size={14} className="text-gray-500" />
                : <Terminal size={14} className="text-gray-500" />}
              <h3 className="text-sm font-semibold text-gray-500">
                {isExisting ? 'Load Log' : 'Script Output'}
              </h3>
            </div>
            <div
              ref={logRef}
              className="flex-1 overflow-y-auto bg-gray-100 rounded-lg p-3 font-mono text-xs leading-relaxed"
            >
              {logLines.length === 0 ? (
                <div className="text-gray-400 flex items-center gap-2">
                  <Download size={14} />
                  {isExisting
                    ? 'Click "Load Files" to read existing data'
                    : 'Click "Run Scripts" to extract fresh data from World Bank API'}
                </div>
              ) : (
                logLines.map((line, i) => (
                  <div key={i} className={`${i === logLines.length - 1 ? 'text-gray-900' : lineColor(line.type)}`}>
                    {line.text}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Preview */}
          {xmlPreview && (
            <div className="h-44 glass-card p-3 flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <FileJson size={13} className="text-gray-500" />
                <h3 className="text-xs font-semibold text-gray-500">
                  {dataSource.format.toUpperCase()} Document Preview
                </h3>
              </div>
              <div className="flex-1 overflow-auto bg-gray-100 rounded p-2 font-mono text-[10px]">
                <pre className="text-gray-500 whitespace-pre-wrap">{xmlPreview}</pre>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200 shrink-0">
        <button onClick={onPrev} className="btn-secondary">Back</button>
        <div className="flex gap-3">
          {!isRunning && !allDone && (
            <button onClick={startCollection} className="btn-accent flex items-center gap-2">
              <Download size={16} />
              {isExisting ? 'Load Files' : 'Run Scripts'}
            </button>
          )}
          {isRunning && (
            <div className="flex items-center gap-2 text-sm text-gray-500 px-3">
              <Loader2 size={14} className="animate-spin" />
              {isExisting ? 'Loading…' : 'Running Python scripts…'}
            </div>
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

function generatePreview(country: Country, format: 'json' | 'xml'): string {
  if (format === 'json') {
    return JSON.stringify({
      country: country.name,
      iso3: country.code,
      demographics: { population: { value: null, year: null } },
      economy:      { gdp_usd:    { value: null, year: null } },
    }, null, 2);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<country code="${country.code}">
  <common_name>${country.name}</common_name>
  <region>${country.region}</region>
  <demographics>
    <population><value/><year/></population>
  </demographics>
  <economy>
    <gdp_usd><value/><year/></gdp_usd>
  </economy>
</country>`;
}
