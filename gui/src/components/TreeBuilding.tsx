import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Play, Pause, SkipForward, RotateCcw, TreePine, FileJson, ArrowRight } from 'lucide-react';
import { TreeNode, Country, CountryPair } from '../types';
import { countries } from '../data/countries';

interface TreeBuildingProps {
  selectedCountries: Country[];
  comparisonMode: 'pair' | 'all';
  countryPairs: CountryPair[];
  loadedTrees: Record<string, TreeNode>;
  onNext: () => void;
  onPrev: () => void;
}

function makePairKey(country1: string, country2: string): string {
  return `${country1}__${country2}`;
}

function treeToXml(node: TreeNode, indent: number): { text: string; indent: number }[] {
  const lines: { text: string; indent: number }[] = [];

  if (node.children.length === 0) {
    lines.push({
      text: node.value ? `<${node.label}>${node.value}</${node.label}>` : `<${node.label}/>`,
      indent,
    });
  } else {
    lines.push({ text: `<${node.label}>`, indent });
    node.children.forEach(child => {
      lines.push(...treeToXml(child, indent + 1));
    });
    lines.push({ text: `</${node.label}>`, indent });
  }

  return lines;
}

const TreeListView: React.FC<{
  tree: TreeNode;
  visibleNodes: Set<string>;
  highlightedNode: string | null;
  accentColor?: boolean;
}> = ({ tree, visibleNodes, highlightedNode, accentColor }) => {
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [highlightedNode]);

  const rootBg = accentColor ? 'bg-accent-600 text-white' : 'bg-primary-600 text-white';
  const catBg = accentColor
    ? 'bg-accent-50 text-accent-700 border border-accent-200'
    : 'bg-primary-50 text-primary-700 border border-primary-200';
  const leafKey = accentColor ? 'text-accent-700 font-semibold' : 'text-primary-700 font-semibold';
  const leafVal = 'bg-amber-50 text-amber-700 border border-amber-200';

  const formatValue = (v: string): string => {
    const n = Number(v);
    if (isNaN(n)) return v;
    if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
    if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return n % 1 === 0 ? String(n) : n.toFixed(3);
  };

  const renderNode = (
    node: TreeNode,
    depth: number,
    isLast: boolean,
    parentPrefix: string,
  ): React.ReactNode => {
    if (!visibleNodes.has(node.id)) return null;

    const isHighlighted = highlightedNode === node.id;
    const isLeaf = node.children.length === 0;

    const connector = depth === 0 ? '' : isLast ? '└─ ' : '├─ ';
    const childPfx = depth === 0 ? '' : parentPrefix + (isLast ? '   ' : '│  ');
    const visibleChildren = node.children.filter(c => visibleNodes.has(c.id));

    return (
      <div key={node.id} className="transition-all duration-150 animate-fade-in">
        <div
          ref={isHighlighted ? highlightRef : undefined}
          className={`flex items-start gap-1 py-0.5 group ${isHighlighted ? 'bg-yellow-50 rounded-md' : ''}`}
        >
          {depth > 0 && (
            <span className="font-mono text-[11px] text-gray-300 select-none whitespace-pre shrink-0 pt-0.5">
              {parentPrefix}
              {connector}
            </span>
          )}

          {depth === 0 ? (
            <span
              className={`px-2.5 py-1 rounded-lg text-xs font-bold ${rootBg} ${
                isHighlighted ? 'ring-2 ring-yellow-400' : ''
              }`}
            >
              🌍 {node.value ?? node.label}
            </span>
          ) : isLeaf ? (
            <div
              className={`flex items-center gap-1.5 flex-wrap py-0.5 ${
                isHighlighted ? 'ring-1 ring-yellow-400 rounded px-1' : ''
              }`}
            >
              <span className={`text-[11px] font-mono ${leafKey}`}>
                {node.label.replace(/_/g, ' ')}
              </span>
              <span className="text-gray-300 text-[10px]">=</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${leafVal}`}>
                {node.value !== undefined ? formatValue(node.value) : 'null'}
              </span>
            </div>
          ) : (
            <span
              className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${catBg} ${
                isHighlighted ? 'ring-2 ring-yellow-400' : ''
              }`}
            >
              {node.label.replace(/_/g, ' ')}
              <span className="ml-1.5 text-[9px] opacity-60 font-normal">
                ({visibleChildren.length}/{node.children.length})
              </span>
            </span>
          )}
        </div>

        {node.children.map((child, i) =>
          renderNode(child, depth + 1, i === node.children.length - 1, depth === 0 ? '' : childPfx),
        )}
      </div>
    );
  };

  return <div className="font-mono text-[11px] leading-relaxed min-w-max">{renderNode(tree, 0, true, '')}</div>;
};

const XmlSourceView: React.FC<{
  tree: TreeNode;
  highlightedLine: number;
}> = ({ tree, highlightedLine }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const lines = treeToXml(tree, 0);

  useEffect(() => {
    const el = containerRef.current?.querySelector(
      `[data-line="${highlightedLine}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [highlightedLine]);

  return (
    <div ref={containerRef}>
      {lines.map((line, i) => (
        <div
          key={i}
          data-line={i + 1}
          className={`px-1 rounded ${
            Math.abs(i + 1 - highlightedLine) <= 1 ? 'bg-primary-50 text-primary-700' : 'text-gray-500'
          }`}
        >
          <span className="text-gray-400 select-none mr-2">{String(i + 1).padStart(3)}</span>
          {'  '.repeat(line.indent)}
          {line.text}
        </div>
      ))}
    </div>
  );
};

export const TreeBuilding: React.FC<TreeBuildingProps> = ({
  selectedCountries,
  comparisonMode,
  countryPairs,
  loadedTrees,
  onNext,
  onPrev,
}) => {
  const [activePairIndex, setActivePairIndex] = useState(0);
  const [buildStep, setBuildStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [visibleNodes1, setVisibleNodes1] = useState<Set<string>>(new Set());
  const [visibleNodes2, setVisibleNodes2] = useState<Set<string>>(new Set());
  const [highlightedNode, setHighlightedNode] = useState<string | null>(null);
  const [highlightedXmlLine, setHighlightedXmlLine] = useState(-1);
  const [buildComplete, setBuildComplete] = useState(false);

  const getCountryName = (code: string) =>
    countries.find(c => c.code === code)?.name ?? code;

  useEffect(() => {
    setActivePairIndex(0);
  }, [comparisonMode]);

  const pair = countryPairs[activePairIndex];

  const emptyTree: TreeNode = { id: '0', label: 'empty', children: [], depth: 0 };
  const tree1 = (pair && loadedTrees[pair.country1]) ?? emptyTree;
  const tree2 = (pair && loadedTrees[pair.country2]) ?? emptyTree;

  const collectNodeIds = useCallback((node: TreeNode): string[] => {
    return [node.id, ...node.children.flatMap(c => collectNodeIds(c))];
  }, []);

  const allNodes1 = useMemo(() => collectNodeIds(tree1), [tree1, collectNodeIds]);
  const allNodes2 = useMemo(() => collectNodeIds(tree2), [tree2, collectNodeIds]);
  const totalBuildSteps = allNodes1.length + allNodes2.length;

  useEffect(() => {
    setBuildStep(0);
    setIsPlaying(false);
    setVisibleNodes1(new Set());
    setVisibleNodes2(new Set());
    setHighlightedNode(null);
    setHighlightedXmlLine(-1);
    setBuildComplete(false);
  }, [activePairIndex, comparisonMode, pair?.country1, pair?.country2]);

  useEffect(() => {
    if (!isPlaying) return;

    const timer = setInterval(() => {
      setBuildStep(prev => {
        if (prev >= totalBuildSteps - 1) {
          setIsPlaying(false);
          setBuildComplete(true);
          return prev;
        }
        return prev + 1;
      });
    }, 600 / speed);

    return () => clearInterval(timer);
  }, [isPlaying, speed, totalBuildSteps]);

  useEffect(() => {
    const newVisible1 = new Set<string>();
    const newVisible2 = new Set<string>();

    for (let i = 0; i <= buildStep; i++) {
      if (i < allNodes1.length) newVisible1.add(allNodes1[i]);
      else newVisible2.add(allNodes2[i - allNodes1.length]);
    }

    setVisibleNodes1(newVisible1);
    setVisibleNodes2(newVisible2);

    if (buildStep < allNodes1.length) {
      setHighlightedNode(allNodes1[buildStep] ?? null);
      setHighlightedXmlLine(buildStep + 1);
    } else {
      setHighlightedNode(allNodes2[buildStep - allNodes1.length] ?? null);
      setHighlightedXmlLine(buildStep - allNodes1.length + 1);
    }
  }, [buildStep, allNodes1, allNodes2]);

  const reset = () => {
    setBuildStep(0);
    setIsPlaying(false);
    setVisibleNodes1(new Set());
    setVisibleNodes2(new Set());
    setHighlightedNode(null);
    setHighlightedXmlLine(-1);
    setBuildComplete(false);
  };

  const skipToEnd = () => {
    setBuildStep(totalBuildSteps - 1);
    setIsPlaying(false);
    setVisibleNodes1(new Set(allNodes1));
    setVisibleNodes2(new Set(allNodes2));
    setBuildComplete(true);
  };

  return (
    <div className="animate-fade-in flex flex-col h-full">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Pre-Processing: Tree Building</h2>
        <p className="text-gray-500">
          {pair
            ? `Preview the tree-building process for ${getCountryName(pair.country1)} against ${getCountryName(pair.country2)}.`
            : comparisonMode === 'pair'
            ? 'Watch how the selected country documents are converted into rooted ordered labeled trees.'
            : `Preview the tree-building process for ${selectedCountries[0]?.name ?? 'the selected country'} against the selected comparison.`}
        </p>
      </div>

      <div className="glass-card p-3 mb-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={`p-2 rounded-lg transition-colors ${
              isPlaying ? 'bg-yellow-50 text-yellow-600' : 'bg-primary-50 text-primary-600'
            }`}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>

          <button
            onClick={skipToEnd}
            className="p-2 rounded-lg bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
          >
            <SkipForward size={18} />
          </button>

          <button
            onClick={reset}
            className="p-2 rounded-lg bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
          >
            <RotateCcw size={18} />
          </button>
        </div>

        {comparisonMode === 'pair' && countryPairs.length > 1 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Pair:</span>
            {countryPairs.map((p, idx) => (
              <button
                key={makePairKey(p.country1, p.country2)}
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

        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500">
              Step {Math.min(buildStep + 1, totalBuildSteps)} of {totalBuildSteps}
            </span>
            <span className="text-xs text-gray-500">
              {buildStep < allNodes1.length ? 'Building Tree 1' : 'Building Tree 2'}
            </span>
          </div>
          <div className="h-1.5 bg-gray-200 rounded-full">
            <div
              className="h-full bg-gradient-to-r from-primary-600 to-accent-500 rounded-full transition-all duration-300"
              style={{ width: `${totalBuildSteps > 0 ? ((buildStep + 1) / totalBuildSteps) * 100 : 0}%` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Speed:</span>
          {[0.5, 1, 2, 4].map(s => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                speed === s ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-700'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3 flex-1 min-h-0">
        <div className="flex-1 glass-card p-4 flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div className="flex items-center gap-2">
              <TreePine size={14} className="text-primary-600" />
              <h3 className="text-sm font-semibold text-primary-600">
                {pair ? getCountryName(pair.country1) : 'Country 1'}
              </h3>
            </div>
            <span className="text-[10px] text-gray-400 font-mono">
              {visibleNodes1.size}/{allNodes1.length} nodes
            </span>
          </div>

          <div className="flex items-center gap-3 mb-2 shrink-0 flex-wrap">
            <span className="flex items-center gap-1 text-[9px] text-gray-500">
              <span className="px-1.5 py-0.5 rounded bg-primary-600 text-white text-[9px]">root</span>Country
            </span>
            <span className="flex items-center gap-1 text-[9px] text-gray-500">
              <span className="px-1.5 py-0.5 rounded bg-primary-50 border border-primary-200 text-primary-700 text-[9px]">cat</span>Category
            </span>
            <span className="flex items-center gap-1 text-[9px] text-gray-500">
              <span className="font-semibold text-primary-700 text-[9px]">key</span>
              <span className="text-gray-400">=</span>
              <span className="px-1 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 text-[9px]">value</span>
            </span>
          </div>

          <div className="flex-1 overflow-auto border border-gray-100 rounded-lg bg-gray-50 p-3">
            <TreeListView
              tree={tree1}
              visibleNodes={visibleNodes1}
              highlightedNode={buildStep < allNodes1.length ? highlightedNode : null}
            />
          </div>
        </div>

        <div className="w-72 glass-card p-4 flex flex-col min-h-0 shrink-0">
          <div className="flex items-center gap-2 mb-3 shrink-0">
            <FileJson size={14} className="text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-500">
              {buildStep < allNodes1.length ? 'Source (T1)' : 'Source (T2)'}
            </h3>
          </div>

          <div className="flex-1 overflow-auto bg-gray-50 border border-gray-200 rounded-lg p-3 font-mono text-[10px] leading-relaxed">
            <XmlSourceView
              tree={buildStep < allNodes1.length ? tree1 : tree2}
              highlightedLine={highlightedXmlLine}
            />
          </div>
        </div>

        <div className="flex-1 glass-card p-4 flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div className="flex items-center gap-2">
              <TreePine size={14} className="text-accent-600" />
              <h3 className="text-sm font-semibold text-accent-600">
                {pair ? getCountryName(pair.country2) : 'Country 2'}
              </h3>
            </div>
            <span className="text-[10px] text-gray-400 font-mono">
              {visibleNodes2.size}/{allNodes2.length} nodes
            </span>
          </div>

          <div className="flex items-center gap-3 mb-2 shrink-0 flex-wrap">
            <span className="flex items-center gap-1 text-[9px] text-gray-500">
              <span className="px-1.5 py-0.5 rounded bg-accent-600 text-white text-[9px]">root</span>Country
            </span>
            <span className="flex items-center gap-1 text-[9px] text-gray-500">
              <span className="px-1.5 py-0.5 rounded bg-accent-50 border border-accent-200 text-accent-700 text-[9px]">cat</span>Category
            </span>
            <span className="flex items-center gap-1 text-[9px] text-gray-500">
              <span className="font-semibold text-accent-700 text-[9px]">key</span>
              <span className="text-gray-400">=</span>
              <span className="px-1 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 text-[9px]">value</span>
            </span>
          </div>

          <div className="flex-1 overflow-auto border border-gray-100 rounded-lg bg-gray-50 p-3">
            <TreeListView
              tree={tree2}
              visibleNodes={visibleNodes2}
              highlightedNode={buildStep >= allNodes1.length ? highlightedNode : null}
              accentColor
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
        <button onClick={onPrev} className="btn-secondary">Back</button>
        <button onClick={onNext} disabled={!buildComplete} className="btn-primary flex items-center gap-2">
          Continue to Algorithm Execution
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};