import { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import { countries as allCountries } from '../data/countries';
import { BackendCompareResult } from '../types';

function parseInfobox(text: string): { key: string; value: string }[] {
  return text
    .split('\n')
    .map(line => {
      const idx = line.indexOf(':');
      if (idx < 0) return null;
      return { key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
    })
    .filter((r): r is { key: string; value: string } => r !== null && r.key.length > 0);
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function ReconstructionPage() {
  const [countryA, setCountryA] = useState('France');
  const [countryB, setCountryB] = useState('Germany');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  // Load from sessionStorage if available
  useEffect(() => {
    const stored = sessionStorage.getItem('csc_patched_infobox');
    if (stored) setText(stored);
  }, []);

  const loadPatched = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ted/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country_a: countryA, country_b: countryB, dataset: 'clean' }),
      });
      if (res.ok) {
        const data = await res.json() as BackendCompareResult;
        setText(data.patched_infobox ?? '');
        sessionStorage.setItem('csc_patched_infobox', data.patched_infobox ?? '');
      }
    } catch { /* offline */ }
    finally { setLoading(false); }
  };

  const rows = parseInfobox(text);

  const exportHtml = () => {
    const tableHtml = `<table border="1" cellpadding="6" style="border-collapse:collapse;font-family:sans-serif">
${rows.map(r => `  <tr><td style="font-weight:bold;background:#f3f4f6;text-align:right;min-width:140px">${r.key}</td><td>${r.value}</td></tr>`).join('\n')}
</table>`;
    downloadBlob(tableHtml, `infobox_${countryB}.html`, 'text/html');
  };

  const exportJson = () => {
    const obj = Object.fromEntries(rows.map(r => [r.key, r.value]));
    downloadBlob(JSON.stringify(obj, null, 2), `infobox_${countryB}.json`, 'application/json');
  };

  const exportXml = () => {
    const fields = rows.map(r => `  <field name="${r.key}">${r.value}</field>`).join('\n');
    downloadBlob(`<infobox>\n${fields}\n</infobox>`, `infobox_${countryB}.xml`, 'application/xml');
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="shrink-0 bg-white border-b border-gray-200 p-4 flex flex-wrap items-center gap-3">
        <select className="text-sm border border-gray-200 rounded-lg px-3 py-2" value={countryA} onChange={e => setCountryA(e.target.value)}>
          {allCountries.map(c => <option key={c.code}>{c.name}</option>)}
        </select>
        <span className="text-gray-400">→</span>
        <select className="text-sm border border-gray-200 rounded-lg px-3 py-2" value={countryB} onChange={e => setCountryB(e.target.value)}>
          {allCountries.map(c => <option key={c.code}>{c.name}</option>)}
        </select>
        <button
          onClick={loadPatched}
          disabled={loading}
          className="px-4 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          {loading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" /> : 'Load Patched Infobox'}
        </button>
        <div className="ml-auto flex gap-2">
          <button onClick={exportHtml} className="flex items-center gap-1 px-3 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"><Download size={12} /> HTML</button>
          <button onClick={exportJson} className="flex items-center gap-1 px-3 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"><Download size={12} /> JSON</button>
          <button onClick={exportXml} className="flex items-center gap-1 px-3 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"><Download size={12} /> XML</button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex gap-0">
        {/* Left: wikitext */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-gray-200">
          <div className="shrink-0 px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-600">Wikitext Input</div>
          <textarea
            className="flex-1 p-4 font-mono text-xs text-gray-800 resize-none focus:outline-none bg-white"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Load a patched infobox or paste Key: Value lines here…"
          />
        </div>

        {/* Right: rendered preview */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="shrink-0 px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-600">Infobox Preview</div>
          <div className="flex-1 overflow-auto p-4">
            {rows.length > 0 ? (
              <table className="w-full border-collapse text-sm shadow-sm">
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-2 px-3 bg-gray-50 font-semibold text-gray-700 text-right w-1/3 text-xs">{r.key}</td>
                      <td className="py-2 px-3 bg-white text-gray-900 text-xs">{r.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-gray-400 text-center py-12">Preview will appear here as you type</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}