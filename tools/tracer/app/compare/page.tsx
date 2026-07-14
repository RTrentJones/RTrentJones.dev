import { compareModels, filterOptions } from '../../lib/queries';
import type { CompareCell } from '../../lib/types';
import { BarChart } from '../components/BarChart';
import { Card, EmptyState, EvidenceBanner, PassBadge, pct } from '../components/ui';

export const dynamic = 'force-dynamic';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

const th = { textAlign: 'left', padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: '#64748b' } as const;
const td = { padding: '0.6rem 0.75rem', borderTop: '1px solid #f1f5f9', fontSize: '0.9rem', verticalAlign: 'top' } as const;

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const opts = await filterOptions();
  const tool = one(sp.tool) ?? opts.tools[0] ?? 'tracer';
  const env = one(sp.env) ?? (opts.envs.includes('prod') ? 'prod' : opts.envs[0]) ?? 'prod';

  // Compare every model that has a run in this (tool, env) suite.
  const cells = await compareModels(tool, env, opts.models);

  const models = [...new Set(cells.map((c) => c.model))].sort();
  const caseNames = [...new Set(cells.map((c) => c.name))];
  const byKey = new Map<string, CompareCell>();
  for (const c of cells) byKey.set(`${c.name}|${c.model}`, c);
  const perModelRate = models.map((m) => ({
    model: m,
    pass_rate: cells.find((c) => c.model === m)?.pass_rate ?? null,
  }));

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <div>
        <h1 style={{ margin: '0 0 0.25rem' }}>Compare models</h1>
        <p style={{ margin: 0, color: '#64748b' }}>Latest real run per model or source on the same suite, aligned case by case.</p>
      </div>

      <EvidenceBanner />

      <Card>
        <form method="get" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: '0.85rem', color: '#64748b' }}>
            Tool{' '}
            <select name="tool" defaultValue={tool} style={{ padding: '0.35rem 0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}>
              {opts.tools.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: '0.85rem', color: '#64748b' }}>
            Env{' '}
            <select name="env" defaultValue={env} style={{ padding: '0.35rem 0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}>
              {opts.envs.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" style={{ padding: '0.4rem 0.9rem', borderRadius: 6, border: '1px solid #4338ca', background: '#4338ca', color: '#fff', cursor: 'pointer' }}>
            Compare
          </button>
        </form>
      </Card>

      {models.length === 0 ? (
        <Card>
          <EmptyState title="Nothing to compare yet">No real runs for <strong>{tool}</strong> in <strong>{env}</strong>. Ingest at least one run for this project/environment; ingest multiple models or sources to unlock a useful comparison.</EmptyState>
        </Card>
      ) : (
        <>
          <Card>
            <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Pass rate by model</h2>
            <BarChart data={perModelRate} />
          </Card>

          <Card style={{ padding: 0, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={th}>Case</th>
                  {models.map((m) => (
                    <th key={m} style={th}>
                      {m}
                      <div style={{ fontWeight: 400 }}>{pct(perModelRate.find((p) => p.model === m)?.pass_rate ?? null)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {caseNames.map((name) => (
                  <tr key={name}>
                    <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{name}</td>
                    {models.map((m) => {
                      const cell = byKey.get(`${name}|${m}`);
                      return (
                        <td key={m} style={td}>
                          {cell ? (
                            <div style={{ display: 'grid', gap: '0.35rem' }}>
                              <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <PassBadge passed={cell.passed} />
                                {cell.score != null && <span style={{ color: '#64748b', fontSize: '0.8rem' }}>{cell.score.toFixed(2)}</span>}
                              </span>
                              {cell.judge_rationale && (
                                <details>
                                  <summary style={{ cursor: 'pointer', color: '#6d28d9', fontSize: '0.8rem' }}>judge</summary>
                                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: '#334155', lineHeight: 1.45 }}>
                                    {cell.judge_rationale}
                                  </p>
                                </details>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: '#cbd5e1' }}>—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
