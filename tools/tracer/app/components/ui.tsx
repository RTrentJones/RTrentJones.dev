import type { CSSProperties, ReactNode } from 'react';
import type { RunWithRegression } from '../../lib/types';

// Small server-rendered UI primitives shared across pages. No client JS.

export const pct = (v: number | null | undefined) =>
  v == null ? '—' : `${(v * 100).toFixed(0)}%`;

export const fmtCost = (v: string | null) => (v == null ? '—' : `$${Number(v).toFixed(4)}`);

export const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 16).replace('T', ' ');
};

const badgeBase: CSSProperties = {
  display: 'inline-block',
  padding: '0.1rem 0.5rem',
  borderRadius: 999,
  fontSize: '0.75rem',
  fontWeight: 600,
  lineHeight: 1.6,
};

export function PassBadge({ passed }: { passed: boolean }) {
  return (
    <span
      style={{
        ...badgeBase,
        background: passed ? '#dcfce7' : '#fee2e2',
        color: passed ? '#166534' : '#991b1b',
      }}
    >
      {passed ? 'pass' : 'fail'}
    </span>
  );
}

/** Red "REGRESSION ↓" badge with the drop, shown only when a run regressed vs its prior run. */
export function RegressionBadge({ run }: { run: RunWithRegression }) {
  if (!run.is_regression) return null;
  return (
    <span style={{ ...badgeBase, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
      ↓ regression {pct(run.prev_pass_rate)} → {pct(run.pass_rate)}
    </span>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <section
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: '1.25rem',
        background: '#fff',
        ...style,
      }}
    >
      {children}
    </section>
  );
}

export function EvidenceBanner() {
  return (
    <aside
      style={{
        border: '1px solid #bfdbfe',
        background: '#eff6ff',
        color: '#1e3a8a',
        borderRadius: 12,
        padding: '0.85rem 1rem',
        display: 'grid',
        gap: '0.25rem',
      }}
    >
      <strong>Evidence-only dashboard</strong>
      <span style={{ fontSize: '0.9rem', lineHeight: 1.45 }}>
        Tracer does not seed demo runs. Every row should come from a real producer: Greenlight verify,
        an authenticated provider run, CI, or a project pipeline such as pg_kafka.
      </span>
    </aside>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div style={{ color: '#64748b', display: 'grid', gap: '0.35rem' }}>
      <strong style={{ color: '#334155' }}>{title}</strong>
      <div style={{ fontSize: '0.9rem', lineHeight: 1.45 }}>{children}</div>
    </div>
  );
}
