import Link from 'next/link';
import { filterOptions, runsWithRegression } from '../../lib/queries';
import { Card, EmptyState, EvidenceBanner, PassBadge, RegressionBadge, fmtCost, fmtDate, pct } from '../components/ui';

export const dynamic = 'force-dynamic';

const th = { textAlign: 'left', padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: '#64748b' } as const;
const td = { padding: '0.5rem 0.75rem', borderTop: '1px solid #f1f5f9', fontSize: '0.9rem' } as const;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

function Select({ name, value, options }: { name: string; value?: string; options: string[] }) {
  return (
    <select name={name} defaultValue={value ?? ''} style={{ padding: '0.35rem 0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}>
      <option value="">all {name}s</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = { tool: one(sp.tool), model: one(sp.model), env: one(sp.env) };
  const [runs, opts] = await Promise.all([runsWithRegression(filters, 200), filterOptions()]);

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <div>
        <h1 style={{ margin: '0 0 0.25rem' }}>Runs</h1>
        <p style={{ margin: 0, color: '#64748b' }}>Filter real ingested signal by project, model/source, and environment.</p>
      </div>

      <EvidenceBanner />

      <Card>
        {/* Plain GET form → filters live in the URL, no client state. */}
        <form method="get" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Select name="tool" value={filters.tool} options={opts.tools} />
          <Select name="model" value={filters.model} options={opts.models} />
          <Select name="env" value={filters.env} options={opts.envs} />
          <button type="submit" style={{ padding: '0.4rem 0.9rem', borderRadius: 6, border: '1px solid #4338ca', background: '#4338ca', color: '#fff', cursor: 'pointer' }}>
            Filter
          </button>
          <Link href="/runs" style={{ color: '#64748b', fontSize: '0.85rem' }}>
            reset
          </Link>
        </form>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>When</th>
              <th style={th}>Tool</th>
              <th style={th}>Model</th>
              <th style={th}>Mode</th>
              <th style={th}>Env</th>
              <th style={th}>Pass rate</th>
              <th style={th}>Result</th>
              <th style={th}>Cost</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td style={{ ...td, color: '#64748b', whiteSpace: 'nowrap' }}>{fmtDate(r.started_at)}</td>
                <td style={td}>{r.tool}</td>
                <td style={td}>{r.model}</td>
                <td style={td}>{r.mode}</td>
                <td style={td}>{r.env}</td>
                <td style={td}>
                  {pct(r.pass_rate)} <RegressionBadge run={r} />
                </td>
                <td style={td}>
                  <PassBadge passed={r.passed} />
                </td>
                <td style={{ ...td, color: '#64748b' }}>{fmtCost(r.cost_usd)}</td>
                <td style={td}>
                  <Link href={`/runs/${r.id}`} style={{ color: '#4338ca', fontSize: '0.85rem' }}>
                    detail →
                  </Link>
                </td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td style={{ ...td, color: '#94a3b8' }} colSpan={9}>
                  No real runs match these filters. Clear the filters or ingest a new run from CI, Greenlight verify, /api/run, or a project pipeline.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
