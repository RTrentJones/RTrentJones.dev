// Tracer's eval store — two append-heavy time-series tables (design §2). Drizzle owns the schema;
// `drizzle-kit generate` emits the SQL into this dir and the build runs `drizzle-kit migrate`
// against DIRECT_URL. Regressions are DERIVED on read (see lib/queries.ts), never stored here.
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// One verify/eval invocation: a suite run against one model, in one env.
export const evalRun = pgTable(
  'eval_run',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tool: text('tool').notNull(), // which Greenlight tool was evaluated (e.g. 'bamcp')
    model: text('model').notNull(), // 'claude-opus-4-8' | 'claude-sonnet-4-6' | ...
    mode: text('mode').notNull(), // 'eval' | 'agent-web' | 'api' | 'test' | ...
    env: text('env').notNull(), // 'prod' | 'beta' | 'preview'
    gitSha: text('git_sha'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    durationMs: integer('duration_ms'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 4 }),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    passed: boolean('passed').notNull(), // run-level rollup
    passRate: real('pass_rate'), // 0..1, derived from cases
    // Provenance (0003). All optional so older producers keep ingesting unchanged.
    suite: text('suite'), // dataset / benchmark id within a tool+mode, e.g. 'synthetic_v1', 'dracula'
    repo: text('repo'), // 'owner/name' — git_sha links to https://github.com/<repo>/commit/<sha>
    branch: text('branch'),
    sourceUrl: text('source_url'), // the CI run (or report) that produced this row
    metrics: jsonb('metrics').$type<Record<string, number>>(), // run-level numeric metrics (f1, msgs/s…)
    labels: jsonb('labels').$type<Record<string, string>>(), // free-form string labels (judge, label…)
  },
  (t) => [
    index('idx_eval_run_tool_model_started').on(t.tool, t.model, t.startedAt.desc()),
    index('idx_eval_run_tool_started').on(t.tool, t.startedAt.desc()),
  ],
);

// One case/assertion within a run.
export const evalCase = pgTable(
  'eval_case',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    runId: uuid('run_id')
      .notNull()
      .references(() => evalRun.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    input: text('input'),
    expected: text('expected'),
    output: text('output'),
    score: real('score'), // 0..1 (judge score) or null for boolean cases
    passed: boolean('passed').notNull(),
    judgeRationale: text('judge_rationale'), // the LLM judge's reasoning — SURFACE THIS in the UI
    category: text('category'), // grouping within a run (step, stratum, floor…) (0003)
    metrics: jsonb('metrics').$type<Record<string, number>>(), // per-case numeric metrics (0003)
  },
  (t) => [index('idx_eval_case_run').on(t.runId)],
);

export type EvalRunRow = typeof evalRun.$inferSelect;
export type EvalCaseRow = typeof evalCase.$inferSelect;
