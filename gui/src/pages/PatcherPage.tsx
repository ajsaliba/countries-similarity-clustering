import { useState, useCallback, useRef } from 'react';
import { SkipBack, ChevronLeft, Play, Pause, ChevronRight, SkipForward } from 'lucide-react';
import { countries as allCountries } from '../data/countries';
import { TreeView } from '../components/TreeView';
import { EditOperation, TreeNode, BackendCompareResult } from '../types';

const PRECOMPUTED_PAIRS = [
  { label: 'France → Germany', a: 'France', b: 'Germany' },
  { label: 'Greece → Lebanon', a: 'Greece', b: 'Lebanon' },
  { label: 'Iran → Iraq', a: 'Iran', b: 'Iraq' },
  { label: 'Lebanon → France', a: 'Lebanon', b: 'France' },
  { label: 'Syria → Lebanon', a: 'Syria', b: 'Lebanon' },
  { label: 'US → CAR', a: 'United States', b: 'Central African Republic' },
  { label: 'US → China', a: 'United States', b: 'China' },
  { label: 'US → Lebanon', a: 'United States', b: 'Lebanon' },
];

const SPEEDS = [0.5, 1, 2, 4];

function deepClone(node: TreeNode): TreeNode {
  return { ...node, children: node.children.map(deepClone) };
}

function applyEditOps(tree: TreeNode, ops: EditOperation[], upTo: number): TreeNode {
  let current = deepClone(tree);
  for (let i = 0; i < Math.min(upTo, ops.length); i++) {
    const op = ops[i];
    current = applyOneOp(current, op);
  }
  return current;
}

function applyOneOp(root: TreeNode, op: EditOperation): TreeNode {
  const clone = deepClone(root);

  function walk(node: TreeNode): boolean {
    if (node.label === op.node || node.id === op.node) {
      if (op.type === 'update' && op.to !== undefined) {
        node.value = op.to;
      } else if (op.type === 'delete') {
        // Mark for removal by parent
        (node as TreeNode & { _delete?: boolean })._delete = true;
      }
      return true;
    }
    for (const child of node.children) {
      if (walk(child)) break;
    }
    node.children = node.children.filter(
      c => !(c as TreeNode & { _delete?: boolean })._delete,
    );
    return false;
  }

  walk(clone);
  return clone;
}

export function PatcherPage() {
  const [source, setSource] = useState('France');
  const [target, setTarget] = useState('Germany');
  const [ops, setOps] = useState<EditOperation[]>([]);
  const [baseTree, setBaseTree] = useState<TreeNode | null>(null);
  const [patchVerified, setPatchVerified] = useState<boolean | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loading, setLoading] = useState(false);
  const [beforeAfter, setBeforeAfter] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadPatch = useCallback(async (a: string, b: string) => {
    setLoading(true);
    setPlaying(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
    try {
      const res = await fetch('/api/ted/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country_a: a, country_b: b, dataset: 'clean' }),
      });
      if (!res.ok) throw new Error('Compare failed');
      const data = await res.json() as BackendCompareResult;
      setOps(data.edit_script ?? []);
      setBaseTree(data.tree_a ?? null);
      setPatchVerified(data.patch_verified ?? null);
      setCurrentStep(0);
      setSource(a);
      setTarget(b);
    } catch { /* offline */ }
    finally { setLoading(false); }
  }, []);

  const startPlay = () => {
    if (playing) { stopPlay(); return; }
    setPlaying(true);
    intervalRef.current = setInterval(() => {
      setCurrentStep(s => {
        if (s >= ops.length) { stopPlay(); return s; }
        return s + 1;
      });
    }, 1000 / speed);
  };

  const stopPlay = () => {
    setPlaying(false);
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  };

  const patchedTree = baseTree ? applyEditOps(baseTree, ops, currentStep) : null;
  const beforeTree = baseTree && beforeAfter ? applyEditOps(baseTree, ops, Math.max(0, currentStep - 1)) : null;
  const curOp = ops[currentStep - 1];
  const highlightedPaths = curOp ? [curOp.node] : [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Source/Target selectors */}
      <div className="shrink-0 bg-white border-b border-gray-200 p-4 flex flex-wrap gap-3 items-center">
        <select className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-300"
          value={source} onChange={e => setSource(e.target.value)}>
          {allCountries.map(c => <option key={c.code}>{c.name}</option>)}
        </select>
        <span className="text-gray-400">→</span>
        <select className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-300"
          value={target} onChange={e => setTarget(e.target.value)}>
          {allCountries.map(c => <option key={c.code}>{c.name}</option>)}
        </select>
        <button
          onClick={() => loadPatch(source, target)}
          disabled={loading}
          className="px-4 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          {loading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" /> : 'Load Patch'}
        </button>
        <select
          defaultValue=""
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none"
          onChange={e => {
            const p = PRECOMPUTED_PAIRS.find(pp => pp.label === e.target.value);
            if (p) void loadPatch(p.a, p.b);
          }}
        >
          <option value="" disabled>Load Pre-computed…</option>
          {PRECOMPUTED_PAIRS.map(p => <option key={p.label}>{p.label}</option>)}
        </select>
      </div>

      {/* Timeline player */}
      {ops.length > 0 && (
        <div className="shrink-0 bg-gray-50 border-b border-gray-200 p-4 space-y-3">
          {/* Step dots */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {ops.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentStep(i + 1)}
                className={`shrink-0 w-3 h-3 rounded-full transition-colors ${
                  i + 1 === currentStep ? 'bg-primary-600 scale-125' : i + 1 < currentStep ? 'bg-primary-300' : 'bg-gray-300'
                }`}
              />
            ))}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3 justify-center">
            <button onClick={() => { stopPlay(); setCurrentStep(0); }} className="p-1.5 rounded hover:bg-gray-200"><SkipBack size={16} /></button>
            <button onClick={() => { stopPlay(); setCurrentStep(s => Math.max(0, s - 1)); }} className="p-1.5 rounded hover:bg-gray-200"><ChevronLeft size={16} /></button>
            <button onClick={startPlay} className="p-2 rounded-full bg-primary-600 text-white hover:bg-primary-700">
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button onClick={() => { stopPlay(); setCurrentStep(s => Math.min(ops.length, s + 1)); }} className="p-1.5 rounded hover:bg-gray-200"><ChevronRight size={16} /></button>
            <button onClick={() => { stopPlay(); setCurrentStep(ops.length); }} className="p-1.5 rounded hover:bg-gray-200"><SkipForward size={16} /></button>
            <div className="flex gap-1 ml-4">
              {SPEEDS.map(s => (
                <button key={s} onClick={() => setSpeed(s)}
                  className={`px-2 py-0.5 text-xs rounded ${speed === s ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                  {s}×
                </button>
              ))}
            </div>
          </div>

          <div className="text-xs text-center text-gray-600">
            Step {currentStep} of {ops.length}
            {curOp && ` — ${curOp.type.toUpperCase()}: ${curOp.node}`}
          </div>

          <div className="flex items-center gap-2 justify-center text-xs text-gray-500">
            <span>Single</span>
            <button onClick={() => setBeforeAfter(v => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors ${beforeAfter ? 'bg-primary-600' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${beforeAfter ? 'translate-x-4' : ''}`} />
            </button>
            <span>Before/After</span>
          </div>
        </div>
      )}

      {/* Validation banner */}
      {currentStep === ops.length && ops.length > 0 && patchVerified !== null && (
        <div className={`shrink-0 px-4 py-2 text-sm font-medium text-center ${patchVerified ? 'bg-accent-50 text-accent-700 border-b border-accent-200' : 'bg-red-50 text-red-700 border-b border-red-200'}`}>
          {patchVerified ? 'Patch verified ✓ — Patched tree matches target' : 'Patch failed — trees differ'}
        </div>
      )}

      {/* Tree panel */}
      <div className="flex-1 overflow-hidden flex">
        {beforeAfter && beforeTree ? (
          <>
            <div className="flex-1 flex flex-col overflow-hidden border-r border-gray-200">
              <div className="shrink-0 px-4 py-2 bg-gray-50 text-xs font-medium text-gray-600 border-b border-gray-200">Before step {currentStep}</div>
              <div className="flex-1 overflow-auto p-3"><TreeView node={beforeTree} highlightedPaths={highlightedPaths} highlightColor="yellow" /></div>
            </div>
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="shrink-0 px-4 py-2 bg-gray-50 text-xs font-medium text-gray-600 border-b border-gray-200">After step {currentStep}</div>
              <div className="flex-1 overflow-auto p-3">{patchedTree && <TreeView node={patchedTree} highlightedPaths={highlightedPaths} highlightColor="green" />}</div>
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-auto p-4">
            {patchedTree
              ? <TreeView node={patchedTree} highlightedPaths={highlightedPaths} highlightColor={curOp?.type === 'insert' ? 'green' : curOp?.type === 'delete' ? 'red' : 'yellow'} />
              : <p className="text-sm text-gray-400 text-center py-12">Load a patch to begin</p>
            }
          </div>
        )}
      </div>
    </div>
  );
}