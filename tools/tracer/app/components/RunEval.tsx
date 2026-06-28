'use client';

import { useState } from 'react';

// Operator-only "Run eval" control. /api/run is bearer-gated (it spends provider tokens), so a public
// visitor can't trigger it — the operator pastes the ingest token, kept in sessionStorage for the tab.
// Posts to /api/run (fans the suite across every enabled provider), then reloads to show the new runs.
export function RunEval() {
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  async function run() {
    let token = sessionStorage.getItem('tracer_ingest_token') ?? '';
    if (!token) {
      token = window.prompt('Ingest token (TRACER_INGEST_TOKEN):') ?? '';
      if (!token) return;
      sessionStorage.setItem('tracer_ingest_token', token);
    }
    setBusy(true);
    setStatus('Running eval across providers…');
    try {
      const res = await fetch('/api/run', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        sessionStorage.removeItem('tracer_ingest_token');
        setStatus('Unauthorized — token cleared, try again.');
      } else if (!res.ok) {
        setStatus(`Failed (${res.status}): ${body.error ?? 'see logs'}`);
      } else {
        const n = Array.isArray(body.ran) ? body.ran.length : 0;
        setStatus(`Ran ${n} provider(s). Refreshing…`);
        setTimeout(() => window.location.reload(), 800);
      }
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', gap: '0.6rem', alignItems: 'center' }}>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        style={{
          padding: '0.4rem 0.8rem',
          borderRadius: 6,
          border: '1px solid #4338ca',
          background: busy ? '#c7d2fe' : '#4338ca',
          color: '#fff',
          cursor: busy ? 'default' : 'pointer',
          fontSize: '0.85rem',
        }}
      >
        {busy ? 'Running…' : 'Run eval'}
      </button>
      {status && (
        <span role="status" aria-live="polite" style={{ fontSize: '0.8rem', color: '#64748b' }}>
          {status}
        </span>
      )}
    </span>
  );
}
