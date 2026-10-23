// Pure read-side analysis for the dashboard: how runs group into SIGNALS, how fresh a signal is, how a
// project's health rolls up, what changed between two runs of a signal, and which cases are flaky.
// No DB access — lib/queries fetches rows, these shape them — so every rule here is unit-tested
// (test/signals.test.ts) and the pages stay thin.
//
// STATUS has ONE definition (signalStatus / projectHealth), used by the overview, project page, summary
// API and badge alike. A signal counts toward its project's health only when it is GATING (a producer
// can mark a feed `gating: false` — trended, not gated) and not STALE (old evidence says nothing about
// now). A run that errored/skipped steps or scored nothing is INCOMPLETE, never "failing" on its own.
// Cases with category 'reported' are informational: shown, never part of pass%, flips or diffs.

import type { JudgeChange } from './types';

/** Sentinel for "suite IS NULL" in filters and scopes (a URL can't carry a SQL null). */
export const NO_SUITE = '__none__';

/** A signal is one (tool, mode, suite, env) feed — e.g. bamcp · truthset · indel_v1 · ci. The model is
 * deliberately NOT part of it: a provider/model change within a feed is the thing a trend should show
 * (and /compare is where models are set side by side). */
export interface SignalKeyed {
  tool: string;
  mode: string;
  suite: string | null;
  env: string;
}

export const signalKey = (r: SignalKeyed) => [r.tool, r.mode, r.suite ?? '', r.env].join('|');

/** Human label for a signal within its project: `mode · suite · env`, suite omitted when absent. */
export const signalLabel = (r: Omit<SignalKeyed, 'tool'>) =>
  [r.mode, r.suite, r.env].filter((p): p is string => Boolean(p)).join(' · ');

// Delivery-pipeline stages (Greenlight `ship` events) answer "did it deploy", not "is it good", so the
// dashboard shows them apart from quality signals (evals, checks, benchmarks).
const PIPELINE_MODES = new Set(['build', 'deploy', 'verify', 'rollback', 'promote', 'ship']);

export type SignalKind = 'pipeline' | 'benchmark' | 'quality';

export function signalKind(mode: string): SignalKind {
  const m = mode.toLowerCase();
  if (PIPELINE_MODES.has(m)) return 'pipeline';
  if (m.includes('bench')) return 'benchmark';
  return 'quality';
}

export type Freshness = 'fresh' | 'aging' | 'stale';

/** How often a feed is expected to report, from `labels.cadence` on its latest run. */
export type Cadence = 'daily' | 'weekly' | 'on-demand';

export function cadenceOf(labels?: Record<string, string> | null): Cadence {
  const c = labels?.cadence;
  return c === 'weekly' || c === 'on-demand' ? c : 'daily';
}

/** Daily feeds: fresh ≤48h, aging ≤8d, stale beyond. Weekly: fresh ≤8d, aging ≤15d, stale beyond.
 * On-demand: fresh ≤48h, otherwise aging — never stale (nothing is overdue when nothing is scheduled). */
export function freshness(latestIso: string, now: number = Date.now(), cadence: Cadence = 'daily'): Freshness {
  const ageH = (now - new Date(latestIso).getTime()) / 3_600_000;
  if (!Number.isFinite(ageH)) return 'stale';
  const day = 24;
  if (cadence === 'on-demand') return ageH > 48 ? 'aging' : 'fresh';
  const [freshH, agingH] = cadence === 'weekly' ? [8 * day, 15 * day] : [48, 8 * day];
  if (ageH > agingH) return 'stale';
  return ageH > freshH ? 'aging' : 'fresh';
}

/** "3h ago" / "2d ago" — coarse, for at-a-glance freshness. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return iso;
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export interface SignalRun extends SignalKeyed {
  id: string;
  model: string;
  started_at: string;
  passed: boolean;
  pass_rate: number | null;
  /** Absent = true (rows predating the column, or scratch shapes). */
  gating?: boolean;
  labels?: Record<string, string> | null;
  metrics?: Record<string, number> | null;
  is_regression?: boolean;
  prev_pass_rate?: number | null;
  incomplete_reason?: string | null;
  judge_change?: JudgeChange | null;
  gated_cases?: number | null;
}

export interface Signal<R extends SignalRun = SignalRun> {
  key: string;
  tool: string;
  mode: string;
  suite: string | null;
  env: string;
  kind: SignalKind;
  latest: R;
  /** Oldest → newest, the latest included; feeds the sparkline. */
  history: R[];
  freshness: Freshness;
  /** From the latest run: `gating !== false`. */
  gating: boolean;
  /** From the latest run's `labels.cadence`. */
  cadence: Cadence;
}

/** Group runs (any order) into signals, each with its newest run and a chronological history. Signals
 * come back quality-first, then by tool and label, so the overview reads the same on every request. */
export function groupSignals<R extends SignalRun>(runs: R[], now: number = Date.now()): Signal<R>[] {
  const byKey = new Map<string, R[]>();
  for (const r of runs) {
    const k = signalKey(r);
    const bucket = byKey.get(k);
    if (bucket) bucket.push(r);
    else byKey.set(k, [r]);
  }
  const order: Record<SignalKind, number> = { quality: 0, benchmark: 1, pipeline: 2 };
  return [...byKey.entries()]
    .map(([key, rs]) => {
      const history = [...rs].sort((a, b) => a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id));
      const latest = history[history.length - 1];
      const cadence = cadenceOf(latest.labels);
      return {
        key,
        tool: latest.tool,
        mode: latest.mode,
        suite: latest.suite,
        env: latest.env,
        kind: signalKind(latest.mode),
        latest,
        history,
        freshness: freshness(latest.started_at, now, cadence),
        gating: latest.gating !== false,
        cadence,
      };
    })
    .sort(
      (a, b) =>
        a.tool.localeCompare(b.tool) ||
        order[a.kind] - order[b.kind] ||
        signalLabel(a).localeCompare(signalLabel(b)),
    );
}

export type Health = 'failing' | 'regressed' | 'passing' | 'stale' | 'empty';

export type SignalState = 'failing' | 'regressed' | 'incomplete' | 'passing';

export interface SignalStatus {
  state: SignalState;
  gating: boolean;
  stale: boolean;
  /** Whether this signal counts toward project health: gating and not stale. */
  counted: boolean;
}

/** The one status rule for a signal's latest run. An incomplete run that passed (or scored nothing) is
 * `incomplete`, not `passing`; a failing verdict outranks a regression. */
export function signalStatus(s: Signal): SignalStatus {
  const l = s.latest;
  const stale = s.freshness === 'stale';
  let state: SignalState;
  if (l.incomplete_reason && (l.passed || l.gated_cases === 0)) state = 'incomplete';
  else if (!l.passed) state = 'failing';
  else if (l.is_regression) state = 'regressed';
  else state = 'passing';
  return { state, gating: s.gating, stale, counted: s.gating && !stale };
}

export interface ProjectHealth {
  tool: string;
  health: Health;
  signals: number;
  failing: number;
  regressed: number;
  /** Candidate signals marked `gating: false` (trended, not gated). */
  tracked: number;
  /** Candidate signals whose latest run is stale. */
  stale: number;
  latestAt: string | null;
}

/** Roll a project's signals up into one status. Pipeline stages are candidates only when they are the
 * project's sole signals (the blog has no evals) — otherwise a red deploy would mask, or be masked by,
 * the evals. Only COUNTED candidates (gating, not stale) can make a project failing or regressed; with
 * `explicit` (a caller narrowed to one signal) a non-gating signal counts too. A failing signal outranks
 * a regression; a project whose every candidate is stale is `stale`: old green is not current evidence. */
export function projectHealth(tool: string, signals: Signal[], opts: { explicit?: boolean } = {}): ProjectHealth {
  const mine = signals.filter((s) => s.tool === tool);
  const nonPipeline = mine.filter((s) => s.kind !== 'pipeline');
  const candidates = nonPipeline.length > 0 ? nonPipeline : mine;
  const statuses = candidates.map((s) => signalStatus(s));
  const counts = (st: SignalStatus) => (opts.explicit ? !st.stale : st.counted);
  const failing = statuses.filter((st) => counts(st) && st.state === 'failing').length;
  const regressed = statuses.filter((st) => counts(st) && st.state === 'regressed').length;
  const tracked = candidates.filter((s) => !s.gating).length;
  const stale = statuses.filter((st) => st.stale).length;
  const latestAt = mine.reduce<string | null>(
    (acc, s) => (acc == null || s.latest.started_at > acc ? s.latest.started_at : acc),
    null,
  );
  let health: Health;
  if (mine.length === 0) health = 'empty';
  else if (failing > 0) health = 'failing';
  else if (regressed > 0) health = 'regressed';
  else if (stale === candidates.length) health = 'stale';
  else health = 'passing';
  return { tool, health, signals: mine.length, failing, regressed, tracked, stale, latestAt };
}

/** Quality/benchmark signals that need a human: counted (gating, not stale) and failing or regressed. */
export function needsAttention<R extends SignalRun>(signals: Signal<R>[]): Signal<R>[] {
  return signals.filter((s) => {
    if (s.kind === 'pipeline') return false;
    const st = signalStatus(s);
    return st.counted && (st.state === 'failing' || st.state === 'regressed');
  });
}

/** A case with category 'reported' is informational (shown, never gated). */
export const isReportedCase = (c: { category?: string | null }): boolean => c.category === 'reported';

/** The run's declared headline metric (`labels.headline_metric`, a finite number in `metrics`), shown
 * instead of a pass rate for benchmarks. No fallback: an undeclared or missing key yields null. */
export function headlineMetric(run: {
  metrics?: Record<string, number> | null;
  labels?: Record<string, string> | null;
}): { key: string; value: number; unit: string | null } | null {
  const key = run.labels?.headline_metric;
  if (!key) return null;
  const value = run.metrics?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return { key, value, unit: run.labels?.headline_unit || null };
}

export interface DiffCase {
  name: string;
  passed: boolean;
  score: number | null;
  category?: string | null;
}

export interface CaseDiff {
  newlyFailing: { name: string; before: DiffCase; after: DiffCase }[];
  newlyPassing: { name: string; before: DiffCase; after: DiffCase }[];
  /** Same verdict, score moved by at least `minDelta`. */
  scoreMoves: { name: string; before: number; after: number; delta: number }[];
  added: string[];
  removed: string[];
  unchanged: number;
}

/** What changed between two runs of the same signal, case by case (matched by name). Duplicate case
 * names within a run keep the last occurrence. A reported case (either side) never counts as newly
 * failing/passing; its score move is still listed. */
export function diffCases(before: DiffCase[], after: DiffCase[], minDelta = 0.05): CaseDiff {
  const b = new Map(before.map((c) => [c.name, c]));
  const a = new Map(after.map((c) => [c.name, c]));
  const out: CaseDiff = { newlyFailing: [], newlyPassing: [], scoreMoves: [], added: [], removed: [], unchanged: 0 };
  for (const [name, cur] of a) {
    const prev = b.get(name);
    if (!prev) {
      out.added.push(name);
      continue;
    }
    const verdictCounts = !isReportedCase(prev) && !isReportedCase(cur);
    if (verdictCounts && prev.passed && !cur.passed) out.newlyFailing.push({ name, before: prev, after: cur });
    else if (verdictCounts && !prev.passed && cur.passed) out.newlyPassing.push({ name, before: prev, after: cur });
    else if (prev.score != null && cur.score != null && Math.abs(cur.score - prev.score) >= minDelta)
      out.scoreMoves.push({ name, before: prev.score, after: cur.score, delta: cur.score - prev.score });
    else out.unchanged++;
  }
  for (const name of b.keys()) if (!a.has(name)) out.removed.push(name);
  out.scoreMoves.sort((x, y) => x.delta - y.delta); // biggest drops first
  out.added.sort();
  out.removed.sort();
  return out;
}

export interface MatrixCase {
  run_id: string;
  name: string;
  passed: boolean;
  score: number | null;
  category: string | null;
}

export interface CaseRow {
  name: string;
  /** One cell per run (same order as the runs passed in); null when the case wasn't in that run. */
  cells: (MatrixCase | null)[];
  /** Verdict changes between consecutive runs where the case was present. */
  flips: number;
  /** Over the non-reported cells; null when every present cell is reported. */
  passRate: number | null;
  flaky: boolean;
  /** Every present cell is a reported case (informational row). */
  reported: boolean;
}

/** Case × run matrix for one signal's recent runs (runs oldest → newest). A case is FLAKY when its
 * verdict flipped at least `flakyFlips` times across the window — on a fixed suite that means noise
 * (or an unstable judge), which is worth knowing before trusting a single run's regression flag.
 * Reported cells are left out of flips, pass rate and "failing now". Rows sort failing-now first, then
 * flakiest, then by name. */
export function caseMatrix(runIds: string[], cases: MatrixCase[], flakyFlips = 2): CaseRow[] {
  const col = new Map(runIds.map((id, i) => [id, i]));
  const rows = new Map<string, (MatrixCase | null)[]>();
  for (const c of cases) {
    const i = col.get(c.run_id);
    if (i === undefined) continue;
    let cells = rows.get(c.name);
    if (!cells) {
      cells = runIds.map(() => null);
      rows.set(c.name, cells);
    }
    cells[i] = c;
  }
  const out: CaseRow[] = [];
  for (const [name, cells] of rows) {
    const present = cells.filter((c): c is MatrixCase => c !== null);
    const gated = present.filter((c) => !isReportedCase(c));
    let flips = 0;
    for (let i = 1; i < gated.length; i++) if (gated[i].passed !== gated[i - 1].passed) flips++;
    const passRate = gated.length ? gated.filter((c) => c.passed).length / gated.length : null;
    const reported = present.length > 0 && gated.length === 0;
    out.push({ name, cells, flips, passRate, flaky: !reported && flips >= flakyFlips, reported });
  }
  const failingNow = (r: CaseRow) => {
    const last = [...r.cells].reverse().find((c) => c !== null);
    return last ? !last.passed && !isReportedCase(last) : false;
  };
  return out.sort(
    (x, y) =>
      Number(failingNow(y)) - Number(failingNow(x)) || y.flips - x.flips || x.name.localeCompare(y.name),
  );
}

export interface MetricRun {
  id: string;
  started_at: string;
  metrics: Record<string, number> | null;
}

/** Pivot run-level metrics into one series per metric key (oldest → newest), keys sorted. Only keys
 * that appear in at least `minPoints` runs are kept — a one-off metric isn't a trend. */
export function metricSeries(
  runs: MetricRun[],
  minPoints = 2,
): { key: string; points: { id: string; t: string; v: number }[] }[] {
  const byKey = new Map<string, { id: string; t: string; v: number }[]>();
  const ordered = [...runs].sort((a, b) => a.started_at.localeCompare(b.started_at));
  for (const r of ordered) {
    for (const [k, v] of Object.entries(r.metrics ?? {})) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const pts = byKey.get(k) ?? [];
      pts.push({ id: r.id, t: r.started_at, v });
      byKey.set(k, pts);
    }
  }
  return [...byKey.entries()]
    .filter(([, pts]) => pts.length >= minPoints)
    .map(([key, points]) => ({ key, points }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** `owner/name` with no dot-only segment (`..` would walk the URL path). Shared with the ingest schema. */
export const REPO_RE = /^(?!\.+\/)[\w.-]+\/(?!\.+$)[\w.-]+$/;

/** GitHub commit link when the run names its repo and a hex sha; otherwise null (rendered as text). */
export function commitUrl(repo: string | null, sha: string | null): string | null {
  if (!repo || !sha || !/^[0-9a-f]{7,40}$/i.test(sha) || !REPO_RE.test(repo)) return null;
  return `https://github.com/${repo}/commit/${sha}`;
}

/** Only http(s) links are rendered as anchors (ingest already enforces this; belt and braces for
 * rows written before validation existed). */
export const safeHref = (u: string | null | undefined): string | null =>
  u && /^https?:\/\//i.test(u) ? u : null;
