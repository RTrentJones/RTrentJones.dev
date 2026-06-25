import type { ReactNode } from 'react';

export const metadata = {
  title: 'Tracer — Claude evals',
  description: 'A Claude evals dashboard: pass-rate over time, regressions, and model comparisons.',
};

const navLink = { color: '#4338ca', textDecoration: 'none', fontWeight: 600 } as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#f8fafc',
          color: '#0f172a',
          margin: 0,
        }}
      >
        <header
          style={{
            borderBottom: '1px solid #e2e8f0',
            background: '#fff',
            padding: '0.9rem 1.5rem',
            display: 'flex',
            gap: '1.5rem',
            alignItems: 'baseline',
          }}
        >
          <a href="/" style={{ ...navLink, fontSize: '1.15rem', color: '#0f172a' }}>
            Tracer
          </a>
          <nav style={{ display: 'flex', gap: '1.25rem', fontSize: '0.95rem' }}>
            <a href="/" style={navLink}>
              Dashboard
            </a>
            <a href="/runs" style={navLink}>
              Runs
            </a>
            <a href="/compare" style={navLink}>
              Compare
            </a>
          </nav>
        </header>
        <main style={{ maxWidth: 1040, margin: '0 auto', padding: '1.75rem 1.5rem 4rem' }}>{children}</main>
      </body>
    </html>
  );
}
