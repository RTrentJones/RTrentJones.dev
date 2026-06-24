# `_template-next` — Next.js on Vercel + Neon

The lane template `greenlight add <name> --lane next --target vercel --data neon` scaffolds. A minimal
real app that **reads Neon at request time** and **migrates its schema on deploy** — the Greenlight
Neon convention end to end. Verify mode: `api` (the page runs a live query, so a broken DB 500s).

## How it maps to Greenlight

- **Connection strings** come from the env, wired by the `neon` Terraform module per Vercel target:
  `DATABASE_URL` (pooled) for runtime reads ([lib/db.ts](lib/db.ts)), `DIRECT_URL` (direct) for
  migrations. Prod build → prod branch, preview build → its own branch — same code, different data.
- **Schema as code** lives in [migrations/](migrations) (plain `.sql`). The app's build runs
  [scripts/migrate.mjs](scripts/migrate.mjs) (`package.json` `build` = `node scripts/migrate.mjs &&
  next build`), so a deploy creates/edits tables. A failed migration fails the build → never goes live.
- **Greenlight's gate**: run `greenlight migrations scan` in CI before the migrate (the dangerous-SQL
  check). See [docs/migrations.md](../../docs/migrations.md). Greenlight does **not** run migrations.

## Make it yours

- Prefer an ORM? Swap the plain-SQL migrations for Drizzle/Prisma — keep the build running *your*
  migrate against `DIRECT_URL`, and keep `migrations scan` pointed at the generated SQL.
- Ephemeral per-PR preview branches: connect the native **Neon↔Vercel** integration (it creates a
  branch + injects `DATABASE_URL` per preview); the stable prod/beta branches stay in Terraform.

## Local dev

Set `DATABASE_URL` + `DIRECT_URL` to a Neon branch, then `pnpm migrate && pnpm dev`.
