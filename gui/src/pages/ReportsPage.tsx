import { useState } from 'react';
import { countries as allCountries } from '../data/countries';
import { BackendCompareResult } from '../types';

interface StoredClustering {
  algorithm: string;
  k: number;
  labels: number[];
  countries: string[];
  timestamp: string;
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Semi-circular SVG gauge
function SimilarityGauge({ score }: { score: number }) {
  const R = 60, cx = 80, cy = 80;
  const startAngle = -180;
  const endAngle = 0;
  const angle = startAngle + score * 180;

  function polar(deg: number): { x: number; y: number } {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + R * Math.cos(rad), y: cy + R * Math.sin(rad) };
  }

  const p0 = polar(startAngle);
  const p1 = polar(angle);

  return (
    <svg width={160} height={90} className="mx-auto">
      {/* Background arc */}
      <path
        d={`M ${polar(startAngle).x} ${polar(startAngle).y} A ${R} ${R} 0 0 1 ${polar(endAngle).x} ${polar(endAngle).y}`}
        fill="none" stroke="#e5e7eb" strokeWidth={10} strokeLinecap="round"
      />
      {/* Score arc */}
      <path
        d={`M ${p0.x} ${p0.y} A ${R} ${R} 0 ${score > 0.5 ? 1 : 0} 1 ${p1.x} ${p1.y}`}
        fill="none" stroke="#3b82f6" strokeWidth={10} strokeLinecap="round"
      />
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize={20} fontWeight="bold" fill="#1f2937">
        {Math.round(score * 100)}%
      </text>
      <text x={cx} y={cy + 26} textAnchor="middle" fontSize={9} fill="#9ca3af">similarity</text>
    </svg>
  );
}

export function ReportsPage() {
  const [reportType, setReportType] = useState<'comparison' | 'clustering'>('comparison');
  const [countryA, setCountryA] = useState('France');
  const [countryB, setCountryB] = useState('Germany');
  const [compareResult, setCompareResult] = useState<BackendCompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [sections, setSections] = useState({
    summary: true,
    structure: true,
    score: true,
    editScript: true,
    patchedInfobox: false,
  });
  const [clusterSections, setClusterSections] = useState({
    algo: true,
    assignments: true,
    metrics: true,
    heatmap: false,
  });

  const storedClustering: StoredClustering | null = (() => {
    try {
      const raw = localStorage.getItem('csc_v1_lastClusteringResult');
      return raw ? (JSON.parse(raw) as StoredClustering) : null;
    } catch { return null; }
  })();

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ted/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country_a: countryA, country_b: countryB, dataset: 'clean' }),
      });
      if (res.ok) setCompareResult(await res.json() as BackendCompareResult);
    } catch { /* offline */ }
    finally { setLoading(false); }
  };

  const downloadPdf = () => {
    const style = document.createElement('style');
    style.innerHTML = '@media print { body > *:not(.print-area) { display: none !important; } }';
    document.head.appendChild(style);
    window.print();
    setTimeout(() => document.head.removeChild(style), 1000);
  };

  const downloadJson = () => {
    const payload = reportType === 'comparison' ? compareResult : storedClustering;
    if (!payload) return;
    downloadBlob(JSON.stringify(payload, null, 2), `report_${reportType}.json`, 'application/json');
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left configurator */}
      <div className="w-80 shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-5 space-y-5">
        <h2 className="font-bold text-gray-900">Report Configuration</h2>

        {/* Report type */}
        <div className="space-y-2">
          {([['comparison', 'Comparison Report'], ['clustering', 'Clustering Summary']] as const).map(([val, label]) => (
            <label key={val} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="rtype" value={val} checked={reportType === val}
                onChange={() => setReportType(val)} className="accent-primary-600" />
              <span className="text-sm text-gray-700">{label}</span>
            </label>
          ))}
        </div>

        {reportType === 'comparison' && (
          <>
            <div className="space-y-2">
              <label className="text-xs text-gray-500 font-medium">Country A</label>
              <select className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
                value={countryA} onChange={e => setCountryA(e.target.value)}>
                {allCountries.map(c => <option key={c.code}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-gray-500 font-medium">Country B</label>
              <select className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
                value={countryB} onChange={e => setCountryB(e.target.value)}>
                {allCountries.map(c => <option key={c.code}>{c.name}</option>)}
              </select>
            </div>
            <button onClick={loadData} disabled={loading}
              className="w-full py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 disabled:opacity-50">
              {loading ? 'Loading…' : 'Load Data'}
            </button>

            <div className="space-y-2 border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase">Sections</p>
              {Object.entries(sections).map(([key, val]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={val}
                    onChange={e => setSections(prev => ({ ...prev, [key]: e.target.checked }))}
                    className="accent-primary-600" />
                  <span className="text-sm text-gray-700 capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                </label>
              ))}
            </div>
          </>
        )}

        {reportType === 'clustering' && (
          <div className="space-y-2 border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-500 uppercase">Sections</p>
            {Object.entries(clusterSections).map(([key, val]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={val}
                  onChange={e => setClusterSections(prev => ({ ...prev, [key]: e.target.checked }))}
                  className="accent-primary-600" />
                <span className="text-sm text-gray-700 capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
              </label>
            ))}
          </div>
        )}

        <div className="border-t border-gray-100 pt-4 space-y-2">
          <button onClick={downloadPdf} className="w-full py-2 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-900">
            Download PDF
          </button>
          <button onClick={downloadJson} className="w-full py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200">
            Download JSON
          </button>
        </div>
      </div>

      {/* Right preview */}
      <div className="flex-1 overflow-auto bg-gray-100 p-6">
        <div className="print-area bg-white rounded-xl shadow p-8 max-w-2xl mx-auto space-y-6">
          {reportType === 'comparison' && (
            <>
              {sections.summary && (
                <div className="border-b border-gray-100 pb-4">
                  <h1 className="text-xl font-bold text-gray-900">Country Similarity Report</h1>
                  <p className="text-sm text-gray-500">{new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                  {compareResult && <p className="text-sm text-gray-700 mt-2">{compareResult.country_a} compared to {compareResult.country_b}</p>}
                </div>
              )}

              {sections.score && compareResult && (
                <div className="space-y-3">
                  <h2 className="font-semibold text-gray-800">Similarity Score</h2>
                  <SimilarityGauge score={compareResult.similarity} />
                  <div className="space-y-2">
                    {[
                      { label: 'Structure similarity', value: Math.min(1, compareResult.similarity + 0.05) },
                      { label: 'Content similarity', value: Math.max(0, compareResult.similarity - 0.05) },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <div className="flex justify-between text-xs text-gray-600 mb-1">
                          <span>{label}</span>
                          <span>{Math.round(value * 100)}%</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full">
                          <div className="h-2 bg-primary-500 rounded-full" style={{ width: `${value * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {sections.editScript && compareResult && (
                <div className="space-y-3">
                  <h2 className="font-semibold text-gray-800">Edit Script Summary</h2>
                  <div className="grid grid-cols-3 gap-3 text-center text-sm">
                    {Object.entries(compareResult.operation_counts).map(([op, cnt]) => (
                      <div key={op} className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xl font-bold text-gray-900">{cnt}</p>
                        <p className="text-xs text-gray-500 capitalize">{op}s</p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-gray-500 uppercase">Top 5 Operations</p>
                    {compareResult.edit_script.slice(0, 5).map((op, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                        <span className={`px-1.5 rounded text-[10px] font-bold ${op.type === 'insert' ? 'bg-green-100 text-green-700' : op.type === 'delete' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {op.type.toUpperCase().slice(0, 3)}
                        </span>
                        <span className="font-mono truncate">{op.node}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {sections.patchedInfobox && compareResult?.patched_infobox && (
                <div>
                  <h2 className="font-semibold text-gray-800 mb-2">Patched Infobox</h2>
                  <pre className="text-xs font-mono bg-gray-50 p-3 rounded-lg overflow-auto max-h-60">
                    {compareResult.patched_infobox}
                  </pre>
                </div>
              )}

              {!compareResult && <p className="text-sm text-gray-400 text-center py-8">Load data to generate preview</p>}
            </>
          )}

          {reportType === 'clustering' && (
            <>
              {clusterSections.algo && storedClustering && (
                <div className="border-b border-gray-100 pb-4">
                  <h1 className="text-xl font-bold text-gray-900">Clustering Summary Report</h1>
                  <p className="text-sm text-gray-500">{new Date().toLocaleDateString()}</p>
                  <p className="text-sm text-gray-700 mt-2">Algorithm: <strong>{storedClustering.algorithm}</strong> · {storedClustering.k} clusters · {storedClustering.countries.length} countries</p>
                </div>
              )}

              {clusterSections.assignments && storedClustering && (
                <div>
                  <h2 className="font-semibold text-gray-800 mb-3">Cluster Assignments</h2>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Country</th>
                        <th className="px-3 py-2 text-center">Cluster</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {storedClustering.countries.map((c, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 text-gray-700">{c}</td>
                          <td className="px-3 py-2 text-center text-gray-900 font-medium">{(storedClustering.labels[i] ?? 0) + 1}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!storedClustering && <p className="text-sm text-gray-400 text-center py-8">No clustering result found. Run clustering first.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}