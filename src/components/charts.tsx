import { type LucideIcon } from "lucide-react";
import { number } from "@/lib/format";

export function Kpi({
  label,
  value,
  note,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  note: string;
  tone: "green" | "blue" | "red" | "purple";
  icon?: LucideIcon;
}) {
  return (
    <div className={`kpi kpi-${tone}`}>
      <p className="kpi-label">{label}</p>
      {Icon && <Icon className="kpi-icon" size={17} aria-hidden="true" />}
      <p className="kpi-value">{value}</p>
      <p className="kpi-note">{note}</p>
    </div>
  );
}
export type Segment = { label: string; value: number; color: string };
export function Donut({
  segments,
  primary,
  secondary,
  label,
}: {
  segments: Segment[];
  primary: string;
  secondary: string;
  label: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  let offset = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 120 120" role="img" aria-label={label}>
        <circle
          cx="60"
          cy="60"
          r="48"
          fill="none"
          stroke="#edf1f7"
          strokeWidth="13"
        />
        {segments.map((s) => {
          const length = total === 0 ? 0 : (s.value / total) * 301.593;
          const start = offset;
          offset += length;
          return (
            <circle
              key={s.label}
              cx="60"
              cy="60"
              r="48"
              fill="none"
              stroke={s.color}
              strokeWidth="13"
              strokeDasharray={`${length} ${301.593 - length}`}
              strokeDashoffset={-start}
            />
          );
        })}
      </svg>
      <div className="donut-label">
        <strong>{primary}</strong>
        <small>{secondary}</small>
      </div>
    </div>
  );
}
export function Legend({
  segments,
  suffix = "",
}: {
  segments: Segment[];
  suffix?: string;
}) {
  return (
    <div className="legend-list">
      {segments.map((s) => (
        <div key={s.label} className="legend-item">
          <span className="legend-label">
            <span className="legend-swatch" style={{ background: s.color }} />
            {s.label}
          </span>
          <span className="legend-value">
            {number(s.value)}
            {suffix}
          </span>
        </div>
      ))}
    </div>
  );
}
export function BarChart({
  rows,
  series,
  label,
}: {
  rows: { label: string; values: number[] }[];
  series: { label: string; color: string }[];
  label: string;
}) {
  const maximum = Math.max(20000, ...rows.flatMap((r) => r.values));
  const top = Math.ceil(maximum / 20000) * 20000;
  const width = 550,
    height = 180,
    left = 48,
    graphWidth = 485;
  const group = graphWidth / Math.max(rows.length, 1);
  return (
    <figure>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.label}>
            <span className="legend-swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg
        className="bar-chart"
        viewBox={`0 0 ${width} 220`}
        role="img"
        aria-label={label}
      >
        {Array.from({ length: 5 }, (_, i) => (
          <g key={i}>
            <line
              x1={left}
              x2={width - 8}
              y1={height - i * 40}
              y2={height - i * 40}
              stroke="#e7edf5"
              strokeDasharray="3 3"
            />
            <text x={left - 9} y={height - i * 40 + 3} textAnchor="end">
              {number((top * i) / 4)}
            </text>
          </g>
        ))}
        {rows.map((row, i) => (
          <g key={row.label}>
            {row.values.map((v, j) => {
              const barWidth = Math.min(14, (group - 24) / series.length);
              const x =
                left +
                i * group +
                group / 2 -
                (series.length * (barWidth + 3)) / 2 +
                j * (barWidth + 3);
              const barHeight = (Math.max(0, v) / top) * 160;
              return (
                <rect
                  key={j}
                  x={x}
                  y={height - barHeight}
                  width={barWidth}
                  height={barHeight}
                  rx="2"
                  fill={series[j]?.color || "#126ce0"}
                />
              );
            })}
            <text x={left + i * group + group / 2} y={204} textAnchor="middle">
              {row.label}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="sr-only">
        {rows
          .map(
            (r) =>
              `${r.label}: ${r.values.map((v, i) => `${series[i]?.label} ${number(v)} บาท`).join(", ")}`,
          )
          .join("; ")}
      </figcaption>
    </figure>
  );
}
