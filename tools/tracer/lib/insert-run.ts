import type { BatchItem } from 'drizzle-orm/batch';
import { evalCase, evalRun } from '../drizzle/schema';
import { getDb, isNeonHttp } from './db';
import type { EvalRunInput } from './schema';

// Shared write path for one eval_run + its eval_case[]. Used by /api/ingest (external POSTs) and
// /api/run (server-triggered evals). The run id is generated up front so the case rows can reference
// it without a round-trip — lets us send the run insert + all case inserts as ONE neon-http batch (a
// single transaction; the neon HTTP driver can't do interactive multi-statement transactions, but
// batch() is atomic). On node-postgres (local dev / DB tests) the same rows go in one transaction.
// Returns the new run id.
// Cap every stored text field: it's the raw LLM response (+ judge rationale), ingested verbatim from
// any provider/producer. Unbounded text would bloat rows on free-tier Neon over time; the dashboard
// only renders a preview. Matches the schema's TEXT_MAX bound so validation and storage agree.
const MAX_OUTPUT = 16_384;
const cap = (s: string | null | undefined): string | null =>
  s == null ? null : s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}… [truncated]` : s;

// An empty map stores as NULL so "no metrics" has one representation on read.
const nonEmpty = <T extends Record<string, unknown>>(m: T | null | undefined): T | null =>
  m && Object.keys(m).length > 0 ? m : null;

export async function insertRun(run: EvalRunInput): Promise<string> {
  const db = getDb();
  const runId = crypto.randomUUID();

  const runValues: typeof evalRun.$inferInsert = {
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
    suite: run.suite ?? null,
    repo: run.repo ?? null,
    branch: run.branch ?? null,
    sourceUrl: run.source_url ?? null,
    metrics: nonEmpty(run.metrics),
    labels: nonEmpty(run.labels),
  };

  const caseValues: (typeof evalCase.$inferInsert)[] = run.cases.map((c) => ({
    runId,
    name: c.name,
    input: cap(c.input),
    expected: cap(c.expected),
    output: cap(c.output),
    score: c.score ?? null,
    passed: c.passed,
    judgeRationale: cap(c.judge_rationale),
    category: c.category ?? null,
    metrics: nonEmpty(c.metrics),
  }));

  if (!isNeonHttp(db)) {
    await db.transaction(async (tx) => {
      await tx.insert(evalRun).values(runValues);
      if (caseValues.length > 0) await tx.insert(evalCase).values(caseValues);
    });
    return runId;
  }

  // batch() wants a non-empty tuple of pg BatchItems; the run + case inserts target different tables
  // but are all valid BatchItem<'pg'>. The run insert is always first → the tuple is never empty.
  const batch: [BatchItem<'pg'>, ...BatchItem<'pg'>[]] = [
    db.insert(evalRun).values(runValues),
    ...caseValues.map((c) => db.insert(evalCase).values(c)),
  ];
  await db.batch(batch);
  return runId;
}
