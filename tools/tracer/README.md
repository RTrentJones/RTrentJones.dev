# Tracer — Claude evals dashboard

The persistence + UI layer for Greenlight's `verify --mode eval` / `agent-web` runs: store every
eval run, show pass-rate over time, flag regressions, compare models, and surface the LLM judge's
rationale. **`next` lane · `vercel` target · `neon` data.**

## Surface

- `/` — dashboard: pass-rate over time (per model), latest run per tool, recent runs with regression flags.
- `/runs` — filterable list of runs (by tool / model / env).
- `/runs/[id]` — run detail: per-case input → output, expected, score, pass/fail, and the **judge rationale**.
- `/compare` — latest run per model on the same suite, aligned case by case.
- `POST /api/ingest` — accept one eval run + its cases (JSON). Bearer-authed, zod-validated. The seam
  `greenlight verify --mode eval` POSTs to.

## Data (Neon)

Two append-heavy tables — `eval_run` and `eval_case` — defined in [drizzle/schema.ts](drizzle/schema.ts).
**Regressions are derived on read** (a `lag()` window over `eval_run` per `(tool, model, env)`); nothing
denormalised, so backfilled/reordered runs stay correct. The pure mirror of that logic lives in
[lib/regression.ts](lib/regression.ts) and is unit-tested without a DB.

- **Runtime reads** use the pooled `DATABASE_URL` over the Neon serverless HTTP driver
  ([lib/db.ts](lib/db.ts), Drizzle).
- **Migrations** use the direct `DIRECT_URL`. The build runs `drizzle-kit migrate`
  (`build = drizzle-kit migrate && next build`), so a deploy applies the schema + seed to the env's
  Neon branch. Greenlight does **not** run migrations — its only DB role is `migrations scan` (the
  dangerous-SQL gate over `drizzle/*.sql`).

Schema changes: edit `drizzle/schema.ts`, then `pnpm db:generate` to emit a new `drizzle/NNNN_*.sql`,
and commit it. `0001_seed.sql` is a custom (idempotent) migration with demo data.

## Auth / security

- `/api/ingest` requires `Authorization: Bearer ${TRACER_INGEST_TOKEN}` and **fails closed** (503)
  when the token is unset. Bodies are zod-validated; shape mismatch → 422.
- The dashboard is `access: public` (a shareable portfolio link); only seeded/demo data lives here.

## Local dev

```
export DATABASE_URL=...   # pooled Neon branch URL
export DIRECT_URL=...     # direct Neon branch URL
pnpm db:migrate           # apply schema + seed
pnpm dev                  # http://localhost:3000
pnpm test                 # vitest: regression / pass-rate / ingest shape
```

Smoke the ingest endpoint:

```
# tokenless → 503; GET → 405; valid POST with the bearer → 201
export TRACER_INGEST_TOKEN=devtoken
curl -s -XPOST localhost:3000/api/ingest -H "authorization: Bearer devtoken" \
  -H 'content-type: application/json' \
  -d '{"tool":"tracer","model":"claude-opus-4-8","mode":"eval","env":"beta","passed":true,"pass_rate":1,
       "cases":[{"name":"smoke","passed":true,"score":1,"judge_rationale":"ok"}]}'
```

## Pass-two TODO (out of scope here)

1. Wire `TRACER_INGEST_TOKEN` (and, for `/api/run`, `ANTHROPIC_API_KEY`) in `infra/tracer.tf` —
   add entries to the `tracer_vercel` module's `environment` / `environment_values`, sourced from the
   `TF_VAR_TRACER_INGEST_TOKEN` GitHub Actions secret (already listed in the manifest `tokens`).
2. Flip the `/api/ingest` verify check from `405` (GET, route mounted) once you want to assert the
   authed POST path end to end.
3. Add `/api/run` (the Anthropic "Run eval" button) + the `agent-web` verify entry (auto-enables when
   `ANTHROPIC_API_KEY` is set).
4. Dogfood: have `greenlight verify --mode eval` POST its own result to `/api/ingest` so Tracer shows
   up in its own dashboard.
