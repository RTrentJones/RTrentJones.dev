import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCases, getRun } from '../../../lib/queries';
import { Card, PassBadge, fmtCost, fmtDate, pct } from '../../components/ui';

export const dynamic = 'force-dynamic';

const meta = { fontSize: '0.8rem', color: '#64748b' } as const;
const metaVal = { fontSize: '0.95rem', fontWeight: 600 } as const;

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={meta}>{label}</div>
      <div style={metaVal}>{value}</div>
    </div>
  );
}

const field = { fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' } as const;
const pre = {
  margin: '0.25rem 0 0',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: '0.9rem',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

export default async function RunDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) notFound();
  const cases = await getCases(run.id);

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <div>
        <Link href="/runs" style={{ color: '#4338ca', fontSize: '0.85rem' }}>
          ← all runs
        </Link>
        <h1 style={{ margin: '0.35rem 0 0' }}>
          {run.tool} · {run.model}
        </h1>
      </div>

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '1rem' }}>
          <Meta label="Mode" value={run.mode} />
          <Meta label="Env" value={run.env} />
          <Meta label="Pass rate" value={pct(run.pass_rate)} />
          <Meta label="Result" value={run.passed ? 'pass' : 'fail'} />
          <Meta label="Duration" value={run.duration_ms != null ? `${run.duration_ms} ms` : '—'} />
          <Meta label="Cost" value={fmtCost(run.cost_usd)} />
          <Meta label="Tokens in/out" value={`${run.tokens_in ?? '—'} / ${run.tokens_out ?? '—'}`} />
          <Meta label="Git SHA" value={run.git_sha ?? '—'} />
          <Meta label="Started" value={fmtDate(run.started_at)} />
        </div>
      </Card>

      <h2 style={{ margin: 0, fontSize: '1.05rem' }}>
        Cases <span style={{ color: '#94a3b8', fontWeight: 400 }}>({cases.length}, failures first)</span>
      </h2>

      <div style={{ display: 'grid', gap: '1rem' }}>
        {cases.map((c) => (
          <Card key={c.id} style={{ borderLeft: `4px solid ${c.passed ? '#16a34a' : '#dc2626'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
              <strong style={{ fontSize: '1rem' }}>{c.name}</strong>
              <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {c.score != null && <span style={{ color: '#64748b', fontSize: '0.85rem' }}>score {c.score.toFixed(2)}</span>}
                <PassBadge passed={c.passed} />
              </span>
            </div>

            <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.85rem' }}>
              {c.input != null && (
                <div>
                  <div style={field}>Input</div>
                  <pre style={pre}>{c.input}</pre>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                {c.expected != null && (
                  <div>
                    <div style={field}>Expected</div>
                    <pre style={pre}>{c.expected}</pre>
                  </div>
                )}
                {c.output != null && (
                  <div>
                    <div style={field}>Output</div>
                    <pre style={pre}>{c.output}</pre>
                  </div>
                )}
              </div>

              {/* The interpretability headline: the LLM judge's reasoning, surfaced in full. */}
              {c.judge_rationale != null && (
                <div
                  style={{
                    background: '#f5f3ff',
                    border: '1px solid #ddd6fe',
                    borderRadius: 8,
                    padding: '0.85rem 1rem',
                  }}
                >
                  <div style={{ ...field, color: '#6d28d9' }}>⚖︎ Judge rationale</div>
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.92rem', lineHeight: 1.5 }}>{c.judge_rationale}</p>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
