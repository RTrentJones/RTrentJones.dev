import { describe, expect, it } from 'vitest';
import {
  type SignalRun,
  cadenceOf,
  caseMatrix,
  commitUrl,
  diffCases,
  freshness,
  groupSignals,
  headlineMetric,
  isReportedCase,
  metricSeries,
  needsAttention,
  projectHealth,
  signalStatus,
  relativeTime,
  safeHref,
  signalKind,
  signalLabel,
} from '../lib/signals';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

let seq = 0;
const run = (over: Partial<SignalRun> = {}): SignalRun => ({
  id: `r${++seq}`,
  tool: 'bamcp',
  mode: 'truthset',
  suite: 'synthetic_v1',
  env: 'ci',
  model: 'deterministic',
  started_at: hoursAgo(1),
  passed: true,
  pass_rate: 1,
  ...over,
});

describe('signalKind / signalLabel', () => {
  it('separates delivery-pipeline stages from quality and benchmark signals', () => {
    expect(signalKind('deploy')).toBe('pipeline');
    expect(signalKind('Verify')).toBe('pipeline');
    expect(signalKind('benchmark')).toBe('benchmark');
    expect(signalKind('eval')).toBe('quality');
    expect(signalKind('api+test')).toBe('quality');
  });

  it('omits a missing suite from the label', () => {
    expect(signalLabel({ mode: 'eval', suite: 'dracula', env: 'ci' })).toBe('eval · dracula · ci');
    expect(signalLabel({ mode: 'api+test', suite: null, env: 'prod' })).toBe('api+test · prod');
  });
});

describe('freshness / relativeTime', () => {
  it('buckets by age', () => {
    expect(freshness(hoursAgo(3), NOW)).toBe('fresh');
    expect(freshness(hoursAgo(72), NOW)).toBe('aging');
    expect(freshness(hoursAgo(24 * 9), NOW)).toBe('stale');
    expect(freshness('not a date', NOW)).toBe('stale');
  });

  it('formats coarse relative times', () => {
    expect(relativeTime(hoursAgo(0), NOW)).toBe('just now');
    expect(relativeTime(hoursAgo(0.5), NOW)).toBe('30m ago');
    expect(relativeTime(hoursAgo(5), NOW)).toBe('5h ago');
    expect(relativeTime(hoursAgo(24 * 3), NOW)).toBe('3d ago');
  });
});

describe('groupSignals', () => {
  it('groups by tool/mode/suite/env (not model) with a chronological history', () => {
    const a = run({ started_at: hoursAgo(30), model: 'm1', pass_rate: 0.8 });
    const b = run({ started_at: hoursAgo(2), model: 'm2', pass_rate: 0.9 });
    const other = run({ suite: 'indel_v1' });
    const sigs = groupSignals([b, other, a], NOW);
    expect(sigs).toHaveLength(2);
    const syn = sigs.find((s) => s.suite === 'synthetic_v1')!;
    expect(syn.history.map((r) => r.id)).toEqual([a.id, b.id]);
    expect(syn.latest.id).toBe(b.id);
    expect(syn.freshness).toBe('fresh');
  });

  it('orders quality before benchmark before pipeline within a tool', () => {
    const sigs = groupSignals(
      [run({ tool: 't', mode: 'deploy' }), run({ tool: 't', mode: 'benchmark' }), run({ tool: 't', mode: 'eval' })],
      NOW,
    );
    expect(sigs.map((s) => s.kind)).toEqual(['quality', 'benchmark', 'pipeline']);
  });
});

describe('projectHealth', () => {
  it('a failing latest quality run makes the project failing', () => {
    const sigs = groupSignals([run({ passed: false, pass_rate: 0.5 }), run({ suite: 'indel_v1' })], NOW);
    const h = projectHealth('bamcp', sigs);
    expect(h.health).toBe('failing');
    expect(h.failing).toBe(1);
    expect(h.signals).toBe(2);
  });

  it('ignores pipeline stages when quality signals exist', () => {
    const sigs = groupSignals([run(), run({ mode: 'deploy', suite: null, passed: false })], NOW);
    expect(projectHealth('bamcp', sigs).health).toBe('passing');
  });

  it('falls back to pipeline stages for a project with nothing else (the blog)', () => {
    const sigs = groupSignals([run({ tool: 'blog', mode: 'deploy', suite: null, passed: false })], NOW);
    expect(projectHealth('blog', sigs).health).toBe('failing');
  });

  it('flags a regression, and reports all-stale green as stale', () => {
    expect(projectHealth('bamcp', groupSignals([run({ is_regression: true })], NOW)).health).toBe('regressed');
    expect(projectHealth('bamcp', groupSignals([run({ started_at: hoursAgo(24 * 30) })], NOW)).health).toBe('stale');
    expect(projectHealth('nope', []).health).toBe('empty');
  });
});

describe('diffCases', () => {
  const c = (name: string, passed: boolean, score: number | null = null) => ({ name, passed, score });

  it('classifies verdict flips, score moves, added and removed cases', () => {
    const d = diffCases(
      [c('a', true, 0.9), c('b', false, 0.2), c('c', true, 0.9), c('d', true, 0.5), c('gone', true)],
      [c('a', false, 0.3), c('b', true, 0.8), c('c', true, 0.7), c('d', true, 0.52), c('new', true)],
    );
    expect(d.newlyFailing.map((x) => x.name)).toEqual(['a']);
    expect(d.newlyPassing.map((x) => x.name)).toEqual(['b']);
    expect(d.scoreMoves).toEqual([{ name: 'c', before: 0.9, after: 0.7, delta: expect.closeTo(-0.2, 6) }]);
    expect(d.unchanged).toBe(1); // d moved < minDelta
    expect(d.added).toEqual(['new']);
    expect(d.removed).toEqual(['gone']);
  });
});

describe('caseMatrix', () => {
  it('aligns cases to runs, counts flips, and marks flaky cases', () => {
    const runs = ['r1', 'r2', 'r3', 'r4'];
    const cell = (run_id: string, name: string, passed: boolean) => ({ run_id, name, passed, score: null, category: null });
    const rows = caseMatrix(runs, [
      cell('r1', 'stable', true),
      cell('r2', 'stable', true),
      cell('r3', 'stable', true),
      cell('r4', 'stable', true),
      cell('r1', 'noisy', true),
      cell('r2', 'noisy', false),
      cell('r3', 'noisy', true),
      cell('r4', 'noisy', true),
      cell('r3', 'broke', true),
      cell('r4', 'broke', false),
      cell('elsewhere', 'stable', false), // a run not in the window is ignored
    ]);
    expect(rows.map((r) => r.name)).toEqual(['broke', 'noisy', 'stable']); // failing-now, then flakiest
    const noisy = rows.find((r) => r.name === 'noisy')!;
    expect(noisy.flips).toBe(2);
    expect(noisy.flaky).toBe(true);
    expect(noisy.passRate).toBe(0.75);
    const broke = rows.find((r) => r.name === 'broke')!;
    expect(broke.cells[0]).toBeNull();
    expect(broke.flaky).toBe(false);
  });
});

describe('metricSeries', () => {
  it('pivots run metrics into per-key series, dropping one-off keys and non-finite values', () => {
    const s = metricSeries([
      { id: 'b', started_at: '2026-01-02', metrics: { f1: 0.9, once: 1 } },
      { id: 'a', started_at: '2026-01-01', metrics: { f1: 0.8, recall: Number.NaN } },
      { id: 'c', started_at: '2026-01-03', metrics: null },
    ]);
    expect(s).toEqual([
      {
        key: 'f1',
        points: [
          { id: 'a', t: '2026-01-01', v: 0.8 },
          { id: 'b', t: '2026-01-02', v: 0.9 },
        ],
      },
    ]);
  });
});

describe('links', () => {
  it('builds commit links only from a valid repo + hex sha', () => {
    expect(commitUrl('RTrentJones/BAMCP', 'b76fd3e')).toBe('https://github.com/RTrentJones/BAMCP/commit/b76fd3e');
    expect(commitUrl(null, 'b76fd3e')).toBeNull();
    expect(commitUrl('RTrentJones/BAMCP', 'main')).toBeNull();
    expect(commitUrl('../evil', 'b76fd3e')).toBeNull();
    expect(commitUrl('owner/..', 'b76fd3e')).toBeNull();
    expect(commitUrl('my.org/my-repo.js', 'b76fd3e')).not.toBeNull();
  });

  it('only treats http(s) as a safe href', () => {
    expect(safeHref('https://github.com/x/y/actions/runs/1')).toBe('https://github.com/x/y/actions/runs/1');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});

describe('cadence-aware freshness', () => {
  it('reads cadence from labels, defaulting to daily', () => {
    expect(cadenceOf({ cadence: 'weekly' })).toBe('weekly');
    expect(cadenceOf({ cadence: 'on-demand' })).toBe('on-demand');
    expect(cadenceOf({ cadence: 'hourly' })).toBe('daily');
    expect(cadenceOf(null)).toBe('daily');
  });

  it('gives weekly feeds a longer window and never lets on-demand go stale', () => {
    expect(freshness(hoursAgo(24 * 7), NOW, 'weekly')).toBe('fresh');
    expect(freshness(hoursAgo(24 * 9), NOW, 'weekly')).toBe('aging');
    expect(freshness(hoursAgo(24 * 16), NOW, 'weekly')).toBe('stale');
    expect(freshness(hoursAgo(24), NOW, 'on-demand')).toBe('fresh');
    expect(freshness(hoursAgo(24 * 30), NOW, 'on-demand')).toBe('aging');
    expect(freshness(hoursAgo(24 * 9), NOW, 'daily')).toBe('stale');
  });

  it('groupSignals applies the latest run cadence and gating', () => {
    const [s] = groupSignals([run({ started_at: hoursAgo(24 * 9), labels: { cadence: 'weekly' }, gating: false })], NOW);
    expect(s.cadence).toBe('weekly');
    expect(s.freshness).toBe('aging');
    expect(s.gating).toBe(false);
    expect(groupSignals([run()], NOW)[0].gating).toBe(true); // absent = gating
  });
});

describe('signalStatus', () => {
  const status = (over: Partial<SignalRun>) => signalStatus(groupSignals([run(over)], NOW)[0]);

  it('applies the rules in order: incomplete, failing, regressed, passing', () => {
    expect(status({ incomplete_reason: 'outline errored' }).state).toBe('incomplete');
    expect(status({ incomplete_reason: 'no scored cases', passed: false, gated_cases: 0 }).state).toBe('incomplete');
    expect(status({ incomplete_reason: 'x errored', passed: false, gated_cases: 3 }).state).toBe('failing');
    expect(status({ passed: false, is_regression: true }).state).toBe('failing');
    expect(status({ is_regression: true }).state).toBe('regressed');
    expect(status({}).state).toBe('passing');
  });

  it('counts only gating, non-stale signals', () => {
    expect(status({})).toMatchObject({ gating: true, stale: false, counted: true });
    expect(status({ gating: false })).toMatchObject({ gating: false, counted: false });
    expect(status({ started_at: hoursAgo(24 * 30) })).toMatchObject({ stale: true, counted: false });
  });
});

describe('projectHealth — gating and freshness', () => {
  it('a stale failing signal does not fail the project and needs no attention', () => {
    const sigs = groupSignals(
      [run({ suite: 'old', passed: false, pass_rate: 0.2, started_at: hoursAgo(24 * 30) }), run({ suite: 'new' })],
      NOW,
    );
    const h = projectHealth('bamcp', sigs);
    expect(h.health).toBe('passing');
    expect(h.failing).toBe(0);
    expect(h.stale).toBe(1);
    expect(needsAttention(sigs)).toEqual([]);
  });

  it('an all-stale project is stale, even when failing', () => {
    const sigs = groupSignals([run({ passed: false, started_at: hoursAgo(24 * 30) })], NOW);
    expect(projectHealth('bamcp', sigs).health).toBe('stale');
  });

  it('a non-gating signal is tracked, never failing', () => {
    const sigs = groupSignals(
      [
        run({ mode: 'truthset' }),
        run({ mode: 'llm-eval', suite: 'arms', gating: false, passed: false, pass_rate: 0.8, is_regression: true }),
      ],
      NOW,
    );
    const h = projectHealth('bamcp', sigs);
    expect(h).toMatchObject({ health: 'passing', tracked: 1, failing: 0, regressed: 0 });
    expect(needsAttention(sigs)).toEqual([]);
  });

  it('explicit narrowing counts a non-gating signal', () => {
    const sigs = groupSignals([run({ gating: false, passed: false, pass_rate: 0.5 })], NOW);
    expect(projectHealth('bamcp', sigs).health).toBe('passing');
    expect(projectHealth('bamcp', sigs, { explicit: true })).toMatchObject({ health: 'failing', failing: 1 });
  });

  it('needsAttention lists counted failing/regressed quality signals, never pipeline ones', () => {
    const sigs = groupSignals(
      [
        run({ suite: 'a', passed: false }),
        run({ suite: 'b', is_regression: true }),
        run({ suite: 'c' }),
        run({ suite: 'd', incomplete_reason: 'x errored' }),
        run({ mode: 'deploy', suite: null, passed: false }),
      ],
      NOW,
    );
    expect(needsAttention(sigs).map((s) => s.suite).sort()).toEqual(['a', 'b']);
  });
});

describe('reported cases', () => {
  it('isReportedCase matches the category only', () => {
    expect(isReportedCase({ category: 'reported' })).toBe(true);
    expect(isReportedCase({ category: 'floors' })).toBe(false);
    expect(isReportedCase({})).toBe(false);
  });

  it('a reported matrix row has no pass rate, is not flaky and is not failing now', () => {
    const cell = (run_id: string, name: string, passed: boolean, category: string | null) => ({
      run_id,
      name,
      passed,
      score: null,
      category,
    });
    const rows = caseMatrix(
      ['r1', 'r2', 'r3'],
      [
        cell('r1', 'info', true, 'reported'),
        cell('r2', 'info', false, 'reported'),
        cell('r3', 'info', true, 'reported'),
        cell('r1', 'mixed', true, null),
        cell('r2', 'mixed', false, 'reported'),
        cell('r3', 'mixed', true, null),
        cell('r3', 'zz-gate', true, null),
      ],
    );
    const info = rows.find((r) => r.name === 'info')!;
    expect(info).toMatchObject({ reported: true, passRate: null, flaky: false, flips: 0 });
    const mixed = rows.find((r) => r.name === 'mixed')!;
    expect(mixed).toMatchObject({ reported: false, passRate: 1, flips: 0, flaky: false });
    const last = caseMatrix(['r1'], [cell('r1', 'a', false, 'reported'), cell('r1', 'b', false, null)]);
    expect(last.map((r) => r.name)).toEqual(['b', 'a']); // only the gated failure is failing now
  });

  it('diffCases keeps reported cases out of newly failing/passing but lists their score moves', () => {
    const d = diffCases(
      [
        { name: 'r', passed: true, score: 0.9, category: 'reported' },
        { name: 'p', passed: false, score: 0.1, category: 'reported' },
        { name: 'g', passed: true, score: 1, category: null },
      ],
      [
        { name: 'r', passed: false, score: 0.2, category: 'reported' },
        { name: 'p', passed: true, score: 0.1, category: 'reported' },
        { name: 'g', passed: false, score: 0, category: null },
      ],
    );
    expect(d.newlyFailing.map((x) => x.name)).toEqual(['g']);
    expect(d.newlyPassing).toEqual([]);
    expect(d.scoreMoves.map((x) => x.name)).toEqual(['r']);
    expect(d.unchanged).toBe(1);
  });
});

describe('headlineMetric', () => {
  it('returns the declared metric with its unit', () => {
    expect(
      headlineMetric({
        metrics: { best_msgs_per_sec: 20626, other: 1 },
        labels: { headline_metric: 'best_msgs_per_sec', headline_unit: 'msgs/s' },
      }),
    ).toEqual({ key: 'best_msgs_per_sec', value: 20626, unit: 'msgs/s' });
    expect(headlineMetric({ metrics: { f1: 0.9 }, labels: { headline_metric: 'f1' } })).toEqual({
      key: 'f1',
      value: 0.9,
      unit: null,
    });
  });

  it('has no fallback: undeclared, missing or non-finite is null', () => {
    expect(headlineMetric({ metrics: { f1: 0.9 }, labels: null })).toBeNull();
    expect(headlineMetric({ metrics: { f1: 0.9 }, labels: { headline_metric: 'nope' } })).toBeNull();
    expect(headlineMetric({ metrics: { f1: Number.NaN }, labels: { headline_metric: 'f1' } })).toBeNull();
    expect(headlineMetric({ metrics: null, labels: { headline_metric: 'f1' } })).toBeNull();
  });
});
