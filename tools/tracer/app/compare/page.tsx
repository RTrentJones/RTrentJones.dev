import Link from 'next/link';
import { compareModels, filterOptions, latestCaseScope, suitesByRecency } from '../../lib/queries';
import { isReportedCase } from '../../lib/signals';
import type { CompareCell } from '../../lib/types';
import { BarChart } from '../components/BarChart';
import { Card, EmptyState, EvidenceBanner, PassBadge, Select, pct, shortSha, suiteLabel } from '../components/ui';

export const dynamic = 'force-dynamic';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

type Scope = { tool: string; mode: string; suite: string; env: string };
type Wanted = Partial<Scope>;

/** The scope to compare: the newest run with cases that matches what was asked for. When nothing matches
 * the full request (say the project changed but the old suite stayed in the URL), drop the narrowest
 * filters one at a time, so the page always lands on a real suite instead of an empty table. */
async function resolveScope(w: Wanted): Promise<{ scope: Scope | null; relaxed: boolean }> {
  const attempts: Wanted[] = [
    w,
    { tool: w.tool, mode: w.mode, suite: w.suite },
    { tool: w.tool, mode: w.mode },
    { tool: w.tool },
  ];
  const tried = new Set<string>();
  for (const a of attempts) {
    const key = JSON.stringify(a);
    if (tried.has(key)) continue;
    tried.add(key);
    const scope = await latestCaseScope(a);
    if (scope) return { scope, relaxed: tried.size > 1 };
  }
  return { scope: null, relaxed: false };
}

// `MM-DD` from an ISO timestamp, for the column headers.
const monthDay = (iso: string) => (Number.isNaN(new Date(iso).getTime()) ? '' : new Date(iso).toISOString().slice(5, 10));

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const wanted: Wanted = { tool: one(sp.tool), mode: one(sp.mode), suite: one(sp.suite), env: one(sp.env) };
  const asked = Object.values(wanted).some(Boolean);
  const { scope, relaxed } = await resolveScope(wanted);

  const all = await filterOptions();
  const tool = scope?.tool ?? wanted.tool ?? all.tools[0];
  const opts = tool ? await filterOptions({ tool }) : { modes: [], envs: [] };
  const suites = scope ? await suitesByRecency({ tool: scope.tool, mode: scope.mode, env: scope.env }) : [];
  // A comparison never spans suites: the latest run per model on exactly this (tool, mode, suite, env).
  const cells = scope ? await compareModels(scope) : [];

  const models = [...new Set(cells.map((c) => c.model))].sort();
  const caseNames = [...new Set(cells.map((c) => c.name))];
  const byKey = new Map<string, CompareCell>();
  for (const c of cells) byKey.set(`${c.name}|${c.model}`, c);
  const head = new Map(models.map((m) => [m, cells.find((c) => c.model === m) as CompareCell]));
  const perModelRate = models.map((m) => ({ model: m, pass_rate: head.get(m)?.pass_rate ?? null }));
  // Cases where the models disagree are the interesting rows; show them first. A reported case carries
  // no verdict, so it can't disagree.
  const disagree = (name: string) =>
    new Set(
      models
        .map((m) => byKey.get(`${name}|${m}`))
        .filter((c): c is CompareCell => c != null && !isReportedCase(c))
        .map((c) => c.passed),
    ).size > 1;
  caseNames.sort((a, b) => Number(disagree(b)) - Number(disagree(a)) || a.localeCompare(b));

  return (
    <div className="stack">
      <div>
        <h1>Compare models</h1>
        <p className="lede">
          The latest run of each model on one project, mode, suite and env, aligned case by case. Cases the
          models disagree on are listed first.
        </p>
      </div>

      <EvidenceBanner />

      <Card>
        <form method="get" className="row">
          <label className="small secondary row" style={{ gap: '0.3rem' }}>
            Project <Select name="tool" value={tool} options={all.tools} />
          </label>
          <label className="small secondary row" style={{ gap: '0.3rem' }}>
            Mode <Select name="mode" value={scope?.mode} options={opts.modes} />
          </label>
          <label className="small secondary row" style={{ gap: '0.3rem' }}>
            Suite <Select name="suite" value={scope?.suite} options={suites} label={suiteLabel} />
          </label>
          <label className="small secondary row" style={{ gap: '0.3rem' }}>
            Env <Select name="env" value={scope?.env} options={opts.envs} />
          </label>
          <button type="submit" className="btn">
            Compare
          </button>
        </form>
      </Card>

      {asked && relaxed && scope && (
        <p className="small muted" style={{ margin: 0 }}>
          No runs with cases match that exact scope, so this shows the latest one that does.
        </p>
      )}

      {!scope || models.length === 0 ? (
        <Card>
          <EmptyState title="Nothing to compare yet">
            No runs with per-case results{tool ? (
              <>
                {' '}
                for <strong>{tool}</strong>
              </>
            ) : null}
            . A comparison needs at least one run with cases for a project, mode and suite, and becomes useful
            once two or more models or sources have reported on it.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card>
            <h2>Pass rate by model</h2>
            <BarChart data={perModelRate} />
          </Card>

          <Card className="flush">
            <table className="data" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>Case</th>
                  {models.map((m) => {
                    const h = head.get(m) as CompareCell;
                    return (
                      <th key={m}>
                        <Link href={`/runs/${h.run_id}`} title={`latest ${m} run`} style={{ color: 'inherit' }}>
                          {[m, monthDay(h.started_at), h.git_sha ? shortSha(h.git_sha) : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </Link>
                        <div style={{ fontWeight: 400 }}>{pct(h.pass_rate)}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {caseNames.map((name) => (
                  <tr key={name}>
                    <td style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                      {disagree(name) && models.length > 1 && <span title="models disagree">≠ </span>}
                      {name}
                    </td>
                    {models.map((m) => {
                      const cell = byKey.get(`${name}|${m}`);
                      return (
                        <td key={m}>
                          {cell ? (
                            <div className="stack" style={{ gap: '0.3rem' }}>
                              <span className="row" style={{ gap: '0.4rem' }}>
                                {isReportedCase(cell) ? (
                                  <span className="pill neutral" title="reported, not scored">
                                    {cell.score != null ? `${cell.score.toFixed(2)} · ` : ''}reported
                                  </span>
                                ) : (
                                  <>
                                    <PassBadge passed={cell.passed} />
                                    {cell.score != null && <span className="small secondary num">{cell.score.toFixed(2)}</span>}
                                  </>
                                )}
                              </span>
                              {cell.judge_rationale && (
                                <details>
                                  <summary className="small" style={{ color: 'var(--judge-ink)' }}>
                                    judge
                                  </summary>
                                  <p className="small secondary" style={{ margin: '0.3rem 0 0' }}>
                                    {cell.judge_rationale}
                                  </p>
                                </details>
                              )}
                            </div>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <p className="small muted">
            Scope: <Link href={`/projects/${encodeURIComponent(scope.tool)}`}>{scope.tool}</Link> · {scope.mode} ·{' '}
            {suiteLabel(scope.suite)} · {scope.env}
          </p>
        </>
      )}
    </div>
  );
}
