'use client';

// Segment error boundary: catches anything thrown while rendering a page (most likely a failed DB
// read — e.g. DATABASE_URL unset on this environment) and shows a clear, recoverable message instead
// of the opaque "Server Components render" crash. The real error text is masked in production builds,
// so point the operator at /api/health, which returns the exact cause as JSON.
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{ maxWidth: 560, margin: '3rem auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.25rem' }}>Couldn’t load the dashboard</h1>
      <p style={{ color: '#475569', lineHeight: 1.5 }}>
        Tracer couldn’t read its database for this request. The most common cause is a missing or
        misconfigured <code>DATABASE_URL</code> (the Neon pooled connection) in this environment.
      </p>
      <p style={{ color: '#475569', lineHeight: 1.5 }}>
        Check <a href="/api/health" style={{ color: '#4338ca' }}>/api/health</a> for the exact cause, then{' '}
        <button
          type="button"
          onClick={() => reset()}
          style={{ color: '#4338ca', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}
        >
          retry
        </button>
        .
      </p>
    </div>
  );
}
