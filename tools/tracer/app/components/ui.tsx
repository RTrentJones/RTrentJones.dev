import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import type { Freshness, Health } from '../../lib/signals';
import type { RunWithRegression } from '../../lib/types';

// Small server-rendered UI primitives shared across pages. No client JS. Status is always an icon +
// a word on a status wash, never colour alone.

export const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);

export const fmtCost = (v: string | null) => (v == null ? '—' : `$${Number(v).toFixed(4)}`);

export const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};

export const fmtDuration = (ms: number | null) => {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 120 ? `${s.toFixed(1)} s` : `${Math.round(s / 60)} min`;
};

/** Metric values: rates/scores in 0..1 to 3 dp, big counts grouped, everything else trimmed. */
export const fmtMetric = (v: number) => {
  if (Number.isInteger(v)) return v.toLocaleString('en-US');
  if (Math.abs(v) <= 1) return v.toFixed(3);
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
};

export const shortSha = (sha: string | null) => (sha ? (/^[0-9a-f]{12,}$/i.test(sha) ? sha.slice(0, 7) : sha) : '—');

export function PassBadge({ passed }: { passed: boolean }) {
  return <span className={`pill ${passed ? 'good' : 'critical'}`}>{passed ? '✓ pass' : '✗ fail'}</span>;
}

/** "↓ regression 90% → 70%", shown only when a run dropped vs the prior run in its series. */
export function RegressionBadge({ run }: { run: Pick<RunWithRegression, 'is_regression' | 'prev_pass_rate' | 'pass_rate'> }) {
  if (!run.is_regression) return null;
  return (
    <span className="pill critical" title="pass rate dropped vs the previous run in this series">
      ↓ regression {pct(run.prev_pass_rate)} → {pct(run.pass_rate)}
    </span>
  );
}

const HEALTH: Record<Health, { cls: string; label: string }> = {
  passing: { cls: 'good', label: '✓ passing' },
  failing: { cls: 'critical', label: '✗ failing' },
  regressed: { cls: 'warning', label: '↓ regressed' },
  stale: { cls: 'neutral', label: '◷ stale' },
  empty: { cls: 'neutral', label: '— no data' },
};

export function HealthPill({ health }: { health: Health }) {
  const h = HEALTH[health];
  return <span className={`pill ${h.cls}`}>{h.label}</span>;
}

export function FreshnessPill({ freshness, when }: { freshness: Freshness; when: string }) {
  const cls = freshness === 'fresh' ? 'info' : freshness === 'aging' ? 'warning' : 'neutral';
  return (
    <span className={`pill ${cls}`} title={`freshness: ${freshness}`}>
      {freshness === 'stale' ? '◷ ' : ''}
      {when}
    </span>
  );
}

export function Card({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <section className={`card ${className ?? ''}`} style={style}>
      {children}
    </section>
  );
}

export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{children}</div>
    </div>
  );
}

export function EvidenceBanner() {
  return (
    <aside className="banner">
      <strong>Evidence only.</strong> Every row was posted by a real producer (CI eval jobs, Greenlight
      verify and ship, benchmark pipelines). Tracer seeds nothing, so an empty panel means no producer has
      reported yet. The ingest contract is documented in the{' '}
      <a href="https://github.com/RTrentJones/RTrentJones.dev/tree/main/tools/tracer#ingest-contract">README</a>.
    </aside>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <div className="small">{children}</div>
    </div>
  );
}

export interface SparkPoint {
  id: string;
  started_at: string;
  pass_rate: number | null;
  passed: boolean;
}

/** Pass-rate sparkline for one signal (oldest → newest). Pure SVG, server-rendered: each point is a
 * link to its run with a native <title> tooltip, so hover and click work without client JS. A single
 * series, so no legend; the y-range is fixed 0..1 so sparklines across signals are comparable. */
export function Sparkline({ points, width = 120, height = 28 }: { points: SparkPoint[]; width?: number; height?: number }) {
  const pts = points.filter((p) => p.pass_rate != null);
  if (pts.length === 0) return <span className="muted small">—</span>;
  const pad = 4;
  const x = (i: number) => (pts.length === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (pts.length - 1));
  const y = (v: number) => pad + (1 - v) * (height - 2 * pad);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.pass_rate as number).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`pass rate trend, ${pts.length} runs`}>
      <line x1={pad} x2={width - pad} y1={y(1)} y2={y(1)} stroke="var(--grid)" strokeWidth={1} />
      <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={1.5} strokeLinejoin="round" />
      {pts.map((p, i) => (
        <Link key={p.id} href={`/runs/${p.id}`}>
          {/* An invisible, larger hit target than the dot, per the hover-layer rule. */}
          <circle cx={x(i)} cy={y(p.pass_rate as number)} r={6} fill="transparent">
            <title>{`${fmtDate(p.started_at)} · ${pct(p.pass_rate)} · ${p.passed ? 'pass' : 'fail'}`}</title>
          </circle>
          {(i === pts.length - 1 || !p.passed) && (
            <circle
              cx={x(i)}
              cy={y(p.pass_rate as number)}
              r={i === pts.length - 1 ? 3 : 2.5}
              fill={p.passed ? 'var(--series-1)' : 'var(--critical)'}
              stroke="var(--surface)"
              strokeWidth={1.5}
              pointerEvents="none"
            />
          )}
        </Link>
      ))}
    </svg>
  );
}

/** Plain GET `<select>` for URL-driven filters (no client state). */
export function Select({ name, value, options, all }: { name: string; value?: string; options: string[]; all?: string }) {
  return (
    <select name={name} defaultValue={value ?? ''} aria-label={name}>
      {all !== undefined && <option value="">{all}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
