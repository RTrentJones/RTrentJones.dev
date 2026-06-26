import { evalCase, evalRun } from '../drizzle/schema';
import { getDb } from './db';
import type { EvalRunInput } from './schema';

// Shared write path for one eval_run + its eval_case[]. Used by /api/ingest (external POSTs) and
// /api/run (server-triggered evals). The run id is generated up front so the case rows can reference
// it without a round-trip — lets us send the run insert + all case inserts as ONE neon-http batch (a
// single transaction; the neon HTTP driver can't do interactive multi-statement transactions, but
// batch() is atomic). Returns the new run id.
export async function insertRun(run: EvalRunInput): Promise<string> {
  const db = getDb();
  const runId = crypto.randomUUID();

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

  // batch() wants a homogeneous non-empty tuple; run + case inserts are different table types but all
  // valid BatchItems, so cast to the param type. runRow is always first → never empty.
  await db.batch([runRow, ...caseRows] as unknown as Parameters<typeof db.batch>[0]);
  return runId;
}
