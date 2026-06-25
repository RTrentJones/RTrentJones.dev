import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '../drizzle/schema';

// Runtime reads use the POOLED connection (DATABASE_URL) over Neon's serverless HTTP driver — ideal
// for Vercel's per-request functions and Neon scale-to-zero. Migrations use the DIRECT connection
// instead (drizzle.config.ts / drizzle-kit). Both are wired into the Vercel env per target by the
// Greenlight `neon` module, so prod hits the prod branch and beta/preview hit their own branches.
export const db = drizzle(neon(process.env.DATABASE_URL ?? ''), { schema });
