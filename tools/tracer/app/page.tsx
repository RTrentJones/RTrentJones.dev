import Link from 'next/link';
import { countRunsSince, recentSignalRuns } from '../lib/queries';
import {
  type Signal,
  type SignalKind,
  groupSignals,
  headlineMetric,
  needsAttention,
  projectHealth,
  relativeTime,
  signalKind,
  signalLabel,
  signalStatus,
} from '../lib/signals';
import type { RunWithRegression } from '../lib/types';
import { RunEval } from './components/RunEval';
import {
  Card,
  EmptyState,
  EvidenceBanner,
  FreshnessPill,
  HealthPill,
  JudgeChangedPill,
  RegressionBadge,
  Sparkline,
  Stat,
  VerdictPill,
  fmtDate,
  runStatus,
} from './components/ui';

// Read fresh each request so the dashboard reflects the DB and the verify gate exercises a live query
// (a broken connection / missing table 500s instead of hiding behind stale content).
export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<SignalKind, string> = {
  quality: 'Evals & checks',
  benchmark: 'Benchmarks',
  pipeline: 'Delivery pipeline',
};

const CARD_SIGNALS = 6;
const RECENT_RUNS = 12;

const signalHref = (s: Signal) => `/projects/${encodeURIComponent(s.tool)}?signal=${encodeURIComponent(s.key)}`;

function SignalRow({ s, now }: { s: Signal<RunWithRegression>; now: number }) {
  const h = headlineMetric(s.latest);
  return (
    <li>
      <span className="signal-name" title={`${signalLabel(s)} — latest model ${s.latest.model}`}>
        <Link href={signalHref(s)}>{signalLabel(s)}</Link>
      </span>
      <Sparkline points={s.history} metric={h ? { key: h.key, unit: h.unit } : null} width={96} height={24} />
      <span className="row" style={{ gap: '0.35rem', justifyContent: 'flex-end' }}>
        <Link href={`/runs/${s.latest.id}`} className="num" style={{ textDecoration: 'none' }}>
          <VerdictPill run={s.latest} status={signalStatus(s)} />
        </Link>
        <JudgeChangedPill change={s.latest.judge_change} />
        <FreshnessPill freshness={s.freshness} when={relativeTime(s.latest.started_at, now)} />
      </span>
    </li>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const showPipeline = (Array.isArray(sp.pipeline) ? sp.pipeline[0] : sp.pipeline) === '1';
  const [runs, week] = await Promise.all([recentSignalRuns({}, 20, 180), countRunsSince(7)]);
  const now = Date.now();
  const signals = groupSignals(runs, now);
  const tools = [...new Set(signals.map((s) => s.tool))];
  const projects = tools
    .map((t) => {
      const mine = signals.filter((s) => s.tool === t);
      return { ...projectHealth(t, mine), all: mine, live: mine.filter((s) => !signalStatus(s).stale) };
    })
    // Problems first, then most recently active.
    .sort((a, b) => {
      const rank = { failing: 0, regressed: 1, passing: 2, stale: 3, empty: 4 } as const;
      return rank[a.health] - rank[b.health] || (b.latestAt ?? '').localeCompare(a.latestAt ?? '');
    });
  // The tiles and the attention list count the same signals projectHealth does: gating, fresh, and
  // not a delivery-pipeline stage. Tracked (non-gating) signals still show on their cards, as neutral.
  const countedIn = (state: 'failing' | 'regressed') =>
    signals.filter((s) => {
      const st = signalStatus(s);
      return s.kind !== 'pipeline' && st.counted && st.state === state;
    }).length;
  const attention = needsAttention(signals);
  const byNewest = [...runs].sort((a, b) => b.started_at.localeCompare(a.started_at) || b.id.localeCompare(a.id));
  const lastIngest = byNewest[0]?.started_at;
  // Ship events (build/deploy/verify per push) would otherwise crowd every eval out of this table.
  const recent = byNewest.filter((r) => showPipeline || signalKind(r.mode) !== 'pipeline').slice(0, RECENT_RUNS);

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
      </div>

      <EvidenceBanner />

      <Card>
        <div className="grid-stats">
          <Stat label="Projects">{tools.length}</Stat>
          <Stat label="Signals">{signals.length}</Stat>
          <Stat label="Evals failing">{countedIn('failing')}</Stat>
          <Stat label="Evals regressed">{countedIn('regressed')}</Stat>
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
                      <VerdictPill run={s.latest} status={signalStatus(s)} detail />
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
              const stale = p.all.length - p.live.length;
              const kinds = (['quality', 'benchmark', 'pipeline'] as SignalKind[]).filter((k) =>
                p.live.some((s) => s.kind === k),
              );
              const projectHref = `/projects/${encodeURIComponent(p.tool)}`;
              return (
                <Card key={p.tool} className="project-card">
                  <header>
                    <h2>
                      <Link href={projectHref}>{p.tool}</Link>
                    </h2>
                    <HealthPill health={p.health} />
                  </header>
                  {kinds.map((k) => {
                    const ofKind = p.live.filter((s) => s.kind === k);
                    return (
                      <div key={k}>
                        <div className="kind-label">{KIND_LABEL[k]}</div>
                        <ul className="signal-list">
                          {ofKind.slice(0, CARD_SIGNALS).map((s) => (
                            <SignalRow key={s.key} s={s} now={now} />
                          ))}
                        </ul>
                        {ofKind.length > CARD_SIGNALS && (
                          <Link href={projectHref} className="small">
                            + {ofKind.length - CARD_SIGNALS} more
                          </Link>
                        )}
                      </div>
                    );
                  })}
                  {stale > 0 && (
                    <Link href={projectHref} className="small muted" title="signals with no recent run; they don't affect health">
                      + {stale} stale
                    </Link>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <Card className="flush">
        <div style={{ padding: '1rem 1rem 0' }} className="spread">
          <h2>Recent runs</h2>
          <span className="row small" style={{ gap: '1rem' }}>
            {showPipeline ? (
              <Link href="/">hide delivery pipeline</Link>
            ) : (
              <Link href="/?pipeline=1">show delivery pipeline</Link>
            )}
            <Link href="/runs">all runs →</Link>
          </span>
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
                  {runs.length === 0 ? 'No real ingested runs yet.' : 'No eval or benchmark runs in this window.'}
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
                      <VerdictPill run={r} status={runStatus(r)} detail /> <RegressionBadge run={r} />
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

      <Card>
        <div className="spread" style={{ alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0 }}>Operator</h3>
            <p className="small muted" style={{ margin: '0.2rem 0 0' }}>
              Runs the built-in demo suite on every enabled provider. Needs the ingest token.
            </p>
          </div>
          <RunEval />
        </div>
      </Card>
    </div>
  );
}
