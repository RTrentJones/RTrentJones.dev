import Link from 'next/link';
import { compareModels, filterOptions } from '../../lib/queries';
import type { CompareCell } from '../../lib/types';
import { BarChart } from '../components/BarChart';
import { Card, EmptyState, EvidenceBanner, PassBadge, Select, pct } from '../components/ui';

export const dynamic = 'force-dynamic';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const all = await filterOptions();
  const tool = one(sp.tool) ?? all.tools[0] ?? 'tracer';
  // Mode/suite/env options are scoped to the chosen project so every choice is one that has data.
  const opts = await filterOptions({ tool });
  const mode = one(sp.mode) ?? (opts.modes.includes('eval') ? 'eval' : undefined);
  const suite = one(sp.suite);
  const env = one(sp.env) ?? (opts.envs.includes('prod') ? 'prod' : opts.envs[0]) ?? 'prod';

  const cells = await compareModels({ tool, env, mode, suite });

  const models = [...new Set(cells.map((c) => c.model))].sort();
  const caseNames = [...new Set(cells.map((c) => c.name))];
  const byKey = new Map<string, CompareCell>();
  for (const c of cells) byKey.set(`${c.name}|${c.model}`, c);
  const perModelRate = models.map((m) => ({
    model: m,
    pass_rate: cells.find((c) => c.model === m)?.pass_rate ?? null,
  }));
  // Cases where the models disagree are the interesting rows; show them first.
  const disagree = (name: string) => new Set(models.map((m) => byKey.get(`${name}|${m}`)?.passed)).size > 1;
  caseNames.sort((a, b) => Number(disagree(b)) - Number(disagree(a)) || a.localeCompare(b));

  return (
    <div className="stack">
      <div>
        <h1>Compare models</h1>
        <p className="lede">
          The latest run of each model on the same project, mode and suite, aligned case by case. Cases the
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
            Mode <Select name="mode" value={mode} options={opts.modes} all="any" />
          </label>
          <label className="small secondary row" style={{ gap: '0.3rem' }}>
            Suite <Select name="suite" value={suite} options={opts.suites} all="any" />
          </label>
          <label className="small secondary row" style={{ gap: '0.3rem' }}>
            Env <Select name="env" value={env} options={opts.envs} />
          </label>
          <button type="submit" className="btn">
            Compare
          </button>
        </form>
      </Card>

      {models.length === 0 ? (
        <Card>
          <EmptyState title="Nothing to compare yet">
            No runs with cases for <strong>{tool}</strong>
            {mode && (
              <>
                {' '}
                · <strong>{mode}</strong>
              </>
            )}
            {suite && (
              <>
                {' '}
                · <strong>{suite}</strong>
              </>
            )}{' '}
            in <strong>{env}</strong>. A comparison needs at least one run for this scope, and becomes useful
            once two or more models or sources have reported.
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
                  {models.map((m) => (
                    <th key={m}>
                      {m}
                      <div style={{ fontWeight: 400 }}>{pct(perModelRate.find((p) => p.model === m)?.pass_rate ?? null)}</div>
                    </th>
                  ))}
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
                                <PassBadge passed={cell.passed} />
                                {cell.score != null && <span className="small secondary num">{cell.score.toFixed(2)}</span>}
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
            Scope: <Link href={`/projects/${encodeURIComponent(tool)}`}>{tool}</Link> · {mode ?? 'any mode'} ·{' '}
            {suite ?? 'any suite'} · {env}
          </p>
        </>
      )}
    </div>
  );
}
