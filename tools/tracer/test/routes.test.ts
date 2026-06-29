import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as ingestPOST } from '../app/api/ingest/route';
import { POST as runPOST } from '../app/api/run/route';

// Route smokes that exercise the auth + validation boundary WITHOUT a database: every path asserted
// here returns before the handler touches the DB (fail-closed 503, 401, or a 422 that zod rejects
// pre-insert). The DB-writing 201 path lives in test/db (Neon-branch only). Snapshot/restore the env
// these routes read so the suite is hermetic in CI (which sources real provider keys).
const ENV_KEYS = ['TRACER_INGEST_TOKEN', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const TOKEN = 'a'.repeat(64);

function post(url: string, opts: { token?: string; body?: unknown; raw?: string } = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const body = opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined);
  return new Request(url, { method: 'POST', headers, body });
}

describe('POST /api/ingest — auth + validation (pre-DB)', () => {
  it('503 when the ingest token is unset (fails closed)', async () => {
    const res = await ingestPOST(post('http://t/api/ingest', { body: { tool: 'x', passed: true } }));
    expect(res.status).toBe(503);
  });

  it('401 with a wrong bearer token', async () => {
    process.env.TRACER_INGEST_TOKEN = TOKEN;
    const res = await ingestPOST(
      post('http://t/api/ingest', { token: 'b'.repeat(64), body: { tool: 'x', passed: true } }),
    );
    expect(res.status).toBe(401);
  });

  it('422 on an invalid body (authed) — never reaches the DB', async () => {
    process.env.TRACER_INGEST_TOKEN = TOKEN;
    // native shape missing required fields (model/mode/env) + a nameless case → zod rejects pre-insert
    const res = await ingestPOST(
      post('http://t/api/ingest', { token: TOKEN, body: { tool: 'x', passed: true, cases: [{ passed: true }] } }),
    );
    expect(res.status).toBe(422);
  });

  it('422 on a non-JSON body', async () => {
    process.env.TRACER_INGEST_TOKEN = TOKEN;
    const res = await ingestPOST(post('http://t/api/ingest', { token: TOKEN, raw: 'not json' }));
    expect(res.status).toBe(422);
  });
});

describe('POST /api/run — auth + fail-closed (pre-DB)', () => {
  it('503 when the ingest token is unset', async () => {
    const res = await runPOST(post('http://t/api/run'));
    expect(res.status).toBe(503);
  });

  it('401 with a wrong bearer token', async () => {
    process.env.TRACER_INGEST_TOKEN = TOKEN;
    const res = await runPOST(post('http://t/api/run', { token: 'b'.repeat(64) }));
    expect(res.status).toBe(401);
  });

  it('503 when authed but no provider key is set (nothing to run, no spend)', async () => {
    process.env.TRACER_INGEST_TOKEN = TOKEN;
    const res = await runPOST(post('http://t/api/run', { token: TOKEN }));
    expect(res.status).toBe(503);
  });
});
