import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Migration 0004 relabels legacy producer rows in place. It runs against prod data on deploy, so prove on
// a real Postgres that it is idempotent (a second run is a no-op), lands the relabels with the original
// value preserved in labels, leaves every other row alone, and never touches a verdict or score.
// Runs ONLY when TEST_DATABASE_URL is set, against an already-migrated database (like queries.db.test).
const dbDescribe = describe.runIf(Boolean(process.env.TEST_DATABASE_URL));

// Always node-postgres, even when DATABASE_URL is a Neon branch (CI): the rollback below needs an
// interactive transaction, which the app's Neon HTTP driver does not support. Neon speaks the wire
// protocol too, so the same URL works.
type Db = ReturnType<typeof drizzle>;

const MIGRATION = fileURLToPath(new URL('../../drizzle/0004_relabel_gating.sql', import.meta.url));

// Everything runs inside ONE transaction that is rolled back at the end: no residue, and the other DB
// test file (which TRUNCATEs in its setup and runs in parallel) can neither see nor wipe these fixtures.
class Rollback extends Error {}

type Exec = { execute: Db['execute'] };

interface Fixture {
  tool: string;
  model: string;
  mode: string;
  env: string;
  suite?: string | null;
  passed: boolean;
  pass_rate: number | null;
  labels?: Record<string, string>;
  score?: number; // one case with this score when set
}

async function seed(tx: Exec, f: Fixture): Promise<string> {
  const labels = f.labels ? JSON.stringify(f.labels) : null;
  const res = await tx.execute(sql`
    INSERT INTO eval_run (tool, model, mode, env, suite, passed, pass_rate, labels)
    VALUES (${f.tool}, ${f.model}, ${f.mode}, ${f.env}, ${f.suite ?? null}, ${f.passed}, ${f.pass_rate}, ${labels}::jsonb)
    RETURNING id::text
  `);
  const id = (res.rows[0] as { id: string }).id;
  if (f.score != null)
    await tx.execute(sql`
      INSERT INTO eval_case (run_id, name, passed, score) VALUES (${id}::uuid, 'case', ${f.score >= 0.6}, ${f.score})
    `);
  return id;
}

dbDescribe('migration 0004_relabel_gating (DB-backed)', () => {
  let db: Db;
  let pool: pg.Pool;
  const statements = readFileSync(MIGRATION, 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    db = drizzle(pool);
  });
  afterAll(async () => {
    await pool?.end();
  });

  // Every row of the fixture tools, verdict/score columns rendered as text so equality is byte-exact.
  const snapshot = async (tx: Exec) => {
    const runs = await tx.execute(sql`
      SELECT id::text, tool, model, mode, suite, env, labels, gating, passed::text, pass_rate::text
      FROM eval_run WHERE tool IN ('pg_kafka', 'polyphony', 'tracer', 'blog') ORDER BY id
    `);
    const cases = await tx.execute(sql`
      SELECT c.id::text, c.run_id::text, c.name, c.passed::text, c.score::text
      FROM eval_case c JOIN eval_run r ON r.id = c.run_id
      WHERE r.tool IN ('pg_kafka', 'polyphony', 'tracer', 'blog') ORDER BY c.id
    `);
    return { runs: runs.rows as Record<string, unknown>[], cases: cases.rows as Record<string, unknown>[] };
  };
  const applyAll = async (tx: Exec) => {
    for (const stmt of statements) await tx.execute(sql.raw(stmt));
  };
  const byId = (rows: Record<string, unknown>[]) => Object.fromEntries(rows.map((r) => [r.id as string, r]));

  it('is idempotent, relabels only the legacy rows, and preserves the original values', async () => {
    let ran = false;
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`DELETE FROM eval_run WHERE tool IN ('pg_kafka', 'polyphony', 'tracer', 'blog')`);
        const ids = {
          kafka: await seed(tx, {
            tool: 'pg_kafka',
            model: '0.4.1',
            mode: 'benchmark',
            env: 'ci',
            passed: true,
            pass_rate: 1,
            labels: { cadence: 'weekly' },
            score: 0.91,
          }),
          kafkaNew: await seed(tx, { tool: 'pg_kafka', model: 'pg_kafka', mode: 'benchmark', env: 'ci', passed: true, pass_rate: 1, score: 1 }),
          dracula: await seed(tx, { tool: 'polyphony', model: 'gemini', mode: 'eval', env: 'ci-dracula', passed: false, pass_rate: 0.42, score: 0.42 }),
          frank: await seed(tx, { tool: 'polyphony', model: 'groq', mode: 'eval', env: 'ci-frankenstein', passed: true, pass_rate: 0.83, score: 0.83 }),
          experiment: await seed(tx, { tool: 'polyphony', model: 'gemini', mode: 'eval', env: 'ci-spec-merge-cel', passed: true, pass_rate: 0.7, score: 0.7 }),
          suited: await seed(tx, { tool: 'polyphony', model: 'gemini', mode: 'eval', env: 'ci-dracula', suite: 'keep', passed: true, pass_rate: 0.9, score: 0.9 }),
          dogfood: await seed(tx, { tool: 'tracer', model: 'unknown', mode: 'api+test', env: 'prod', passed: true, pass_rate: 1, score: 1 }),
          otherTracer: await seed(tx, { tool: 'tracer', model: 'unknown', mode: 'eval', env: 'prod', passed: true, pass_rate: 1, score: 1 }),
          blog: await seed(tx, { tool: 'blog', model: 'greenlight', mode: 'deploy', env: 'prod', passed: true, pass_rate: null }),
        };

        const before = await snapshot(tx);
        await applyAll(tx);
        const once = await snapshot(tx);
        await applyAll(tx);
        const twice = await snapshot(tx);

        expect(once.runs).toHaveLength(before.runs.length);
        expect(once.cases).toHaveLength(before.cases.length);
        expect(twice).toEqual(once); // the second pass is a no-op

        const b = byId(before.runs);
        const r = byId(once.runs);
        expect(r[ids.kafka]).toMatchObject({ model: 'pg_kafka', labels: { cadence: 'weekly', version: '0.4.1' } });
        expect(r[ids.dracula]).toMatchObject({ env: 'ci', suite: 'dracula', labels: { legacy_env: 'ci-dracula' } });
        expect(r[ids.frank]).toMatchObject({
          env: 'ci',
          suite: 'frankenstein',
          labels: { legacy_env: 'ci-frankenstein' },
        });
        expect(r[ids.dogfood]).toMatchObject({ model: 'greenlight-verify', labels: { legacy_model: 'unknown' } });

        // Untouched: an already-current row, the experiment env, a row that already has a suite, other
        // tracer modes, the blog.
        for (const k of ['kafkaNew', 'experiment', 'suited', 'otherTracer', 'blog'] as const)
          expect(r[ids[k]]).toEqual(b[ids[k]]);

        // Verdicts and scores are byte-identical everywhere; gating reads its default.
        for (const row of once.runs) {
          expect(row.passed).toBe(b[row.id as string].passed);
          expect(row.pass_rate).toBe(b[row.id as string].pass_rate);
          expect(row.gating).toBe(true);
        }
        expect(once.cases).toEqual(before.cases);
        ran = true;
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
    expect(ran).toBe(true);
  });

  it('every UPDATE is scoped by tool, and nothing deletes', () => {
    const updates = statements.filter((s) => /\bUPDATE\b/i.test(s));
    expect(updates).toHaveLength(3);
    for (const u of updates) expect(u).toMatch(/WHERE tool = '/);
    expect(statements.join('\n')).not.toMatch(/\b(DELETE|TRUNCATE|DROP)\b/i);
  });
});
