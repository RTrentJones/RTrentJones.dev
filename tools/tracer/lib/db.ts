import { neon } from '@neondatabase/serverless';

// Runtime reads use the POOLED connection (DATABASE_URL) over Neon's serverless HTTP driver — ideal
// for Vercel's per-request functions. Migrations use the DIRECT connection instead (scripts/migrate.mjs).
// Both are wired into the Vercel env per target by the Greenlight `neon` module, so prod hits the
// prod branch and preview hits its own branch.
export const sql = neon(process.env.DATABASE_URL ?? '');
