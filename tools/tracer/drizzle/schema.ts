// Tracer's eval store — two append-heavy time-series tables (design §2). Drizzle owns the schema;
// `drizzle-kit generate` emits the SQL into this dir and the build runs `drizzle-kit migrate`
// against DIRECT_URL. Regressions are DERIVED on read (see lib/queries.ts), never stored here.
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
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
  },
  (t) => [index('idx_eval_run_tool_model_started').on(t.tool, t.model, t.startedAt.desc())],
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
  },
  (t) => [index('idx_eval_case_run').on(t.runId)],
);

export type EvalRunRow = typeof evalRun.$inferSelect;
export type EvalCaseRow = typeof evalCase.$inferSelect;
