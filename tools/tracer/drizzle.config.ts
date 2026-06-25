import { defineConfig } from 'drizzle-kit';

// Migrations run against the DIRECT (non-pooled) Neon connection — pgbouncer can't carry the
// transactional DDL drizzle-kit issues. The app's runtime reads use the pooled DATABASE_URL
// (lib/db.ts). The build does `drizzle-kit migrate` (see package.json); Greenlight does NOT run
// migrations — its only DB role is the `migrations scan` dangerous-SQL gate over ./drizzle/*.sql.
export default defineConfig({
  dialect: 'postgresql',
  schema: './drizzle/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
});
