import { useState } from 'react';

export interface SvgHeatmapProps {
  matrix: number[][];
  labels: string[];
  cellSize?: number;
}

function hsl(similarity: number): string {
  const h = Math.round(similarity * 120);
  return `hsl(${h}, 70%, 50%)`;
}

export function SvgHeatmap({ matrix, labels, cellSize = 20 }: SvgHeatmapProps) {
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  const n = labels.length;
  const labelPad = 80;
  const svgW = labelPad + n * cellSize;
  const svgH = labelPad + n * cellSize;

  const abbr = (s: string) => (n > 10 ? s.slice(0, 3).toUpperCase() : s);

  return (
    <div className="relative overflow-auto">
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="w-full h-auto"
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Column headers */}
        {labels.map((lbl, j) => (
          <text
            key={j}
            x={labelPad + j * cellSize + cellSize / 2}
            y={labelPad - 4}
            textAnchor="end"
            fontSize={9}
            fill="#6b7280"
            transform={`rotate(-45, ${labelPad + j * cellSize + cellSize / 2}, ${labelPad - 4})`}
          >
            {abbr(lbl)}
          </text>
        ))}

        {/* Row headers */}
        {labels.map((lbl, i) => (
          <text
            key={i}
            x={labelPad - 4}
            y={labelPad + i * cellSize + cellSize / 2 + 4}
            textAnchor="end"
            fontSize={9}
            fill="#6b7280"
          >
            {abbr(lbl)}
          </text>
        ))}

        {/* Cells */}
        {matrix.map((row, i) =>
          row.map((val, j) => (
            <rect
              key={`${i}-${j}`}
              x={labelPad + j * cellSize}
              y={labelPad + i * cellSize}
              width={cellSize - 1}
              height={cellSize - 1}
              fill={hsl(val)}
              rx={1}
              onMouseEnter={e => {
                const svgEl = (e.currentTarget as SVGRectElement).ownerSVGElement;
                const rect = svgEl?.getBoundingClientRect();
                setTooltip({
                  x: e.clientX - (rect?.left ?? 0) + 8,
                  y: e.clientY - (rect?.top ?? 0) - 24,
                  text: `${labels[i]} vs ${labels[j]}: ${val.toFixed(2)}`,
                });
              }}
            />
          )),
        )}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-gray-900 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap z-10"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}