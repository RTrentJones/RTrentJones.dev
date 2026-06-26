import { NextResponse } from 'next/server';
import { runEval } from '../../../lib/eval';
import { insertRun } from '../../../lib/insert-run';
import { enabledProviders } from '../../../lib/providers';

// Optional "Run eval" seam: runs the demo suite against every provider whose API key is present (one
// eval_run each → populates /compare with a real cross-vendor comparison) and stores the results.
// Bearer-authed and fails CLOSED — a public dashboard must not let anonymous visitors spend tokens.
// Node runtime (provider SDKs); force-dynamic; can be slow, so callers should expect a few seconds.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const token = process.env.TRACER_INGEST_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'run disabled (TRACER_INGEST_TOKEN unset)' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${token}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const providers = enabledProviders();
  if (providers.length === 0) {
    return NextResponse.json(
      { error: 'no provider key set (GEMINI_API_KEY / XAI_API_KEY / ANTHROPIC_API_KEY)' },
      { status: 503 },
    );
  }

  // Run each provider independently; one failing vendor (bad key, rate limit) shouldn't sink the rest.
  const results = await Promise.allSettled(
    providers.map(async (p) => {
      const run = await runEval(p);
      const id = await insertRun(run);
      return { provider: p.id, model: p.defaultModel, id, pass_rate: run.pass_rate };
    }),
  );

  const ran = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const errors = results
    .map((r, i) => (r.status === 'rejected' ? { provider: providers[i].id, error: String(r.reason) } : null))
    .filter(Boolean);

  if (ran.length === 0) {
    return NextResponse.json({ error: 'all providers failed', errors }, { status: 502 });
  }
  return NextResponse.json({ ran, errors }, { status: 201 });
}
