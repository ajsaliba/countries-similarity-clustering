export interface SvgBarChartProps {
  data: { label: string; value: number }[];
  width?: number;
  height?: number;
  color?: string;
}

export function SvgBarChart({ data, width = 500, height = 220, color = '#3b82f6' }: SvgBarChartProps) {
  if (data.length === 0) return null;

  const paddingLeft = 40;
  const paddingRight = 16;
  const paddingTop = 16;
  const paddingBottom = 60;

  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;

  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barW = Math.max(4, (chartW / data.length) * 0.7);
  const gap = chartW / data.length;

  // Y-axis ticks
  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => (maxVal * i) / ticks);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
    >
      {/* Y-axis */}
      <line
        x1={paddingLeft}
        y1={paddingTop}
        x2={paddingLeft}
        y2={paddingTop + chartH}
        stroke="#d1d5db"
        strokeWidth={1}
      />

      {/* Y gridlines + labels */}
      {yTicks.map((tick, i) => {
        const y = paddingTop + chartH - (tick / maxVal) * chartH;
        return (
          <g key={i}>
            <line
              x1={paddingLeft}
              y1={y}
              x2={paddingLeft + chartW}
              y2={y}
              stroke="#f3f4f6"
              strokeWidth={1}
            />
            <text
              x={paddingLeft - 4}
              y={y + 4}
              textAnchor="end"
              fontSize={9}
              fill="#9ca3af"
            >
              {Math.round(tick)}
            </text>
          </g>
        );
      })}

      {/* Bars + x-labels */}
      {data.map((d, i) => {
        const barH = Math.max(1, (d.value / maxVal) * chartH);
        const x = paddingLeft + i * gap + (gap - barW) / 2;
        const y = paddingTop + chartH - barH;
        const labelX = x + barW / 2;
        const labelY = paddingTop + chartH + 8;

        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} rx={3} fill={color} opacity={0.85} />
            <text
              x={labelX}
              y={labelY}
              textAnchor="end"
              fontSize={9}
              fill="#6b7280"
              transform={`rotate(-40, ${labelX}, ${labelY})`}
            >
              {d.label.length > 12 ? d.label.slice(0, 12) + '…' : d.label}
            </text>
            <text
              x={x + barW / 2}
              y={y - 3}
              textAnchor="middle"
              fontSize={8}
              fill="#374151"
            >
              {d.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}