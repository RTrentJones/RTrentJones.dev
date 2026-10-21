import { describe, expect, it } from 'vitest';
import {
  type SignalRun,
  caseMatrix,
  commitUrl,
  diffCases,
  freshness,
  groupSignals,
  metricSeries,
  projectHealth,
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
    const cell = (run_id: string, name: string, passed: boolean) => ({ run_id, name, passed, score: null });
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
