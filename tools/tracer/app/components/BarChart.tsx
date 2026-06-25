'use client';

import {
  Bar,
  BarChart as RBarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// Per-model pass-rate bars for /compare. Client component — Recharts needs the DOM.

export interface BarChartProps {
  data: { model: string; pass_rate: number | null }[];
}

const color = (rate: number | null) => (rate == null ? '#9ca3af' : rate >= 0.9 ? '#16a34a' : rate >= 0.75 ? '#ca8a04' : '#dc2626');

export function BarChart({ data }: BarChartProps) {
  const rows = data.map((d) => ({ ...d, pct: d.pass_rate == null ? 0 : d.pass_rate }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <RBarChart data={rows} margin={{ top: 16, right: 16, bottom: 8, left: -16 }}>
        <XAxis dataKey="model" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(v) => `${Math.round(Number(v) * 100)}%`} />
        <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
          <LabelList dataKey="pct" position="top" formatter={(v: number) => `${Math.round(v * 100)}%`} />
          {rows.map((r) => (
            <Cell key={r.model} fill={color(r.pass_rate)} />
          ))}
        </Bar>
      </RBarChart>
    </ResponsiveContainer>
  );
}
