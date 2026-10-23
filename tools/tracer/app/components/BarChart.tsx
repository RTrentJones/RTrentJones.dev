'use client';

import { Bar, BarChart as RBarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Per-model pass-rate bars for /compare. Client component — Recharts needs the DOM. Bars are one
// measure across entities (magnitude, not identity), so they share a single colour; the value is
// direct-labelled on each bar and the model is on the axis.

export interface BarChartProps {
  data: { model: string; pass_rate: number | null }[];
}

export function BarChart({ data }: BarChartProps) {
  const rows = data.map((d) => ({ ...d, pct: d.pass_rate == null ? 0 : d.pass_rate }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <RBarChart data={rows} margin={{ top: 20, right: 12, bottom: 4, left: 0 }}>
        <XAxis dataKey="model" tick={{ fontSize: 11, fill: 'var(--muted)' }} stroke="var(--axis)" tickLine={false} />
        <YAxis
          domain={[0, 1]}
          tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`}
          tick={{ fontSize: 11, fill: 'var(--muted)' }}
          stroke="var(--axis)"
          tickLine={false}
          width={40}
        />
        <Tooltip
          formatter={(v) => `${Math.round(Number(v) * 100)}%`}
          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--ink)' }}
          cursor={{ fill: 'var(--surface-2)' }}
        />
        <Bar dataKey="pct" name="pass rate" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}>
          <LabelList
            dataKey="pct"
            position="top"
            fill="var(--ink-2)"
            fontSize={12}
            formatter={(v: number) => `${Math.round(v * 100)}%`}
          />
        </Bar>
      </RBarChart>
    </ResponsiveContainer>
  );
}
