'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart as RLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// Trend chart: one line per series over pre-pivoted rows ([{ x, [series]: value }]). Client component —
// Recharts needs the DOM. Series colours are the categorical slots in fixed order of the (sorted) series
// list the server passes, so an entity keeps its colour across requests; more than eight series is
// refused upstream (the page folds or facets). One y-axis only: `percent` charts are fixed 0..1; metric
// charts are fixed 0..1 too when every value is a ratio (so rates stay comparable across charts) and
// otherwise scale to their own data. Lines are straight segments between runs: a smoothed curve would
// draw values no run ever reported.

export interface LineChartProps {
  data: Record<string, number | string | null>[];
  series: string[];
  percent?: boolean;
  height?: number;
  xKey?: string;
}

const MAX_SERIES = 8;

const fmt = (percent: boolean) => (v: unknown) => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (percent) return `${Math.round(n * 100)}%`;
  return Math.abs(n) <= 1 && !Number.isInteger(n) ? n.toFixed(3) : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
};

export function LineChart({ data, series, percent = true, height = 260, xKey = 'x' }: LineChartProps) {
  const shown = series.slice(0, MAX_SERIES);
  const f = fmt(percent);
  const values = data.flatMap((row) => shown.map((s) => row[s])).filter((v): v is number => typeof v === 'number');
  const ratio = percent || (values.length > 0 && values.every((v) => v >= 0 && v <= 1));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RLineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 11, fill: 'var(--muted)' }}
          stroke="var(--axis)"
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          domain={ratio ? [0, 1] : ['auto', 'auto']}
          tickFormatter={f}
          tick={{ fontSize: 11, fill: 'var(--muted)' }}
          stroke="var(--axis)"
          tickLine={false}
          width={percent ? 40 : 56}
        />
        <Tooltip
          formatter={(v) => f(v)}
          contentStyle={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--ink)',
          }}
          labelStyle={{ color: 'var(--ink-2)' }}
          cursor={{ stroke: 'var(--axis)' }}
        />
        {shown.length >= 2 && <Legend wrapperStyle={{ fontSize: 12, color: 'var(--ink-2)' }} />}
        {shown.map((s, i) => (
          <Line
            key={s}
            type="linear"
            dataKey={s}
            stroke={`var(--series-${i + 1})`}
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 0, fill: `var(--series-${i + 1})` }}
            activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </RLineChart>
    </ResponsiveContainer>
  );
}
