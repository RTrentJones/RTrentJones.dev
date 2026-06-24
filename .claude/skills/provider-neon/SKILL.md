---
name: provider-neon
description: How Neon works in a Greenlight setup — the `data: neon` store (serverless Postgres), git-style branch-per-env, scale-to-zero + auto-resume (so NO keepalive, unlike Supabase), pooled vs direct connection strings, the NEON_API_KEY, and migrations on a branch. Use when wiring a tool's database, choosing Neon vs Supabase, or a Neon apply.
---

# provider-neon

`data: neon` is the **default Postgres** — for tools that need a SQL database and nothing else
bundled. One Neon **project** per tool, **a branch per env** (git-style copy-on-write): `prod` is
the project's default branch; `beta` is a child branch (separate data, instant to create). Compute
**autosuspends and auto-resumes on the next connection**, so a Neon tool needs **no keepalive** —
that's the whole reason Neon is preferred over Supabase, which pauses for 7 days and needs a manual
unpause. Choose `supabase` only when you need bundled auth + storage + realtime together.

## Token — `NEON_API_KEY`

Console → Account settings → API keys. Account-level (configures the `neon` provider for every Neon
tool, like `CLOUDFLARE_API_TOKEN`) — **not** per-tool. `greenlight add` verifies it against
`/api/v2/projects` (HTTP 200). There is **no per-tool secret**: the role/password/connection strings
are module OUTPUTS, not inputs.

## Terraform module — `infra/modules/neon`

Creates the project (default branch = prod) + a `neon_branch` per non-prod env (except `preview`,
which is ephemeral/per-PR — created by CI, not Terraform). Outputs two per-env maps:
- **`database_url[env]`** — the **pooled** (pgbouncer) string → `DATABASE_URL` for the serverless app.
- **`direct_url[env]`** — the **direct** string → `DIRECT_URL` for migrations.

The emitted `<name>.tf` wires `database_url["prod"]`/`["beta"]` into the Vercel env per target, so
prod and beta hit **different branches**. Pin the provider `kislerdm/neon ~> 0.13`.

## No keepalive

Do **not** add a Neon tool to `module.keepalive.targets_json`. Neon resumes on connect — a request
just wakes it. (`doctor` does not flag `data: neon` for keepalive; that exemption is intentional.)

## Schema as code / migrations

**Greenlight does NOT run migrations — by design.** The split:
- **Schema** lives in the tool (an ORM — Drizzle/Prisma — or plain `.sql` migrations).
- **Branch-per-env**: the TF module owns stable `prod`/`beta`; the **native Neon↔Vercel integration**
  owns ephemeral per-PR preview branches (+ auto-injects `DATABASE_URL`). Don't put ephemeral branches
  in Terraform.
- **Execution**: the app's own build runs its migrate (`drizzle-kit migrate` / `prisma migrate deploy`)
  against the wired **`DIRECT_URL`** — prod build → prod branch, preview build → preview branch. A
  failed migrate fails the build = a natural gate.
- **Greenlight's role**: the **dangerous-SQL gate**. Run `greenlight migrations scan` (no `<dir>` →
  it auto-detects `supabase/migrations | migrations | drizzle/migrations | …`) in CI before the migrate.

See [docs/migrations.md](../../../docs/migrations.md).

## Sharing one DB + multi-account

- **One DB, many services**: a second tool sets `dataShareWith: '<owner>'` (or `add … --share <owner>`)
  — it creates no project and wires the owner's connection strings.
- **A second Neon account**: `tokenOverrides: { NEON_API_KEY: 'NEON_API_KEY_X' }` → an aliased `neon`
  provider authenticates that account. (A sharer can't also override — it uses the owner's account.)

## MCP

`.mcp.json` wires `neon` (hosted) with `Authorization: Bearer ${NEON_API_KEY}`. Run `/mcp` to auth.

## Rule
The **blog must never use a database** that can pause — but Neon's auto-resume makes it safe for
*tools*; still, the apex blog stays `data: none` (D1/KV/external only). Neon is per-tool Postgres.
