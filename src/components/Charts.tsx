import { useMemo } from 'react';
import type { AnalyticsSummary } from '../lib/types';
import { formatNumber } from '../lib/format';

const SERIES_COLORS: Record<string, string> = {
  reads: '#14b8a6',
  views: '#6366f1',
  downloads: '#f59e0b',
};

type SeriesKey = 'reads' | 'views' | 'downloads';

const LABELS: Record<SeriesKey, string> = {
  reads: 'ยอดเข้าอ่าน',
  views: 'ยอดเข้าชม',
  downloads: 'ดาวน์โหลด',
};

function buildPath(values: number[], width: number, height: number, max: number) {
  if (!values.length) return { line: '', area: '' };
  const stepX = width / Math.max(1, values.length - 1);
  const points = values.map((value, index) => {
    const x = index * stepX;
    const y = height - (value / (max || 1)) * (height - 12) - 4;
    return [x, y];
  });
  let line = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i += 1) {
    const [px, py] = points[i - 1];
    const [x, y] = points[i];
    const cx = (px + x) / 2;
    line += ` C ${cx} ${py}, ${cx} ${y}, ${x} ${y}`;
  }
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  return { line, area };
}

export function TrendChart({ data, series }: { data: AnalyticsSummary['series']; series: SeriesKey[] }) {
  const width = 720;
  const height = 240;
  const max = useMemo(
    () => Math.max(4, ...data.flatMap((day) => series.map((key) => Number(day[key] ?? 0)))),
    [data, series],
  );
  const tickValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(max * ratio));
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  return (
    <div className="chart">
      <div className="chart-legend">
        {series.map((key) => (
          <span key={key} className="chart-legend-item">
            <i style={{ background: SERIES_COLORS[key] }} /> {LABELS[key]}
          </span>
        ))}
      </div>
      <div className="chart-canvas">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="กราฟแนวโน้มการใช้งาน">
          {tickValues.map((value) => {
            const y = height - (value / (max || 1)) * (height - 12) - 4;
            return (
              <g key={value}>
                <line x1="0" y1={y} x2={width} y2={y} stroke="currentColor" strokeOpacity="0.09" strokeDasharray="3 6" />
                <text x="0" y={Math.max(10, y - 5)} fontSize="9" fill="currentColor" fillOpacity="0.4">
                  {formatNumber(value)}
                </text>
              </g>
            );
          })}
          {series.map((key) => {
            const { line, area } = buildPath(
              data.map((day) => Number(day[key] ?? 0)),
              width,
              height,
              max,
            );
            const gradientId = `grad-${key}`;
            return (
              <g key={key}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES_COLORS[key]} stopOpacity="0.28" />
                    <stop offset="100%" stopColor={SERIES_COLORS[key]} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={area} fill={`url(#${gradientId})`} />
                <path d={line} fill="none" stroke={SERIES_COLORS[key]} strokeWidth="2.4" strokeLinecap="round" />
              </g>
            );
          })}
        </svg>
        <div className="chart-x-axis">
          {data.map((day, index) =>
            index % labelEvery === 0 ? (
              <span key={day.day}>{new Date(day.day).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</span>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}

export function Sparkline({ values, color = '#14b8a6' }: { values: number[]; color?: string }) {
  const width = 120;
  const height = 34;
  const max = Math.max(1, ...values);
  const stepX = width / Math.max(1, values.length - 1);
  const points = values.map((value, index) => `${index * stepX},${height - (value / max) * (height - 4) - 2}`);
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Donut({
  segments,
  total,
  caption,
}: {
  segments: { label: string; value: number; color: string }[];
  total: number;
  caption: string;
}) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 140 140" className="donut">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="16" />
        {segments.map((segment) => {
          const fraction = total ? segment.value / total : 0;
          const dash = fraction * circumference;
          const element = (
            <circle
              key={segment.label}
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth="16"
              strokeLinecap="round"
              strokeDasharray={`${Math.max(0, dash - 3)} ${circumference - Math.max(0, dash - 3)}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
            />
          );
          offset += dash;
          return element;
        })}
        <text x="70" y="66" textAnchor="middle" fontSize="20" fontWeight="600" fill="currentColor">
          {formatNumber(total)}
        </text>
        <text x="70" y="84" textAnchor="middle" fontSize="8.5" fill="currentColor" fillOpacity="0.5">
          {caption}
        </text>
      </svg>
      <div className="donut-legend">
        {segments.map((segment) => (
          <span key={segment.label}>
            <i style={{ background: segment.color }} /> {segment.label}
            <strong>{formatNumber(segment.value)}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
