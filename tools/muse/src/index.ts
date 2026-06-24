/**
 * Agent Worker — autonomous, cron-triggered, Gemini-backed.
 *
 * On the cron (`scheduled`) it asks Gemini for content and stores it in KV. The `fetch` handler
 * serves the latest output (`GET /`), reports last-run metadata (`GET /status` — the verify
 * target), and force-runs (`POST /run`, bearer-gated so it can't be used to burn the free-tier
 * quota; the deploy step uses it to seed the first output before verify).
 *
 * GEMINI_API_KEY + RUN_TOKEN are Worker secrets (`wrangler secret put …`), never in wrangler.toml.
 */

export interface Env {
  STATE: KVNamespace;
  GEMINI_API_KEY: string;
  RUN_TOKEN?: string;
  MODEL: string;
  GREENLIGHT_ENV: string;
}

interface AgentRecord {
  ok: true;
  text: string;
  lastRun: string;
  model: string;
}

const PROMPT =
  'In one or two sentences, share a single concrete, non-obvious tip about deploying software ' +
  'safely. Vary the topic each time. Plain text, no preamble, no markdown.';

async function callGemini(env: Env): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT }] }] }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Gemini returned no text');
  return text;
}

function key(env: Env): string {
  return `${env.GREENLIGHT_ENV}:latest`;
}

async function runOnce(env: Env): Promise<AgentRecord> {
  const rec: AgentRecord = {
    ok: true,
    text: await callGemini(env),
    lastRun: new Date().toISOString(),
    model: env.MODEL,
  };
  await env.STATE.put(key(env), JSON.stringify(rec));
  return rec;
}

async function latest(env: Env): Promise<AgentRecord | null> {
  const raw = await env.STATE.get(key(env));
  return raw ? (JSON.parse(raw) as AgentRecord) : null;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runOnce(env));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);

    if (req.method === 'POST' && pathname === '/run') {
      const auth = req.headers.get('authorization');
      if (!env.RUN_TOKEN || auth !== `Bearer ${env.RUN_TOKEN}`) {
        return new Response('unauthorized', { status: 401 });
      }
      return Response.json(await runOnce(env));
    }

    if (pathname === '/status') {
      const rec = await latest(env);
      return Response.json({
        ok: Boolean(rec),
        lastRun: rec?.lastRun ?? null,
        model: env.MODEL,
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
