import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Pause, SkipForward, RotateCcw, ArrowRight, Cpu, Grid3X3, GitBranch } from 'lucide-react';
import { AlgorithmConfig, TedMatrixCell, EditOperation } from '../types';
import { sampleTreeLebanon, sampleTreeFrance, generateSampleMatrix, sampleEditOperations } from '../data/sampleTrees';

interface AlgorithmExecutionProps {
  selectedAlgorithm: AlgorithmConfig | null;
  onNext: () => void;
  onPrev: () => void;
}

export const AlgorithmExecution: React.FC<AlgorithmExecutionProps> = ({
  selectedAlgorithm,
  onNext,
  onPrev,
}) => {
  const tree1Labels = ['', 'country', 'name', 'official', 'capital', 'cap_n', 'cap_c', 'gov', 'type', 'pres', 'pm'];
  const tree2Labels = ['', 'country', 'name', 'official', 'capital', 'cap_n', 'cap_c', 'gov', 'type', 'pres', 'pm', 'leg'];

  const rows = tree1Labels.length - 1;
  const cols = tree2Labels.length - 1;
  const fullMatrix = generateSampleMatrix(rows, cols);

  const [currentRow, setCurrentRow] = useState(0);
  const [currentCol, setCurrentCol] = useState(0);
  const [computedCells, setComputedCells] = useState<Set<string>>(new Set());
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [phase, setPhase] = useState<'matrix' | 'backtrack' | 'editscript'>('matrix');
  const [backtrackPath, setBacktrackPath] = useState<Array<[number, number]>>([]);
  const [backtrackStep, setBacktrackStep] = useState(0);
  const [editScriptStep, setEditScriptStep] = useState(0);
  const [recursionStack, setRecursionStack] = useState<string[]>([]);
  const [complete, setComplete] = useState(false);

  // Initialize base cases
  useEffect(() => {
    const initial = new Set<string>();
    for (let i = 0; i <= rows; i++) initial.add(`0-${i}`);
    for (let j = 0; j <= cols; j++) initial.add(`${j}-0`);
    setComputedCells(initial);
    setCurrentRow(1);
    setCurrentCol(1);
  }, []);

  // Compute backtrack path
  const computeBacktrackPath = useCallback(() => {
    const path: Array<[number, number]> = [];
    let i = rows;
    let j = cols;
    while (i > 0 || j > 0) {
      path.push([i, j]);
      const cell = fullMatrix[i][j];
      if (cell.backtrack === 'diagonal') { i--; j--; }
      else if (cell.backtrack === 'up') { i--; }
      else { j--; }
    }
    path.push([0, 0]);
    return path.reverse();
  }, [fullMatrix, rows, cols]);

  // Matrix filling animation
  useEffect(() => {
    if (!isPlaying || phase !== 'matrix') return;
    const timer = setInterval(() => {
      setComputedCells(prev => {
        const next = new Set(prev);
        next.add(`${currentCol}-${currentRow}`);

        // Add to recursion stack
        setRecursionStack(s => [
          ...s.slice(-8),
          `TED(T1[${currentRow}], T2[${currentCol}]) = ${fullMatrix[currentRow][currentCol].value}`,
        ]);

        if (currentCol >= cols) {
          if (currentRow >= rows) {
            setIsPlaying(false);
            setPhase('backtrack');
            setBacktrackPath(computeBacktrackPath());
            return next;
          }
          setCurrentRow(r => r + 1);
          setCurrentCol(1);
        } else {
          setCurrentCol(c => c + 1);
        }
        return next;
      });
    }, 300 / speed);
    return () => clearInterval(timer);
  }, [isPlaying, phase, currentRow, currentCol, speed, cols, rows, fullMatrix, computeBacktrackPath]);

  // Backtrack animation
  useEffect(() => {
    if (!isPlaying || phase !== 'backtrack') return;
    const timer = setInterval(() => {
      setBacktrackStep(prev => {
        if (prev >= backtrackPath.length - 1) {
          setIsPlaying(false);
          setPhase('editscript');
          return prev;
        }
        return prev + 1;
      });
    }, 500 / speed);
    return () => clearInterval(timer);
  }, [isPlaying, phase, backtrackPath, speed]);

  // Edit script animation
  useEffect(() => {
    if (!isPlaying || phase !== 'editscript') return;
    const timer = setInterval(() => {
      setEditScriptStep(prev => {
        if (prev >= sampleEditOperations.length - 1) {
          setIsPlaying(false);
          setComplete(true);
          return prev;
        }
        return prev + 1;
      });
    }, 400 / speed);
    return () => clearInterval(timer);
  }, [isPlaying, phase, speed]);

  const skipToEnd = () => {
    const allCells = new Set<string>();
    for (let i = 0; i <= rows; i++)
      for (let j = 0; j <= cols; j++)
        allCells.add(`${j}-${i}`);
    setComputedCells(allCells);
    setPhase('editscript');
    setBacktrackPath(computeBacktrackPath());
    setBacktrackStep(computeBacktrackPath().length - 1);
    setEditScriptStep(sampleEditOperations.length - 1);
    setComplete(true);
    setIsPlaying(false);
  };

  const reset = () => {
    const initial = new Set<string>();
    for (let i = 0; i <= rows; i++) initial.add(`0-${i}`);
    for (let j = 0; j <= cols; j++) initial.add(`${j}-0`);
    setComputedCells(initial);
    setCurrentRow(1);
    setCurrentCol(1);
    setPhase('matrix');
    setBacktrackPath([]);
    setBacktrackStep(0);
    setEditScriptStep(0);
    setRecursionStack([]);
    setIsPlaying(false);
    setComplete(false);
  };

  const totalSteps =
    rows * cols +
    (backtrackPath.length || rows + cols) +
    sampleEditOperations.length;
  const currentStepNum =
    phase === 'matrix'
      ? (currentRow - 1) * cols + currentCol
      : phase === 'backtrack'
      ? rows * cols + backtrackStep
      : rows * cols + (backtrackPath.length || 0) + editScriptStep;

  return (
    <div className="animate-fade-in flex flex-col h-full">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold text-white mb-2">Algorithm Execution</h2>
        <p className="text-gray-400">
          Visualizing {selectedAlgorithm?.name || 'Tree Edit Distance'} computation step by step.
        </p>
      </div>

      {/* Controls */}
      <div className="glass-card p-3 mb-4 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={`p-2 rounded-lg transition-colors ${
              isPlaying ? 'bg-yellow-900/50 text-yellow-400' : 'bg-primary-900/50 text-primary-400'
            }`}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button onClick={skipToEnd} className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white">
            <SkipForward size={18} />
          </button>
          <button onClick={reset} className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white">
            <RotateCcw size={18} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          {['matrix', 'backtrack', 'editscript'].map((p, i) => (
            <div
              key={p}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                phase === p
                  ? 'bg-primary-900/50 text-primary-400 border border-primary-700'
                  : p === 'matrix' || (p === 'backtrack' && phase !== 'matrix') || (p === 'editscript' && complete)
                  ? 'bg-gray-800 text-gray-400'
                  : 'bg-gray-900 text-gray-600'
              }`}
            >
              {p === 'matrix' && <Grid3X3 size={12} />}
              {p === 'backtrack' && <GitBranch size={12} />}
              {p === 'editscript' && <Cpu size={12} />}
              {p === 'matrix' ? 'Matrix Fill' : p === 'backtrack' ? 'Backtrack' : 'Edit Script'}
            </div>
          ))}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Speed:</span>
          {[0.5, 1, 2, 4].map(s => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-2 py-0.5 rounded text-xs ${
                speed === s ? 'bg-primary-600 text-white' : 'bg-gray-800 text-gray-500'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* TED Matrix */}
        <div className="flex-1 glass-card p-4 flex flex-col">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">
            Tree Edit Distance Matrix ({rows + 1} x {cols + 1})
          </h3>
          <div className="flex-1 overflow-auto">
            <table className="border-collapse mx-auto">
              <thead>
                <tr>
                  <th className="w-10 h-8" />
                  {tree2Labels.map((label, j) => (
                    <th
                      key={j}
                      className="w-10 h-8 text-[9px] text-gray-500 font-mono font-normal"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tree1Labels.map((label, i) => (
                  <tr key={i}>
                    <td className="w-10 h-8 text-[9px] text-gray-500 font-mono text-right pr-2">
                      {label}
                    </td>
                    {tree2Labels.map((_, j) => {
                      const key = `${j}-${i}`;
                      const isComputed = computedCells.has(key);
                      const isCurrent = phase === 'matrix' && i === currentRow && j === currentCol;
                      const isOnBacktrack =
                        phase !== 'matrix' &&
                        backtrackPath.slice(0, backtrackStep + 1).some(([r, c]) => r === i && c === j);
                      const value = fullMatrix[i]?.[j]?.value;

                      return (
                        <td
                          key={j}
                          className={`w-10 h-8 text-center text-xs font-mono border border-gray-800 matrix-cell ${
                            isCurrent
                              ? 'bg-yellow-500/30 text-yellow-300 computing border-yellow-600'
                              : isOnBacktrack
                              ? 'bg-accent-500/20 text-accent-400 border-accent-700'
                              : isComputed
                              ? 'bg-gray-800/50 text-gray-300'
                              : 'bg-gray-900/30 text-gray-700'
                          }`}
                        >
                          {isComputed || isCurrent ? value : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right panel: Recursion stack / Edit script */}
        <div className="w-80 flex flex-col gap-4">
          {/* Recursion stack */}
          <div className="flex-1 glass-card p-4 flex flex-col">
            <h3 className="text-sm font-semibold text-gray-400 mb-3">
              {phase === 'editscript' ? 'Edit Script Generation' : 'Recursive Call Stack'}
            </h3>
            <div className="flex-1 overflow-auto bg-gray-950 rounded-lg p-3 font-mono text-[11px]">
              {phase === 'editscript' ? (
                <div className="space-y-1.5">
                  {sampleEditOperations.slice(0, editScriptStep + 1).map((op, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2 p-2 rounded ${
                        i === editScriptStep
                          ? 'bg-primary-900/30 border border-primary-800'
                          : 'border border-transparent'
                      }`}
                    >
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase shrink-0 ${
                          op.type === 'insert'
                            ? 'bg-green-900/50 text-green-400'
                            : op.type === 'delete'
                            ? 'bg-red-900/50 text-red-400'
                            : op.type === 'update'
                            ? 'bg-yellow-900/50 text-yellow-400'
                            : 'bg-blue-900/50 text-blue-400'
                        }`}
                      >
                        {op.type}
                      </span>
                      <div className="text-gray-400">
                        <span className="text-gray-300">{op.node}</span>
                        {op.from && (
                          <>
                            : <span className="text-red-400 line-through">{op.from}</span>
                            {' -> '}
                            <span className="text-green-400">{op.to}</span>
                          </>
                        )}
                        {op.value && !op.from && (
                          <>
                            : <span className="text-green-400">{op.value}</span>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {recursionStack.map((entry, i) => (
                    <div
                      key={i}
                      className={`text-[10px] ${
                        i === recursionStack.length - 1 ? 'text-primary-400' : 'text-gray-600'
                      }`}
                    >
                      {entry}
                    </div>
                  ))}
                  {recursionStack.length === 0 && (
                    <span className="text-gray-600">Press Play to start...</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Status */}
          <div className="glass-card p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] text-gray-500 uppercase">Phase</div>
                <div className="text-sm font-semibold text-white capitalize">
                  {phase === 'editscript' ? 'Edit Script' : phase}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-gray-500 uppercase">TED Value</div>
                <div className="text-sm font-semibold text-primary-400">
                  {computedCells.has(`${cols}-${rows}`)
                    ? fullMatrix[rows][cols].value
                    : '...'}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-gray-500 uppercase">Edit Ops</div>
                <div className="text-sm font-semibold text-yellow-400">
                  {phase === 'editscript' ? editScriptStep + 1 : 0}/{sampleEditOperations.length}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-gray-500 uppercase">Similarity</div>
                <div className="text-sm font-semibold text-accent-400">
                  {complete
                    ? `${Math.round(
                        (1 - fullMatrix[rows][cols].value / Math.max(rows, cols)) * 100
                      )}%`
                    : '...'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-800">
        <button onClick={onPrev} className="btn-secondary">Back</button>
        <button onClick={onNext} disabled={!complete} className="btn-primary flex items-center gap-2">
          View Results
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};
