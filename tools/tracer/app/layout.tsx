import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Tracer — project signals',
  description:
    'Evidence-only signal dashboard for RTrentJones projects: eval suites, CI checks, benchmarks, and delivery pipelines, with regressions, run diffs, and flaky-case detection.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <a href="/" className="brand">
            Tracer
          </a>
          <nav className="nav">
            <a href="/">Overview</a>
            <a href="/runs">Runs</a>
            <a href="/compare">Compare</a>
            <a href="https://github.com/RTrentJones/RTrentJones.dev/tree/main/tools/tracer#ingest-contract">Ingest API</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
