import { useState, useEffect, useCallback } from 'react';
import { Search, X, ChevronDown, Upload, Globe } from 'lucide-react';
import { countries as allCountries } from '../data/countries';
import { TreeView } from '../components/TreeView';
import { TreeNode } from '../types';

interface CountryDetail {
  raw: string;
  tree: TreeNode | null;
}

function flagEmoji(code2: string): string {
  return [...code2.toUpperCase()].map(c => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('');
}

function syntaxHighlight(json: string): string {
  return json
    .replace(/("(?:[^"\\]|\\.)*")\s*:/g, '<span style="color:#f59e0b">$1</span>:')
    .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span style="color:#22c55e">$1</span>')
    .replace(/:\s*(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g, ': <span style="color:#60a5fa">$1</span>');
}

const REGIONS = ['All Regions', 'Africa', 'Americas', 'Asia', 'Europe', 'Oceania'];
const PAGE_SIZE = 20;

export function DatasetBrowserPage() {
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('All Regions');
  const [sort, setSort] = useState<'name-asc' | 'name-desc' | 'region'>('name-asc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CountryDetail | null>(null);
  const [tab, setTab] = useState<'json' | 'tree'>('json');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState<'auto' | 'upload'>('auto');
  const [importName, setImportName] = useState('');
  const [importToast, setImportToast] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);

  const filtered = allCountries
    .filter(c => {
      const matchSearch = c.name.toLowerCase().includes(search.toLowerCase());
      const matchRegion = region === 'All Regions' || c.region === region;
      return matchSearch && matchRegion;
    })
    .sort((a, b) => {
      if (sort === 'name-asc') return a.name.localeCompare(b.name);
      if (sort === 'name-desc') return b.name.localeCompare(a.name);
      return a.region.localeCompare(b.region);
    });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, region, sort]);

  const openDetail = useCallback(async (name: string) => {
    setSelected(name);
    setDetail(null);
    setLoadingDetail(true);
    setTab('json');
    try {
      const [rawRes, treeRes] = await Promise.all([
        fetch(`/api/ted/country?name=${encodeURIComponent(name)}&dataset=clean`),
        fetch('/api/ted/build-tree', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, dataset: 'clean' }),
        }),
      ]);
      const raw = rawRes.ok ? JSON.stringify(await rawRes.json(), null, 2) : 'Error loading data';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const treeData = treeRes.ok ? (await treeRes.json() as { tree: TreeNode }) : null;
      setDetail({ raw, tree: treeData?.tree ?? null });
    } catch {
      setDetail({ raw: 'Backend offline', tree: null });
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const showToast = (msg: string) => {
    setImportToast(msg);
    setTimeout(() => setImportToast(null), 3000);
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => setUploadPreview(e.target?.result as string ?? null);
    reader.readAsText(file);
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content */}
      <div className={`flex-1 flex flex-col min-w-0 overflow-hidden ${selected ? 'hidden md:flex' : ''}`}>
        {/* Toolbar */}
        <div className="shrink-0 bg-white border-b border-gray-200 p-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-40 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300"
              placeholder="Search countries…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <select
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-300"
            value={region}
            onChange={e => setRegion(e.target.value)}
          >
            {REGIONS.map(r => <option key={r}>{r}</option>)}
          </select>

          <select
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-300"
            value={sort}
            onChange={e => setSort(e.target.value as typeof sort)}
          >
            <option value="name-asc">Name A–Z</option>
            <option value="name-desc">Name Z–A</option>
            <option value="region">Region</option>
          </select>

          <button
            onClick={() => setImportOpen(true)}
            className="ml-auto flex items-center gap-2 px-3 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700"
          >
            <Upload size={14} /> Import Data
          </button>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {paged.map(c => (
              <button
                key={c.code}
                onClick={() => openDetail(c.name)}
                className={`text-left p-3 rounded-xl border transition-all hover:shadow-md ${
                  selected === c.name ? 'border-primary-400 bg-primary-50' : 'border-gray-200 bg-white hover:border-primary-200'
                }`}
              >
                <div className="text-2xl mb-1">{flagEmoji(c.code2)}</div>
                <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                  {c.region}
                </span>
              </button>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-6">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >
                Prev
              </button>
              <span className="px-3 py-1.5 text-sm text-gray-600">
                {page} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Detail drawer */}
      {selected && (
        <div className="w-full md:w-[480px] lg:w-[520px] shrink-0 bg-white border-l border-gray-200 flex flex-col animate-slide-in-right">
          <div className="shrink-0 p-4 border-b border-gray-200 flex items-center gap-3">
            <Globe size={18} className="text-primary-600" />
            <span className="font-semibold text-gray-900">{selected}</span>
            <button
              onClick={() => setSelected(null)}
              className="ml-auto p-1 rounded hover:bg-gray-100"
            >
              <X size={16} className="text-gray-400" />
            </button>
          </div>

          {/* Tabs */}
          <div className="shrink-0 flex border-b border-gray-200">
            {(['json', 'tree'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 text-sm font-medium ${tab === t ? 'border-b-2 border-primary-500 text-primary-700' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {t === 'json' ? 'Raw JSON' : 'Parsed Tree'}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto p-4">
            {loadingDetail && (
              <div className="flex items-center gap-2 text-sm text-gray-400 justify-center py-8">
                <div className="w-5 h-5 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
                Loading…
              </div>
            )}

            {!loadingDetail && detail && (
              <>
                {tab === 'json' && (
                  <pre
                    className="text-xs font-mono bg-gray-950 text-gray-100 p-3 rounded-lg overflow-auto max-h-[70vh]"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    dangerouslySetInnerHTML={{ __html: syntaxHighlight(detail.raw) }}
                  />
                )}
                {tab === 'tree' && detail.tree && (
                  <TreeView node={detail.tree} />
                )}
                {tab === 'tree' && !detail.tree && (
                  <p className="text-sm text-gray-400 text-center py-8">Tree unavailable</p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Import modal */}
      {importOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Import Data</h2>
              <button onClick={() => setImportOpen(false)} className="p-1 rounded hover:bg-gray-100">
                <X size={18} className="text-gray-400" />
              </button>
            </div>

            <div className="flex border-b border-gray-200">
              {(['auto', 'upload'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setImportTab(t)}
                  className={`flex-1 py-2.5 text-sm font-medium ${importTab === t ? 'border-b-2 border-primary-500 text-primary-700' : 'text-gray-500'}`}
                >
                  {t === 'auto' ? 'Auto-fetch' : 'Manual Upload'}
                </button>
              ))}
            </div>

            <div className="p-5 space-y-4">
              {importTab === 'auto' && (
                <>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300"
                    placeholder="Country name (e.g. Lebanon)"
                    value={importName}
                    onChange={e => setImportName(e.target.value)}
                  />
                  <button
                    onClick={() => showToast('Auto-fetch not available — backend script not connected')}
                    className="w-full py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700"
                  >
                    Fetch from Wikipedia
                  </button>
                </>
              )}

              {importTab === 'upload' && (
                <>
                  <div
                    className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dragOver ? 'border-primary-400 bg-primary-50' : 'border-gray-300'}`}
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={e => {
                      e.preventDefault();
                      setDragOver(false);
                      const file = e.dataTransfer.files[0];
                      if (file) handleFileUpload(file);
                    }}
                    onClick={() => {
                      const inp = document.createElement('input');
                      inp.type = 'file';
                      inp.accept = '.json,.xml';
                      inp.onchange = () => { if (inp.files?.[0]) handleFileUpload(inp.files[0]); };
                      inp.click();
                    }}
                  >
                    <Upload size={24} className="mx-auto text-gray-400 mb-2" />
                    <p className="text-sm text-gray-600">Drop .json or .xml file here, or click to upload</p>
                  </div>

                  {uploadPreview && (
                    <>
                      <pre className="text-xs bg-gray-50 p-3 rounded-lg max-h-40 overflow-auto border border-gray-200">
                        {uploadPreview.slice(0, 500)}{uploadPreview.length > 500 ? '…' : ''}
                      </pre>
                      <button
                        onClick={() => showToast('Saved to dataset (client-side preview only)')}
                        className="w-full py-2 bg-accent-600 text-white text-sm rounded-lg hover:bg-accent-700"
                      >
                        Save to Dataset
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {importToast && (
        <div className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg z-50 animate-slide-up">
          {importToast}
        </div>
      )}

      {/* ChevronDown to suppress unused import */}
      <span className="hidden"><ChevronDown /></span>
    </div>
  );
}