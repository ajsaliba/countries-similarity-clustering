import { useState } from 'react';
import { ChevronDown, ChevronRight, Send } from 'lucide-react';

function syntaxHighlight(json: string): string {
  return json
    .replace(/("(?:[^"\\]|\\.)*")\s*:/g, '<span style="color:#f59e0b">$1</span>:')
    .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span style="color:#22c55e">$1</span>')
    .replace(/:\s*(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g, ': <span style="color:#60a5fa">$1</span>');
}

interface Endpoint {
  method: 'GET' | 'POST';
  path: string;
  description: string;
  exampleBody?: string;
  curl: string;
  python: string;
  javascript: string;
}

const ENDPOINTS: Endpoint[] = [
  {
    method: 'GET',
    path: '/api/ted/countries',
    description: 'List all country names in the dataset',
    curl: `curl "http://localhost:3000/api/ted/countries?dataset=clean"`,
    python: `import requests\nres = requests.get("http://localhost:5001/api/ted/countries", params={"dataset": "clean"})\nprint(res.json())`,
    javascript: `const res = await fetch('/api/ted/countries?dataset=clean');\nconst data = await res.json();\nconsole.log(data);`,
  },
  {
    method: 'GET',
    path: '/api/ted/country',
    description: 'Get raw JSON data for a single country',
    curl: `curl "http://localhost:3000/api/ted/country?name=Lebanon&dataset=clean"`,
    python: `import requests\nres = requests.get("http://localhost:5001/api/ted/country", params={"name": "Lebanon", "dataset": "clean"})\nprint(res.json())`,
    javascript: `const res = await fetch('/api/ted/country?name=Lebanon&dataset=clean');\nconst data = await res.json();\nconsole.log(data);`,
  },
  {
    method: 'POST',
    path: '/api/ted/build-tree',
    description: 'Build a parsed tree for one country and return frontend TreeNode shape',
    exampleBody: JSON.stringify({ name: 'Lebanon', dataset: 'clean' }, null, 2),
    curl: `curl -X POST "http://localhost:3000/api/ted/build-tree" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Lebanon","dataset":"clean"}'`,
    python: `import requests\nres = requests.post("http://localhost:5001/api/ted/build-tree",\n  json={"name": "Lebanon", "dataset": "clean"})\nprint(res.json())`,
    javascript: `const res = await fetch('/api/ted/build-tree', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ name: 'Lebanon', dataset: 'clean' })\n});\nconst data = await res.json();`,
  },
  {
    method: 'POST',
    path: '/api/ted/compare',
    description: 'Full TED comparison: distance, similarity, edit script, patch, post-process',
    exampleBody: JSON.stringify({ country_a: 'France', country_b: 'Germany', dataset: 'clean', method: 'exp_size' }, null, 2),
    curl: `curl -X POST "http://localhost:3000/api/ted/compare" \\\n  -H "Content-Type: application/json" \\\n  -d '{"country_a":"France","country_b":"Germany","dataset":"clean","method":"exp_size"}'`,
    python: `import requests\nres = requests.post("http://localhost:5001/api/ted/compare",\n  json={"country_a": "France", "country_b": "Germany",\n        "dataset": "clean", "method": "exp_size"})\nprint(res.json())`,
    javascript: `const res = await fetch('/api/ted/compare', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ country_a: 'France', country_b: 'Germany', dataset: 'clean', method: 'exp_size' })\n});\nconst data = await res.json();`,
  },
  {
    method: 'POST',
    path: '/api/ted/clustering/matrix',
    description: 'Compute pairwise similarity matrix for a list of countries',
    exampleBody: JSON.stringify({ countries: ['Lebanon', 'France', 'Germany'], dataset: 'clean', method: 'exp_size' }, null, 2),
    curl: `curl -X POST "http://localhost:3000/api/ted/clustering/matrix" \\\n  -H "Content-Type: application/json" \\\n  -d '{"countries":["Lebanon","France","Germany"],"dataset":"clean"}'`,
    python: `import requests\nres = requests.post("http://localhost:5001/api/ted/clustering/matrix",\n  json={"countries": ["Lebanon", "France", "Germany"], "dataset": "clean"})\nprint(res.json())`,
    javascript: `const res = await fetch('/api/ted/clustering/matrix', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ countries: ['Lebanon', 'France', 'Germany'], dataset: 'clean' })\n});\nconst data = await res.json();`,
  },
];

function EndpointCard({ ep }: { ep: Endpoint }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(ep.exampleBody ?? '');
  const [response, setResponse] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [snippet, setSnippet] = useState<'curl' | 'python' | 'javascript'>('curl');

  const sendRequest = async () => {
    setSending(true);
    setResponse(null);
    const t0 = performance.now();
    try {
      const opts: RequestInit = ep.method === 'POST'
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
        : {};
      const res = await fetch(ep.path, opts);
      setStatus(res.status);
      setElapsed(Math.round(performance.now() - t0));
      const text = await res.text();
      try {
        setResponse(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setResponse(text);
      }
    } catch (e) {
      setResponse(e instanceof Error ? e.message : 'Error');
      setStatus(0);
      setElapsed(Math.round(performance.now() - t0));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 text-left" onClick={() => setOpen(v => !v)}>
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${ep.method === 'GET' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
          {ep.method}
        </span>
        <span className="font-mono text-sm text-gray-700 flex-1">{ep.path}</span>
        <span className="text-xs text-gray-500 hidden sm:block">{ep.description}</span>
        {open ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 p-4 space-y-4">
          <p className="text-sm text-gray-600">{ep.description}</p>

          {/* Try it out */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase">Try it out</p>
            {ep.method === 'POST' && (
              <textarea
                className="w-full h-28 font-mono text-xs p-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300 bg-gray-50"
                value={body}
                onChange={e => setBody(e.target.value)}
              />
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={sendRequest}
                disabled={sending}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {sending ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send size={14} />}
                Send Request
              </button>
              {status !== null && (
                <span className={`text-xs font-mono ${status >= 200 && status < 300 ? 'text-accent-600' : 'text-red-600'}`}>
                  {status} · {elapsed}ms
                </span>
              )}
            </div>
            {response && (
              <pre
                className="text-xs font-mono bg-gray-950 text-gray-100 p-3 rounded-lg overflow-auto max-h-48"
                dangerouslySetInnerHTML={{ __html: syntaxHighlight(response) }}
              />
            )}
          </div>

          {/* Code snippets */}
          <div className="space-y-2">
            <div className="flex gap-2">
              {(['curl', 'python', 'javascript'] as const).map(s => (
                <button key={s} onClick={() => setSnippet(s)}
                  className={`px-3 py-1 text-xs rounded-md font-medium ${snippet === s ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'}`}>
                  {s === 'javascript' ? 'JavaScript (fetch)' : s === 'python' ? 'Python (requests)' : 'cURL'}
                </button>
              ))}
            </div>
            <pre className="text-xs font-mono bg-gray-950 text-gray-100 p-3 rounded-lg overflow-auto">
              {ep[snippet]}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export function DeveloperPage() {
  return (
    <div className="p-6 space-y-4 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Developer API</h1>
        <p className="text-sm text-gray-500 mt-1">All endpoints are proxied through Vite at <code className="bg-gray-100 px-1 rounded text-xs">localhost:3000/api/ted/*</code> → Flask at port 5001.</p>
      </div>
      {ENDPOINTS.map(ep => (
        <EndpointCard key={ep.path + ep.method} ep={ep} />
      ))}
    </div>
  );
}