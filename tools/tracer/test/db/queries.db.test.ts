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
    // Start from a clean slate (the branch is migrated; we want deterministic fixtures).
    await db.execute(sql`TRUNCATE eval_run, eval_case RESTART IDENTITY CASCADE`);
  });

  // Fixture timestamps are relative to now: the dashboard queries window on recent runs (e.g.
  // runsWithRegression's 90-day default), so fixed calendar dates silently age out of the results.
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  const setStarted = (id: string, iso: string) =>
    db.execute(sql`UPDATE eval_run SET started_at = ${iso}::timestamptz WHERE id = ${id}`);

  it('runsWithRegression flags a pass_rate drop and orders newest-first', async () => {
    const base = { tool: 'rt-reg', model: 'm1', mode: 'eval', env: 'prod', passed: true, cases: [] };
    const a = await insertRun({ ...base, pass_rate: 0.9 });
    const b = await insertRun({ ...base, pass_rate: 0.95 });
    const c = await insertRun({ ...base, passed: false, pass_rate: 0.6 });
    await setStarted(a, daysAgo(10));
    await setStarted(b, daysAgo(9));
    await setStarted(c, daysAgo(8));

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
    await mk('m-old', 0.4, daysAgo(10));
    await mk('m-new', 0.7, daysAgo(10));
    await mk('m-old', 0.8, daysAgo(6)); // newer m-old must win the DISTINCT ON

    const cells = await q.compareModels({ tool: 'rt-cmp', env: 'prod', mode: 'eval' });
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

  it('round-trips provenance, metrics, labels and case category', async () => {
    const id = await insertRun({
      tool: 'rt-prov',
      model: 'deterministic',
      mode: 'truthset',
      env: 'ci',
      suite: 'synthetic_v1',
      repo: 'RTrentJones/BAMCP',
      branch: 'main',
      source_url: 'https://github.com/RTrentJones/BAMCP/actions/runs/1',
      metrics: { f1: 0.97, tp: 12 },
      labels: { trigger: 'push' },
      passed: true,
      pass_rate: 1,
      cases: [{ name: 'floor:recall', category: 'floors', passed: true, score: 1, metrics: { value: 1 } }],
    });
    const run = await q.getRun(id);
    expect(run).toMatchObject({
      suite: 'synthetic_v1',
      repo: 'RTrentJones/BAMCP',
      branch: 'main',
      source_url: 'https://github.com/RTrentJones/BAMCP/actions/runs/1',
      metrics: { f1: 0.97, tp: 12 },
      labels: { trigger: 'push' },
    });
    expect(typeof run?.started_at).toBe('string');
    const [c] = await q.getCases(id);
    expect(c).toMatchObject({ category: 'floors', metrics: { value: 1 } });
  });

  it('series are keyed by suite: previousInSeries and regressions never cross suites', async () => {
    const base = { tool: 'rt-suite', model: 'm', mode: 'truthset', env: 'ci', passed: true, cases: [] };
    const a = await insertRun({ ...base, suite: 'syn', pass_rate: 1 });
    const b = await insertRun({ ...base, suite: 'indel', pass_rate: 0.5 });
    const c = await insertRun({ ...base, suite: 'syn', pass_rate: 0.9 });
    await setStarted(a, daysAgo(5));
    await setStarted(b, daysAgo(4));
    await setStarted(c, daysAgo(3));

    const runC = (await q.getRun(c))!;
    expect((await q.previousInSeries(runC))?.id).toBe(a); // skips the indel run in between
    expect(await q.previousInSeries((await q.getRun(a))!)).toBeNull();

    const runs = await q.runsWithRegression({ tool: 'rt-suite' });
    const byId = Object.fromEntries(runs.map((r) => [r.id, r]));
    expect(byId[b].is_regression).toBe(false); // first indel run, no baseline
    expect(byId[c].is_regression).toBe(true); // 0.9 < 1.0 within syn

    const syn = await q.runsWithRegression({ tool: 'rt-suite', suite: 'syn' });
    expect(syn.map((r) => r.id)).toEqual([c, a]);
  });

  it('recentSignalRuns caps each signal at perSignal rows, oldest-first', async () => {
    const base = { tool: 'rt-sig', model: 'm', mode: 'eval', env: 'ci', passed: true, cases: [] };
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = await insertRun({ ...base, suite: 's1', pass_rate: 0.5 + i / 10 });
      await setStarted(id, daysAgo(10 - i));
      ids.push(id);
    }
    const other = await insertRun({ ...base, suite: 's2', pass_rate: 1 });
    const rows = await q.recentSignalRuns({ tool: 'rt-sig' }, 2);
    const s1 = rows.filter((r) => r.suite === 's1').map((r) => r.id);
    expect(s1).toEqual([ids[2], ids[3]]); // newest two, chronological
    expect(rows.some((r) => r.id === other)).toBe(true);
    expect(rows.every((r) => !('rn' in r))).toBe(true);
  });

  it('signalRuns + casesForRuns feed the case matrix', async () => {
    const base = { tool: 'rt-mx', model: 'm', mode: 'eval', env: 'ci', suite: null, passed: true };
    const r1 = await insertRun({ ...base, pass_rate: 1, cases: [{ name: 'a', passed: true }] });
    const r2 = await insertRun({ ...base, pass_rate: 0, cases: [{ name: 'a', passed: false }] });
    await setStarted(r1, daysAgo(2));
    await setStarted(r2, daysAgo(1));
    const runs = await q.signalRuns({ tool: 'rt-mx', mode: 'eval', suite: null, env: 'ci' }, 5);
    expect(runs.map((r) => r.id)).toEqual([r1, r2]);
    const cells = await q.casesForRuns([r1, r2, 'not-a-uuid']);
    expect(cells.map((c) => [c.run_id, c.passed]).sort()).toEqual([
      [r1, true],
      [r2, false],
    ].sort());
  });

  it('filterOptions exposes modes and suites, scoped to a tool', async () => {
    const opts = await q.filterOptions({ tool: 'rt-suite' });
    expect(opts.modes).toEqual(['truthset']);
    expect(opts.suites).toEqual(['indel', 'syn']);
    expect(opts.tools).toEqual(expect.arrayContaining(['rt-suite', 'rt-prov'])); // tools stay global
  });
});
