import { defineConfig } from 'drizzle-kit';

// Migrations MUST target the same database the app reads at runtime. The app reads DATABASE_URL
// (pooled); migrations need the DIRECT (non-pooled) endpoint of that *same* branch.
//
// Why not just use DIRECT_URL? On Vercel preview deployments the native Neon↔Vercel integration injects
// its own per-branch DATABASE_URL, which differs from the Terraform-wired DIRECT_URL. Migrating
// DIRECT_URL then leaves the branch the app actually reads without tables — the runtime fails with
// `relation "eval_run" does not exist`. So derive the migration URL from DATABASE_URL:
//   1. prefer the integration's DATABASE_URL_UNPOOLED (the canonical direct URL for the same branch),
//   2. else strip "-pooler" from the pooled host to get that branch's direct endpoint,
//   3. else fall back to DIRECT_URL / DATABASE_URL (local dev, where there's no pooler split).
function migrationUrl(): string {
  const unpooled = process.env.DATABASE_URL_UNPOOLED;
  if (unpooled) return unpooled;
  const pooled = process.env.DATABASE_URL;
  if (pooled) return pooled.replace('-pooler.', '.');
  return process.env.DIRECT_URL ?? '';
}

// The build runs `drizzle-kit migrate` against this; Greenlight does NOT run migrations — its only DB
// role is the `migrations scan` dangerous-SQL gate over ./drizzle/*.sql.
export default defineConfig({
  dialect: 'postgresql',
  schema: './drizzle/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: migrationUrl(),
  },
});
