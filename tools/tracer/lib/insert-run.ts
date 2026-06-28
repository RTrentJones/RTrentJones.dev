import type { BatchItem } from 'drizzle-orm/batch';
import { evalCase, evalRun } from '../drizzle/schema';
import { getDb } from './db';
import type { EvalRunInput } from './schema';

// Shared write path for one eval_run + its eval_case[]. Used by /api/ingest (external POSTs) and
// /api/run (server-triggered evals). The run id is generated up front so the case rows can reference
// it without a round-trip — lets us send the run insert + all case inserts as ONE neon-http batch (a
// single transaction; the neon HTTP driver can't do interactive multi-statement transactions, but
// batch() is atomic). Returns the new run id.
// Cap every stored text field: it's the raw LLM response (+ judge rationale), ingested verbatim from
// any provider/producer. Unbounded text would bloat rows on free-tier Neon over time; the dashboard
// only renders a preview. Matches the schema's TEXT_MAX bound so validation and storage agree.
const MAX_OUTPUT = 16_384;
const cap = (s: string | null | undefined): string | null =>
  s == null ? null : s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}… [truncated]` : s;

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
      input: cap(c.input),
      expected: cap(c.expected),
      output: cap(c.output),
      score: c.score ?? null,
      passed: c.passed,
      judgeRationale: cap(c.judge_rationale),
    }),
  );

  // batch() wants a non-empty tuple of pg BatchItems; the run + case inserts target different tables
  // but are all valid BatchItem<'pg'>. runRow is always first → the tuple is never empty.
  const batch: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [runRow, ...caseRows];
  await db.batch(batch);
  return runId;
}
