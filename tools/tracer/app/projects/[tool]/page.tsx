import Link from 'next/link';
import { notFound } from 'next/navigation';
import { casesForRuns, recentSignalRuns, signalRuns } from '../../../lib/queries';
import {
  NO_SUITE,
  type Signal,
  caseMatrix,
  isReportedCase,
  commitUrl,
  groupSignals,
  headlineMetric,
  metricSeries,
  projectHealth,
  relativeTime,
  signalLabel,
  signalStatus,
} from '../../../lib/signals';
import type { RunWithRegression } from '../../../lib/types';
import { LineChart } from '../../components/LineChart';
import {
  Card,
  FreshnessPill,
  HealthPill,
  RegressionBadge,
  Sparkline,
  VerdictPill,
  fmtDate,
  fmtMetric,
  pct,
  shortSha,
} from '../../components/ui';

export const dynamic = 'force-dynamic';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const MAX_METRIC_CHARTS = 12;
const MATRIX_RUNS = 15;

// Compact x label for a per-run trend (several runs can share a day, so the time is kept).
const xLabel = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(5, 16).replace('T', ' ');
};

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ tool: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Route params arrive decoded; decoding again would throw on a literal `%` (and mangle `%25`).
  const { tool } = await params;
  const sp = await searchParams;
  const now = Date.now();

  const runs = await recentSignalRuns({ tool }, 40, 180);
  if (runs.length === 0) notFound();
  const signals = groupSignals(runs, now);
  const health = projectHealth(tool, signals);
  // Stale signals (no run within their cadence) don't count toward health; they fold away below the table.
  const live = signals.filter((s) => !signalStatus(s).stale);
  const stale = signals.filter((s) => signalStatus(s).stale);
  const wanted = one(sp.signal);
  const selected =
    signals.find((s) => s.key === wanted) ??
    live.find((s) => s.kind !== 'pipeline') ??
    live[0] ??
    signals.find((s) => s.kind !== 'pipeline') ??
    signals[0];

  // Trend: one row per run, one column per model (a model switch inside a feed shows as a new line).
  const models = [...new Set(selected.history.map((r) => r.model))].sort();
  const trend = selected.history.map((r) => ({ x: xLabel(r.started_at), [r.model]: r.pass_rate }));
  const metrics = metricSeries(selected.history).slice(0, MAX_METRIC_CHARTS);

  const matrixRuns = await signalRuns(selected, MATRIX_RUNS);
  const matrix = caseMatrix(
    matrixRuns.map((r) => r.id),
    await casesForRuns(matrixRuns.map((r) => r.id)),
  );
  const flaky = matrix.filter((r) => r.flaky);
  const repo = runs.find((r) => r.repo)?.repo ?? null;
  // The suite always rides along (NO_SUITE for a suite-less signal), so the links never widen the scope.
  const scopeQs = new URLSearchParams({
    tool,
    mode: selected.mode,
    suite: selected.suite ?? NO_SUITE,
    env: selected.env,
  }).toString();

  return (
    <div className="stack">
      <div>
        <Link href="/" className="small">
          ← overview
        </Link>
        <div className="spread" style={{ marginTop: '0.35rem' }}>
          <div>
            <h1>{tool}</h1>
            <p className="lede">
              {signals.length} signal{signals.length === 1 ? '' : 's'} · last run{' '}
              {health.latestAt ? relativeTime(health.latestAt, now) : '—'}
              {repo && (
                <>
                  {' · '}
                  <a href={`https://github.com/${repo}`}>{repo}</a>
                </>
              )}
            </p>
          </div>
          <div className="row">
            <HealthPill health={health.health} />
            <a href={`/api/badge/${encodeURIComponent(tool)}`} className="small" title="embeddable SVG status badge">
              badge
            </a>
            <a href={`/api/summary/${encodeURIComponent(tool)}`} className="small" title="machine-readable status">
              JSON
            </a>
          </div>
        </div>
      </div>

      <Card className="flush">
        <SignalTable signals={live} selected={selected.key} now={now} />
        {live.length === 0 && (
          <p className="small muted" style={{ padding: '0 0.75rem 0.75rem', margin: 0 }}>
            No signal has reported within its cadence.
          </p>
        )}
      </Card>
      {stale.length > 0 && (
        <details className="stale-signals">
          <summary className="small secondary">
            {stale.length} stale signal{stale.length === 1 ? '' : 's'} (no recent run; not counted in health)
          </summary>
          <Card className="flush" style={{ marginTop: '0.5rem' }}>
            <SignalTable signals={stale} selected={selected.key} now={now} />
          </Card>
        </details>
      )}

      <h2 style={{ margin: 0 }}>
        {signalLabel(selected)}{' '}
        <span className="muted small" style={{ fontWeight: 400 }}>
          ({selected.history.length} recent runs ·{' '}
          <Link href={`/runs?${scopeQs}`}>all runs</Link>
          {matrix.length > 0 && (
            <>
              {' · '}
              <Link href={`/compare?${scopeQs}`}>compare models</Link>
            </>
          )}
          )
        </span>
      </h2>

      <Card>
        <h3>Pass rate per run</h3>
        <LineChart data={trend} series={models} />
        {models.length > 8 && <p className="small muted">Showing the first 8 of {models.length} models.</p>}
      </Card>

      {metrics.length > 0 && (
        <Card>
          <h3>Metrics</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            Numeric results reported with each run, one chart per metric so each keeps its own scale.
          </p>
          <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {metrics.map((m) => {
              const last = m.points[m.points.length - 1];
              return (
                <div key={m.key}>
                  <div className="spread">
                    <span className="small secondary mono">{m.key}</span>
                    <span className="small num">
                      <strong>{fmtMetric(last.v)}</strong>
                    </span>
                  </div>
                  <LineChart
                    data={m.points.map((p) => ({ x: xLabel(p.t), [m.key]: p.v }))}
                    series={[m.key]}
                    percent={false}
                    height={120}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card>
        <div className="spread">
          <h3>
            Cases across the last {matrixRuns.length} run{matrixRuns.length === 1 ? '' : 's'}{' '}
            <span className="muted small" style={{ fontWeight: 400 }}>
              (oldest → latest ▾)
            </span>
          </h3>
          <span className="small secondary">
            {matrix.length} cases
            {flaky.length > 0 && (
              <>
                {' · '}
                <span className="pill warning">⚠ {flaky.length} flaky</span>
              </>
            )}
          </span>
        </div>
        {matrix.length === 0 ? (
          <p className="small muted">This signal reports run-level results only (no per-case rows).</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="matrix">
              <thead>
                <tr>
                  <th>case</th>
                  {matrixRuns.map((r, i) => (
                    <th key={r.id} title={`${fmtDate(r.started_at)} · ${r.model}${i === matrixRuns.length - 1 ? ' (latest)' : ''}`}>
                      {i === matrixRuns.length - 1 ? '▾' : ''}
                    </th>
                  ))}
                  <th>pass</th>
                </tr>
              </thead>
              <tbody>
                {matrix.slice(0, 60).map((row) => (
                  <tr key={row.name}>
                    <td className="name" title={row.name}>
                      {row.flaky && <span title={`verdict flipped ${row.flips}× in this window`}>⚠ </span>}
                      {row.name}
                    </td>
                    {row.cells.map((c, i) => {
                      const reported = c != null && isReportedCase(c);
                      const when = fmtDate(matrixRuns[i].started_at);
                      return (
                        <td
                          key={matrixRuns[i].id}
                          className={`cell ${c == null ? 'none' : reported ? 'reported' : c.passed ? 'pass' : 'fail'}`}
                          title={
                            c == null
                              ? 'not in this run'
                              : reported
                                ? `reported (not scored)${c.score != null ? ` · ${c.score.toFixed(2)}` : ''} · ${when}`
                                : `${c.passed ? 'pass' : 'fail'}${c.score != null ? ` · score ${c.score.toFixed(2)}` : ''} · ${when}`
                          }
                        >
                          <Link href={`/runs/${matrixRuns[i].id}`}>
                            {c == null ? '·' : reported ? (c.score != null ? c.score.toFixed(2) : '○') : c.passed ? '✓' : '✗'}
                          </Link>
                        </td>
                      );
                    })}
                    <td className="small num secondary">{row.reported ? 'reported' : pct(row.passRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {matrix.length > 60 && <p className="small muted">Showing 60 of {matrix.length} cases (failing and flaky first).</p>}
          </div>
        )}
      </Card>
    </div>
  );
}

/** The project's signal table: one row per signal, status from signalStatus (as the overview and the
 * public summary use), the headline metric for benchmarks, and the latest commit. */
function SignalTable({ signals, selected, now }: { signals: Signal<RunWithRegression>[]; selected: string; now: number }) {
  if (signals.length === 0) return null;
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Signal</th>
          <th>Kind</th>
          <th>Latest model</th>
          <th>Trend</th>
          <th>Latest</th>
          <th>Freshness</th>
          <th>Commit</th>
        </tr>
      </thead>
      <tbody>
        {signals.map((s) => {
          const st = signalStatus(s);
          const h = headlineMetric(s.latest);
          const href = commitUrl(s.latest.repo, s.latest.git_sha);
          return (
            <tr
              key={s.key}
              className={st.stale ? 'stale' : undefined}
              style={s.key === selected ? { background: 'var(--surface-2)' } : undefined}
            >
              <td>
                <Link href={`?signal=${encodeURIComponent(s.key)}`} scroll={false}>
                  {signalLabel(s)}
                </Link>
              </td>
              <td className="muted small">{s.kind}</td>
              <td className="secondary">{s.latest.model}</td>
              <td>
                <Sparkline points={s.history} metric={h ? { key: h.key, unit: h.unit } : null} />
              </td>
              <td>
                <span className="row" style={{ gap: '0.35rem' }}>
                  <Link href={`/runs/${s.latest.id}`} style={{ textDecoration: 'none' }}>
                    <VerdictPill run={s.latest} status={st} detail />
                  </Link>
                  <RegressionBadge run={s.latest} />
                </span>
              </td>
              <td>
                <FreshnessPill freshness={s.freshness} when={relativeTime(s.latest.started_at, now)} />
              </td>
              <td className="mono small">
                {href ? <a href={href}>{shortSha(s.latest.git_sha)}</a> : shortSha(s.latest.git_sha)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
