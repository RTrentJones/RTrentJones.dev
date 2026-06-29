import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

// DB-backed coverage of the raw SQL the dashboard depends on — regression ordering, DISTINCT ON,
// the write path, the filter scan — which the pure unit suite can't reach. Runs ONLY when
// TEST_DATABASE_URL is set (the tracer-db-tests workflow points it at a throwaway Neon branch); a
// normal `pnpm test` / verify `test` run skips this file, so the loop stays DB-free.
const dbDescribe = describe.runIf(Boolean(process.env.TEST_DATABASE_URL));

type Db = ReturnType<(typeof import('../../lib/db'))['getDb']>;

dbDescribe('tracer queries (DB-backed, Neon branch)', () => {
  // Imported lazily so getDb() reads DATABASE_URL only once the branch env is in place.
  let db: Db;
  let q: typeof import('../../lib/queries');
  let insertRun: (typeof import('../../lib/insert-run'))['insertRun'];

  beforeAll(async () => {
    db = (await import('../../lib/db')).getDb();
    q = await import('../../lib/queries');
    ({ insertRun } = await import('../../lib/insert-run'));
    // Start from a clean slate (the branch is migrated + seeded; we want deterministic fixtures).
    await db.execute(sql`TRUNCATE eval_run, eval_case RESTART IDENTITY CASCADE`);
  });

  const setStarted = (id: string, iso: string) =>
    db.execute(sql`UPDATE eval_run SET started_at = ${iso}::timestamptz WHERE id = ${id}`);

  it('runsWithRegression flags a pass_rate drop and orders newest-first', async () => {
    const base = { tool: 'rt-reg', model: 'm1', mode: 'eval', env: 'prod', passed: true, cases: [] };
    const a = await insertRun({ ...base, pass_rate: 0.9 });
    const b = await insertRun({ ...base, pass_rate: 0.95 });
    const c = await insertRun({ ...base, passed: false, pass_rate: 0.6 });
    await setStarted(a, '2026-06-01T00:00:00Z');
    await setStarted(b, '2026-06-02T00:00:00Z');
    await setStarted(c, '2026-06-03T00:00:00Z');

    const runs = await q.runsWithRegression({ tool: 'rt-reg' }, 100);
    expect(runs.map((r) => r.id)).toEqual([c, b, a]); // newest-first
    expect(runs[0].is_regression).toBe(true); // 0.6 < prior 0.95
    expect(runs[0].prev_pass_rate).toBeCloseTo(0.95, 6);
    expect(runs[1].is_regression).toBe(false); // 0.95 > 0.9 is an improvement
  });

  it('getRun + getCases round-trip the write path, failures first', async () => {
    const id = await insertRun({
      tool: 'rt-cases',
      model: 'm',
      mode: 'eval',
      env: 'prod',
      passed: false,
      pass_rate: 0.5,
      cases: [
        { name: 'z-pass', passed: true, score: 1 },
        { name: 'a-fail', passed: false, score: 0 },
      ],
    });
    expect((await q.getRun(id))?.tool).toBe('rt-cases');
    const cases = await q.getCases(id);
    expect(cases.map((c) => c.name)).toEqual(['a-fail', 'z-pass']); // ORDER BY passed ASC, name
  });

  it('compareModels returns the latest run per model with its cases', async () => {
    const mk = async (model: string, pr: number, started: string) => {
      const id = await insertRun({
        tool: 'rt-cmp',
        model,
        mode: 'eval',
        env: 'prod',
        passed: true,
        pass_rate: pr,
        cases: [{ name: 'case-1', passed: true, score: pr }],
      });
      await setStarted(id, started);
    };
    await mk('m-old', 0.4, '2026-06-01T00:00:00Z');
    await mk('m-new', 0.7, '2026-06-01T00:00:00Z');
    await mk('m-old', 0.8, '2026-06-05T00:00:00Z'); // newer m-old must win the DISTINCT ON

    const cells = await q.compareModels('rt-cmp', 'prod', ['m-old', 'm-new']);
    const byModel = Object.fromEntries(cells.map((c) => [c.model, c.pass_rate]));
    expect(byModel['m-old']).toBeCloseTo(0.8, 6); // latest, not 0.4
    expect(byModel['m-new']).toBeCloseTo(0.7, 6);
  });

  it('latestRunPerTool returns one (newest) row per tool', async () => {
    const rows = await q.latestRunPerTool();
    const tools = rows.map((r) => r.tool);
    expect(new Set(tools).size).toBe(tools.length); // no duplicate tool
    expect(tools).toEqual(expect.arrayContaining(['rt-reg', 'rt-cases', 'rt-cmp']));
  });

  it('filterOptions returns the distinct dimensions', async () => {
    const opts = await q.filterOptions();
    expect(opts.tools).toEqual(expect.arrayContaining(['rt-reg', 'rt-cases', 'rt-cmp']));
    expect(opts.envs).toContain('prod');
    expect(opts.models).toEqual(expect.arrayContaining(['m1', 'm-old', 'm-new']));
  });
});
