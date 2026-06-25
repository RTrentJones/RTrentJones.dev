import { NextResponse } from 'next/server';
import { evalCase, evalRun } from '../../../drizzle/schema';
import { getDb } from '../../../lib/db';
import { evalRunInput } from '../../../lib/schema';

// The ingest seam: `greenlight verify --mode eval` POSTs one run + its cases here. Mutating endpoint,
// so it is bearer-authed and fails CLOSED (503) when no token is configured. Node runtime (not edge);
// reads are elsewhere — this only writes.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const token = process.env.TRACER_INGEST_TOKEN;
  // Fail closed: with no token wired, ingest is disabled rather than open.
  if (!token) {
    return NextResponse.json({ error: 'ingest disabled (TRACER_INGEST_TOKEN unset)' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${token}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = evalRunInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 422 });
  }
  const run = parsed.data;

  // Generate the run id up front so the case rows can reference it without a round-trip — lets us send
  // the run insert + all case inserts as ONE neon-http batch (a single transaction). The neon HTTP
  // driver can't do interactive multi-statement transactions, but batch() is atomic.
  const runId = crypto.randomUUID();

  try {
    const db = getDb();
    const runRow = db.insert(evalRun).values({
      id: runId,
      tool: run.tool,
      model: run.model,
      mode: run.mode,
      env: run.env,
      gitSha: run.git_sha ?? null,
      durationMs: run.duration_ms ?? null,
      costUsd: run.cost_usd != null ? String(run.cost_usd) : null,
      tokensIn: run.tokens_in ?? null,
      tokensOut: run.tokens_out ?? null,
      passed: run.passed,
      passRate: run.pass_rate ?? null,
    });

    const caseRows = run.cases.map((c) =>
      db.insert(evalCase).values({
        runId,
        name: c.name,
        input: c.input ?? null,
        expected: c.expected ?? null,
        output: c.output ?? null,
        score: c.score ?? null,
        passed: c.passed,
        judgeRationale: c.judge_rationale ?? null,
      }),
    );

    // batch() wants a homogeneous non-empty tuple; our run + case inserts are different table types
    // but all valid BatchItems, so cast to the param type. runRow is always first → never empty.
    await db.batch([runRow, ...caseRows] as unknown as Parameters<typeof db.batch>[0]);
    return NextResponse.json({ id: runId, cases: run.cases.length }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'insert failed' }, { status: 500 });
  }
}
