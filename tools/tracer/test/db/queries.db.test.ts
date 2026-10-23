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

  // A run needs at least one gated case to be complete (lib/regression: "no scored cases").
  const scored = { name: 'c', passed: true };

  const setStarted = (id: string, iso: string) =>
    db.execute(sql`UPDATE eval_run SET started_at = ${iso}::timestamptz WHERE id = ${id}`);

  it('runsWithRegression flags a pass_rate drop and orders newest-first', async () => {
    const base = { tool: 'rt-reg', model: 'm1', mode: 'eval', env: 'prod', passed: true, cases: [scored] };
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
    expect(cases.map((c) => c.name)).toEqual(['a-fail', 'z-pass']); // gated failures first, then name
  });

  it('compareModels returns the latest run per model with its cases and header fields', async () => {
    const mk = async (model: string, pr: number, started: string) => {
      const id = await insertRun({
        tool: 'rt-cmp',
        model,
        mode: 'eval',
        env: 'prod',
        suite: 'x',
        git_sha: `sha-${model}`,
        passed: true,
        pass_rate: pr,
        cases: [{ name: 'case-1', passed: true, score: pr, category: 'step' }],
      });
      await setStarted(id, started);
      return id;
    };
    await mk('m-old', 0.4, daysAgo(10));
    const newId = await mk('m-new', 0.7, daysAgo(10));
    const oldId = await mk('m-old', 0.8, daysAgo(6)); // newer m-old must win the DISTINCT ON

    const cells = await q.compareModels({ tool: 'rt-cmp', env: 'prod', mode: 'eval', suite: 'x' });
    const byModel = Object.fromEntries(cells.map((c) => [c.model, c]));
    expect(byModel['m-old'].pass_rate).toBeCloseTo(0.8, 6); // latest, not 0.4
    expect(byModel['m-old']).toMatchObject({ run_id: oldId, git_sha: 'sha-m-old', category: 'step' });
    expect(byModel['m-old'].started_at).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/); // ISO, normalised
    expect(byModel['m-new']).toMatchObject({ run_id: newId, git_sha: 'sha-m-new' });
    expect(byModel['m-new'].pass_rate).toBeCloseTo(0.7, 6);
  });

  it('compareModels never spans suites, and NO_SUITE matches the null suite', async () => {
    const { NO_SUITE } = await import('../../lib/signals');
    const mk = async (model: string, suite: string | null, name: string, started: string) => {
      const id = await insertRun({
        tool: 'rt-cmp2',
        model,
        mode: 'eval',
        env: 'ci',
        suite,
        passed: true,
        pass_rate: 1,
        cases: [{ name, passed: true }],
      });
      await setStarted(id, started);
      return id;
    };
    const x = await mk('m1', 'X', 'x-case', daysAgo(5));
    await mk('m1', 'Y', 'y-case', daysAgo(4)); // newer, other suite: must not shadow X
    const nul = await mk('m2', null, 'null-case', daysAgo(3));

    const inX = await q.compareModels({ tool: 'rt-cmp2', mode: 'eval', suite: 'X', env: 'ci' });
    expect(inX.map((c) => [c.model, c.name, c.run_id])).toEqual([['m1', 'x-case', x]]);
    const inNull = await q.compareModels({ tool: 'rt-cmp2', mode: 'eval', suite: NO_SUITE, env: 'ci' });
    expect(inNull.map((c) => [c.model, c.name, c.run_id])).toEqual([['m2', 'null-case', nul]]);

    expect(await q.latestCaseScope({ tool: 'rt-cmp2' })).toEqual({
      tool: 'rt-cmp2',
      mode: 'eval',
      suite: NO_SUITE,
      env: 'ci',
    });
    expect(await q.latestCaseScope({ tool: 'rt-cmp2', suite: 'X' })).toMatchObject({ suite: 'X' });
    expect(await q.latestCaseScope({ tool: 'rt-nothing' })).toBeNull();
    expect(await q.suitesByRecency({ tool: 'rt-cmp2', mode: 'eval' })).toEqual([NO_SUITE, 'Y', 'X']);
    expect(await q.suitesByRecency({ tool: 'rt-cmp2', mode: 'eval', env: 'prod' })).toEqual([]);

    const filtered = await q.runsWithRegression({ tool: 'rt-cmp2', suite: NO_SUITE });
    expect(filtered.map((r) => r.id)).toEqual([nul]);
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

  it('series are keyed by suite: baselines and regressions never cross suites', async () => {
    const base = { tool: 'rt-suite', model: 'm', mode: 'truthset', env: 'ci', passed: true, cases: [scored] };
    const a = await insertRun({ ...base, suite: 'syn', pass_rate: 1 });
    const b = await insertRun({ ...base, suite: 'indel', pass_rate: 0.5 });
    const c = await insertRun({ ...base, suite: 'syn', pass_rate: 0.9 });
    await setStarted(a, daysAgo(5));
    await setStarted(b, daysAgo(4));
    await setStarted(c, daysAgo(3));

    const runC = await q.runWithBaseline((await q.getRun(c))!);
    expect(runC.baseline?.id).toBe(a); // skips the indel run in between
    expect(runC.run.is_regression).toBe(true);
    expect((await q.runWithBaseline((await q.getRun(a))!)).baseline).toBeNull();

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

dbDescribe('tracer status (DB-backed): one status rule, baselines, counts', () => {
  let db: Db;
  let q: typeof import('../../lib/queries');
  let insertRun: (typeof import('../../lib/insert-run'))['insertRun'];

  beforeAll(async () => {
    db = (await import('../../lib/db')).getDb();
    q = await import('../../lib/queries');
    ({ insertRun } = await import('../../lib/insert-run'));
  });

  const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();
  const setStarted = (id: string, iso: string) =>
    db.execute(sql`UPDATE eval_run SET started_at = ${iso}::timestamptz WHERE id = ${id}`);
  const scored = { name: 'c', passed: true };

  it('projectSummary agrees with the overview rollup (M1): A 0.9 → B 0.8 → A 0.7 is regressed', async () => {
    const { projectSummary } = await import('../../lib/summary');
    const { groupSignals, projectHealth } = await import('../../lib/signals');
    const base = { tool: 'rt-m1', mode: 'eval', suite: 's', env: 'ci', passed: true, cases: [scored] };
    const a1 = await insertRun({ ...base, model: 'A', pass_rate: 0.9 });
    const b = await insertRun({ ...base, model: 'B', pass_rate: 0.8 });
    const a2 = await insertRun({ ...base, model: 'A', pass_rate: 0.7 });
    await setStarted(a1, hoursAgo(5));
    await setStarted(b, hoursAgo(4));
    await setStarted(a2, hoursAgo(3));

    const summary = await projectSummary('rt-m1');
    const overview = projectHealth('rt-m1', groupSignals(await q.recentSignalRuns({}, 20)));
    expect(summary.regressed).toBe(1);
    expect(summary.health).toBe('regressed');
    expect(overview.regressed).toBe(summary.regressed);
    expect(overview.health).toBe(summary.health);
    const [sig] = summary.signals_detail;
    expect(sig).toMatchObject({ key: 'rt-m1|eval|s|ci', state: 'regressed', counted: true, gating: true });
    expect(sig.cadence).toBe('daily');

    const narrowed = await projectSummary('rt-m1', 'rt-m1|eval|s|ci');
    expect(narrowed.signals_detail).toHaveLength(1);
    expect((await projectSummary('rt-m1', 'rt-m1|eval|nope|ci')).health).toBe('empty');
  });

  it('projectSummary exposes gating, git_sha, headline and the explicit rule', async () => {
    const { projectSummary } = await import('../../lib/summary');
    const id = await insertRun({
      tool: 'rt-gate',
      model: 'm',
      mode: 'llm-eval',
      env: 'ci',
      suite: 'arms',
      git_sha: 'abc1234',
      gating: false,
      passed: false,
      pass_rate: 0.5,
      metrics: { f1: 0.5 },
      labels: { headline_metric: 'f1' },
      cases: [scored],
    });
    const s = await projectSummary('rt-gate');
    expect(s).toMatchObject({ health: 'passing', tracked: 1, failing: 0 });
    expect(s.signals_detail[0]).toMatchObject({
      gating: false,
      counted: false,
      state: 'failing',
      git_sha: 'abc1234',
      headline: { key: 'f1', value: 0.5, unit: null },
      run: `/runs/${id}`,
    });
    expect((await projectSummary('rt-gate', 'rt-gate|llm-eval|arms|ci')).health).toBe('failing');
  });

  it('runWithBaseline skips an incomplete predecessor (same rule as the list)', async () => {
    const base = { tool: 'rt-base', model: 'm', mode: 'eval', env: 'ci', suite: null, passed: true };
    const a = await insertRun({ ...base, pass_rate: 0.9, cases: [scored] });
    const b = await insertRun({ ...base, pass_rate: 0, labels: { errored: 'outline' }, cases: [scored] });
    const c = await insertRun({ ...base, pass_rate: 0.8, cases: [scored] });
    await setStarted(a, hoursAgo(30));
    await setStarted(b, hoursAgo(20));
    await setStarted(c, hoursAgo(10));

    const { run, baseline } = await q.runWithBaseline((await q.getRun(c))!);
    expect(baseline?.id).toBe(a);
    expect(run).toMatchObject({ baseline_id: a, is_regression: true, gated_cases: 1 });
    expect(run.prev_pass_rate).toBeCloseTo(0.9, 6);
    const list = await q.runsWithRegression({ tool: 'rt-base' });
    const listed = list.find((r) => r.id === c)!;
    expect(listed.baseline_id).toBe(run.baseline_id);
    expect(list.find((r) => r.id === b)).toMatchObject({ incomplete_reason: 'outline errored', is_regression: false });
    expect((await q.runWithBaseline((await q.getRun(b))!)).run.incomplete_reason).toBe('outline errored');
  });

  it('countRunsSince is a true count', async () => {
    const old = await insertRun({ tool: 'rt-count', model: 'm', mode: 'eval', env: 'ci', passed: true, cases: [] });
    await setStarted(old, hoursAgo(24 * 30));
    const res = await db.execute(sql`SELECT count(*)::int AS n FROM eval_run WHERE started_at >= now() - interval '7 days'`);
    const truth = Number((res.rows[0] as { n: number }).n);
    expect(truth).toBeGreaterThan(0);
    expect(await q.countRunsSince(7)).toBe(truth);
    expect(await q.countRunsSince(365)).toBeGreaterThan(truth);
  });

  it('gated_cases excludes reported cases; getCases sorts reported with the passes', async () => {
    const id = await insertRun({
      tool: 'rt-reported',
      model: 'm',
      mode: 'eval',
      env: 'ci',
      passed: true,
      pass_rate: 1,
      cases: [
        { name: 'a-reported', passed: false, category: 'reported' },
        { name: 'b-gated-fail', passed: false },
        { name: 'c-gated-pass', passed: true },
      ],
    });
    const only = await insertRun({
      tool: 'rt-reported',
      model: 'm',
      mode: 'eval',
      env: 'ci',
      suite: 'info',
      passed: true,
      pass_rate: 1,
      cases: [{ name: 'r', passed: true, category: 'reported' }],
    });
    // No case rows at all = a run-level-only result: gated_cases is null and the run is complete.
    const bare = await insertRun({
      tool: 'rt-reported',
      model: 'm',
      mode: 'eval',
      env: 'ci',
      suite: 'run-level',
      passed: true,
      pass_rate: 0.8,
      cases: [],
    });
    const runs = await q.recentSignalRuns({ tool: 'rt-reported' });
    expect(runs.find((r) => r.id === id)?.gated_cases).toBe(2);
    expect(runs.find((r) => r.id === only)).toMatchObject({ gated_cases: 0, incomplete_reason: 'no scored cases' });
    expect(runs.find((r) => r.id === bare)).toMatchObject({ gated_cases: null, incomplete_reason: null });
    expect((await q.runsWithRegression({ tool: 'rt-reported', suite: 'run-level' }))[0]).toMatchObject({
      gated_cases: null,
      incomplete_reason: null,
    });
    expect((await q.getCases(id)).map((c) => c.name)).toEqual(['b-gated-fail', 'a-reported', 'c-gated-pass']);
    const cells = await q.casesForRuns([id]);
    expect(cells.find((c) => c.name === 'a-reported')?.category).toBe('reported');
  });

  it('stores gating (default true) and clips over-long case names to 255 chars', async () => {
    const id = await insertRun({
      tool: 'rt-ingest',
      model: 'm',
      mode: 'eval',
      env: 'ci',
      passed: true,
      cases: [{ name: 'n'.repeat(300), passed: true }],
    });
    const tracked = await insertRun({ tool: 'rt-ingest', model: 'm', mode: 'eval', env: 'ci', passed: true, gating: false, cases: [] });
    expect((await q.getRun(id))?.gating).toBe(true);
    expect((await q.getRun(tracked))?.gating).toBe(false);
    const [c] = await q.getCases(id);
    expect(c.name).toHaveLength(255);
    expect(c.name.endsWith('…')).toBe(true);
    expect(c.name.slice(0, 254)).toBe('n'.repeat(254));
  });
});
