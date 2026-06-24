// The app's OWN migrate — Greenlight does not run migrations. The build runs this (see package.json
// `build`) against DIRECT_URL, so a deploy creates/edits tables on the env's Neon branch; a failed
// migration fails the build, so a broken schema never goes live. Gate it in CI with `greenlight
// migrations scan` first. Plain `pg` (TCP, transactional) for DDL; the app reads via lib/db.ts.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('migrate: set DIRECT_URL (the direct Neon connection string)');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(
    'CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())',
  );
  const { rows } = await client.query('SELECT name FROM _migrations');
  const applied = new Set(rows.map((r) => r.name));
  const files = readdirSync('migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    console.log(`applying ${file}`);
    await client.query('BEGIN');
    try {
      await client.query(readFileSync(join('migrations', file), 'utf8'));
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
  console.log('migrations up to date');
} finally {
  await client.end();
}
