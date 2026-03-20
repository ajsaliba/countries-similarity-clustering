import React, { useState, useEffect, useCallback } from 'react';
import { Play, Pause, SkipForward, RotateCcw, TreePine, FileJson, ArrowRight } from 'lucide-react';
import { TreeNode, Country, CountryPair } from '../types';
import { sampleTreeLebanon, sampleTreeFrance } from '../data/sampleTrees';
import { countries } from '../data/countries';

interface TreeBuildingProps {
  selectedCountries: Country[];
  countryPairs: CountryPair[];
  onNext: () => void;
  onPrev: () => void;
}

export const TreeBuilding: React.FC<TreeBuildingProps> = ({
  selectedCountries,
  countryPairs,
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

  const tree1 = sampleTreeLebanon;
  const tree2 = sampleTreeFrance;

  // Collect all node IDs in order
  const collectNodeIds = useCallback((node: TreeNode): string[] => {
    return [node.id, ...node.children.flatMap(c => collectNodeIds(c))];
  }, []);

  const allNodes1 = collectNodeIds(tree1);
  const allNodes2 = collectNodeIds(tree2);
  const totalBuildSteps = allNodes1.length + allNodes2.length;

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
      if (i < allNodes1.length) {
        newVisible1.add(allNodes1[i]);
      } else {
        newVisible2.add(allNodes2[i - allNodes1.length]);
      }
    }

    setVisibleNodes1(newVisible1);
    setVisibleNodes2(newVisible2);

    // Highlight current node
    if (buildStep < allNodes1.length) {
      setHighlightedNode(allNodes1[buildStep]);
      setHighlightedXmlLine(buildStep + 1);
    } else {
      setHighlightedNode(allNodes2[buildStep - allNodes1.length]);
      setHighlightedXmlLine(buildStep - allNodes1.length + 1);
    }
  }, [buildStep, allNodes1, allNodes2]);

  const reset = () => {
    setBuildStep(0);
    setIsPlaying(false);
    setVisibleNodes1(new Set());
    setVisibleNodes2(new Set());
    setHighlightedNode(null);
    setBuildComplete(false);
  };

  const skipToEnd = () => {
    setBuildStep(totalBuildSteps - 1);
    setIsPlaying(false);
    setVisibleNodes1(new Set(allNodes1));
    setVisibleNodes2(new Set(allNodes2));
    setBuildComplete(true);
  };

  const getCountryName = (code: string) =>
    countries.find(c => c.code === code)?.name || code;

  const pair = countryPairs[activePairIndex];

  return (
    <div className="animate-fade-in flex flex-col h-full">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold text-white mb-2">Pre-Processing: Tree Building</h2>
        <p className="text-gray-400">
          Watch how XML/JSON documents are converted into rooted ordered labeled trees.
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
          <button onClick={skipToEnd} className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white transition-colors">
            <SkipForward size={18} />
          </button>
          <button onClick={reset} className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white transition-colors">
            <RotateCcw size={18} />
          </button>
        </div>

        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500">
              Step {buildStep + 1} of {totalBuildSteps}
            </span>
            <span className="text-xs text-gray-500">
              {buildStep < allNodes1.length ? 'Building Tree 1' : 'Building Tree 2'}
            </span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full">
            <div
              className="h-full bg-gradient-to-r from-primary-600 to-accent-500 rounded-full transition-all duration-300"
              style={{ width: `${((buildStep + 1) / totalBuildSteps) * 100}%` }}
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
                speed === s ? 'bg-primary-600 text-white' : 'bg-gray-800 text-gray-500 hover:text-gray-300'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Tree 1 */}
        <div className="flex-1 glass-card p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <TreePine size={14} className="text-primary-400" />
            <h3 className="text-sm font-semibold text-primary-400">
              Tree 1: {pair ? getCountryName(pair.country1) : 'Country 1'}
            </h3>
          </div>
          <div className="flex-1 overflow-auto">
            <TreeVisualization
              tree={tree1}
              visibleNodes={visibleNodes1}
              highlightedNode={buildStep < allNodes1.length ? highlightedNode : null}
            />
          </div>
        </div>

        {/* XML source */}
        <div className="w-80 glass-card p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <FileJson size={14} className="text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-400">
              {buildStep < allNodes1.length ? 'Source XML (Country 1)' : 'Source XML (Country 2)'}
            </h3>
          </div>
          <div className="flex-1 overflow-auto bg-gray-950 rounded-lg p-3 font-mono text-[11px] leading-relaxed">
            <XmlSourceView
              tree={buildStep < allNodes1.length ? tree1 : tree2}
              highlightedLine={highlightedXmlLine}
            />
          </div>
        </div>

        {/* Tree 2 */}
        <div className="flex-1 glass-card p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <TreePine size={14} className="text-accent-400" />
            <h3 className="text-sm font-semibold text-accent-400">
              Tree 2: {pair ? getCountryName(pair.country2) : 'Country 2'}
            </h3>
          </div>
          <div className="flex-1 overflow-auto">
            <TreeVisualization
              tree={tree2}
              visibleNodes={visibleNodes2}
              highlightedNode={buildStep >= allNodes1.length ? highlightedNode : null}
              accentColor
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-800">
        <button onClick={onPrev} className="btn-secondary">Back</button>
        <button onClick={onNext} disabled={!buildComplete} className="btn-primary flex items-center gap-2">
          Continue to Algorithm Execution
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};

// Tree visualization component
const TreeVisualization: React.FC<{
  tree: TreeNode;
  visibleNodes: Set<string>;
  highlightedNode: string | null;
  accentColor?: boolean;
}> = ({ tree, visibleNodes, highlightedNode, accentColor }) => {
  const renderNode = (node: TreeNode, x: number, y: number, width: number): React.ReactNode => {
    const isVisible = visibleNodes.has(node.id);
    const isHighlighted = highlightedNode === node.id;

    if (!isVisible) return null;

    const childWidth = width / Math.max(node.children.length, 1);
    const childY = y + 60;

    const baseColor = accentColor ? '#22c55e' : '#3b82f6';
    const highlightColor = '#fbbf24';

    return (
      <g key={node.id}>
        {/* Lines to children */}
        {node.children.map((child, i) => {
          if (!visibleNodes.has(child.id)) return null;
          const childX = x - width / 2 + childWidth * (i + 0.5);
          return (
            <line
              key={`line-${child.id}`}
              x1={x}
              y1={y + 16}
              x2={childX}
              y2={childY - 16}
              className={visibleNodes.has(child.id) ? 'tree-line active' : 'tree-line'}
              strokeDasharray="6 3"
            />
          );
        })}

        {/* Node */}
        <g
          className={`tree-node ${isHighlighted ? 'highlighted' : ''}`}
          style={{ opacity: isVisible ? 1 : 0 }}
        >
          <rect
            x={x - 40}
            y={y - 14}
            width={80}
            height={28}
            rx={6}
            fill={isHighlighted ? highlightColor : baseColor}
            fillOpacity={isHighlighted ? 0.3 : 0.15}
            stroke={isHighlighted ? highlightColor : baseColor}
            strokeWidth={isHighlighted ? 2 : 1}
          />
          <text
            x={x}
            y={y - 1}
            textAnchor="middle"
            fill={isHighlighted ? highlightColor : baseColor}
            fontSize="9"
            fontWeight="600"
            fontFamily="JetBrains Mono, monospace"
          >
            {node.label}
          </text>
          {node.value && (
            <text
              x={x}
              y={y + 9}
              textAnchor="middle"
              fill="#9ca3af"
              fontSize="7"
              fontFamily="Inter, sans-serif"
            >
              {node.value.length > 14 ? node.value.substring(0, 12) + '..' : node.value}
            </text>
          )}
        </g>

        {/* Render children */}
        {node.children.map((child, i) => {
          const childX = x - width / 2 + childWidth * (i + 0.5);
          return renderNode(child, childX, childY, childWidth);
        })}
      </g>
    );
  };

  return (
    <svg viewBox="0 0 500 350" className="w-full h-full" preserveAspectRatio="xMidYMin meet">
      {renderNode(tree, 250, 30, 480)}
    </svg>
  );
};

// XML source view with highlighting
const XmlSourceView: React.FC<{
  tree: TreeNode;
  highlightedLine: number;
}> = ({ tree, highlightedLine }) => {
  const lines = treeToXml(tree, 0);

  return (
    <div>
      {lines.map((line, i) => (
        <div
          key={i}
          className={`${
            Math.abs(i - highlightedLine) <= 1
              ? 'bg-primary-900/30 text-primary-300 code-highlight'
              : 'text-gray-500'
          } px-1 rounded`}
        >
          <span className="text-gray-700 select-none mr-2">{String(i + 1).padStart(3)}</span>
          <span className="text-blue-400">{'  '.repeat(line.indent)}</span>
          {line.text}
        </div>
      ))}
    </div>
  );
};

function treeToXml(node: TreeNode, indent: number): { text: string; indent: number }[] {
  const lines: { text: string; indent: number }[] = [];
  if (node.children.length === 0) {
    lines.push({
      text: node.value
        ? `<${node.label}>${node.value}</${node.label}>`
        : `<${node.label}/>`,
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
