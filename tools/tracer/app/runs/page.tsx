import Link from 'next/link';
import { filterOptions, runsWithRegression } from '../../lib/queries';
import { relativeTime } from '../../lib/signals';
import { Card, EvidenceBanner, PassBadge, RegressionBadge, Select, fmtCost, fmtDate, fmtDuration, pct, shortSha } from '../components/ui';

export const dynamic = 'force-dynamic';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = { tool: one(sp.tool), mode: one(sp.mode), suite: one(sp.suite), model: one(sp.model), env: one(sp.env) };
  const regressionsOnly = one(sp.regressions) === '1';
  const failuresOnly = one(sp.failures) === '1';
  const [all, opts] = await Promise.all([runsWithRegression(filters, 300), filterOptions({ tool: filters.tool })]);
  const runs = all.filter((r) => (!regressionsOnly || r.is_regression) && (!failuresOnly || !r.passed)).slice(0, 200);
  const now = Date.now();

  return (
    <div className="stack">
      <div>
        <h1>Runs</h1>
        <p className="lede">Every ingested run in the last 90 days, newest first, filterable by project, signal and model.</p>
      </div>

      <EvidenceBanner />

      <Card>
        {/* Plain GET form → filters live in the URL, no client state. */}
        <form method="get" className="row">
          <Select name="tool" value={filters.tool} options={opts.tools} all="all projects" />
          <Select name="mode" value={filters.mode} options={opts.modes} all="all modes" />
          <Select name="suite" value={filters.suite} options={opts.suites} all="all suites" />
          <Select name="model" value={filters.model} options={opts.models} all="all models" />
          <Select name="env" value={filters.env} options={opts.envs} all="all envs" />
          <label className="small secondary row" style={{ gap: '0.3rem' }}>
            <input type="checkbox" name="regressions" value="1" defaultChecked={regressionsOnly} /> regressions
          </label>
          <label className="small secondary row" style={{ gap: '0.3rem' }}>
            <input type="checkbox" name="failures" value="1" defaultChecked={failuresOnly} /> failures
          </label>
          <button type="submit" className="btn">
            Filter
          </button>
          <Link href="/runs" className="small">
            reset
          </Link>
        </form>
      </Card>

      <Card className="flush">
        <table className="data" style={{ minWidth: 820 }}>
          <thead>
            <tr>
              <th>When</th>
              <th>Project</th>
              <th>Mode</th>
              <th>Suite</th>
              <th>Model</th>
              <th>Env</th>
              <th>Pass rate</th>
              <th>Duration</th>
              <th>Cost</th>
              <th>Commit</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="muted nowrap" title={fmtDate(r.started_at)}>
                  {relativeTime(r.started_at, now)}
                </td>
                <td>
                  <Link href={`/projects/${encodeURIComponent(r.tool)}`}>{r.tool}</Link>
                </td>
                <td>{r.mode}</td>
                <td className="secondary">{r.suite ?? '—'}</td>
                <td className="secondary">{r.model}</td>
                <td className="secondary">{r.env}</td>
                <td className="num">
                  <span className="row" style={{ gap: '0.35rem' }}>
                    <PassBadge passed={r.passed} /> {pct(r.pass_rate)} <RegressionBadge run={r} />
                  </span>
                </td>
                <td className="muted nowrap">{fmtDuration(r.duration_ms)}</td>
                <td className="muted">{fmtCost(r.cost_usd)}</td>
                <td className="mono small muted">{shortSha(r.git_sha)}</td>
                <td>
                  <Link href={`/runs/${r.id}`} className="small">
                    detail →
                  </Link>
                </td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td className="muted" colSpan={11}>
                  No real runs match these filters. Clear the filters, or ingest a run from CI, Greenlight
                  verify, /api/run, or a project pipeline.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      {all.length > runs.length && !regressionsOnly && !failuresOnly && (
        <p className="small muted">Showing the newest {runs.length} runs; narrow the filters to see older ones.</p>
      )}
    </div>
  );
}
