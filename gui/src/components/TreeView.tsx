import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { TreeNode } from '../types';

export interface TreeViewProps {
  node: TreeNode;
  highlightedPaths?: string[];
  highlightColor?: 'green' | 'red' | 'yellow' | 'blue';
  depth?: number;
}

const colorClasses: Record<string, string> = {
  green: 'border-l-4 border-green-500 bg-green-50',
  red: 'border-l-4 border-red-500 bg-red-50',
  yellow: 'border-l-4 border-yellow-500 bg-yellow-50',
  blue: 'border-l-4 border-blue-500 bg-blue-50',
};

function TreeNodeRow({
  node,
  highlightedPaths,
  highlightColor,
  depth,
}: {
  node: TreeNode;
  highlightedPaths: string[];
  highlightColor: string;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isHighlighted = highlightedPaths.includes(node.label) || highlightedPaths.includes(node.id);
  const hasChildren = node.children.length > 0;
  const dimmed = highlightedPaths.length > 0 && !isHighlighted && !hasChildren;

  const highlight = colorClasses[highlightColor] ?? '';

  const rowClass = [
    'flex items-start gap-1 px-2 py-0.5 rounded text-sm',
    isHighlighted ? highlight : '',
    dimmed ? 'opacity-40' : '',
  ].join(' ');

  if (!hasChildren) {
    return (
      <div className={rowClass} style={{ marginLeft: depth * 16 }}>
        <span className="text-gray-500 font-mono text-xs mt-0.5 shrink-0">—</span>
        <span className="text-gray-700 font-medium">{node.label}</span>
        {node.value !== undefined && (
          <>
            <span className="text-gray-400 mx-1">:</span>
            <span className="text-accent-700 font-mono text-xs break-all">{node.value}</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        className={[rowClass, 'w-full text-left hover:bg-gray-50 cursor-pointer'].join(' ')}
        style={{ marginLeft: depth * 16 }}
        onClick={() => setOpen(v => !v)}
      >
        <span className="shrink-0 mt-0.5 text-gray-400">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="text-gray-800 font-semibold">{node.label}</span>
        {node.value !== undefined && (
          <span className="text-gray-400 font-mono text-xs ml-1">({node.value})</span>
        )}
        <span className="ml-auto text-[10px] text-gray-400">{node.children.length} children</span>
      </button>
      {open && (
        <div>
          {node.children.map(child => (
            <TreeNodeRow
              key={child.id}
              node={child}
              highlightedPaths={highlightedPaths}
              highlightColor={highlightColor}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TreeView({
  node,
  highlightedPaths = [],
  highlightColor = 'blue',
  depth = 0,
}: TreeViewProps) {
  return (
    <div className="font-mono text-xs overflow-auto">
      <TreeNodeRow
        node={node}
        highlightedPaths={highlightedPaths}
        highlightColor={highlightColor}
        depth={depth}
      />
    </div>
  );
}