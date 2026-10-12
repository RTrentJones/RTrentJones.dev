/**
 * Agent Worker — autonomous, cron-triggered, Gemini-backed.
 *
 * On the cron (`scheduled`) it asks Gemini for content and stores it in KV. The `fetch` handler
 * serves the latest output (`GET /`), reports last-run metadata (`GET /status` — the verify
 * target), and force-runs (`POST /run`, bearer-gated so it can't be used to burn the free-tier
 * quota; the deploy step uses it to seed the first output before verify).
 *
 * GEMINI_API_KEY + RUN_TOKEN are Worker secrets (`wrangler secret put …`), never in wrangler.toml.
 *
 * Failures are RECORDED, not swallowed: a cron run that throws (a retired model, a revoked key, a
 * quota) writes `lastError` + `lastAttempt` next to the last good output, and `/status` reports
 * `ok: false` until a run succeeds again. The verify gate asserts `ok` and that `lastRun` is
 * recent, so a dead cron fails the gate instead of serving yesterday's text behind a green check.
 */

export interface Env {
  STATE: KVNamespace;
  GEMINI_API_KEY: string;
  RUN_TOKEN?: string;
  MODEL: string;
  /** Optional second model, tried once MODEL is still overloaded after its retries. */
  FALLBACK_MODEL?: string;
  GREENLIGHT_ENV: string;
  /** The deployed commit, baked in at deploy (`wrangler deploy --var GREENLIGHT_SHA:<sha>`). */
  GREENLIGHT_SHA?: string;
}

interface AgentRecord {
  ok: true;
  text: string;
  lastRun: string;
  model: string;
}

/** The latest attempt, success or not — kept apart from the last good output so a failing run
 * never erases it, but `/status` can still tell a dead cron from a quiet one. */
interface AttemptRecord {
  at: string;
  ok: boolean;
  error?: string;
}

const PROMPT =
  'In one or two sentences, share a single concrete, non-obvious tip about deploying software ' +
  'safely. Vary the topic each time. Plain text, no preamble, no markdown.';

// Transient failures (rate limit, request timeout, overloaded/unavailable model, a network drop
// while sending or while reading the body) are retried with a short backoff so one bad second
// doesn't fail the whole day's run. Anything else (a bad key, an unknown or retired model) fails
// immediately: retrying can't fix it, and verify must see it.
const RETRY_DELAYS_MS = [2_000, 8_000];
const isTransient = (status: number) => status === 408 || status === 429 || status >= 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Attempt = { text: string } | { error: string; transient: boolean };

async function attemptGemini(env: Env, model: string): Promise<Attempt> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT }] }] }),
    });
    if (!res.ok) return { error: `Gemini HTTP ${res.status}`, transient: isTransient(res.status) };
    // Read the body inside the try: a connection dropped mid-body is as transient as one dropped
    // before the headers arrived.
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text ? { text } : { error: 'Gemini returned no text', transient: false };
  } catch (e) {
    // Network/IO failure. Report only the error class — never the message, which can echo the
    // request URL, and the URL carries the API key.
    return { error: `Gemini unreachable: ${(e as Error).name}`, transient: true };
  }
}

class GeminiError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
  }
}

async function callModel(env: Env, model: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const r = await attemptGemini(env, model);
    if ('text' in r) return r.text;
    if (r.transient && attempt < RETRY_DELAYS_MS.length) {
      // Full jitter on top of the base delay: agents sharing a key (and the same cron minute) would
      // otherwise retry in lockstep and re-hit the same per-minute rate window together.
      const base = RETRY_DELAYS_MS[attempt] as number;
      await sleep(base + Math.random() * base);
      continue;
    }
    const msg = attempt > 0 ? `${r.error} (after ${attempt + 1} attempts)` : r.error;
    throw new GeminiError(msg, r.transient);
  }
}

// A once-a-day run can't wait out a model overload that lasts minutes, so when MODEL is still
// failing transiently after its retries, FALLBACK_MODEL (a different model, with its own capacity)
// gets one round of its own. A non-transient failure (bad key, unknown model) never falls back:
// that's a misconfiguration verify must surface, not paper over.
async function callGemini(env: Env): Promise<{ text: string; model: string }> {
  try {
    return { text: await callModel(env, env.MODEL), model: env.MODEL };
  } catch (e) {
    const fallback = env.FALLBACK_MODEL;
    if (!(e instanceof GeminiError) || !e.transient || !fallback || fallback === env.MODEL) throw e;
    try {
      return { text: await callModel(env, fallback), model: fallback };
    } catch (f) {
      throw new Error(`${env.MODEL}: ${e.message}; fallback ${fallback}: ${(f as Error).message}`);
    }
  }
}

function key(env: Env): string {
  return `${env.GREENLIGHT_ENV}:latest`;
}

function attemptKey(env: Env): string {
  return `${env.GREENLIGHT_ENV}:attempt`;
}

async function runOnce(env: Env): Promise<AgentRecord> {
  const at = new Date().toISOString();
  try {
    const { text, model } = await callGemini(env);
    const rec: AgentRecord = { ok: true, text, lastRun: at, model };
    await env.STATE.put(key(env), JSON.stringify(rec));
    await env.STATE.put(attemptKey(env), JSON.stringify({ at, ok: true } satisfies AttemptRecord));
    return rec;
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await env.STATE.put(
      attemptKey(env),
      JSON.stringify({ at, ok: false, error } satisfies AttemptRecord),
    );
    throw e;
  }
}

async function readJson<T>(env: Env, k: string): Promise<T | null> {
  const raw = await env.STATE.get(k);
  return raw ? (JSON.parse(raw) as T) : null;
}

const latest = (env: Env) => readJson<AgentRecord>(env, key(env));

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // runOnce records the failure itself; rethrowing also marks the invocation failed in the
    // Workers dashboard / `wrangler tail`, so the error is visible there too.
    ctx.waitUntil(runOnce(env));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);

    if (req.method === 'POST' && pathname === '/run') {
      const auth = req.headers.get('authorization');
      if (!env.RUN_TOKEN || auth !== `Bearer ${env.RUN_TOKEN}`) {
        return new Response('unauthorized', { status: 401 });
      }
      try {
        return Response.json(await runOnce(env));
      } catch (e) {
        // Surface the cause to the caller (the deploy seed step logs it) instead of a bare 500.
        const error = e instanceof Error ? e.message : String(e);
        return Response.json({ ok: false, error }, { status: 502 });
      }
    }

    if (pathname === '/__version') {
      return Response.json({ sha: env.GREENLIGHT_SHA ?? null });
    }

    if (pathname === '/status') {
      const [rec, attempt] = await Promise.all([
        latest(env),
        readJson<AttemptRecord>(env, attemptKey(env)),
      ]);
      return Response.json({
        // ok = there is output AND the most recent recorded attempt SUCCEEDED. No attempt record
        // (e.g. a Worker upgraded over a pre-attempt KV) is not evidence of health.
        ok: Boolean(rec) && attempt?.ok === true,
        lastRun: rec?.lastRun ?? null,
        lastAttempt: attempt?.at ?? null,
        lastError: attempt?.ok === false ? (attempt.error ?? 'unknown error') : null,
        model: env.MODEL,
        // The model that produced the latest output: FALLBACK_MODEL on a day MODEL was overloaded.
        lastModel: rec?.model ?? null,
        preview: rec ? rec.text.slice(0, 80) : null,
      });
    }

    const rec = await latest(env);
    if (!rec) return new Response('No run yet — POST /run to seed.\n', { status: 200 });
    return new Response(`${rec.text}\n`, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
