import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCases, getRun, previousInSeries } from '../../../lib/queries';
import { commitUrl, diffCases, safeHref, signalKey, signalLabel } from '../../../lib/signals';
import type { EvalCase } from '../../../lib/types';
import {
  Card,
  PassBadge,
  RegressionBadge,
  Stat,
  fmtCost,
  fmtDate,
  fmtDuration,
  fmtMetric,
  pct,
  shortSha,
} from '../../components/ui';

export const dynamic = 'force-dynamic';

function CaseCard({ c }: { c: EvalCase }) {
  const metrics = Object.entries(c.metrics ?? {});
  return (
    <Card className={`case ${c.passed ? '' : 'fail'}`}>
      <div className="spread">
        <strong style={{ overflowWrap: 'anywhere' }}>{c.name}</strong>
        <span className="row" style={{ gap: '0.5rem' }}>
          {c.score != null && <span className="small secondary num">score {c.score.toFixed(2)}</span>}
          <PassBadge passed={c.passed} />
        </span>
      </div>
      <div className="stack" style={{ gap: '0.7rem', marginTop: '0.75rem' }}>
        {metrics.length > 0 && (
          <div className="row small secondary">
            {metrics.map(([k, v]) => (
              <span key={k} className="mono">
                {k}={fmtMetric(v)}
              </span>
            ))}
          </div>
        )}
        {c.input != null && (
          <div>
            <div className="field">Input</div>
            <pre className="block">{c.input}</pre>
          </div>
        )}
        {(c.expected != null || c.output != null) && (
          <div className="two-col">
            {c.expected != null && (
              <div>
                <div className="field">Expected</div>
                <pre className="block">{c.expected}</pre>
              </div>
            )}
            {c.output != null && (
              <div>
                <div className="field">Output</div>
                <pre className="block">{c.output}</pre>
              </div>
            )}
          </div>
        )}
        {/* The interpretability headline: the judge's (or grader's) reasoning, surfaced in full. */}
        {c.judge_rationale != null && (
          <div className="judge">
            <div className="field">⚖︎ Judge rationale</div>
            <p>{c.judge_rationale}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

export default async function RunDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) notFound();
  const [cases, prev] = await Promise.all([getCases(run.id), previousInSeries(run)]);
  const prevCases = prev ? await getCases(prev.id) : [];
  const diff = prev && prevCases.length + cases.length > 0 ? diffCases(prevCases, cases) : null;
  const isRegression = prev?.pass_rate != null && run.pass_rate != null && run.pass_rate < prev.pass_rate;

  const commit = commitUrl(run.repo, run.git_sha);
  const source = safeHref(run.source_url);
  const metrics = Object.entries(run.metrics ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const labels = Object.entries(run.labels ?? {}).sort(([a], [b]) => a.localeCompare(b));

  // Group cases by category when the producer supplied one (BAMCP floors vs artifact checks, Polyphony
  // pipeline steps); failures stay first within each group (getCases orders them).
  const groups = new Map<string, EvalCase[]>();
  for (const c of cases) {
    const g = c.category ?? '';
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  const failed = cases.filter((c) => !c.passed).length;

  return (
    <div className="stack">
      <div>
        <Link href={`/projects/${encodeURIComponent(run.tool)}?signal=${encodeURIComponent(signalKey(run))}`} className="small">
          ← {run.tool} · {signalLabel(run)}
        </Link>
        <div className="spread" style={{ marginTop: '0.35rem' }}>
          <h1>
            {run.tool} · {run.model}
          </h1>
          <span className="row">
            <PassBadge passed={run.passed} />
            <RegressionBadge run={{ is_regression: isRegression, prev_pass_rate: prev?.pass_rate ?? null, pass_rate: run.pass_rate }} />
          </span>
        </div>
      </div>

      <Card>
        <div className="grid-stats">
          <Stat label="Pass rate">{pct(run.pass_rate)}</Stat>
          <Stat label="Cases">
            {cases.length}
            {failed > 0 && <span className="small secondary"> ({failed} failed)</span>}
          </Stat>
          <Stat label="Mode">{run.mode}</Stat>
          <Stat label="Suite">{run.suite ?? '—'}</Stat>
          <Stat label="Env">{run.env}</Stat>
          <Stat label="Started">{fmtDate(run.started_at)}</Stat>
          <Stat label="Duration">{fmtDuration(run.duration_ms)}</Stat>
          <Stat label="Cost">{fmtCost(run.cost_usd)}</Stat>
          <Stat label="Tokens in/out">{`${run.tokens_in ?? '—'} / ${run.tokens_out ?? '—'}`}</Stat>
          <Stat label="Commit">
            <span className="mono">{commit ? <a href={commit}>{shortSha(run.git_sha)}</a> : shortSha(run.git_sha)}</span>
          </Stat>
          <Stat label="Branch">{run.branch ?? '—'}</Stat>
          <Stat label="Source">{source ? <a href={source}>CI run ↗</a> : '—'}</Stat>
        </div>
      </Card>

      {(metrics.length > 0 || labels.length > 0) && (
        <div className="two-col">
          {metrics.length > 0 && (
            <Card>
              <h3>Metrics</h3>
              <table className="data">
                <tbody>
                  {metrics.map(([k, v]) => (
                    <tr key={k}>
                      <td className="mono small secondary">{k}</td>
                      <td className="num" style={{ textAlign: 'right' }}>
                        {fmtMetric(v)}
                        {prev?.metrics && typeof prev.metrics[k] === 'number' && prev.metrics[k] !== v && (
                          <span className="small muted"> (was {fmtMetric(prev.metrics[k])})</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {labels.length > 0 && (
            <Card>
              <h3>Labels</h3>
              <table className="data">
                <tbody>
                  {labels.map(([k, v]) => (
                    <tr key={k}>
                      <td className="mono small secondary">{k}</td>
                      <td style={{ overflowWrap: 'anywhere' }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      <Card>
        <h3>Compared with the previous run</h3>
        {!prev ? (
          <p className="small muted" style={{ margin: 0 }}>
            First run in this series ({run.tool} · {signalLabel(run)} · {run.model}), so there is no baseline yet.
          </p>
        ) : (
          <div className="stack" style={{ gap: '0.6rem' }}>
            <p className="small secondary" style={{ margin: 0 }}>
              Baseline{' '}
              <Link href={`/runs/${prev.id}`}>
                {fmtDate(prev.started_at)} · {pct(prev.pass_rate)}
              </Link>{' '}
              → this run {pct(run.pass_rate)}
              {commit && commitUrl(run.repo, prev.git_sha) && prev.git_sha !== run.git_sha && (
                <>
                  {' · '}
                  <a href={`https://github.com/${run.repo}/compare/${prev.git_sha}...${run.git_sha}`}>code diff ↗</a>
                </>
              )}
            </p>
            {diff &&
              (diff.newlyFailing.length + diff.newlyPassing.length + diff.scoreMoves.length + diff.added.length + diff.removed.length ===
              0 ? (
                <p className="small muted" style={{ margin: 0 }}>
                  No case changed verdict or moved score by 0.05 or more ({diff.unchanged} unchanged).
                </p>
              ) : (
                <div className="two-col">
                  {diff.newlyFailing.length > 0 && (
                    <div>
                      <span className="pill critical">✗ newly failing · {diff.newlyFailing.length}</span>
                      <ul className="diff-list">
                        {diff.newlyFailing.map((d) => (
                          <li key={d.name}>{d.name}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {diff.newlyPassing.length > 0 && (
                    <div>
                      <span className="pill good">✓ newly passing · {diff.newlyPassing.length}</span>
                      <ul className="diff-list">
                        {diff.newlyPassing.map((d) => (
                          <li key={d.name}>{d.name}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {diff.scoreMoves.length > 0 && (
                    <div>
                      <span className="pill info">± score moved · {diff.scoreMoves.length}</span>
                      <ul className="diff-list">
                        {diff.scoreMoves.slice(0, 12).map((d) => (
                          <li key={d.name} className="num">
                            {d.name}: {d.before.toFixed(2)} → {d.after.toFixed(2)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {(diff.added.length > 0 || diff.removed.length > 0) && (
                    <div>
                      <span className="pill neutral">cases added / removed</span>
                      <ul className="diff-list">
                        {diff.added.slice(0, 10).map((n) => (
                          <li key={`+${n}`}>+ {n}</li>
                        ))}
                        {diff.removed.slice(0, 10).map((n) => (
                          <li key={`-${n}`}>− {n}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
      </Card>

      <h2 style={{ margin: 0 }}>
        Cases <span className="muted small" style={{ fontWeight: 400 }}>({cases.length}, failures first)</span>
      </h2>
      {cases.length === 0 && <p className="small muted">This run reported no per-case rows.</p>}
      {[...groups.entries()].map(([group, cs]) => (
        <section key={group || '_'} className="stack" style={{ gap: '0.75rem' }}>
          {groups.size > 1 && (
            <h3 style={{ margin: '0.5rem 0 0' }}>
              {group || 'uncategorised'}{' '}
              <span className="muted small" style={{ fontWeight: 400 }}>
                {cs.filter((c) => c.passed).length}/{cs.length} passed
              </span>
            </h3>
          )}
          {cs.map((c) => (
            <CaseCard key={c.id} c={c} />
          ))}
        </section>
      ))}
    </div>
  );
}
