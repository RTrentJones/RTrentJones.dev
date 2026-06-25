import { neon } from '@neondatabase/serverless';
import { type NeonHttpDatabase, drizzle } from 'drizzle-orm/neon-http';
import * as schema from '../drizzle/schema';

// Runtime reads use the POOLED connection (DATABASE_URL) over Neon's serverless HTTP driver — ideal
// for Vercel's per-request functions and Neon scale-to-zero. Migrations use the DIRECT connection
// instead (drizzle.config.ts / drizzle-kit). Both are wired into the Vercel env per target by the
// Greenlight `neon` module, so prod hits the prod branch and beta/preview hit their own branches.
//
// Constructed LAZILY: `neon()` throws synchronously when the connection string is empty, so building
// it at module top-level would crash the whole route on import when DATABASE_URL is unset — surfacing
// as an opaque "Server Components render" error with no hint. Defer it so a missing env var yields a
// clear, catchable message instead (see app/api/health and app/error.tsx).
let _db: NeonHttpDatabase<typeof schema> | null = null;

export function getDb(): NeonHttpDatabase<typeof schema> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set for this environment — wire the Neon pooled connection string ' +
        '(Vercel project → Settings → Environment Variables, or the Greenlight `neon` module).',
    );
  }
  _db = drizzle(neon(url), { schema });
  return _db;
}
