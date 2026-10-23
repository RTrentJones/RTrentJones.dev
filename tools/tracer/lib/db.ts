import { neon } from '@neondatabase/serverless';
import { type NeonHttpDatabase, drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { type NodePgDatabase, drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../drizzle/schema';

// Runtime reads use the POOLED connection (DATABASE_URL) over Neon's serverless HTTP driver — ideal
// for Vercel's per-request functions and Neon scale-to-zero. Migrations use the DIRECT connection
// instead (drizzle.config.ts / drizzle-kit). Both are wired into the Vercel env per target by the
// Greenlight `neon` module, so prod hits the prod branch and beta/preview hit their own branches.
//
// A plain Postgres URL (localhost, or TRACER_DB_DRIVER=pg) uses node-postgres instead, so local dev
// and the DB-backed tests run against a stock Postgres without a Neon HTTP proxy. Both drivers
// return `{ rows }` from execute(); the one behavioural difference (neon-http batches, node-postgres
// transacts) is handled in lib/insert-run.
//
// Constructed LAZILY: `neon()` throws synchronously when the connection string is empty, so building
// it at module top-level would crash the whole route on import when DATABASE_URL is unset — surfacing
// as an opaque "Server Components render" error with no hint. Defer it so a missing env var yields a
// clear, catchable message instead (see app/api/health and app/error.tsx).
export type Db = NeonHttpDatabase<typeof schema> | NodePgDatabase<typeof schema>;

let _db: Db | null = null;
// Which driver getDb() chose — recorded at construction so isNeonHttp never has to sniff the instance
// (drizzle may grow a `batch` on other drivers; the choice, not the shape, decides the write path).
let driver: 'neon' | 'pg' | null = null;

/** True when the URL should use node-postgres (local/stock Postgres) rather than Neon's HTTP driver. */
export function usesPgDriver(url: string, driver = process.env.TRACER_DB_DRIVER): boolean {
  if (driver === 'pg') return true;
  if (driver === 'neon') return false;
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

export function getDb(): Db {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set for this environment — wire the Neon pooled connection string ' +
        '(Vercel project → Settings → Environment Variables, or the Greenlight `neon` module).',
    );
  }
  driver = usesPgDriver(url) ? 'pg' : 'neon';
  _db =
    driver === 'pg'
      ? drizzlePg(new pg.Pool({ connectionString: url, max: 5 }), { schema })
      : drizzleNeon(neon(url), { schema });
  return _db;
}

/** True for the Neon HTTP driver (supports atomic batch(), not interactive transactions). */
export function isNeonHttp(db: Db): db is NeonHttpDatabase<typeof schema> {
  return db === _db && driver === 'neon';
}
