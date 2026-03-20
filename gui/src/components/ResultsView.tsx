import React, { useState, useEffect } from 'react';
import {
  ArrowRight,
  FileOutput,
  GitCompare,
  ArrowLeftRight,
  Percent,
  FileJson,
  CheckCircle2,
  XCircle,
  PlusCircle,
  Pencil,
  MoveHorizontal,
} from 'lucide-react';
import { AlgorithmConfig, EditOperation } from '../types';
import { sampleEditOperations, generateSampleMatrix } from '../data/sampleTrees';

interface ResultsViewProps {
  selectedAlgorithm: AlgorithmConfig | null;
  onNext: () => void;
  onPrev: () => void;
}

type Tab = 'similarity' | 'editscript' | 'patch' | 'diff' | 'postprocess';

export const ResultsView: React.FC<ResultsViewProps> = ({
  selectedAlgorithm,
  onNext,
  onPrev,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('similarity');
  const [patchStep, setPatchStep] = useState(0);
  const [isPatching, setIsPatching] = useState(false);

  const matrix = generateSampleMatrix(10, 11);
  const tedValue = matrix[10][11].value;
  const similarity = (1 - tedValue / Math.max(10, 11)) * 100;

  // Patching animation
  useEffect(() => {
    if (!isPatching) return;
    const timer = setInterval(() => {
      setPatchStep(prev => {
        if (prev >= sampleEditOperations.length - 1) {
          setIsPatching(false);
          return prev;
        }
        return prev + 1;
      });
    }, 600);
    return () => clearInterval(timer);
  }, [isPatching]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'similarity', label: 'Similarity Score', icon: <Percent size={14} /> },
    { id: 'editscript', label: 'Edit Script', icon: <FileOutput size={14} /> },
    { id: 'patch', label: 'Patching', icon: <GitCompare size={14} /> },
    { id: 'diff', label: 'Diff View', icon: <ArrowLeftRight size={14} /> },
    { id: 'postprocess', label: 'Post-Processing', icon: <FileJson size={14} /> },
  ];

  const getOpIcon = (type: EditOperation['type']) => {
    switch (type) {
      case 'insert': return <PlusCircle size={12} className="text-green-400" />;
      case 'delete': return <XCircle size={12} className="text-red-400" />;
      case 'update': return <Pencil size={12} className="text-yellow-400" />;
      case 'move': return <MoveHorizontal size={12} className="text-blue-400" />;
    }
  };

  return (
    <div className="animate-fade-in flex flex-col h-full">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold text-white mb-2">Results & Analysis</h2>
        <p className="text-gray-400">
          Explore the similarity score, edit script, patching process, and post-processed output.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-900/50 p-1 rounded-lg w-fit mx-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-primary-600 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        {activeTab === 'similarity' && (
          <div className="grid grid-cols-3 gap-4 h-full">
            {/* Similarity gauge */}
            <div className="col-span-1 glass-card p-6 flex flex-col items-center justify-center">
              <div className="relative w-44 h-44">
                <svg viewBox="0 0 200 200" className="w-full h-full -rotate-90">
                  <circle cx="100" cy="100" r="85" fill="none" stroke="#1f2937" strokeWidth="12" />
                  <circle
                    cx="100"
                    cy="100"
                    r="85"
                    fill="none"
                    stroke="url(#gaugeGradient)"
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray={`${(similarity / 100) * 534} 534`}
                    className="transition-all duration-1000"
                  />
                  <defs>
                    <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="100%" stopColor="#22c55e" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-4xl font-bold text-white">{similarity.toFixed(1)}%</span>
                  <span className="text-xs text-gray-500">Similarity</span>
                </div>
              </div>
              <div className="mt-4 text-center">
                <div className="text-lg font-semibold text-white">Tree Edit Distance: {tedValue}</div>
                <div className="text-sm text-gray-500 mt-1">
                  Using {selectedAlgorithm?.name || 'TED Algorithm'}
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="col-span-2 glass-card p-4 flex flex-col">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                Comparison Summary
              </h3>
              <div className="grid grid-cols-2 gap-4 flex-1">
                <StatCard label="Total Edit Operations" value={sampleEditOperations.length.toString()} color="text-yellow-400" />
                <StatCard label="Insert Operations" value={sampleEditOperations.filter(o => o.type === 'insert').length.toString()} color="text-green-400" />
                <StatCard label="Update Operations" value={sampleEditOperations.filter(o => o.type === 'update').length.toString()} color="text-blue-400" />
                <StatCard label="Delete Operations" value={sampleEditOperations.filter(o => o.type === 'delete').length.toString()} color="text-red-400" />
                <StatCard label="Tree 1 Nodes" value="18" color="text-primary-400" />
                <StatCard label="Tree 2 Nodes" value="20" color="text-accent-400" />
                <StatCard label="Matching Nodes" value="14" color="text-cyan-400" />
                <StatCard label="Cost per Operation" value="1.0" color="text-gray-300" />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'editscript' && (
          <div className="flex gap-4 h-full">
            <div className="flex-1 glass-card p-4 flex flex-col">
              <h3 className="text-sm font-semibold text-gray-400 mb-3">
                Edit Script ({sampleEditOperations.length} operations, Total cost: {sampleEditOperations.reduce((s, o) => s + o.cost, 0)})
              </h3>
              <div className="flex-1 overflow-auto space-y-1.5">
                {sampleEditOperations.map((op, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-3 bg-gray-800/30 rounded-lg border border-gray-800"
                  >
                    <span className="text-xs text-gray-600 font-mono mt-0.5 w-5">{i + 1}</span>
                    {getOpIcon(op.type)}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${
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
                        <span className="text-sm text-gray-200 font-mono">{op.node}</span>
                      </div>
                      {op.from && (
                        <div className="mt-1 text-xs">
                          <span className="text-red-400 line-through">{op.from}</span>
                          <span className="text-gray-600 mx-2">-&gt;</span>
                          <span className="text-green-400">{op.to}</span>
                        </div>
                      )}
                      {op.value && !op.from && (
                        <div className="mt-1 text-xs text-green-400">+ {op.value}</div>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-600 font-mono">cost: {op.cost}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* XML diff format */}
            <div className="w-96 glass-card p-4 flex flex-col">
              <h3 className="text-sm font-semibold text-gray-400 mb-3">Edit Script (XML Format)</h3>
              <div className="flex-1 overflow-auto bg-gray-950 rounded-lg p-3 font-mono text-[11px]">
                <pre className="text-gray-400">
{`<?xml version="1.0" encoding="UTF-8"?>
<edit_script>
  <metadata>
    <source>Lebanon</source>
    <target>France</target>
    <algorithm>${selectedAlgorithm?.name || 'TED'}</algorithm>
    <total_cost>${sampleEditOperations.reduce((s, o) => s + o.cost, 0)}</total_cost>
    <operations_count>${sampleEditOperations.length}</operations_count>
  </metadata>
  <operations>`}
                  {sampleEditOperations.map((op, i) => (
                    <div key={i} className={op.type === 'insert' ? 'text-green-400' : op.type === 'delete' ? 'text-red-400' : 'text-yellow-400'}>
{`    <${op.type} path="${op.node}" cost="${op.cost}"${op.from ? ` old="${op.from}" new="${op.to}"` : ''}${op.value && !op.from ? ` value="${op.value}"` : ''}/>`}
                    </div>
                  ))}
{`  </operations>
</edit_script>`}
                </pre>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'patch' && (
          <div className="flex gap-4 h-full">
            {/* Patching visualization */}
            <div className="flex-1 glass-card p-4 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-400">
                  Patching: Applying Edit Script to Tree 1
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setPatchStep(0);
                      setIsPatching(true);
                    }}
                    disabled={isPatching}
                    className="btn-accent text-xs py-1.5 px-3"
                  >
                    {isPatching ? `Applying ${patchStep + 1}/${sampleEditOperations.length}...` : 'Start Patching'}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-auto">
                <div className="space-y-2">
                  {sampleEditOperations.map((op, i) => {
                    const isApplied = i <= patchStep && (isPatching || patchStep === sampleEditOperations.length - 1);
                    const isCurrent = i === patchStep && isPatching;

                    return (
                      <div
                        key={i}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-300 ${
                          isCurrent
                            ? 'bg-primary-900/40 border-primary-600 ring-1 ring-primary-500/30'
                            : isApplied
                            ? 'bg-accent-900/20 border-accent-800/50'
                            : 'bg-gray-800/20 border-gray-800/50 opacity-50'
                        }`}
                      >
                        <div className="shrink-0">
                          {isApplied ? (
                            <CheckCircle2 size={16} className="text-accent-500" />
                          ) : (
                            <div className="w-4 h-4 rounded-full border border-gray-700" />
                          )}
                        </div>
                        {getOpIcon(op.type)}
                        <span className="text-sm font-mono text-gray-300">{op.node}</span>
                        {op.from && (
                          <span className="text-xs text-gray-500">
                            <span className="text-red-400">{op.from}</span> -&gt;{' '}
                            <span className="text-green-400">{op.to}</span>
                          </span>
                        )}
                        {isCurrent && (
                          <span className="ml-auto text-[10px] text-primary-400 animate-pulse">
                            Applying...
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {patchStep === sampleEditOperations.length - 1 && !isPatching && (
                <div className="mt-3 p-3 bg-accent-900/20 border border-accent-800/50 rounded-lg flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-accent-500" />
                  <span className="text-sm text-accent-400">
                    Patching complete! Tree 1 has been transformed to match Tree 2.
                  </span>
                </div>
              )}
            </div>

            {/* Before/After preview */}
            <div className="w-80 flex flex-col gap-4">
              <div className="flex-1 glass-card p-4 flex flex-col">
                <h3 className="text-sm font-semibold text-red-400 mb-2">Before (Source Tree)</h3>
                <div className="flex-1 bg-gray-950 rounded-lg p-3 font-mono text-[10px] overflow-auto">
                  <pre className="text-gray-500">{`<country>
  <common_name>Lebanon</common_name>
  <capital>
    <name>Beirut</name>
  </capital>
  <government>
    <type>Unitary parliamentary</type>
    <president>Joseph Aoun</president>
  </government>
  <economy>
    <gdp>$18.077 billion</gdp>
    <currency>Lebanese pound</currency>
  </economy>
</country>`}</pre>
                </div>
              </div>
              <div className="flex-1 glass-card p-4 flex flex-col">
                <h3 className="text-sm font-semibold text-green-400 mb-2">After (Patched Tree)</h3>
                <div className="flex-1 bg-gray-950 rounded-lg p-3 font-mono text-[10px] overflow-auto">
                  <pre className="text-gray-500">{`<country>
  <common_name>France</common_name>
  <capital>
    <name>Paris</name>
  </capital>
  <government>
    <type>Unitary semi-presidential</type>
    <president>Emmanuel Macron</president>
    <legislature>Parliament</legislature>
  </government>
  <economy>
    <gdp>$2.78 trillion</gdp>
    <currency>Euro (EUR)</currency>
    <hdi>0.903</hdi>
  </economy>
</country>`}</pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'diff' && (
          <div className="glass-card p-4 h-full flex flex-col">
            <h3 className="text-sm font-semibold text-gray-400 mb-3">
              Side-by-Side Diff View (DeltaXML-style)
            </h3>
            <div className="flex-1 overflow-auto">
              <div className="flex gap-4">
                {/* Source */}
                <div className="flex-1">
                  <h4 className="text-xs text-red-400 font-semibold mb-2">Source: Lebanon</h4>
                  <div className="bg-gray-950 rounded-lg p-3 font-mono text-[11px] space-y-0.5">
                    {diffLines.map((line, i) => (
                      <div
                        key={i}
                        className={`px-2 py-0.5 rounded ${
                          line.type === 'removed'
                            ? 'bg-red-900/20 text-red-400'
                            : line.type === 'modified'
                            ? 'bg-yellow-900/20 text-yellow-400'
                            : 'text-gray-500'
                        }`}
                      >
                        <span className="text-gray-700 mr-2">{String(i + 1).padStart(3)}</span>
                        {line.source || line.text}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Target */}
                <div className="flex-1">
                  <h4 className="text-xs text-green-400 font-semibold mb-2">Target: France</h4>
                  <div className="bg-gray-950 rounded-lg p-3 font-mono text-[11px] space-y-0.5">
                    {diffLines.map((line, i) => (
                      <div
                        key={i}
                        className={`px-2 py-0.5 rounded ${
                          line.type === 'added'
                            ? 'bg-green-900/20 text-green-400'
                            : line.type === 'modified'
                            ? 'bg-yellow-900/20 text-yellow-400'
                            : 'text-gray-500'
                        }`}
                      >
                        <span className="text-gray-700 mr-2">{String(i + 1).padStart(3)}</span>
                        {line.target || line.text}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'postprocess' && (
          <div className="flex gap-4 h-full">
            <div className="flex-1 glass-card p-4 flex flex-col">
              <h3 className="text-sm font-semibold text-gray-400 mb-3">
                Post-Processing: Tree to Wikipedia Infobox Format
              </h3>
              <p className="text-xs text-gray-500 mb-3">
                Converting the patched tree back to the original Wikipedia infobox format,
                reconstructing the semi-structured document.
              </p>
              <div className="flex-1 grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs text-primary-400 font-semibold mb-2">Patched Tree (Internal)</h4>
                  <div className="bg-gray-950 rounded-lg p-3 font-mono text-[10px] h-full overflow-auto">
                    <pre className="text-gray-500">{`TreeNode {
  label: "country"
  children: [
    TreeNode {
      label: "common_name"
      value: "France"
    }
    TreeNode {
      label: "official_name"
      value: "French Republic"
    }
    TreeNode {
      label: "capital"
      children: [
        TreeNode {
          label: "name"
          value: "Paris"
        }
        TreeNode {
          label: "coordinates"
          value: "48.86°N 2.35°E"
        }
      ]
    }
    TreeNode {
      label: "government"
      children: [
        { label: "type", value: "Unitary semi-presidential" }
        { label: "president", value: "Emmanuel Macron" }
        { label: "prime_minister", value: "François Bayrou" }
        { label: "legislature", value: "Parliament" }
      ]
    }
    ...
  ]
}`}</pre>
                  </div>
                </div>
                <div>
                  <h4 className="text-xs text-accent-400 font-semibold mb-2">Wikipedia Infobox Output</h4>
                  <div className="bg-gray-950 rounded-lg p-3 font-mono text-[10px] h-full overflow-auto">
                    <pre className="text-green-400/80">{`{{Infobox country
| common_name            = France
| official_name          = French Republic
| capital                = Paris
| coordinates            = {{coord|48.86|N|2.35|E}}
| government_type        = Unitary semi-presidential
| leader_title1          = President
| leader_name1           = Emmanuel Macron
| leader_title2          = Prime Minister
| leader_name2           = François Bayrou
| legislature            = Parliament
| area_km2               = 640,679
| area_rank              = 42nd
| population_estimate    = 68,042,591
| population_density_km2 = 106
| GDP_nominal            = $2.78 trillion
| GDP_nominal_per_capita = $40,886
| currency               = Euro (EUR)
| HDI                    = 0.903
}}`}</pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-800">
        <button onClick={onPrev} className="btn-secondary">Back</button>
        <button onClick={onNext} className="btn-primary flex items-center gap-2">
          View Summary & Complexity
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-800">
    <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
    <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
  </div>
);

type DiffLineType = 'unchanged' | 'removed' | 'added' | 'modified';
interface DiffLine {
  text?: string;
  source?: string;
  target?: string;
  type: DiffLineType;
}

const diffLines: DiffLine[] = [
  { text: '<country>', type: 'unchanged' },
  { source: '  <common_name>Lebanon</common_name>', target: '  <common_name>France</common_name>', type: 'modified' },
  { source: '  <official_name>Lebanese Republic</official_name>', target: '  <official_name>French Republic</official_name>', type: 'modified' },
  { text: '  <capital>', type: 'unchanged' },
  { source: '    <name>Beirut</name>', target: '    <name>Paris</name>', type: 'modified' },
  { source: '    <coordinates>33.89°N 35.50°E</coordinates>', target: '    <coordinates>48.86°N 2.35°E</coordinates>', type: 'modified' },
  { text: '  </capital>', type: 'unchanged' },
  { text: '  <government>', type: 'unchanged' },
  { source: '    <type>Unitary parliamentary</type>', target: '    <type>Unitary semi-presidential</type>', type: 'modified' },
  { source: '    <president>Joseph Aoun</president>', target: '    <president>Emmanuel Macron</president>', type: 'modified' },
  { source: '    <prime_minister>Nawaf Salam</prime_minister>', target: '    <prime_minister>François Bayrou</prime_minister>', type: 'modified' },
  { source: '', target: '    <legislature>Parliament</legislature>', type: 'added' },
  { text: '  </government>', type: 'unchanged' },
  { text: '  <area>', type: 'unchanged' },
  { source: '    <total_km2>10,452</total_km2>', target: '    <total_km2>640,679</total_km2>', type: 'modified' },
  { text: '  </area>', type: 'unchanged' },
  { text: '  <economy>', type: 'unchanged' },
  { source: '    <gdp>$18.077 billion</gdp>', target: '    <gdp>$2.78 trillion</gdp>', type: 'modified' },
  { source: '    <currency>Lebanese pound (LBP)</currency>', target: '    <currency>Euro (EUR)</currency>', type: 'modified' },
  { source: '', target: '    <hdi>0.903</hdi>', type: 'added' },
  { text: '  </economy>', type: 'unchanged' },
  { text: '</country>', type: 'unchanged' },
];
