import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Play, Pause, SkipForward, RotateCcw, ArrowRight,
  Cpu, Grid3X3, GitBranch, BarChart2, List, Loader2,
} from 'lucide-react';
import {
  SimilarityConfig, SimilarityResult, TedMatrixCell, PseudocodeLine,
  TreeNode, Country, EditOperation, CountryPair,
} from '../types';
import { sampleTreeLebanon, sampleTreeFrance } from '../data/sampleTrees';
import { algorithms } from '../data/algorithms';
import { relabelCost, filterTreeByMetrics } from '../services/dataService';
import { computeSimilarity, computeAllMethods } from '../services/similarityService';

interface Props {
  similarityConfig: SimilarityConfig;
  selectedCountries: Country[];
  countryPairs: CountryPair[];
  loadedTrees: Record<string, TreeNode>;
  onNext: () => void;
  onPrev: () => void;
}

// ── Max nodes shown in matrix (keeps it readable) ────────────────────────────
const MAX_MATRIX = 18;

// ── Helpers ───────────────────────────────────────────────────────────────────
/** For leaf nodes use the stored value as the effective TED label (matches similarityService). */
function tedNodeLabel(n: TreeNode): string {
  return n.children.length === 0 && n.value != null ? n.value : n.label;
}

function preorderLabels(node: TreeNode, max: number): string[] {
  const result: string[] = [];
  function visit(n: TreeNode) {
    if (result.length >= max) return;
    result.push(tedNodeLabel(n));
    n.children.forEach(visit);
  }
  visit(node);
  return result;
}

function buildTedMatrix(labels1: string[], labels2: string[]): TedMatrixCell[][] {
  const rows = labels1.length - 1;
  const cols = labels2.length - 1;
  const m: TedMatrixCell[][] = [];
  for (let i = 0; i <= rows; i++) {
    m[i] = [];
    for (let j = 0; j <= cols; j++) {
      if (i === 0) {
        m[i][j] = { value: j, computed: true, backtrack: j > 0 ? 'left' : undefined };
      } else if (j === 0) {
        m[i][j] = { value: i, computed: true, backtrack: 'up' };
      } else {
        const rc   = relabelCost(labels1[i], labels2[j]);
        const diag = m[i-1][j-1].value + rc;
        const left = m[i][j-1].value + 1;
        const up   = m[i-1][j].value + 1;
        const min  = Math.min(diag, left, up);
        m[i][j] = {
          value: parseFloat(min.toFixed(2)),
          computed: false,
          backtrack: min === diag ? 'diagonal' : min === up ? 'up' : 'left',
        };
      }
    }
  }
  return m;
}

function buildBacktrackPath(
  matrix: TedMatrixCell[][],
  rows: number,
  cols: number,
): [number, number][] {
  const path: [number, number][] = [];
  let i = rows, j = cols;
  while (i > 0 || j > 0) {
    path.push([i, j]);
    const c = matrix[i]?.[j];
    if (!c) break;
    if (c.backtrack === 'diagonal') { i--; j--; }
    else if (c.backtrack === 'up')  { i--; }
    else                            { j--; }
  }
  path.push([0, 0]);
  return path.reverse();
}

function deriveEditOps(
  labels1: string[],
  labels2: string[],
  matrix: TedMatrixCell[][],
): EditOperation[] {
  const ops: EditOperation[] = [];
  let i = labels1.length - 1;
  let j = labels2.length - 1;
  while (i > 0 || j > 0) {
    if (i === 0) {
      ops.unshift({ type: 'insert', node: labels2[j], cost: 1 }); j--;
    } else if (j === 0) {
      ops.unshift({ type: 'delete', node: labels1[i], cost: 1 }); i--;
    } else {
      const cell = matrix[i][j];
      if (cell.backtrack === 'diagonal') {
        if (labels1[i] !== labels2[j]) {
          const cost = parseFloat((cell.value - matrix[i-1][j-1].value).toFixed(2));
          ops.unshift({ type: 'update', node: labels1[i], to: labels2[j], cost });
        }
        i--; j--;
      } else if (cell.backtrack === 'up') {
        ops.unshift({ type: 'delete', node: labels1[i], cost: 1 }); i--;
      } else {
        ops.unshift({ type: 'insert', node: labels2[j], cost: 1 }); j--;
      }
    }
  }
  return ops;
}

// ── Pseudocode line renderer ──────────────────────────────────────────────────
const PseudoLine: React.FC<{ pl: PseudocodeLine; highlighted: boolean }> = ({ pl, highlighted }) => {
  if (!pl.text) return <div className="h-2" />;
  return (
    <div className={`flex items-start gap-1 px-1 py-0.5 rounded transition-all duration-150 ${
      highlighted ? 'bg-yellow-50 border-l-2 border-yellow-400 text-yellow-700' : 'border-l-2 border-transparent text-gray-500'
    }`}>
      <span className="text-gray-700 select-none w-4 shrink-0 text-right">{pl.line}</span>
      <span style={{ paddingLeft: `${pl.indent * 12}px` }} className="flex-1">
        <span>{pl.text}</span>
        {pl.comment && <span className={`ml-2 ${highlighted ? 'text-yellow-600' : 'text-gray-400'}`}>{pl.comment}</span>}
      </span>
    </div>
  );
};

// ── Feature panel (approximation methods) ────────────────────────────────────
const FeaturePanel: React.FC<{
  config: SimilarityConfig;
  result: SimilarityResult;
  nameA: string;
  nameB: string;
}> = ({ config, result, nameA, nameB }) => {
  const fa = result.featuresA ?? [];
  const fb = result.featuresB ?? [];
  const inA = new Set(fa);
  const inB = new Set(fb);
  const both = new Set([...fa, ...fb]);

  return (
    <div className="flex gap-3 flex-1 min-h-0">
      {[{ label: `A (${nameA})`, feats: fa, other: inB }, { label: `B (${nameB})`, feats: fb, other: inA }].map(({ label, feats, other }) => (
        <div key={label} className="flex-1 glass-card p-3 flex flex-col min-h-0">
          <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2 shrink-0">
            Tree {label}
            <span className="ml-2 text-[10px] font-normal text-gray-400">({feats.length} features)</span>
          </h4>
          <div className="flex-1 overflow-auto space-y-0.5">
            {feats.slice(0, 60).map((f: string, i: number) => (
              <div key={i} className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                other.has(f) ? 'text-accent-600 bg-accent-50' : 'text-gray-500'
              }`}>
                {f}
              </div>
            ))}
            {feats.length > 60 && (
              <div className="text-[9px] text-gray-400 px-1.5">…{feats.length - 60} more</div>
            )}
          </div>
        </div>
      ))}

      <div className="w-56 flex flex-col gap-3">
        <div className="glass-card p-3">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Overlap</h4>
          <div className="space-y-1.5 text-[10px]">
            <div className="flex justify-between"><span className="text-gray-500">|A| features</span><span className="text-gray-900 font-mono">{fa.length}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">|B| features</span><span className="text-gray-900 font-mono">{fb.length}</span></div>
            <div className="flex justify-between"><span className="text-accent-600">|A ∩ B|</span><span className="text-accent-700 font-mono">{[...inA].filter(x => inB.has(x)).length}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">|A ∪ B|</span><span className="text-gray-900 font-mono">{both.size}</span></div>
          </div>
        </div>

        <div className="glass-card p-3">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Formula</h4>
          <div className="font-mono text-[10px] bg-gray-100 p-2 rounded text-yellow-600 border border-gray-200 mb-2">
            {config.approxVariant === 'vector'
              ? config.approxMeasure === 'cosine'    ? 'A·B / (|A|·|B|)'
              : config.approxMeasure === 'pcc'       ? 'Σ(Ai−Ā)(Bi−B̄) / σAσB'
              : config.approxMeasure === 'euclidean' ? '1 / (1+√Σ(Ai−Bi)²)'
              : config.approxMeasure === 'manhattan' ? '1 / (1+Σ|Ai−Bi|)'
              : config.approxMeasure === 'tanimoto'  ? 'A·B / (|A|²+|B|²−A·B)'
              :                                        '2(A·B) / (|A|²+|B|²)'
              : config.approxMeasure === 'jaccard'   ? '|A∩B| / |A∪B|'
              : config.approxMeasure === 'dice'      ? '2|A∩B| / (|A|+|B|)'
              :                                        '|A∩B| / max(|A|,|B|)'}
          </div>
          <div className="text-center">
            <div className="text-[9px] text-gray-500 uppercase mb-1">Similarity</div>
            <div className="text-2xl font-bold text-accent-600">
              {(result.sim * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── All-methods comparison table ──────────────────────────────────────────────
const CompareTable: React.FC<{ results: SimilarityResult[]; active: string }> = ({ results, active }) => (
  <div className="overflow-auto">
    <table className="w-full text-[10px]">
      <thead>
        <tr className="border-b border-gray-200">
          <th className="text-left py-1.5 px-2 text-gray-500 font-semibold">Method</th>
          <th className="text-right py-1.5 px-2 text-gray-500 font-semibold w-16">Sim</th>
          <th className="py-1.5 px-2 w-28 text-gray-500 font-semibold">Bar</th>
        </tr>
      </thead>
      <tbody>
        {results.map(r => (
          <tr key={r.label} className={`border-b border-gray-100 ${r.label === active ? 'bg-primary-50' : ''}`}>
            <td className={`py-1 px-2 font-mono ${r.label === active ? 'text-primary-700' : 'text-gray-500'}`}>{r.label}</td>
            <td className="py-1 px-2 text-right font-bold text-gray-900 tabular-nums">{(r.sim * 100).toFixed(1)}%</td>
            <td className="py-1 px-2">
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${r.label === active ? 'bg-primary-500' : 'bg-gray-400'}`}
                  style={{ width: `${r.sim * 100}%` }}
                />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

type Phase = 'matrix' | 'backtrack' | 'editscript' | 'done';

// Pseudocode line maps
const chawatheLineMap: Record<string, number[]> = {
  matrix_init: [2,3], phase1_start:[4,5], phase1_match:[7,8,9], phase1_add:[10],
  phase2_start:[11,12], phase2_check:[13,14], phase2_add:[16],
  gen_delete:[17,18,19,20], gen_insert:[21,22,23], gen_update:[24,25,26], gen_move:[27,28], done:[29],
};
const niermanLineMap: Record<string, number[]> = {
  precompute:[3,4,5,6], init_matrix:[7,8,9,10], loop_start:[11,12,13],
  forest_dist:[14,17,18,19,20,21,22,23,24,25], cell_compute:[26,27,28,29,30,31,32],
  forest_else:[33,34,35,36,37], backtrack:[38,39,40,41,42,43],
};
const zhangShashaLineMap: Record<string, number[]> = {
  matrix_init:[3,4,5,6,7,8,9], precompute:[3,4,5,6,7,8], loop_start:[11,12,13],
  cell_compute:[23,24,25,26,27,28,29], forest_else:[30,31,32,33,34],
  gen_delete:[36,37,38,39], gen_insert:[36,37,38,39], gen_update:[36,37,38,39],
  backtrack:[35,36,37,38,39,40], done:[40],
};

// ── Main component ─────────────────────────────────────────────────────────────
export const AlgorithmExecution: React.FC<Props> = ({
  similarityConfig, selectedCountries, countryPairs, loadedTrees, onNext, onPrev,
}) => {
  // ── Pair selector ─────────────────────────────────────────────────────────
  const [activePairIndex, setActivePairIndex] = useState(0);

  const activePair = countryPairs[activePairIndex] ?? null;

  // ── Resolve trees (real data or demo fallback), filtered to selected metrics ─
  const T1 = useMemo<TreeNode>(() => {
    let raw: TreeNode;
    if (activePair && loadedTrees[activePair.country1]) raw = loadedTrees[activePair.country1];
    else { const c = selectedCountries[0]; raw = (c && loadedTrees[c.code]) ?? sampleTreeLebanon; }
    const sel = activePair?.selectedMetrics ?? [];
    return sel.length > 0 ? filterTreeByMetrics(raw, sel) : raw;
  }, [activePair, loadedTrees, selectedCountries]);

  const T2 = useMemo<TreeNode>(() => {
    let raw: TreeNode;
    if (activePair && loadedTrees[activePair.country2]) raw = loadedTrees[activePair.country2];
    else { const c = selectedCountries[1]; raw = (c && loadedTrees[c.code]) ?? sampleTreeFrance; }
    const sel = activePair?.selectedMetrics ?? [];
    return sel.length > 0 ? filterTreeByMetrics(raw, sel) : raw;
  }, [activePair, loadedTrees, selectedCountries]);

  const getCountryName = (code: string) =>
    selectedCountries.find(c => c.code === code)?.name ?? code;

  const usingRealData = activePair
    ? !!(loadedTrees[activePair.country1] && loadedTrees[activePair.country2])
    : !!(selectedCountries[0] && loadedTrees[selectedCountries[0].code] &&
         selectedCountries[1] && loadedTrees[selectedCountries[1].code]);

  const nameA = activePair
    ? (loadedTrees[activePair.country1] ? getCountryName(activePair.country1) : `${activePair.country1} (demo)`)
    : (usingRealData ? selectedCountries[0]?.name : 'Lebanon (demo)');
  const nameB = activePair
    ? (loadedTrees[activePair.country2] ? getCountryName(activePair.country2) : `${activePair.country2} (demo)`)
    : (usingRealData ? selectedCountries[1]?.name : 'France (demo)');

  // ── Derive matrix inputs from actual trees ────────────────────────────────
  const tree1Labels = useMemo(() => ['ε', ...preorderLabels(T1, MAX_MATRIX)], [T1]);
  const tree2Labels = useMemo(() => ['ε', ...preorderLabels(T2, MAX_MATRIX)], [T2]);
  const ROWS = tree1Labels.length - 1;
  const COLS = tree2Labels.length - 1;
  const fullMatrix    = useMemo(() => buildTedMatrix(tree1Labels, tree2Labels), [tree1Labels, tree2Labels]);
  const backtrackPath = useMemo(() => buildBacktrackPath(fullMatrix, ROWS, COLS), [fullMatrix, ROWS, COLS]);
  const editOps       = useMemo(() => deriveEditOps(tree1Labels, tree2Labels, fullMatrix), [tree1Labels, tree2Labels, fullMatrix]);

  // ── Algorithm metadata ────────────────────────────────────────────────────
  const isTED    = similarityConfig.category === 'ted';
  const lineMap  = similarityConfig.tedMethod === 'nierman'
    ? niermanLineMap
    : similarityConfig.tedMethod === 'zhang-shasha'
      ? zhangShashaLineMap
      : chawatheLineMap;
  const algoData = algorithms.find(a =>
    similarityConfig.tedMethod === 'nierman'
      ? a.type === 'nierman-chagathe'
      : similarityConfig.tedMethod === 'zhang-shasha'
        ? a.type === 'zhang-shasha'
        : a.type === 'chawathe',
  ) ?? algorithms[0];
  const pseudocode = isTED ? (algoData?.pseudocode ?? []) : [];

  // ── Similarity results ────────────────────────────────────────────────────
  const [liveResult, setLiveResult] = useState<SimilarityResult | null>(null);
  const [allResults, setAllResults] = useState<SimilarityResult[] | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [loadingCompare, setLoadingCompare] = useState(false);

  const selectedMetrics = activePair?.selectedMetrics ?? [];

  useEffect(() => {
    // T1 and T2 are already filtered by selectedMetrics (see useMemo above)
    setLiveResult(computeSimilarity(T1, T2, similarityConfig));
    setAllResults(null);
  }, [T1, T2, similarityConfig]);

  const handleCompareAll = () => {
    if (allResults) {
      setShowCompare(v => !v);
      return;
    }
    setLoadingCompare(true);
    setShowCompare(true);
    setTimeout(() => {
      // T1/T2 already filtered; pass empty selectedMetrics to avoid double-filtering
      const results = computeAllMethods(T1, T2);
      setAllResults(results);
      setLoadingCompare(false);
    }, 0);
  };

  // ── TED animation state ───────────────────────────────────────────────────
  const [computedCells, setComputedCells]   = useState<Set<string>>(new Set());
  const [currentRow, setCurrentRow]         = useState(1);
  const [currentCol, setCurrentCol]         = useState(1);
  const [isPlaying, setIsPlaying]           = useState(false);
  const [speed, setSpeed]                   = useState(1);
  const [phase, setPhase]                   = useState<Phase>('matrix');
  const [backtrackStep, setBacktrackStep]   = useState(0);
  const [editScriptStep, setEditScriptStep] = useState(0);
  const [callStack, setCallStack]           = useState<string[]>([]);
  const [highlighted, setHighlighted]       = useState<number[]>([]);
  const [complete, setComplete]             = useState(false);

  // ── Ref-based animation state (avoids stale closures / double-advance) ────
  const animRef = useRef({
    row: 1, col: 1, btStep: 0, esStep: 0, animPhase: 'matrix' as Phase,
  });

  // Derived values ref — updated synchronously at render time (no hook needed)
  const derivedRef = useRef({
    ROWS: 0, COLS: 0,
    tree1Labels: [] as string[],
    tree2Labels: [] as string[],
    fullMatrix: [] as TedMatrixCell[][],
    backtrackPath: [] as [number, number][],
    editOps: [] as EditOperation[],
    lineMap: chawatheLineMap as Record<string, number[]>,
  });
  // Update synchronously during render
  derivedRef.current = { ROWS, COLS, tree1Labels, tree2Labels, fullMatrix, backtrackPath, editOps, lineMap };

  // Reset animation when trees or config change
  useEffect(() => {
    const init = new Set<string>();
    for (let i = 0; i <= ROWS; i++) init.add(`${i}-0`);
    for (let j = 0; j <= COLS; j++) init.add(`0-${j}`);
    setComputedCells(init);
    setHighlighted(lineMap.matrix_init ?? lineMap.init_matrix ?? []);
    setPhase('matrix'); setComplete(false);
    setCurrentRow(1); setCurrentCol(1);
    setBacktrackStep(0); setEditScriptStep(0);
    setCallStack([]); setIsPlaying(false);
    Object.assign(animRef.current, { row: 1, col: 1, btStep: 0, esStep: 0, animPhase: 'matrix' as Phase });
  }, [similarityConfig, ROWS, COLS, lineMap]);

  // Single animation effect — ONLY depends on isPlaying and speed
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      const a = animRef.current;
      const d = derivedRef.current;
      const p = a.animPhase;

      if (p === 'matrix') {
        const { row, col } = a;
        setComputedCells(prev => {
          const next = new Set(prev);
          next.add(`${row}-${col}`);
          return next;
        });
        setCallStack(s => [
          ...s.slice(-9),
          `TED(${d.tree1Labels[row] ?? '?'}, ${d.tree2Labels[col] ?? '?'}) = ${d.fullMatrix[row]?.[col]?.value ?? '?'}`,
        ]);
        setHighlighted(
          row <= d.ROWS / 2
            ? (d.lineMap.cell_compute ?? d.lineMap.phase1_match ?? [])
            : (d.lineMap.forest_else ?? d.lineMap.phase1_match ?? []),
        );
        if (col >= d.COLS) {
          if (row >= d.ROWS) {
            a.animPhase = 'backtrack';
            setPhase('backtrack');
            setIsPlaying(false);
          } else {
            a.row = row + 1;
            a.col = 1;
            setCurrentRow(a.row);
            setCurrentCol(a.col);
          }
        } else {
          a.col = col + 1;
          setCurrentCol(a.col);
        }
      } else if (p === 'backtrack') {
        setHighlighted(d.lineMap.backtrack ?? d.lineMap.gen_delete ?? []);
        const next = a.btStep + 1;
        if (next >= d.backtrackPath.length) {
          a.animPhase = 'editscript';
          setPhase('editscript');
          setIsPlaying(false);
        } else {
          a.btStep = next;
          setBacktrackStep(next);
        }
      } else if (p === 'editscript') {
        const op = d.editOps[a.esStep];
        if (op) {
          const k = op.type === 'insert' ? 'gen_insert'
            : op.type === 'delete' ? 'gen_delete'
            : op.type === 'update' ? 'gen_update'
            : 'gen_move';
          setHighlighted(d.lineMap[k] ?? []);
        }
        const next = a.esStep + 1;
        if (next >= d.editOps.length) {
          a.animPhase = 'done';
          setIsPlaying(false);
          setComplete(true);
          setHighlighted([29]);
        } else {
          a.esStep = next;
          setEditScriptStep(next);
        }
      }
    }, 280 / speed);
    return () => clearInterval(id);
  }, [isPlaying, speed]);

  const skipToEnd = () => {
    const all = new Set<string>();
    for (let i = 0; i <= ROWS; i++) for (let j = 0; j <= COLS; j++) all.add(`${i}-${j}`);
    setComputedCells(all);
    setPhase('editscript'); setBacktrackStep(backtrackPath.length - 1);
    setEditScriptStep(editOps.length - 1); setComplete(true); setIsPlaying(false);
    Object.assign(animRef.current, {
      row: ROWS, col: COLS, btStep: backtrackPath.length - 1,
      esStep: editOps.length - 1, animPhase: 'done' as Phase,
    });
  };

  const reset = () => {
    const init = new Set<string>();
    for (let i = 0; i <= ROWS; i++) init.add(`${i}-0`);
    for (let j = 0; j <= COLS; j++) init.add(`0-${j}`);
    setComputedCells(init); setCurrentRow(1); setCurrentCol(1);
    setPhase('matrix'); setBacktrackStep(0); setEditScriptStep(0);
    setCallStack([]); setIsPlaying(false); setComplete(false);
    setHighlighted(lineMap.matrix_init ?? lineMap.init_matrix ?? []);
    Object.assign(animRef.current, { row: 1, col: 1, btStep: 0, esStep: 0, animPhase: 'matrix' as Phase });
  };

  const phaseProgress = (() => {
    const matDone = ROWS * COLS;
    if (phase === 'matrix')    return ((currentRow - 1) * COLS + currentCol) / matDone;
    if (phase === 'backtrack') return (matDone + backtrackStep) / (matDone + backtrackPath.length + editOps.length);
    return (matDone + backtrackPath.length + editScriptStep) / (matDone + backtrackPath.length + editOps.length);
  })();

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in flex flex-col h-full">
      <div className="text-center mb-3 shrink-0">
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Algorithm Execution</h2>
        <p className="text-gray-600 text-sm">
          {nameA} vs {nameB}
          {!usingRealData && <span className="ml-1 text-yellow-600 text-xs">(demo — load data to use real trees)</span>}
          {' · '}<span className="text-primary-600 font-semibold">{liveResult?.label}</span>
          {liveResult && <span className="ml-2 text-accent-600 font-bold">Sim = {(liveResult.sim * 100).toFixed(1)}%</span>}
        </p>
      </div>

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div className="glass-card px-4 py-2 mb-3 flex items-center gap-3 shrink-0 flex-wrap">
        {/* Pair selector */}
        {countryPairs.length > 1 && (
          <div className="flex items-center gap-1.5 mr-2">
            <span className="text-xs text-gray-500">Pair:</span>
            {countryPairs.map((p, idx) => (
              <button
                key={idx}
                onClick={() => setActivePairIndex(idx)}
                className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                  activePairIndex === idx
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-500 hover:text-gray-700'
                }`}
              >
                {p.country1}/{p.country2}
              </button>
            ))}
          </div>
        )}

        {isTED && (
          <>
            <button onClick={() => setIsPlaying(v => !v)}
              className={`p-2 rounded-lg transition-colors ${isPlaying ? 'bg-yellow-50 text-yellow-600' : 'bg-primary-50 text-primary-600'}`}>
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button onClick={skipToEnd} className="p-2 rounded-lg bg-gray-100 text-gray-500 hover:text-gray-700">
              <SkipForward size={15} />
            </button>
            <button onClick={reset} className="p-2 rounded-lg bg-gray-100 text-gray-500 hover:text-gray-700">
              <RotateCcw size={15} />
            </button>
            <div className="flex gap-1.5">
              {(['matrix','backtrack','editscript'] as Phase[]).map((p, idx) => {
                const icons = [<Grid3X3 size={10} key="g" />, <GitBranch size={10} key="b" />, <Cpu size={10} key="c" />];
                const labels = ['Matrix Fill', 'Backtrack', 'Edit Script'];
                return (
                  <div key={p} className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold ${
                    phase === p ? 'bg-primary-50 text-primary-700 border border-primary-300' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {icons[idx]}{labels[idx]}
                  </div>
                );
              })}
            </div>
            <div className="flex-1 mx-1">
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-primary-600 to-accent-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, phaseProgress * 100)}%` }} />
              </div>
            </div>
            <span className="text-xs text-gray-500">Speed:</span>
            {[0.5,1,2,4].map(s => (
              <button key={s} onClick={() => setSpeed(s)}
                className={`px-2 py-0.5 rounded text-xs ${speed === s ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                {s}x
              </button>
            ))}
          </>
        )}

        <button
          onClick={handleCompareAll}
          className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
            showCompare ? 'bg-accent-50 border-accent-400 text-accent-700' : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-400'
          }`}
        >
          {loadingCompare ? <Loader2 size={13} className="animate-spin" /> : <BarChart2 size={13} />}
          {allResults ? 'Toggle Comparison' : 'Compare All Methods'}
        </button>
      </div>

      {/* ── Compare panel ─────────────────────────────────────────────────── */}
      {showCompare && (
        <div className="glass-card p-3 mb-3 shrink-0 max-h-56 overflow-hidden">
          <div className="flex items-center gap-2 mb-2">
            <List size={12} className="text-gray-500" />
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
              All Methods — {nameA} vs {nameB}
            </h3>
          </div>
          {loadingCompare ? (
            <div className="flex items-center justify-center py-6 gap-2 text-gray-500 text-xs">
              <Loader2 size={14} className="animate-spin" />
              Computing all methods…
            </div>
          ) : allResults ? (
            <CompareTable results={allResults} active={liveResult?.label ?? ''} />
          ) : null}
        </div>
      )}

      {/* ── Main area ─────────────────────────────────────────────────────── */}
      {isTED ? (
        <div className="flex gap-3 flex-1 min-h-0">
          {/* Matrix */}
          <div className="flex-1 glass-card p-3 flex flex-col min-h-0 min-w-0">
            <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2 shrink-0">
              TED Matrix ({ROWS+1}×{COLS+1}) — showing first {MAX_MATRIX} nodes per tree
            </h3>
            <div className="flex-1 overflow-auto">
              <table className="border-collapse mx-auto text-center">
                <thead>
                  <tr>
                    <th className="w-8 h-7" />
                    {tree2Labels.map((lbl, j) => (
                      <th key={j} className="w-9 h-7 text-[9px] text-gray-500 font-mono font-normal">{lbl}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tree1Labels.map((lbl, i) => (
                    <tr key={i}>
                      <td className="w-8 h-7 text-[9px] text-gray-500 font-mono text-right pr-1">{lbl}</td>
                      {tree2Labels.map((_, j) => {
                        const key = `${i}-${j}`;
                        const isComp = computedCells.has(key);
                        const isCurr = phase === 'matrix' && i === currentRow && j === currentCol;
                        const isPath = phase !== 'matrix' && backtrackPath.slice(0, backtrackStep + 1).some(([r,c]) => r===i && c===j);
                        const val = fullMatrix[i]?.[j]?.value;
                        return (
                          <td key={j} className={`w-9 h-7 text-center text-[10px] font-mono border border-gray-200 transition-all ${
                            isCurr ? 'bg-yellow-100 text-yellow-800 border-yellow-400'
                            : isPath ? 'bg-accent-100 text-accent-800 border-accent-400'
                            : isComp ? 'bg-gray-50 text-gray-700'
                            : 'bg-white text-gray-300'
                          }`}>
                            {isComp || isCurr ? val : ''}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pseudocode */}
          <div className="w-72 glass-card p-3 flex flex-col min-h-0">
            <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2 shrink-0">
              Pseudocode — {algoData?.name}
            </h3>
            <div className="flex-1 overflow-auto bg-gray-50 border border-gray-200 rounded-lg p-2 font-mono text-[10px] leading-relaxed">
              {pseudocode.map(pl => (
                <PseudoLine key={pl.line} pl={pl} highlighted={highlighted.includes(pl.line)} />
              ))}
            </div>
          </div>

          {/* Call stack / edit script */}
          <div className="w-56 flex flex-col gap-3 min-h-0">
            <div className="flex-1 glass-card p-3 flex flex-col min-h-0">
              <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2 shrink-0">
                {phase === 'editscript' ? 'Edit Script' : 'Call Stack'}
              </h3>
              <div className="flex-1 overflow-auto bg-gray-50 border border-gray-200 rounded-lg p-2 font-mono text-[10px]">
                {phase === 'editscript' ? (
                  <div className="space-y-1">
                    {editOps.slice(0, editScriptStep + 1).map((op, i) => (
                      <div key={i} className={`flex items-start gap-1.5 px-1.5 py-1 rounded ${i === editScriptStep ? 'bg-primary-50 border border-primary-200' : ''}`}>
                        <span className={`text-[8px] px-1 py-0.5 rounded font-bold uppercase shrink-0 ${
                          op.type==='insert' ? 'bg-green-100 text-green-700'
                          : op.type==='delete' ? 'bg-red-100 text-red-700'
                          : op.type==='update' ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-blue-100 text-blue-700'
                        }`}>{op.type}</span>
                        <span className="text-gray-700 truncate">{op.node}{op.to ? ` → ${op.to}` : ''}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {callStack.length === 0
                      ? <span className="text-gray-400">Press ▶ to begin…</span>
                      : callStack.map((e, i) => (
                          <div key={i} className={i === callStack.length-1 ? 'text-primary-600 font-semibold' : 'text-gray-500'}>{e}</div>
                        ))}
                  </div>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="glass-card p-3 shrink-0">
              <div className="grid grid-cols-2 gap-2 text-center">
                {[
                  { label:'TED', value: computedCells.has(`${ROWS}-${COLS}`) ? String(fullMatrix[ROWS]?.[COLS]?.value) : '—', color:'text-primary-600' },
                  { label:'Sim', value: liveResult ? `${(liveResult.sim*100).toFixed(1)}%` : '—', color:'text-accent-600' },
                  { label:'Ops', value: phase==='editscript' ? `${editScriptStep+1}/${editOps.length}` : '—', color:'text-yellow-600' },
                  { label:'Phase', value: phase==='matrix'?'Fill':phase==='backtrack'?'Back':phase==='editscript'?'Script':'Done', color:'text-gray-700' },
                ].map(s => (
                  <div key={s.label} className="bg-gray-50 border border-gray-200 rounded p-1.5">
                    <div className="text-[9px] text-gray-500 uppercase">{s.label}</div>
                    <div className={`text-sm font-bold ${s.color}`}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        liveResult && <FeaturePanel config={similarityConfig} result={liveResult} nameA={nameA ?? ''} nameB={nameB ?? ''} />
      )}

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-200 shrink-0">
        <button onClick={onPrev} className="btn-secondary">Back</button>
        <div className="flex items-center gap-2">
          {isTED && !complete && (
            <button
              onClick={() => { skipToEnd(); onNext(); }}
              className="btn-secondary flex items-center gap-2 text-gray-600"
            >
              Skip &amp; Continue <ArrowRight size={14} />
            </button>
          )}
          <button
            onClick={onNext}
            disabled={isTED && !complete}
            className="btn-primary flex items-center gap-2"
          >
            View Results <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};