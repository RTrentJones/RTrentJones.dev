// Pure regression logic, applied on read by lib/queries (the prod path — there is no SQL mirror) and
// unit-tested without a database (see test/regression.test.ts). A run is a REGRESSION if its pass_rate
// dropped vs its BASELINE on the same series — (tool, mode, suite, model, env). Mode and suite are part
// of the key because one tool reports several unrelated signals (BAMCP's synthetic_v1 vs indel_v1 truth
// sets, the blog's build vs verify stages); comparing across them would flag noise as regressions.
// Derived, never stored (design §5) — backfilled/reordered runs stay correct.
//
// The baseline is the latest EARLIER run in the series that has a pass_rate and is not incomplete: a run
// whose steps errored or were skipped (or that scored nothing) is not evidence of quality, so it neither
// regresses nor serves as the bar the next run is held to. A judge change between a run and its baseline
// makes the two scores incomparable, so it suppresses the regression flag and is reported instead.

import { signalKind } from './signals';
import type { JudgeChange } from './types';

// `passRate` lives in lib/score (the shared scoring primitives); re-exported here for the historical
// import path used by test/passrate.test.ts.
export { passRate } from './score';

export interface SeriesRun {
  id?: string;
  tool: string;
  mode?: string;
  suite?: string | null;
  model: string;
  env: string;
  started_at: string; // ISO timestamp
  pass_rate: number | null;
  labels?: Record<string, string> | null;
  /** Count of this run's cases that are not category 'reported'; null when unknown or when the run has
   * no case rows at all (a run-level-only result, which is complete). */
  gated_cases?: number | null;
}

export type WithRegression<T extends SeriesRun> = T & {
  prev_pass_rate: number | null;
  is_regression: boolean;
  baseline_id: string | null;
  incomplete_reason: string | null;
  judge_change: JudgeChange | null;
};

const seriesKey = (r: SeriesRun) => [r.tool, r.mode ?? '', r.suite ?? '', r.model, r.env].join('\u0000');

/** Comma list label (`"a,b"`) → `"a, b"`, or null when it names nothing. */
function listLabel(v: string | undefined): string | null {
  if (!v) return null;
  const parts = v
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Why a run is INCOMPLETE (not evidence of quality), or null when it is complete. Producers mark
 * errored/skipped steps via `labels.errored` / `labels.skipped`; a non-pipeline run that reports a
 * pass_rate while every one of its cases is 'reported' (gated_cases === 0) scored nothing. A run with no
 * case rows (gated_cases null) is a run-level-only result and is complete. Parts are joined with '; '. */
export function incompleteReason(r: {
  mode?: string;
  pass_rate: number | null;
  labels?: Record<string, string> | null;
  gated_cases?: number | null;
}): string | null {
  const parts: string[] = [];
  const errored = listLabel(r.labels?.errored);
  const skipped = listLabel(r.labels?.skipped);
  if (errored) parts.push(`${errored} errored`);
  if (skipped) parts.push(`${skipped} skipped`);
  if (
    parts.length === 0 &&
    r.gated_cases === 0 &&
    r.pass_rate !== null &&
    signalKind(r.mode ?? '') !== 'pipeline'
  )
    parts.push('no scored cases');
  return parts.length ? parts.join('; ') : null;
}

/** The judge as `provider/model` (or whichever half is present) from a run's labels; null when absent. */
export function judgeOf(labels?: Record<string, string> | null): string | null {
  const provider = labels?.judge_provider || null;
  const model = labels?.judge_model || null;
  if (provider && model) return `${provider}/${model}`;
  return provider ?? model;
}

/**
 * Annotate each run against its baseline (see the header) and whether it regressed. Input order is
 * irrelevant — each series is walked chronologically (started_at, then id) internally — and the
 * returned array preserves the input order so callers can render however they like.
 */
export function deriveRegressions<T extends SeriesRun>(runs: T[]): WithRegression<T>[] {
  const bySeries = new Map<string, T[]>();
  for (const r of runs) {
    const key = seriesKey(r);
    const bucket = bySeries.get(key);
    if (bucket) bucket.push(r);
    else bySeries.set(key, [r]);
  }

  const incomplete = new Map<T, string | null>();
  for (const r of runs) incomplete.set(r, incompleteReason(r));

  const baselineOf = new Map<T, T | null>();
  for (const bucket of bySeries.values()) {
    const ordered = [...bucket].sort(
      (a, b) => a.started_at.localeCompare(b.started_at) || (a.id ?? '').localeCompare(b.id ?? ''),
    );
    let baseline: T | null = null;
    for (const run of ordered) {
      baselineOf.set(run, baseline);
      // Only a run that scored something and completed becomes the next run's baseline.
      if (run.pass_rate !== null && incomplete.get(run) === null) baseline = run;
    }
  }

  return runs.map((r) => {
    const base = baselineOf.get(r) ?? null;
    const reason = incomplete.get(r) ?? null;
    const from = base ? judgeOf(base.labels) : null;
    const to = judgeOf(r.labels);
    const judge_change = from !== null && to !== null && from !== to ? { from, to } : null;
    const prev = base?.pass_rate ?? null;
    return {
      ...r,
      prev_pass_rate: prev,
      baseline_id: base?.id ?? null,
      incomplete_reason: reason,
      judge_change,
      is_regression: prev !== null && r.pass_rate !== null && !reason && !judge_change && r.pass_rate < prev,
    };
  });
}
