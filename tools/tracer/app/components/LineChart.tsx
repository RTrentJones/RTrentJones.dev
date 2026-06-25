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

// Pass-rate-over-time: one line per model. Data is pre-pivoted server-side into rows keyed by day
// with one numeric column per model (see app/page.tsx). Client component — Recharts needs the DOM.

const COLORS = ['#7c3aed', '#0891b2', '#db2777', '#16a34a', '#ea580c'];

export interface LineChartProps {
  data: Record<string, number | string | null>[]; // [{ bucket, [model]: passRate, ... }]
  models: string[];
}

export function LineChart({ data, models }: LineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <RLineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
        <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(v) => (v == null ? '—' : `${Math.round(Number(v) * 100)}%`)} />
        <Legend />
        {models.map((m, i) => (
          <Line
            key={m}
            type="monotone"
            dataKey={m}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
        ))}
      </RLineChart>
    </ResponsiveContainer>
  );
}
