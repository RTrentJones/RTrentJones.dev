import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import {
  type Freshness,
  type Health,
  NO_SUITE,
  type SignalStatus,
  groupSignals,
  headlineMetric,
  signalStatus,
} from '../../lib/signals';
import type { JudgeChange, RunWithRegression } from '../../lib/types';

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

/** A benchmark headline: large values grouped and rounded, small ones as fmtMetric, plus the unit. */
export const fmtHeadline = (h: { value: number; unit: string | null }) =>
  `${Math.abs(h.value) >= 100 ? Math.round(h.value).toLocaleString('en-US') : fmtMetric(h.value)}${h.unit ? ` ${h.unit}` : ''}`;

/** Display form of a suite filter value (NO_SUITE is the "suite IS NULL" sentinel). */
export const suiteLabel = (s: string | null | undefined) => (s == null || s === NO_SUITE ? '(no suite)' : s);

export const shortSha = (sha: string | null) => (sha ? (/^[0-9a-f]{12,}$/i.test(sha) ? sha.slice(0, 7) : sha) : '—');

export function PassBadge({ passed }: { passed: boolean }) {
  return <span className={`pill ${passed ? 'good' : 'critical'}`}>{passed ? '✓ pass' : '✗ fail'}</span>;
}

/** "↓ regression 90% → 70%" when a run dropped vs its baseline; "not comparable" when the judge changed
 * between the two runs (the scores were produced by different graders, so no drop is claimed). */
export function RegressionBadge({
  run,
}: {
  run: Pick<RunWithRegression, 'is_regression' | 'prev_pass_rate' | 'pass_rate'> & {
    judge_change?: JudgeChange | null;
    gating?: boolean;
  };
}) {
  if (run.judge_change) {
    return (
      <span className="pill neutral" title={`judge changed (${run.judge_change.from} → ${run.judge_change.to})`}>
        ≠ not comparable
      </span>
    );
  }
  if (!run.is_regression) return null;
  // A tracked (non-gating) run's drop is trend information, not an alarm.
  const tracked = run.gating === false;
  return (
    <span
      className={`pill ${tracked ? 'neutral' : 'critical'}`}
      title={`pass rate dropped vs the baseline run in this series${tracked ? ' (tracked, not gated)' : ''}`}
    >
      ↓ regression {pct(run.prev_pass_rate)} → {pct(run.pass_rate)}
    </span>
  );
}

/** Status of one run, from the same signalStatus every page and the public API use (a run is scored as
 * the latest run of a one-run signal; freshness does not affect the state). */
export function runStatus(run: RunWithRegression): SignalStatus {
  return signalStatus(groupSignals([run])[0]);
}

/** The latest verdict of a signal or run as one pill: the headline metric (benchmarks) or the pass rate,
 * worded by state. Incomplete and tracked (non-gating) runs are neutral: neither claims a failure. With
 * `detail`, a regression keeps its ✓/✗ verdict here and the RegressionBadge beside it names the drop. */
export function VerdictPill({
  run,
  status,
  detail = false,
}: {
  run: RunWithRegression;
  status: SignalStatus;
  detail?: boolean;
}) {
  const h = headlineMetric(run);
  const value = h ? fmtHeadline(h) : pct(run.pass_rate);
  if (status.state === 'incomplete') {
    return (
      <span className="pill neutral" title={`${run.incomplete_reason ?? 'incomplete'}: not scored as pass or fail`}>
        incomplete: {run.incomplete_reason ?? 'no scored cases'}
      </span>
    );
  }
  if (!status.gating) {
    return (
      <span className="pill neutral" title={`tracked, not gated (${run.passed ? 'pass' : 'fail'}); never makes the project red`}>
        tracked · {value}
      </span>
    );
  }
  if (status.state === 'failing') return <span className="pill critical">✗ {value}</span>;
  if (status.state === 'regressed' && !detail) {
    return (
      <span className="pill warning" title={`regressed from ${pct(run.prev_pass_rate)}`}>
        ↓ {value}
      </span>
    );
  }
  return <span className={`pill ${run.passed ? 'good' : 'critical'}`}>{run.passed ? '✓' : '✗'} {value}</span>;
}

/** Small neutral marker for a judge change, for compact rows that don't carry a RegressionBadge. */
export function JudgeChangedPill({ change }: { change: JudgeChange | null | undefined }) {
  if (!change) return null;
  return (
    <span className="pill neutral" title={`judge changed (${change.from} → ${change.to}): scores not directly comparable`}>
      judge changed
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
  metrics?: Record<string, number> | null;
}

/** Trend sparkline for one signal (oldest → newest). Pure SVG, server-rendered: each point is a link to
 * its run with a native <title> tooltip, so hover and click work without client JS. A single series, so
 * no legend. Pass rate uses a fixed 0..1 range so sparklines across signals are comparable; a headline
 * `metric` (a benchmark's msgs/s, say) has no common scale, so its range is fitted to the points. */
export function Sparkline({
  points,
  metric,
  width = 120,
  height = 28,
}: {
  points: SparkPoint[];
  metric?: { key: string; unit: string | null } | null;
  width?: number;
  height?: number;
}) {
  const valueOf = (p: SparkPoint): number | null => {
    const v = metric ? p.metrics?.[metric.key] : p.pass_rate;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const pts = points.map((p) => ({ p, v: valueOf(p) })).filter((x): x is { p: SparkPoint; v: number } => x.v !== null);
  if (pts.length === 0) return <span className="muted small">—</span>;
  const pad = 4;
  let lo = 0;
  let hi = 1;
  if (metric) {
    lo = Math.min(...pts.map((x) => x.v));
    hi = Math.max(...pts.map((x) => x.v));
    if (hi === lo) {
      const m = Math.abs(hi) * 0.05 || 1;
      lo -= m;
      hi += m;
    }
  }
  const x = (i: number) => (pts.length === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (pts.length - 1));
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (height - 2 * pad);
  const fmt = (v: number) => (metric ? fmtHeadline({ value: v, unit: metric.unit }) : pct(v));
  const d = pts.map((pt, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(pt.v).toFixed(1)}`).join(' ');
  const label = metric ? `${metric.key} trend, ${pts.length} runs` : `pass rate trend, ${pts.length} runs`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {!metric && <line x1={pad} x2={width - pad} y1={y(1)} y2={y(1)} stroke="var(--grid)" strokeWidth={1} />}
      <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={1.5} strokeLinejoin="round" />
      {pts.map(({ p, v }, i) => (
        <Link key={p.id} href={`/runs/${p.id}`}>
          {/* An invisible, larger hit target than the dot, per the hover-layer rule. */}
          <circle cx={x(i)} cy={y(v)} r={6} fill="transparent">
            <title>{`${fmtDate(p.started_at)} · ${fmt(v)} · ${p.passed ? 'pass' : 'fail'}`}</title>
          </circle>
          {(i === pts.length - 1 || !p.passed) && (
            <circle
              cx={x(i)}
              cy={y(v)}
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
export function Select({
  name,
  value,
  options,
  all,
  label,
}: {
  name: string;
  value?: string;
  options: string[];
  all?: string;
  /** Display text per option value (defaults to the value itself). */
  label?: (o: string) => string;
}) {
  return (
    <select name={name} defaultValue={value ?? ''} aria-label={name}>
      {all !== undefined && <option value="">{all}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {label ? label(o) : o}
        </option>
      ))}
    </select>
  );
}
