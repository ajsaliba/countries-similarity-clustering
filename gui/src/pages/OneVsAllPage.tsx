import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Target, ChevronDown, ChevronLeft, ChevronRight, X,
  Download, ArrowUpDown, Search, Globe,
} from 'lucide-react';
import { OvaResult, OvaEntry, TreeNode, EditOperation } from '../types';
import { countries as countriesData } from '../data/countries';
import { TreeView } from '../components/TreeView';

// ── helpers ─────────────────────────────────────────────────────────────────

function flagEmoji(code2: string): string {
  if (!code2 || code2.length !== 2) return '';
  return [...code2.toUpperCase()]
    .map(c => String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0)))
    .join('');
}

function findCountry(name: string) {
  const lc = name.toLowerCase();
  return countriesData.find(c => c.name.toLowerCase() === lc);
}

function simColor(s: number): string {
  if (s >= 0.7) return 'bg-green-500';
  if (s >= 0.4) return 'bg-yellow-500';
  return 'bg-red-500';
}

function simPillClass(s: number): string {
  if (s >= 0.7) return 'bg-green-100 text-green-800';
  if (s >= 0.4) return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-800';
}

function pct(s: number): string {
  return (s * 100).toFixed(1) + '%';
}

function downloadJson(obj: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function downloadCsv(result: OvaResult) {
  const header = 'rank,country,similarity,distance,region,subregion';
  const rows = result.results.map(r => {
    const c = findCountry(r.country);
    return `${r.rank},${r.country},${r.similarity},${r.distance},${c?.region ?? ''},${c?.subregion ?? ''}`;
  });
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `one_vs_all_${result.base_country.replace(/\s+/g, '_')}.csv`;
  a.click();
}

const SESSION_KEY = 'csc_v1_ova_last';

// ── method options ────────────────────────────────────────────────────────────
const METHODS = [
  { value: 'nj_ted', label: 'NJ-TED (default)' },
] as const;

// ── component ─────────────────────────────────────────────────────────────────
export function OneVsAllPage() {
  // ── config state ──────────────────────────────────────────────────────────
  const [allCountryNames, setAllCountryNames] = useState<string[]>([]);
  const [dataset, setDataset] = useState<'clean' | 'raw'>('clean');
  const [baseCountry, setBaseCountry] = useState('');
  const [searchText, setSearchText] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── run state ─────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [ovaResult, setOvaResult] = useState<OvaResult | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; lastCountry: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // ── tab + drawer state ────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'rankings' | 'distribution' | 'regional' | 'map'>('rankings');
  const [drawerEntry, setDrawerEntry] = useState<OvaEntry | null>(null);
  const [drawerCompareResult, setDrawerCompareResult] = useState<{
    edit_script: EditOperation[];
    edit_script_summary: string;
    operation_counts: { insert: number; delete: number; update: number };
    tree_b: TreeNode;
  } | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerTreeOpen, setDrawerTreeOpen] = useState(false);

  // ── table state ───────────────────────────────────────────────────────────
  const [tableSort, setTableSort] = useState<{ col: 'rank' | 'similarity' | 'distance'; dir: 'asc' | 'desc' }>({ col: 'rank', dir: 'asc' });
  const [tableFilter, setTableFilter] = useState('');
  const [tablePage, setTablePage] = useState(1);
  const PAGE_SIZE = 25;

  // ── offline detection ─────────────────────────────────────────────────────
  const [backendOnline, setBackendOnline] = useState(true);

  useEffect(() => {
    fetch('/api/ted/countries?dataset=clean')
      .then(r => r.json())
      .then((names: string[]) => {
        setAllCountryNames(names);
        setBackendOnline(true);
      })
      .catch(() => setBackendOnline(false));
  }, []);

  // reload country list when dataset changes
  useEffect(() => {
    fetch(`/api/ted/countries?dataset=${dataset}`)
      .then(r => r.json())
      .then((names: string[]) => setAllCountryNames(names))
      .catch(() => {});
  }, [dataset]);

  // restore from session
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) setOvaResult(JSON.parse(raw) as OvaResult);
    } catch { /* ignore */ }
  }, []);

  // close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('.country-combo')) setDropdownOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // filtered dropdown list
  const filteredNames = useMemo(
    () => allCountryNames.filter(n => n.toLowerCase().includes(searchText.toLowerCase())).slice(0, 80),
    [allCountryNames, searchText],
  );

  // ── run ────────────────────────────────────────────────────────────────────
  const handleRun = useCallback(() => {
    if (!baseCountry || loading) return;
    setLoading(true);
    setBackendError(null);
    setOvaResult(null);
    setProgress(null);
    setElapsed(0);
    setActiveTab('rankings');

    elapsedRef.current = setInterval(() => setElapsed(e => e + 1), 1000);

    // close any previous SSE
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    const params = new URLSearchParams({ base_country: baseCountry, dataset, top_n: '20' });
    const es = new EventSource(`/api/ted/one-vs-all/stream?${params}`);
    esRef.current = es;

    es.onmessage = (e: MessageEvent) => {
      const msg = JSON.parse(e.data) as {
        done?: number; total?: number; country?: string; similarity?: number | null;
        complete?: boolean; error?: string;
      } & Partial<OvaResult>;

      if (msg.error) {
        setBackendError(msg.error);
        setLoading(false);
        if (elapsedRef.current) clearInterval(elapsedRef.current);
        es.close();
        return;
      }
      if (msg.complete) {
        const result = msg as OvaResult;
        setOvaResult(result);
        try {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(result));
          const recent: unknown[] = JSON.parse(localStorage.getItem('csc_v1_recentComparisons') ?? '[]');
          recent.unshift({
            type: 'one-vs-all',
            base: result.base_country,
            total: result.total_compared,
            topMatch: result.top_n[0]?.country ?? '',
            topScore: result.top_n[0]?.similarity ?? 0,
            date: new Date().toISOString(),
          });
          localStorage.setItem('csc_v1_recentComparisons', JSON.stringify(recent.slice(0, 20)));
        } catch { /* ignore */ }
        setLoading(false);
        if (elapsedRef.current) clearInterval(elapsedRef.current);
        es.close();
        return;
      }
      if (msg.done !== undefined && msg.total !== undefined) {
        setProgress({ done: msg.done, total: msg.total, lastCountry: msg.country ?? '' });
      }
    };

    es.onerror = () => {
      setBackendError('Connection to backend lost.');
      setLoading(false);
      if (elapsedRef.current) clearInterval(elapsedRef.current);
      es.close();
    };
  }, [baseCountry, dataset, loading]);

  // cleanup on unmount
  useEffect(() => () => {
    if (esRef.current) esRef.current.close();
    if (elapsedRef.current) clearInterval(elapsedRef.current);
  }, []);

  // ── drawer helpers ────────────────────────────────────────────────────────
  function openDrawer(entry: OvaEntry) {
    setDrawerEntry(entry);
    setDrawerCompareResult(null);
    setDrawerTreeOpen(false);
  }

  function loadEditScript(entry: OvaEntry) {
    if (!ovaResult) return;
    setDrawerLoading(true);
    fetch('/api/ted/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country_a: ovaResult.base_country, country_b: entry.country, dataset }),
    })
      .then(r => r.json())
      .then(d => {
        setDrawerCompareResult({
          edit_script: d.edit_script,
          edit_script_summary: d.edit_script_summary,
          operation_counts: d.operation_counts,
          tree_b: d.tree_b,
        });
      })
      .catch(() => {})
      .finally(() => setDrawerLoading(false));
  }

  function navigateDrawer(dir: -1 | 1) {
    if (!ovaResult || !drawerEntry) return;
    const idx = ovaResult.results.findIndex(r => r.country === drawerEntry.country);
    const next = ovaResult.results[idx + dir];
    if (next) openDrawer(next);
  }

  // ── sorted/filtered table rows ────────────────────────────────────────────
  const tableRows = useMemo(() => {
    if (!ovaResult) return [];
    let rows = [...ovaResult.results];
    if (tableFilter) {
      const lc = tableFilter.toLowerCase();
      rows = rows.filter(r => r.country.toLowerCase().includes(lc));
    }
    rows.sort((a, b) => {
      const mult = tableSort.dir === 'asc' ? 1 : -1;
      return (a[tableSort.col] - b[tableSort.col]) * mult;
    });
    return rows;
  }, [ovaResult, tableFilter, tableSort]);

  const totalPages = Math.ceil(tableRows.length / PAGE_SIZE);
  const pageRows = tableRows.slice((tablePage - 1) * PAGE_SIZE, tablePage * PAGE_SIZE);

  function toggleSort(col: typeof tableSort['col']) {
    setTableSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'rank' ? 'asc' : 'desc' });
    setTablePage(1);
  }

  // ── regional grouping ─────────────────────────────────────────────────────
  const regionalData = useMemo(() => {
    if (!ovaResult) return [];
    const map = new Map<string, { entries: OvaEntry[]; subregions: Map<string, OvaEntry[]> }>();
    for (const entry of ovaResult.results) {
      const meta = findCountry(entry.country);
      const region = meta?.region ?? 'Unknown';
      const subregion = meta?.subregion ?? 'Unknown';
      if (!map.has(region)) map.set(region, { entries: [], subregions: new Map() });
      const g = map.get(region)!;
      g.entries.push(entry);
      if (!g.subregions.has(subregion)) g.subregions.set(subregion, []);
      g.subregions.get(subregion)!.push(entry);
    }
    return [...map.entries()].map(([region, { entries, subregions }]) => {
      const mean = entries.reduce((s, e) => s + e.similarity, 0) / (entries.length || 1);
      const top5 = [...entries].sort((a, b) => b.similarity - a.similarity).slice(0, 5);
      const subArr = [...subregions.entries()].map(([sr, es]) => ({
        subregion: sr,
        count: es.length,
        mean: es.reduce((s, e) => s + e.similarity, 0) / (es.length || 1),
      })).sort((a, b) => b.mean - a.mean);
      return { region, count: entries.length, mean, top5, subArr };
    }).sort((a, b) => b.mean - a.mean);
  }, [ovaResult]);

  // ── similarity color map for world map ───────────────────────────────────
  const mapColors = useMemo((): Record<string, string> => {
    if (!ovaResult) return {};
    const out: Record<string, string> = {};
    for (const entry of ovaResult.results) {
      const meta = findCountry(entry.country);
      if (meta) {
        const hue = Math.round(entry.similarity * 120);
        out[meta.code2] = `hsl(${hue},70%,50%)`;
      }
    }
    const base = findCountry(ovaResult.base_country);
    if (base) out[base.code2] = 'hsl(210,90%,55%)';
    return out;
  }, [ovaResult]);

  // iso-numeric → code2 map (from WorldMapView numericToIso3 logic, using code2 from countries.ts)
  const numToCode2 = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of countriesData) m[c.code] = c.code2;
    return m;
  }, []);

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Backend offline banner ─────────────────────────────────────── */}
      {!backendOnline && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-700 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
          Backend offline — start the Flask server with <code className="font-mono text-xs bg-red-100 px-1 rounded">python scripts/ted_api.py</code>
        </div>
      )}

      {/* ── SECTION A: Config Bar ─────────────────────────────────────────── */}
      <div className="shrink-0 bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Country combobox */}
          <div className="flex flex-col gap-1 country-combo relative min-w-[200px]">
            <label className="text-xs font-semibold text-gray-600">Base Country</label>
            <div className="relative">
              <input
                ref={searchRef}
                type="text"
                placeholder="Search country…"
                className="w-full pl-3 pr-8 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={dropdownOpen ? searchText : (baseCountry || searchText)}
                onChange={e => { setSearchText(e.target.value); setDropdownOpen(true); if (!e.target.value) setBaseCountry(''); }}
                onFocus={() => { setSearchText(''); setDropdownOpen(true); }}
              />
              <ChevronDown size={14} className="absolute right-2 top-2.5 text-gray-400 pointer-events-none" />
            </div>
            {dropdownOpen && (
              <div className="absolute top-full mt-1 left-0 w-60 max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                {filteredNames.length === 0
                  ? <div className="px-3 py-2 text-xs text-gray-500">No matches</div>
                  : filteredNames.map(n => (
                    <button key={n} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${n === baseCountry ? 'bg-primary-50 text-primary-700 font-semibold' : ''}`}
                      onMouseDown={() => { setBaseCountry(n); setSearchText(''); setDropdownOpen(false); }}>
                      {flagEmoji(findCountry(n)?.code2 ?? '')} {n}
                    </button>
                  ))
                }
              </div>
            )}
          </div>

          {/* Dataset toggle */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Dataset</label>
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {(['clean', 'raw'] as const).map(d => (
                <button key={d} onClick={() => setDataset(d)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all capitalize ${dataset === d ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Method (display-only since backend always uses nj_ted) */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Method</label>
            <select className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
              {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          {/* Run button */}
          <button
            disabled={!baseCountry || loading || !backendOnline}
            onClick={handleRun}
            className="px-5 py-1.5 rounded-lg text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 mt-auto"
          >
            {loading
              ? <><span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />Computing…</>
              : <><Target size={14} />Compare All</>
            }
          </button>

          {/* Right side info + export */}
          {ovaResult && !loading && (
            <div className="ml-auto flex items-center gap-2 mt-auto flex-wrap">
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                Compared {ovaResult.total_compared} countries in {ovaResult.elapsed_seconds}s
              </span>
              <button onClick={() => downloadJson(ovaResult, `one_vs_all_${ovaResult.base_country.replace(/\s+/g, '_')}.json`)}
                className="flex items-center gap-1 text-xs text-gray-600 border border-gray-300 rounded-lg px-2 py-1 hover:bg-gray-50">
                <Download size={12} /> Export JSON
              </button>
            </div>
          )}
        </div>

        {/* Progress bar */}
        {loading && (
          <div className="mt-3">
            <div className="text-xs text-gray-500 mb-1 flex items-center justify-between">
              <span>
                Comparing <strong>{baseCountry}</strong> against all countries…
                {progress && <span className="ml-2">{progress.done} / {progress.total}</span>}
                {progress?.lastCountry && <span className="ml-2 text-gray-400">Last: {progress.lastCountry}</span>}
              </span>
              <span className="text-gray-400">{elapsed}s</span>
            </div>
            {progress ? (
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-primary-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
              </div>
            ) : (
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full w-1/3 bg-primary-400 rounded-full animate-pulse" />
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {backendError && (
          <div className="mt-2 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
            <span className="flex-1">{backendError}</span>
            <button onClick={() => setBackendError(null)}><X size={14} /></button>
          </div>
        )}
      </div>

      {/* ── SECTION B: Results ────────────────────────────────────────────── */}
      {!ovaResult && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-4">
          <Globe size={64} strokeWidth={1} />
          <p className="text-base">Select a base country above to begin</p>
        </div>
      )}

      {ovaResult && (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* main content */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Tab bar */}
            <div className="shrink-0 bg-white border-b border-gray-200 px-4 flex gap-0">
              {([ ['rankings', 'Rankings'], ['distribution', 'Distribution'], ['regional', 'Regional'], ['map', 'World Map'] ] as const).map(([id, label]) => (
                <button key={id} onClick={() => setActiveTab(id)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === id ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-4">

              {/* ── Tab 1: Rankings ────────────────────────────────────────── */}
              {activeTab === 'rankings' && (
                <div className="space-y-5">
                  {/* Key metric chips */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                      { label: 'Most Similar', value: `${flagEmoji(findCountry(ovaResult.top_n[0]?.country ?? '')?.code2 ?? '')} ${ovaResult.top_n[0]?.country ?? '—'}` },
                      { label: 'Top Score', value: pct(ovaResult.top_n[0]?.similarity ?? 0) },
                      { label: 'Dataset Average', value: pct(ovaResult.stats.mean_similarity) },
                      { label: 'Least Similar', value: `${flagEmoji(findCountry(ovaResult.bottom_n[ovaResult.bottom_n.length - 1]?.country ?? '')?.code2 ?? '')} ${ovaResult.bottom_n[ovaResult.bottom_n.length - 1]?.country ?? '—'}` },
                      { label: 'Countries Compared', value: String(ovaResult.total_compared) },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm">
                        <div className="text-xs text-gray-500 mb-1">{label}</div>
                        <div className="text-sm font-bold text-gray-900 truncate">{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Dual top/bottom lists */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Most Similar</h3>
                      <div className="space-y-1">
                        {ovaResult.top_n.map(entry => (
                          <button key={entry.country} onClick={() => openDrawer(entry)}
                            className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors group">
                            <span className="text-xs text-gray-400 w-6 shrink-0">#{entry.rank}</span>
                            <span className="text-sm w-5 shrink-0">{flagEmoji(findCountry(entry.country)?.code2 ?? '')}</span>
                            <span className="text-sm text-gray-800 w-28 shrink-0 truncate group-hover:text-primary-700">{entry.country}</span>
                            <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-green-500 rounded-full" style={{ width: pct(entry.similarity) }} />
                            </div>
                            <span className="text-xs font-mono text-gray-600 w-12 text-right shrink-0">{pct(entry.similarity)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Least Similar</h3>
                      <div className="space-y-1">
                        {[...ovaResult.bottom_n].reverse().map(entry => (
                          <button key={entry.country} onClick={() => openDrawer(entry)}
                            className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors group">
                            <span className="text-xs text-gray-400 w-6 shrink-0">#{entry.rank}</span>
                            <span className="text-sm w-5 shrink-0">{flagEmoji(findCountry(entry.country)?.code2 ?? '')}</span>
                            <span className="text-sm text-gray-800 w-28 shrink-0 truncate group-hover:text-primary-700">{entry.country}</span>
                            <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-red-500 rounded-full" style={{ width: pct(entry.similarity) }} />
                            </div>
                            <span className="text-xs font-mono text-gray-600 w-12 text-right shrink-0">{pct(entry.similarity)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Full table */}
                  <div>
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <div className="relative flex-1 max-w-xs">
                        <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
                        <input type="text" placeholder="Filter countries…" value={tableFilter}
                          onChange={e => { setTableFilter(e.target.value); setTablePage(1); }}
                          className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                      </div>
                      <button onClick={() => downloadCsv(ovaResult)}
                        className="flex items-center gap-1 text-xs text-gray-600 border border-gray-300 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                        <Download size={12} /> Export CSV
                      </button>
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-gray-200">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                          <tr>
                            {(['rank', 'Flag', 'Country', 'similarity', 'distance', 'Region', 'Actions'] as const).map(col => {
                              const sortable = col === 'rank' || col === 'similarity' || col === 'distance';
                              return (
                                <th key={col} className={`px-3 py-2 text-left font-semibold ${sortable ? 'cursor-pointer hover:text-gray-700 select-none' : ''}`}
                                  onClick={sortable ? () => toggleSort(col as typeof tableSort['col']) : undefined}>
                                  <span className="flex items-center gap-1">
                                    {col.charAt(0).toUpperCase() + col.slice(1)}
                                    {sortable && tableSort.col === col && (
                                      <ArrowUpDown size={10} className="text-primary-600" />
                                    )}
                                  </span>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {pageRows.map(entry => {
                            const meta = findCountry(entry.country);
                            return (
                              <tr key={entry.country} className="hover:bg-gray-50">
                                <td className="px-3 py-2 text-gray-500">#{entry.rank}</td>
                                <td className="px-3 py-2">{flagEmoji(meta?.code2 ?? '')}</td>
                                <td className="px-3 py-2 font-medium text-gray-900">{entry.country}</td>
                                <td className="px-3 py-2">
                                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${simPillClass(entry.similarity)}`}>
                                    {pct(entry.similarity)}
                                  </span>
                                </td>
                                <td className="px-3 py-2 font-mono text-gray-600">{entry.distance.toFixed(2)}</td>
                                <td className="px-3 py-2 text-gray-500">{meta?.region ?? '—'}</td>
                                <td className="px-3 py-2">
                                  <button onClick={() => openDrawer(entry)}
                                    className="text-xs text-primary-600 hover:text-primary-800 font-medium">Details</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center justify-center gap-3 mt-3 text-sm text-gray-500">
                        <button disabled={tablePage === 1} onClick={() => setTablePage(p => p - 1)}
                          className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"><ChevronLeft size={16} /></button>
                        <span>Page {tablePage} of {totalPages}</span>
                        <button disabled={tablePage === totalPages} onClick={() => setTablePage(p => p + 1)}
                          className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"><ChevronRight size={16} /></button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Tab 2: Distribution ────────────────────────────────────── */}
              {activeTab === 'distribution' && ovaResult && (
                <div className="space-y-6">
                  <DistributionTab result={ovaResult} />
                </div>
              )}

              {/* ── Tab 3: Regional ────────────────────────────────────────── */}
              {activeTab === 'regional' && (
                <div className="space-y-4">
                  {/* Region cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {regionalData.map(({ region, count, mean, top5, subArr }) => (
                      <div key={region} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-gray-900">{region}</span>
                          <span className="text-xs text-gray-400">{count} countries</span>
                        </div>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-xs text-gray-500">Average:</span>
                          <span className={`text-xs font-bold ${mean >= 0.6 ? 'text-green-600' : mean >= 0.4 ? 'text-yellow-600' : 'text-red-600'}`}>{pct(mean)}</span>
                          <div className="flex-1 h-2 bg-gray-100 rounded-full">
                            <div className={`h-full rounded-full ${mean >= 0.6 ? 'bg-green-400' : mean >= 0.4 ? 'bg-yellow-400' : 'bg-red-400'}`}
                              style={{ width: pct(mean) }} />
                          </div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${mean >= 0.6 ? 'bg-green-100 text-green-700' : mean >= 0.4 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                            {mean >= 0.6 ? 'High' : mean >= 0.4 ? 'Moderate' : 'Low'}
                          </span>
                        </div>
                        <div className="space-y-1">
                          {top5.map(e => (
                            <button key={e.country} onClick={() => openDrawer(e)}
                              className="w-full flex items-center gap-2 text-left hover:bg-gray-50 rounded px-1 py-0.5">
                              <span className="text-xs text-gray-800 w-24 shrink-0 truncate">{e.country}</span>
                              <div className="flex-1 h-2 bg-gray-100 rounded-full">
                                <div className="h-full bg-primary-400 rounded-full" style={{ width: pct(e.similarity) }} />
                              </div>
                              <span className="text-[10px] font-mono text-gray-500 w-10 text-right shrink-0">{pct(e.similarity)}</span>
                            </button>
                          ))}
                        </div>
                        {/* Subregion drill-down */}
                        <details className="mt-3">
                          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 select-none">Subregions</summary>
                          <table className="w-full text-xs mt-2">
                            <thead><tr className="text-gray-400"><th className="text-left">Subregion</th><th>Count</th><th>Avg</th></tr></thead>
                            <tbody>
                              {subArr.map(s => (
                                <tr key={s.subregion} className="border-t border-gray-50">
                                  <td className="py-0.5 text-gray-600">{s.subregion}</td>
                                  <td className="text-center text-gray-500">{s.count}</td>
                                  <td className="text-center font-mono">{pct(s.mean)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </details>
                      </div>
                    ))}
                  </div>

                  {/* Regional comparison bar chart */}
                  <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Regional Average Similarity</h3>
                    <RegionalBarChart regions={regionalData} />
                  </div>
                </div>
              )}

              {/* ── Tab 4: World Map ────────────────────────────────────────── */}
              {activeTab === 'map' && (
                <OvaWorldMap result={ovaResult} mapColors={mapColors} numToCode2={numToCode2} onCountryClick={entry => entry && openDrawer(entry)} />
              )}
            </div>
          </div>

          {/* ── SECTION C: Detail Drawer ──────────────────────────────────── */}
          {drawerEntry && (
            <DetailDrawer
              entry={drawerEntry}
              baseResult={ovaResult}
              compareResult={drawerCompareResult}
              compareLoading={drawerLoading}
              treeOpen={drawerTreeOpen}
              onTreeToggle={() => setDrawerTreeOpen(v => !v)}
              onClose={() => setDrawerEntry(null)}
              onLoadScript={() => loadEditScript(drawerEntry)}
              onNavigate={navigateDrawer}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Distribution Tab ──────────────────────────────────────────────────────────

function DistributionTab({ result }: { result: OvaResult }) {
  const { stats, results, bottom_n } = result;
  const buckets = stats.distribution_buckets;
  const maxCount = Math.max(...buckets.map(b => b.count), 1);

  const W = 600, H = 220;
  const pL = 44, pR = 16, pT = 20, pB = 50;
  const cW = W - pL - pR;
  const cH = H - pT - pB;
  const bW = cW / buckets.length;

  const mean = stats.mean_similarity;
  const median = stats.median_similarity;
  const p25 = stats.percentile_25;
  const p75 = stats.percentile_75;
  const minS = stats.min_similarity;
  const maxS = stats.max_similarity;

  const xPos = (s: number) => pL + s * cW;

  const [hoveredBucket, setHoveredBucket] = useState<number | null>(null);

  const leastSimilar = [...results].sort((a, b) => a.similarity - b.similarity)[0];
  const mostSimilar = [...results].sort((a, b) => b.similarity - a.similarity)[0];

  return (
    <>
      {/* Histogram */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Similarity Distribution</h3>
        <div className="relative">
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
            {/* Y axis */}
            <line x1={pL} y1={pT} x2={pL} y2={pT + cH} stroke="#d1d5db" strokeWidth={1} />
            {/* X axis */}
            <line x1={pL} y1={pT + cH} x2={pL + cW} y2={pT + cH} stroke="#d1d5db" strokeWidth={1} />

            {/* Y gridlines */}
            {[0, 0.25, 0.5, 0.75, 1].map(frac => {
              const y = pT + cH - frac * cH;
              return (
                <g key={frac}>
                  <line x1={pL} y1={y} x2={pL + cW} y2={y} stroke="#f3f4f6" strokeWidth={1} />
                  <text x={pL - 4} y={y + 4} textAnchor="end" fontSize={9} fill="#9ca3af">{Math.round(frac * maxCount)}</text>
                </g>
              );
            })}

            {/* Bars */}
            {buckets.map((b, i) => {
              const barH = (b.count / maxCount) * cH;
              const x = pL + i * bW;
              const y = pT + cH - barH;
              const bucketMid = (i + 0.5) / 10;
              const color = bucketMid < mean - 0.05 ? '#f87171' : bucketMid > mean + 0.05 ? '#10b981' : '#fbbf24';
              return (
                <g key={i}
                  onMouseEnter={() => setHoveredBucket(i)}
                  onMouseLeave={() => setHoveredBucket(null)}>
                  <rect x={x + 2} y={y} width={bW - 4} height={barH} rx={3} fill={color} opacity={hoveredBucket === i ? 1 : 0.8} />
                  <text x={x + bW / 2} y={pT + cH + 10} textAnchor="middle" fontSize={8} fill="#6b7280">
                    {b.range.split('–')[0]}
                  </text>
                  {hoveredBucket === i && barH > 0 && (
                    <g>
                      <rect x={x + bW / 2 - 40} y={y - 28} width={80} height={20} rx={4} fill="#1f2937" />
                      <text x={x + bW / 2} y={y - 14} textAnchor="middle" fontSize={10} fill="white">
                        {b.range}: {b.count}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Vertical markers */}
            {[
              { x: xPos(mean), color: '#6366f1', label: 'mean' },
              { x: xPos(median), color: '#f59e0b', label: 'median' },
              { x: xPos(p25), color: '#94a3b8', label: 'p25' },
              { x: xPos(p75), color: '#94a3b8', label: 'p75' },
            ].map(({ x, color, label }) => (
              <g key={label}>
                <line x1={x} y1={pT} x2={x} y2={pT + cH} stroke={color} strokeWidth={1.5} strokeDasharray="4 2" />
                <text x={x} y={pT - 4} textAnchor="middle" fontSize={8} fill={color}>{label}</text>
              </g>
            ))}
          </svg>
        </div>

        {/* Box plot */}
        <div className="mt-2">
          <div className="text-xs text-gray-500 mb-1">Distribution (box plot)</div>
          <svg width={W} height={50} viewBox={`0 0 ${W} 50`} className="w-full h-auto">
            <line x1={pL} y1={25} x2={pL + cW} y2={25} stroke="#e5e7eb" strokeWidth={1} />
            {/* whiskers */}
            <line x1={xPos(minS)} y1={18} x2={xPos(minS)} y2={32} stroke="#9ca3af" strokeWidth={1.5} />
            <line x1={xPos(maxS)} y1={18} x2={xPos(maxS)} y2={32} stroke="#9ca3af" strokeWidth={1.5} />
            <line x1={xPos(minS)} y1={25} x2={xPos(p25)} y2={25} stroke="#9ca3af" strokeWidth={1.5} />
            <line x1={xPos(p75)} y1={25} x2={xPos(maxS)} y2={25} stroke="#9ca3af" strokeWidth={1.5} />
            {/* box */}
            <rect x={xPos(p25)} y={15} width={xPos(p75) - xPos(p25)} height={20} fill="#e0e7ff" stroke="#6366f1" strokeWidth={1} rx={2} />
            {/* median */}
            <line x1={xPos(median)} y1={15} x2={xPos(median)} y2={35} stroke="#f59e0b" strokeWidth={2} />
            {/* mean dot */}
            <circle cx={xPos(mean)} cy={25} r={4} fill="#6366f1" />
            {/* labels */}
            {[
              { x: xPos(minS), label: (minS * 100).toFixed(0) + '%' },
              { x: xPos(p25), label: 'p25' },
              { x: xPos(median), label: 'med' },
              { x: xPos(p75), label: 'p75' },
              { x: xPos(maxS), label: (maxS * 100).toFixed(0) + '%' },
            ].map(({ x, label }) => (
              <text key={label} x={x} y={46} textAnchor="middle" fontSize={8} fill="#6b7280">{label}</text>
            ))}
          </svg>
        </div>
      </div>

      {/* Stats table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr><th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Metric</th><th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Value</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {[
              ['Mean similarity', pct(mean)],
              ['Median similarity', pct(median)],
              ['Std deviation', pct(stats.std_similarity)],
              ['25th percentile', pct(p25)],
              ['75th percentile', pct(p75)],
              ['Min (least similar)', `${pct(minS)} — ${leastSimilar?.country ?? ''}`],
              ['Max (most similar)', `${pct(maxS)} — ${mostSimilar?.country ?? ''}`],
            ].map(([label, value]) => (
              <tr key={label} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-600">{label}</td>
                <td className="px-4 py-2 font-semibold text-gray-900">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Regional bar chart ────────────────────────────────────────────────────────

const REGION_COLORS: Record<string, string> = {
  Africa: '#f97316', Americas: '#3b82f6', Asia: '#10b981',
  Europe: '#8b5cf6', Oceania: '#f59e0b', Unknown: '#9ca3af',
};

function RegionalBarChart({ regions }: { regions: { region: string; mean: number; count: number }[] }) {
  if (!regions.length) return null;
  const W = 500, rowH = 36, pL = 90, pR = 80;
  const height = regions.length * rowH + 20;
  return (
    <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} className="w-full h-auto">
      {regions.map(({ region, mean }, i) => {
        const y = i * rowH + 10;
        const barW = Math.round(mean * (W - pL - pR));
        const color = REGION_COLORS[region] ?? '#6b7280';
        return (
          <g key={region}>
            <text x={pL - 6} y={y + 12} textAnchor="end" fontSize={11} fill="#374151">{region}</text>
            <rect x={pL} y={y} width={barW} height={22} rx={4} fill={color} opacity={0.8} />
            <text x={pL + barW + 6} y={y + 14} fontSize={11} fill="#374151" fontWeight={600}>{pct(mean)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── World Map Tab ─────────────────────────────────────────────────────────────

function OvaWorldMap({ result, mapColors, numToCode2, onCountryClick }: {
  result: OvaResult;
  mapColors: Record<string, string>;
  numToCode2: Record<string, string>;
  onCountryClick: (entry: OvaEntry | null) => void;
}) {
  const [tooltip, setTooltip] = useState<{ name: string; similarity: number | null; rank: number | null; x: number; y: number } | null>(null);
  const [GeoURL] = useState('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');

  // Lazy-load react-simple-maps
  const [MapComponents, setMapComponents] = useState<{
    ComposableMap: React.ComponentType<React.SVGProps<SVGSVGElement> & { projectionConfig?: Record<string, unknown> }>;
    Geographies: React.ComponentType<{ geography: string; children: (p: { geographies: { rsmKey: string; id: string }[] }) => React.ReactNode }>;
    Geography: React.ComponentType<{ geography: unknown; style: Record<string, unknown>; onMouseEnter?: (e: React.MouseEvent) => void; onMouseLeave?: () => void; onClick?: () => void }>;
    ZoomableGroup: React.ComponentType<{ zoom: number; children: React.ReactNode }>;
  } | null>(null);

  useEffect(() => {
    import('react-simple-maps').then(m => setMapComponents(m as never)).catch(() => {});
  }, []);

  const entryByCode2 = useMemo(() => {
    const m = new Map<string, OvaEntry>();
    for (const entry of result.results) {
      const meta = countriesData.find(c => c.name === entry.country);
      if (meta) m.set(meta.code2, entry);
    }
    return m;
  }, [result]);

  if (!MapComponents) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Loading map…</div>;
  }

  const { ComposableMap, Geographies, Geography, ZoomableGroup } = MapComponents;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      {/* Map */}
      <div className="bg-[#060d1a] relative" style={{ minHeight: 340 }}>
        <ComposableMap projectionConfig={{ scale: 145, center: [0, 10] }} style={{ width: '100%', height: '100%' }}>
          <ZoomableGroup zoom={1}>
            <Geographies geography={GeoURL}>
              {({ geographies }) => geographies.map(geo => {
                const alpha3 = numericToIso3Map[String(geo.id)] ?? '';
                const alpha2 = numToCode2[alpha3] ?? '';
                const fill = mapColors[alpha2] ?? '#1e293b';
                const entry = entryByCode2.get(alpha2) ?? null;
                const isBase = countriesData.find(c => c.name === result.base_country)?.code2 === alpha2;
                return (
                  <Geography key={geo.rsmKey} geography={geo as never}
                    onClick={() => entry && onCountryClick(entry)}
                    onMouseEnter={(e: React.MouseEvent) => {
                      const name = entry?.country ?? (isBase ? result.base_country : '');
                      if (name) setTooltip({ name, similarity: entry?.similarity ?? null, rank: entry?.rank ?? null, x: e.clientX, y: e.clientY });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    style={{
                      default: { fill, stroke: isBase ? '#60a5fa' : '#334155', strokeWidth: isBase ? 1 : 0.4, outline: 'none' },
                      hover: { fill: isBase ? '#3b82f6' : (fill === '#1e293b' ? '#2d3f55' : fill), stroke: '#60a5fa', strokeWidth: 0.8, outline: 'none', cursor: entry ? 'pointer' : 'default' },
                      pressed: { outline: 'none' },
                    }} />
                );
              })}
            </Geographies>
          </ZoomableGroup>
        </ComposableMap>
        {tooltip && (
          <div className="fixed z-50 pointer-events-none bg-gray-900 text-white text-xs rounded-lg px-2 py-1.5 shadow-xl"
            style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}>
            <div className="font-semibold">{tooltip.name}</div>
            {tooltip.similarity !== null && <div>Similarity: {pct(tooltip.similarity)} (Rank #{tooltip.rank})</div>}
            {tooltip.similarity === null && <div className="text-gray-400">(base country)</div>}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="px-4 py-3 border-t border-gray-200">
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>Most Different</span>
          <div className="flex-1 h-3 rounded-full" style={{ background: 'linear-gradient(to right, hsl(0,70%,50%), hsl(60,70%,50%), hsl(120,70%,50%))' }} />
          <span>Most Similar</span>
        </div>
        <div className="flex justify-between text-[10px] text-gray-400 mt-0.5 px-0">
          <span>0%</span><span>50%</span><span>100%</span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-500">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: 'hsl(210,90%,55%)' }} />
          <span>Base country ({result.base_country})</span>
          <span className="ml-3 inline-block w-3 h-3 rounded-sm bg-[#1e293b] border border-gray-600" />
          <span>Not in dataset</span>
        </div>
      </div>
    </div>
  );
}

// numeric → iso3 map (subset — same as WorldMapView.tsx)
const numericToIso3Map: Record<string, string> = {
  '004':'AFG','008':'ALB','012':'DZA','020':'AND','024':'AGO','028':'ATG','032':'ARG','051':'ARM','036':'AUS','040':'AUT','031':'AZE','044':'BHS','048':'BHR','050':'BGD','052':'BRB','112':'BLR','056':'BEL','084':'BLZ','204':'BEN','064':'BTN','068':'BOL','070':'BIH','072':'BWA','076':'BRA','096':'BRN','100':'BGR','854':'BFA','108':'BDI','132':'CPV','116':'KHM','120':'CMR','124':'CAN','140':'CAF','148':'TCD','152':'CHL','156':'CHN','170':'COL','174':'COM','178':'COG','180':'COD','188':'CRI','384':'CIV','191':'HRV','192':'CUB','196':'CYP','203':'CZE','208':'DNK','262':'DJI','212':'DMA','214':'DOM','218':'ECU','818':'EGY','222':'SLV','226':'GNQ','232':'ERI','233':'EST','748':'SWZ','231':'ETH','242':'FJI','246':'FIN','250':'FRA','266':'GAB','270':'GMB','268':'GEO','276':'DEU','288':'GHA','300':'GRC','308':'GRD','320':'GTM','324':'GIN','624':'GNB','328':'GUY','332':'HTI','340':'HND','348':'HUN','352':'ISL','356':'IND','360':'IDN','364':'IRN','368':'IRQ','372':'IRL','376':'ISR','380':'ITA','388':'JAM','392':'JPN','400':'JOR','398':'KAZ','404':'KEN','296':'KIR','408':'PRK','410':'KOR','414':'KWT','417':'KGZ','418':'LAO','428':'LVA','422':'LBN','426':'LSO','430':'LBR','434':'LBY','438':'LIE','440':'LTU','442':'LUX','450':'MDG','454':'MWI','458':'MYS','462':'MDV','466':'MLI','470':'MLT','584':'MHL','478':'MRT','480':'MUS','484':'MEX','583':'FSM','498':'MDA','492':'MCO','496':'MNG','499':'MNE','504':'MAR','508':'MOZ','104':'MMR','516':'NAM','520':'NRU','524':'NPL','528':'NLD','554':'NZL','558':'NIC','562':'NER','566':'NGA','807':'MKD','578':'NOR','512':'OMN','586':'PAK','585':'PLW','591':'PAN','598':'PNG','600':'PRY','604':'PER','608':'PHL','616':'POL','620':'PRT','634':'QAT','642':'ROU','643':'RUS','646':'RWA','659':'KNA','662':'LCA','670':'VCT','882':'WSM','674':'SMR','678':'STP','682':'SAU','686':'SEN','688':'SRB','690':'SYC','694':'SLE','702':'SGP','703':'SVK','705':'SVN','090':'SLB','706':'SOM','710':'ZAF','728':'SSD','724':'ESP','144':'LKA','729':'SDN','740':'SUR','752':'SWE','756':'CHE','760':'SYR','762':'TJK','834':'TZA','764':'THA','626':'TLS','768':'TGO','776':'TON','780':'TTO','788':'TUN','792':'TUR','795':'TKM','798':'TUV','800':'UGA','804':'UKR','784':'ARE','826':'GBR','840':'USA','858':'URY','860':'UZB','548':'VUT','336':'VAT','862':'VEN','704':'VNM','887':'YEM','894':'ZMB','716':'ZWE',
};

// ── Detail Drawer ─────────────────────────────────────────────────────────────

interface DetailDrawerProps {
  entry: OvaEntry;
  baseResult: OvaResult;
  compareResult: { edit_script: EditOperation[]; edit_script_summary: string; operation_counts: { insert: number; delete: number; update: number }; tree_b: TreeNode; } | null;
  compareLoading: boolean;
  treeOpen: boolean;
  onTreeToggle: () => void;
  onClose: () => void;
  onLoadScript: () => void;
  onNavigate: (dir: -1 | 1) => void;
}

function DetailDrawer({ entry, baseResult, compareResult, compareLoading, treeOpen, onTreeToggle, onClose, onLoadScript, onNavigate }: DetailDrawerProps) {
  const meta = findCountry(entry.country);
  const flag = flagEmoji(meta?.code2 ?? '');
  const sim = entry.similarity;
  const gaugeColor = sim >= 0.7 ? '#22c55e' : sim >= 0.4 ? '#f59e0b' : '#ef4444';

  // SVG semi-circle gauge (180° arc)
  const R = 54, cx = 70, cy = 70;
  const filledDeg = sim * 180;
  function polarToXY(deg: number) {
    const rad = ((180 + deg) * Math.PI) / 180;
    return { x: cx + R * Math.cos(rad), y: cy + R * Math.sin(rad) };
  }
  const start = polarToXY(0);
  const end = polarToXY(filledDeg);
  const large = filledDeg > 180 ? 1 : 0;

  const totalOps = compareResult
    ? compareResult.operation_counts.insert + compareResult.operation_counts.delete + compareResult.operation_counts.update
    : 0;

  return (
    <div className="w-80 shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-hidden shadow-xl z-10">
      {/* header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xl mr-1 inline">{flag}</div>
          <span className="text-base font-bold text-gray-900">{entry.country}</span>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-lg font-bold`} style={{ color: gaugeColor }}>{pct(sim)}</span>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">#{entry.rank} of {baseResult.total_compared}</span>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Gauge */}
        <div className="flex justify-center">
          <svg width={140} height={80} viewBox="0 0 140 80">
            {/* background arc */}
            <path d={`M ${polarToXY(0).x} ${polarToXY(0).y} A ${R} ${R} 0 1 1 ${polarToXY(179.9).x} ${polarToXY(179.9).y}`}
              fill="none" stroke="#e5e7eb" strokeWidth={10} strokeLinecap="round" />
            {/* filled arc */}
            {sim > 0 && (
              <path d={`M ${start.x} ${start.y} A ${R} ${R} 0 ${large} 1 ${end.x} ${end.y}`}
                fill="none" stroke={gaugeColor} strokeWidth={10} strokeLinecap="round" />
            )}
            <text x={cx} y={cy - 4} textAnchor="middle" fontSize={18} fontWeight="bold" fill={gaugeColor}>{pct(sim)}</text>
            <text x={cx} y={cy + 12} textAnchor="middle" fontSize={9} fill="#9ca3af">similarity</text>
          </svg>
        </div>

        {/* Stats chips */}
        <div className="grid grid-cols-3 gap-2">
          {[
            ['TED Distance', entry.distance.toFixed(2)],
            ['Base tree', `${baseResult.base_tree_size}n`],
            ['Region', meta?.region ?? '—'],
          ].map(([l, v]) => (
            <div key={l} className="bg-gray-50 border border-gray-200 rounded-lg p-2 text-center">
              <div className="text-[10px] text-gray-500">{l}</div>
              <div className="text-xs font-bold text-gray-900 truncate">{v}</div>
            </div>
          ))}
        </div>

        {/* Edit script */}
        <div>
          {!compareResult && (
            <button onClick={onLoadScript} disabled={compareLoading}
              className="w-full py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-2 disabled:opacity-50">
              {compareLoading
                ? <><span className="w-3 h-3 border-2 border-gray-400 border-t-gray-700 rounded-full animate-spin" />Loading…</>
                : 'Load Edit Script'
              }
            </button>
          )}
          {compareResult && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-600">Edit Script Summary</div>
              <div className="text-xs text-gray-500">{compareResult.edit_script_summary}</div>
              <div className="flex gap-2 flex-wrap">
                {[
                  { label: `${compareResult.operation_counts.insert} ins`, cls: 'bg-green-100 text-green-700' },
                  { label: `${compareResult.operation_counts.delete} del`, cls: 'bg-red-100 text-red-700' },
                  { label: `${compareResult.operation_counts.update} upd`, cls: 'bg-yellow-100 text-yellow-700' },
                ].map(({ label, cls }) => (
                  <span key={label} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
                ))}
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {compareResult.edit_script.slice(0, 10).map((op, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[10px]">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${op.type === 'insert' ? 'bg-green-100 text-green-700' : op.type === 'delete' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {op.type.slice(0, 3)}
                    </span>
                    <span className="text-gray-700 truncate">{op.node}</span>
                  </div>
                ))}
                {totalOps > 10 && <div className="text-[10px] text-gray-400">…and {totalOps - 10} more</div>}
              </div>
            </div>
          )}
        </div>

        {/* Tree preview */}
        {compareResult?.tree_b && (
          <div>
            <button onClick={onTreeToggle}
              className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 w-full">
              <ChevronRight size={12} className={`transition-transform ${treeOpen ? 'rotate-90' : ''}`} />
              Show Tree
            </button>
            {treeOpen && (
              <div className="mt-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-2">
                <TreeView node={compareResult.tree_b} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="shrink-0 border-t border-gray-200 px-4 py-2.5 flex items-center justify-between">
        <button onClick={() => onNavigate(-1)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 disabled:opacity-30"
          disabled={entry.rank <= 1}>
          <ChevronLeft size={14} /> Previous
        </button>
        <span className="text-xs text-gray-400">#{entry.rank}</span>
        <button onClick={() => onNavigate(1)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 disabled:opacity-30"
          disabled={entry.rank >= baseResult.total_compared}>
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}