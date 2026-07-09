// Build-time evidence loader for the pg_kafka showcase.
//
// pg_kafka isn't a hosted service — its "live" surface is continuously-verified evidence generated
// by pg_kafka's OWN CI (it owns the cached pgrx build + the real-broker compose, like heistmind/bamcp
// own their pipelines) and published to its orphan `evidence` branch. We fetch those artifacts at
// BUILD time and render them server-side (no client JS). The evidence branch is the single source of
// truth: there's NO fabricated fallback — if a fetch fails (rare; raw.githubusercontent is highly
// available from CI), the component renders an honest "unavailable" note rather than fake numbers.
// Each artifact carries its own `generatedAt`, so the page shows when the evidence was last verified.

const EVIDENCE_BASE =
  import.meta.env.PG_KAFKA_EVIDENCE_BASE ??
  'https://raw.githubusercontent.com/RTrentJones/pg_kafka/evidence';

const FETCH_TIMEOUT_MS = 5000;

export const REPO_URL = 'https://github.com/RTrentJones/pg_kafka';
export const CODESPACE_URL = 'https://codespaces.new/RTrentJones/pg_kafka';
export const TRACER_TREND_URL = 'https://tracer.rtrentjones.dev/runs?tool=pg_kafka';
export const SESSION_SVG_URL = `${EVIDENCE_BASE}/session.svg`;

export type CellStatus = 'pass' | 'fail' | 'na';

export interface ConformanceData {
  generatedAt: string;
  version: string;
  gitSha?: string;
  apis: { key: number; name: string }[];
  clients: { name: string; lang: string; version?: string; results: Record<string, CellStatus> }[];
}

export interface BenchScenario {
  name: string;
  p50Ms: number;
  p99Ms: number;
  msgsPerSec: number;
}
export interface BenchBaseline {
  msgsPerSec: number;
  p50Ms: number;
  p99Ms: number;
}
export interface BenchData {
  generatedAt: string;
  version: string;
  gitSha?: string;
  config: { warmupExcluded: boolean; messageSizes: number[] };
  scenarios: BenchScenario[];
  baselines: { rawInsert: BenchBaseline; realBroker: BenchBaseline };
}

export interface ShadowData {
  generatedAt: string;
  version: string;
  gitSha?: string;
  config: {
    records: number;
    forwardPercentage: number;
    writeMode: string;
    syncMode: string;
    realBroker: string;
  };
  /** One row per forwarding scenario (dual-write async/sync, external-only, %, committed/aborted txn). */
  checks: { name: string; status: CellStatus }[];
  /** Parity block for the headline 100% dual-write topic. */
  counts: {
    produced: number;
    forwardedToBroker: number;
    localStored: number;
    shadowMetricsForwarded: number;
    skipped: number;
    failed: number;
    outboxFinalized: number;
    lag: number;
  };
  /** All checks pass AND forwardedToBroker === produced. */
  passed: boolean;
}

export interface Evidence<T> {
  /** `null` when the evidence branch couldn't be fetched at build time. */
  data: T | null;
  source: 'live' | 'unavailable';
}

async function load<T>(file: string): Promise<Evidence<T>> {
  try {
    const res = await fetch(`${EVIDENCE_BASE}/${file}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) return { data: (await res.json()) as T, source: 'live' };
  } catch {
    /* fall through to unavailable */
  }
  return { data: null, source: 'unavailable' };
}

export const loadConformance = () => load<ConformanceData>('conformance.json');
export const loadBench = () => load<BenchData>('bench.json');
export const loadShadow = () => load<ShadowData>('shadow.json');

/** The live recording URL if the evidence branch has one, else null. */
export async function loadSessionSvg(): Promise<{
  url: string | null;
  source: 'live' | 'unavailable';
}> {
  try {
    const res = await fetch(SESSION_SVG_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.ok) return { url: SESSION_SVG_URL, source: 'live' };
  } catch {
    /* fall through to unavailable */
  }
  return { url: null, source: 'unavailable' };
}

/** UTC, e.g. "Jun 27, 2026, 12:00 PM". */
export function fmtVerified(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
}
