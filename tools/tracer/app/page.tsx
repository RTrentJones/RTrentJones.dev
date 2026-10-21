import Link from 'next/link';
import { recentSignalRuns } from '../lib/queries';
import { type Signal, type SignalKind, groupSignals, projectHealth, relativeTime, signalLabel } from '../lib/signals';
import type { RunWithRegression } from '../lib/types';
import { RunEval } from './components/RunEval';
import {
  Card,
  EmptyState,
  EvidenceBanner,
  FreshnessPill,
  HealthPill,
  PassBadge,
  RegressionBadge,
  Sparkline,
  Stat,
  fmtDate,
  pct,
} from './components/ui';

// Read fresh each request so the dashboard reflects the DB and the verify gate exercises a live query
// (a broken connection / missing table 500s instead of hiding behind stale content).
export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<SignalKind, string> = {
  quality: 'Evals & checks',
  benchmark: 'Benchmarks',
  pipeline: 'Delivery pipeline',
};

const signalHref = (s: Signal) => `/projects/${encodeURIComponent(s.tool)}?signal=${encodeURIComponent(s.key)}`;

function SignalRow({ s, now }: { s: Signal<RunWithRegression>; now: number }) {
  return (
    <li>
      <span className="signal-name" title={`${signalLabel(s)} — latest model ${s.latest.model}`}>
        <Link href={signalHref(s)}>{signalLabel(s)}</Link>
      </span>
      <Sparkline points={s.history} width={96} height={24} />
      <span className="row" style={{ gap: '0.35rem', justifyContent: 'flex-end' }}>
        <Link href={`/runs/${s.latest.id}`} className="num" style={{ textDecoration: 'none' }}>
          {s.latest.passed ? (
            <span className="pill good">✓ {pct(s.latest.pass_rate)}</span>
          ) : (
            <span className="pill critical">✗ {pct(s.latest.pass_rate)}</span>
          )}
        </Link>
        <FreshnessPill freshness={s.freshness} when={relativeTime(s.latest.started_at, now)} />
      </span>
    </li>
  );
}

export default async function Page() {
  const runs = await recentSignalRuns({}, 20, 180);
  const now = Date.now();
  const signals = groupSignals(runs, now);
  const tools = [...new Set(signals.map((s) => s.tool))];
  const projects = tools
    .map((t) => ({ ...projectHealth(t, signals), signals: signals.filter((s) => s.tool === t) }))
    // Problems first, then most recently active.
    .sort((a, b) => {
      const rank = { failing: 0, regressed: 1, passing: 2, stale: 3, empty: 4 } as const;
      return rank[a.health] - rank[b.health] || (b.latestAt ?? '').localeCompare(a.latestAt ?? '');
    });
  const attention = signals.filter((s) => s.kind !== 'pipeline' && (!s.latest.passed || s.latest.is_regression));
  const recent = [...runs].sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 12);
  const lastIngest = recent[0]?.started_at;
  const week = runs.filter((r) => now - new Date(r.started_at).getTime() < 7 * 86_400_000).length;

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1>Project signals</h1>
          <p className="lede">
            Evals, CI checks, benchmarks and deploy pipelines for each project, with pass-rate trends,
            regressions against the previous run, and the evidence behind every verdict.
          </p>
        </div>
        <RunEval />
      </div>

      <EvidenceBanner />

      <Card>
        <div className="grid-stats">
          <Stat label="Projects">{tools.length}</Stat>
          <Stat label="Signals">{signals.length}</Stat>
          <Stat label="Failing now">
            {signals.filter((s) => s.kind !== 'pipeline' && !s.latest.passed).length}
          </Stat>
          <Stat label="Regressed">{signals.filter((s) => s.kind !== 'pipeline' && s.latest.is_regression).length}</Stat>
          <Stat label="Runs, last 7d">{week}</Stat>
          <Stat label="Last ingest">{lastIngest ? relativeTime(lastIngest, now) : '—'}</Stat>
        </div>
      </Card>

      {attention.length > 0 && (
        <Card>
          <h2>Needs attention</h2>
          <table className="data">
            <tbody>
              {attention.map((s) => (
                <tr key={s.key}>
                  <td>
                    <Link href={signalHref(s)}>
                      <strong>{s.tool}</strong> · {signalLabel(s)}
                    </Link>
                  </td>
                  <td className="secondary">{s.latest.model}</td>
                  <td>
                    <span className="row" style={{ gap: '0.35rem' }}>
                      <PassBadge passed={s.latest.passed} />
                      <RegressionBadge run={s.latest} />
                    </span>
                  </td>
                  <td className="muted nowrap">{relativeTime(s.latest.started_at, now)}</td>
                  <td>
                    <Link href={`/runs/${s.latest.id}`} className="small">
                      what changed →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <section className="stack" aria-labelledby="projects-h">
        <h2 id="projects-h" style={{ margin: 0 }}>
          Projects
        </h2>
        {projects.length === 0 ? (
          <Card>
            <EmptyState title="No real runs yet">
              Post an authenticated payload to <code>/api/ingest</code> from a CI job. Tracer leaves the
              dashboard empty until real data arrives.
            </EmptyState>
          </Card>
        ) : (
          <div className="grid-cards">
            {projects.map((p) => {
              const kinds = (['quality', 'benchmark', 'pipeline'] as SignalKind[]).filter((k) =>
                p.signals.some((s) => s.kind === k),
              );
              return (
                <Card key={p.tool} className="project-card">
                  <header>
                    <h2>
                      <Link href={`/projects/${encodeURIComponent(p.tool)}`}>{p.tool}</Link>
                    </h2>
                    <HealthPill health={p.health} />
                  </header>
                  {kinds.map((k) => (
                    <div key={k}>
                      <div className="kind-label">{KIND_LABEL[k]}</div>
                      <ul className="signal-list">
                        {p.signals
                          .filter((s) => s.kind === k)
                          .slice(0, 6)
                          .map((s) => (
                            <SignalRow key={s.key} s={s} now={now} />
                          ))}
                      </ul>
                      {p.signals.filter((s) => s.kind === k).length > 6 && (
                        <Link href={`/projects/${encodeURIComponent(p.tool)}`} className="small">
                          + {p.signals.filter((s) => s.kind === k).length - 6} more
                        </Link>
                      )}
                    </div>
                  ))}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <Card className="flush">
        <div style={{ padding: '1rem 1rem 0' }} className="spread">
          <h2>Recent runs</h2>
          <Link href="/runs" className="small">
            all runs →
          </Link>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>When</th>
              <th>Project</th>
              <th>Signal</th>
              <th>Model / source</th>
              <th>Pass rate</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 ? (
              <tr>
                <td className="muted" colSpan={6}>
                  No real ingested runs yet.
                </td>
              </tr>
            ) : (
              recent.map((r) => (
                <tr key={r.id}>
                  <td className="muted nowrap" title={fmtDate(r.started_at)}>
                    {relativeTime(r.started_at, now)}
                  </td>
                  <td>
                    <Link href={`/projects/${encodeURIComponent(r.tool)}`}>{r.tool}</Link>
                  </td>
                  <td className="secondary">{signalLabel(r)}</td>
                  <td className="secondary">{r.model}</td>
                  <td className="num">
                    <span className="row" style={{ gap: '0.35rem' }}>
                      <PassBadge passed={r.passed} /> {pct(r.pass_rate)} <RegressionBadge run={r} />
                    </span>
                  </td>
                  <td>
                    <Link href={`/runs/${r.id}`} className="small">
                      detail →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
