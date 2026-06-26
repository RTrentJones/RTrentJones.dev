import Link from 'next/link';
import { latestRunPerTool, passRateOverTime, runsWithRegression } from '../lib/queries';
import { LineChart } from './components/LineChart';
import { RunEval } from './components/RunEval';
import { Card, PassBadge, RegressionBadge, fmtCost, fmtDate, pct } from './components/ui';

// Read fresh each request so the dashboard reflects the DB and the verify gate exercises a live query
// (a broken connection / missing table 500s instead of returning the seeded marker).
export const dynamic = 'force-dynamic';

// Pivot the long (bucket, model, pass_rate) rows into one row per day with a column per model — the
// shape Recharts wants for multiple lines.
function pivot(points: { bucket: string; model: string; pass_rate: number }[]) {
  const byBucket = new Map<string, Record<string, number | string>>();
  const models = new Set<string>();
  for (const p of points) {
    models.add(p.model);
    const row = byBucket.get(p.bucket) ?? { bucket: p.bucket };
    row[p.model] = p.pass_rate;
    byBucket.set(p.bucket, row);
  }
  return { data: [...byBucket.values()], models: [...models] };
}

const th = { textAlign: 'left', padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: '#64748b' } as const;
const td = { padding: '0.5rem 0.75rem', borderTop: '1px solid #f1f5f9', fontSize: '0.9rem' } as const;

export default async function Page() {
  const [series, latest, recent] = await Promise.all([
    passRateOverTime(30),
    latestRunPerTool(),
    runsWithRegression({}, 12),
  ]);
  const { data, models } = pivot(series);

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: '0 0 0.25rem' }}>Model evals</h1>
          <p style={{ margin: 0, color: '#64748b' }}>
            Every <code>verify --mode eval</code> run, stored over time — pass rate, regressions, and
            cross-provider comparisons (Claude · Gemini · Grok).
          </p>
        </div>
        <RunEval />
      </div>

      <Card>
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Pass rate over time (30d)</h2>
        {data.length > 0 ? (
          <LineChart data={data} models={models} />
        ) : (
          <p style={{ color: '#94a3b8' }}>No runs yet.</p>
        )}
      </Card>

      <Card>
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Latest run per tool</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Tool</th>
              <th style={th}>Model</th>
              <th style={th}>Env</th>
              <th style={th}>Pass rate</th>
              <th style={th}>Result</th>
              <th style={th}>When</th>
            </tr>
          </thead>
          <tbody>
            {latest.map((r) => (
              <tr key={r.id}>
                <td style={td}>
                  <strong>{r.tool}</strong>
                </td>
                <td style={td}>{r.model}</td>
                <td style={td}>{r.env}</td>
                <td style={td}>{pct(r.pass_rate)}</td>
                <td style={td}>
                  <PassBadge passed={r.passed} />
                </td>
                <td style={{ ...td, color: '#64748b' }}>{fmtDate(r.started_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Recent runs</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>When</th>
              <th style={th}>Tool</th>
              <th style={th}>Model</th>
              <th style={th}>Env</th>
              <th style={th}>Pass rate</th>
              <th style={th}>Cost</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.id}>
                <td style={{ ...td, color: '#64748b' }}>{fmtDate(r.started_at)}</td>
                <td style={td}>{r.tool}</td>
                <td style={td}>{r.model}</td>
                <td style={td}>{r.env}</td>
                <td style={td}>
                  <Link href={`/runs/${r.id}`} style={{ color: '#4338ca' }}>
                    {pct(r.pass_rate)}
                  </Link>{' '}
                  <RegressionBadge run={r} />
                </td>
                <td style={{ ...td, color: '#64748b' }}>{fmtCost(r.cost_usd)}</td>
                <td style={td}>
                  <Link href={`/runs/${r.id}`} style={{ color: '#4338ca', fontSize: '0.85rem' }}>
                    detail →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
