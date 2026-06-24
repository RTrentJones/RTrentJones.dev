import { sql } from '../lib/db';

// Read fresh each request so the page reflects the DB (and so the verify gate exercises a live query —
// a broken connection / missing table would 500, not 200).
export const dynamic = 'force-dynamic';

export default async function Page() {
  const rows = await sql`SELECT id, body FROM notes ORDER BY id DESC LIMIT 20`;
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 640,
        margin: '3rem auto',
        padding: '0 1rem',
      }}
    >
      <h1>Notes</h1>
      <p>{rows.length} note(s) from Neon.</p>
      <ul>
        {rows.map((r) => (
          <li key={String(r.id)}>{String(r.body)}</li>
        ))}
      </ul>
    </main>
  );
}
