import React, { useState, useEffect } from 'react';
import {
  Play, Pause, SkipForward, RotateCcw, ArrowRight, Cpu, Grid3X3, GitBranch,
} from 'lucide-react';
import { AlgorithmConfig, TedMatrixCell, PseudocodeLine } from '../types';
import { sampleEditOperations } from '../data/sampleTrees';
import { relabelCost } from '../services/dataService';

interface Props {
  selectedAlgorithm: AlgorithmConfig | null;
  onNext: () => void;
  onPrev: () => void;
}

// ── Label arrays for the demo TED matrix ─────────────────────────────────────
const tree1Labels = ['ε','country','name','official','capital','cap_name','cap_coord','gov','type','pres','pm'];
const tree2Labels = ['ε','country','name','official','capital','cap_name','cap_coord','gov','type','pres','pm','leg'];
const rows = tree1Labels.length - 1;
const cols = tree2Labels.length - 1;

// Build full matrix once (uses normalised numeric cost for matching labels)
function buildMatrix(): TedMatrixCell[][] {
  const m: TedMatrixCell[][] = [];
  for (let i = 0; i <= rows; i++) {
    m[i] = [];
    for (let j = 0; j <= cols; j++) {
      if (i === 0) {
        m[i][j] = { value: j, computed: true, backtrack: j > 0 ? 'left' : undefined };
      } else if (j === 0) {
        m[i][j] = { value: i, computed: true, backtrack: 'up' };
      } else {
        const rc = relabelCost(tree1Labels[i], tree2Labels[j]);
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
const fullMatrix = buildMatrix();

// Backtrack path
function buildBacktrackPath(): [number, number][] {
  const path: [number, number][] = [];
  let i = rows, j = cols;
  while (i > 0 || j > 0) {
    path.push([i, j]);
    const cell = fullMatrix[i][j];
    if (cell.backtrack === 'diagonal') { i--; j--; }
    else if (cell.backtrack === 'up') { i--; }
    else { j--; }
  }
  path.push([0, 0]);
  return path.reverse();
}
const backtrackPath = buildBacktrackPath();

// Map each animation step → pseudocode line for Chawathe
const chawatheLineMap: Record<string, number[]> = {
  matrix_init:  [2, 3],
  phase1_start: [4, 5],
  phase1_match: [7, 8, 9],
  phase1_add:   [10],
  phase2_start: [11, 12],
  phase2_check: [13, 14],
  phase2_add:   [16],
  gen_delete:   [17, 18, 19, 20],
  gen_insert:   [21, 22, 23],
  gen_update:   [24, 25, 26],
  gen_move:     [27, 28],
  done:         [29],
};

// Map each animation step → pseudocode line for Nierman
const niermanLineMap: Record<string, number[]> = {
  precompute:   [3, 4, 5, 6],
  init_matrix:  [7, 8, 9, 10],
  loop_start:   [11, 12, 13],
  forest_dist:  [14, 17, 18, 19, 20, 21, 22, 23, 24, 25],
  cell_compute: [26, 27, 28, 29, 30, 31, 32],
  forest_else:  [33, 34, 35, 36, 37],
  backtrack:    [38, 39, 40, 41, 42, 43],
};

type Phase = 'matrix' | 'backtrack' | 'editscript';

export const AlgorithmExecution: React.FC<Props> = ({
  selectedAlgorithm,
  onNext,
  onPrev,
}) => {
  const [computedCells, setComputedCells] = useState<Set<string>>(new Set());
  const [currentRow, setCurrentRow] = useState(1);
  const [currentCol, setCurrentCol] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [phase, setPhase] = useState<Phase>('matrix');
  const [backtrackStep, setBacktrackStep] = useState(0);
  const [editScriptStep, setEditScriptStep] = useState(0);
  const [recursionStack, setRecursionStack] = useState<string[]>([]);
  const [highlightedPseudoLines, setHighlightedPseudoLines] = useState<number[]>([]);
  const [complete, setComplete] = useState(false);

  const pseudocode = selectedAlgorithm?.pseudocode ?? [];

  // Initialise base row / col
  useEffect(() => {
    const init = new Set<string>();
    for (let i = 0; i <= rows; i++) init.add(`${i}-0`);
    for (let j = 0; j <= cols; j++) init.add(`0-${j}`);
    setComputedCells(init);
    setHighlightedPseudoLines(
      selectedAlgorithm?.type === 'nierman-chagathe'
        ? niermanLineMap.init_matrix
        : chawatheLineMap.matrix_init
    );
  }, [selectedAlgorithm]);

  // ── Matrix fill ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying || phase !== 'matrix') return;
    const delay = 300 / speed;
    const id = setInterval(() => {
      setComputedCells(prev => {
        const next = new Set(prev);
        next.add(`${currentRow}-${currentCol}`);
        const label1 = tree1Labels[currentRow];
        const label2 = tree2Labels[currentCol];
        const rc = relabelCost(label1, label2);
        setRecursionStack(s => [
          ...s.slice(-9),
          `TED(${label1}, ${label2}) = ${fullMatrix[currentRow][currentCol].value}` +
          (rc > 0 && rc < 1 ? ` [num cost=${rc.toFixed(2)}]` : ''),
        ]);
        // Pseudocode highlight
        if (selectedAlgorithm?.type === 'nierman-chagathe') {
          setHighlightedPseudoLines(
            currentRow <= rows / 2 ? niermanLineMap.cell_compute : niermanLineMap.forest_else
          );
        } else {
          setHighlightedPseudoLines(chawatheLineMap.phase1_match);
        }

        if (currentCol >= cols) {
          if (currentRow >= rows) {
            setIsPlaying(false);
            setPhase('backtrack');
            return next;
          }
          setCurrentRow(r => r + 1);
          setCurrentCol(1);
        } else {
          setCurrentCol(c => c + 1);
        }
        return next;
      });
    }, delay);
    return () => clearInterval(id);
  }, [isPlaying, phase, currentRow, currentCol, speed, selectedAlgorithm]);

  // ── Backtrack ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying || phase !== 'backtrack') return;
    const id = setInterval(() => {
      setHighlightedPseudoLines(
        selectedAlgorithm?.type === 'nierman-chagathe'
          ? niermanLineMap.backtrack
          : chawatheLineMap.gen_delete
      );
      setBacktrackStep(prev => {
        if (prev >= backtrackPath.length - 1) {
          setIsPlaying(false);
          setPhase('editscript');
          return prev;
        }
        return prev + 1;
      });
    }, 500 / speed);
    return () => clearInterval(id);
  }, [isPlaying, phase, speed, selectedAlgorithm]);

  // ── Edit script ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying || phase !== 'editscript') return;
    const id = setInterval(() => {
      const op = sampleEditOperations[editScriptStep];
      if (op) {
        const key = op.type === 'insert' ? 'gen_insert'
                  : op.type === 'delete' ? 'gen_delete'
                  : op.type === 'update' ? 'gen_update'
                  : 'gen_move';
        const lineMap = selectedAlgorithm?.type === 'nierman-chagathe' ? niermanLineMap : chawatheLineMap;
        setHighlightedPseudoLines(lineMap[key] ?? []);
      }
      setEditScriptStep(prev => {
        if (prev >= sampleEditOperations.length - 1) {
          setIsPlaying(false);
          setComplete(true);
          setHighlightedPseudoLines([29]);
          return prev;
        }
        return prev + 1;
      });
    }, 400 / speed);
    return () => clearInterval(id);
  }, [isPlaying, phase, speed, editScriptStep, selectedAlgorithm]);

  const skipToEnd = () => {
    const all = new Set<string>();
    for (let i = 0; i <= rows; i++)
      for (let j = 0; j <= cols; j++)
        all.add(`${i}-${j}`);
    setComputedCells(all);
    setPhase('editscript');
    setBacktrackStep(backtrackPath.length - 1);
    setEditScriptStep(sampleEditOperations.length - 1);
    setComplete(true);
    setIsPlaying(false);
    setHighlightedPseudoLines([pseudocode.length]);
  };

  const reset = () => {
    const init = new Set<string>();
    for (let i = 0; i <= rows; i++) init.add(`${i}-0`);
    for (let j = 0; j <= cols; j++) init.add(`0-${j}`);
    setComputedCells(init);
    setCurrentRow(1); setCurrentCol(1);
    setPhase('matrix');
    setBacktrackStep(0); setEditScriptStep(0);
    setRecursionStack([]); setIsPlaying(false); setComplete(false);
    setHighlightedPseudoLines(
      selectedAlgorithm?.type === 'nierman-chagathe'
        ? niermanLineMap.init_matrix : chawatheLineMap.matrix_init
    );
  };

  const phaseProgress = (() => {
    const matrixDone = rows * cols;
    if (phase === 'matrix') return ((currentRow - 1) * cols + currentCol) / matrixDone;
    if (phase === 'backtrack') return (matrixDone + backtrackStep) / (matrixDone + backtrackPath.length + sampleEditOperations.length);
    return (matrixDone + backtrackPath.length + editScriptStep) / (matrixDone + backtrackPath.length + sampleEditOperations.length);
  })();

  return (
    <div className="animate-fade-in flex flex-col h-full">
      <div className="text-center mb-3 shrink-0">
        <h2 className="text-2xl font-bold text-white mb-1">Algorithm Execution</h2>
        <p className="text-gray-400 text-sm">
          Step-by-step visualisation of <span className="text-primary-400 font-semibold">{selectedAlgorithm?.name}</span>.
          The pseudocode panel tracks which statement is currently executing.
        </p>
      </div>

      {/* Controls */}
      <div className="glass-card px-4 py-2 mb-3 flex items-center gap-3 shrink-0">
        <button
          onClick={() => setIsPlaying(v => !v)}
          className={`p-2 rounded-lg transition-colors ${isPlaying ? 'bg-yellow-900/50 text-yellow-400' : 'bg-primary-900/50 text-primary-400'}`}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button onClick={skipToEnd} className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white transition-colors">
          <SkipForward size={16} />
        </button>
        <button onClick={reset} className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white transition-colors">
          <RotateCcw size={16} />
        </button>

        {/* Phase pills */}
        <div className="flex gap-2">
          {([['matrix', 'Matrix Fill', <Grid3X3 size={11} />], ['backtrack', 'Backtrack', <GitBranch size={11} />], ['editscript', 'Edit Script', <Cpu size={11} />]] as const).map(([p, label, icon]) => (
            <div key={p} className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold ${
              phase === p ? 'bg-primary-900/60 text-primary-300 border border-primary-700'
              : complete || (p === 'backtrack' && phase === 'editscript') || (p === 'matrix' && phase !== 'matrix')
                ? 'bg-gray-800 text-gray-500' : 'bg-gray-900 text-gray-700'
            }`}>
              {icon}{label}
            </div>
          ))}
        </div>

        <div className="flex-1 mx-2">
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary-600 to-accent-500 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, phaseProgress * 100)}%` }}
            />
          </div>
        </div>

        <span className="text-xs text-gray-500">Speed:</span>
        {[0.5, 1, 2, 4].map(s => (
          <button key={s} onClick={() => setSpeed(s)}
            className={`px-2 py-0.5 rounded text-xs ${speed === s ? 'bg-primary-600 text-white' : 'bg-gray-800 text-gray-500'}`}>
            {s}x
          </button>
        ))}
      </div>

      {/* Main 3-column layout */}
      <div className="flex gap-3 flex-1 min-h-0">

        {/* ── TED Matrix ── */}
        <div className="flex-1 glass-card p-3 flex flex-col min-h-0">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 shrink-0">
            TED Matrix ({rows+1}×{cols+1}) — relabel cost: numeric=normalised diff, string=binary
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
                      const isComputed = computedCells.has(key);
                      const isCurrent = phase === 'matrix' && i === currentRow && j === currentCol;
                      const isOnPath = phase !== 'matrix' && backtrackPath.slice(0, backtrackStep + 1).some(([r, c]) => r === i && c === j);
                      const val = fullMatrix[i]?.[j]?.value;
                      return (
                        <td key={j} className={`w-9 h-7 text-center text-[10px] font-mono border border-gray-800 matrix-cell transition-all ${
                          isCurrent ? 'bg-yellow-500/25 text-yellow-300 border-yellow-600 computing'
                          : isOnPath ? 'bg-accent-500/20 text-accent-300 border-accent-700'
                          : isComputed ? 'bg-gray-800/50 text-gray-300'
                          : 'bg-gray-900/20 text-gray-700'
                        }`}>
                          {isComputed || isCurrent ? val : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Pseudocode ── */}
        <div className="w-80 glass-card p-3 flex flex-col min-h-0">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 shrink-0">
            Pseudocode — {selectedAlgorithm?.name}
          </h3>
          <div className="flex-1 overflow-auto bg-gray-950 rounded-lg p-2 font-mono text-[10px] leading-relaxed">
            {pseudocode.map(pl => (
              <PseudoLine key={pl.line} pl={pl} highlighted={highlightedPseudoLines.includes(pl.line)} />
            ))}
            {pseudocode.length === 0 && (
              <span className="text-gray-600">Select an algorithm to see pseudocode.</span>
            )}
          </div>
        </div>

        {/* ── Call stack / edit script ── */}
        <div className="w-64 flex flex-col gap-3 min-h-0">
          <div className="flex-1 glass-card p-3 flex flex-col min-h-0">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 shrink-0">
              {phase === 'editscript' ? 'Edit Script' : 'Call Stack'}
            </h3>
            <div className="flex-1 overflow-auto bg-gray-950 rounded-lg p-2 font-mono text-[10px]">
              {phase === 'editscript' ? (
                <div className="space-y-1">
                  {sampleEditOperations.slice(0, editScriptStep + 1).map((op, i) => (
                    <div key={i} className={`flex items-start gap-1.5 px-1.5 py-1 rounded ${
                      i === editScriptStep ? 'bg-primary-900/40 border border-primary-800' : 'border border-transparent'
                    }`}>
                      <span className={`text-[8px] px-1 py-0.5 rounded font-bold uppercase shrink-0 ${
                        op.type==='insert' ? 'bg-green-900/60 text-green-400'
                        : op.type==='delete' ? 'bg-red-900/60 text-red-400'
                        : op.type==='update' ? 'bg-yellow-900/60 text-yellow-400'
                        : 'bg-blue-900/60 text-blue-400'
                      }`}>{op.type}</span>
                      <span className="text-gray-300 truncate">{op.node}</span>
                      {op.from && <span className="text-gray-600 shrink-0">{op.cost.toFixed(2)}</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {recursionStack.length === 0
                    ? <span className="text-gray-600">Press ▶ to begin…</span>
                    : recursionStack.map((e, i) => (
                        <div key={i} className={i === recursionStack.length - 1 ? 'text-primary-400' : 'text-gray-700'}>{e}</div>
                      ))
                  }
                </div>
              )}
            </div>
          </div>

          {/* Stats card */}
          <div className="glass-card p-3 shrink-0">
            <div className="grid grid-cols-2 gap-2 text-center">
              {[
                { label: 'TED', value: computedCells.has(`${rows}-${cols}`) ? String(fullMatrix[rows][cols].value) : '—', color: 'text-primary-400' },
                { label: 'Similarity', value: complete ? `${Math.round((1 - fullMatrix[rows][cols].value / Math.max(rows, cols)) * 100)}%` : '—', color: 'text-accent-400' },
                { label: 'Edit Ops', value: phase === 'editscript' ? `${editScriptStep+1}/${sampleEditOperations.length}` : '—', color: 'text-yellow-400' },
                { label: 'Phase', value: phase === 'matrix' ? 'Fill' : phase === 'backtrack' ? 'Back' : 'Script', color: 'text-gray-300' },
              ].map(s => (
                <div key={s.label} className="bg-gray-800/40 rounded p-1.5">
                  <div className="text-[9px] text-gray-500 uppercase">{s.label}</div>
                  <div className={`text-sm font-bold ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-800 shrink-0">
        <button onClick={onPrev} className="btn-secondary">Back</button>
        <button onClick={onNext} disabled={!complete} className="btn-primary flex items-center gap-2">
          View Results <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};

// ── Pseudocode line renderer ──────────────────────────────────────────────────
const PseudoLine: React.FC<{ pl: PseudocodeLine; highlighted: boolean }> = ({ pl, highlighted }) => {
  if (!pl.text) return <div className="h-2" />;
  return (
    <div className={`flex items-start gap-1 px-1 py-0.5 rounded transition-all duration-150 ${
      highlighted ? 'bg-yellow-500/20 border-l-2 border-yellow-400 text-yellow-200' : 'border-l-2 border-transparent text-gray-500'
    }`}>
      <span className="text-gray-700 select-none w-4 shrink-0 text-right">{pl.line}</span>
      <span style={{ paddingLeft: `${pl.indent * 12}px` }} className="flex-1">
        <span>{pl.text}</span>
        {pl.comment && (
          <span className={`ml-2 ${highlighted ? 'text-yellow-600' : 'text-gray-700'}`}>{pl.comment}</span>
        )}
      </span>
    </div>
  );
};
