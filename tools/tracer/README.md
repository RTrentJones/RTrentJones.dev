# Tracer — model evals dashboard

The persistence + UI layer for Greenlight's `verify --mode eval` / `agent-web` runs: store every
eval run, show pass-rate over time, flag regressions, compare models **across providers**, and surface
the LLM judge's rationale. **`next` lane · `vercel` target · `neon` data.**

> **Where this sits:** the eval-dashboard space is mature (Langfuse, Braintrust, Arize Phoenix). Tracer
> is a deliberately small **portfolio backend** built for the Greenlight CI loop — but everything it
> stores conforms to a standard (`0..1` scores, OTel-GenAI / OpenInference ingest shape, `autoevals`
> scorer names), so the same data can flow to Langfuse/Phoenix instead (see *Standards & interop*).

## Surface

- `/` — dashboard: pass-rate over time (per model), latest run per tool, recent runs with regression flags.
- `/runs` · `/runs/[id]` — filterable run list + per-case detail with the **judge rationale**.
- `/compare` — latest run per model on the same suite, aligned case by case (cross-provider).
- `POST /api/ingest` — accept one eval run + its cases. Bearer-authed, zod-validated. Accepts **either**
  the native shape **or** a standard OTel-GenAI/OpenInference verify result ([lib/openinference.ts](lib/openinference.ts)).
- `POST /api/run` — optional: run the demo suite against every enabled provider, store the results.
  Bearer-authed, fails closed.

## Multi-provider `/api/run`

Vendor-agnostic by design — target many providers' **free tiers**, not just Anthropic. Most vendors
expose an OpenAI-compatible endpoint, so one `openai`-SDK adapter covers Gemini / Grok / Groq / etc.;
Anthropic gets its own adapter ([lib/providers.ts](lib/providers.ts)). Each provider is gated on its own
key and **fails soft** — `/api/run` exercises only the providers whose key is present, so a full run can
cost **$0** (Gemini Flash). Generation is scored by `autoevals` deterministic scorers (`ExactMatch`,
`JSONDiff`) for exact-answer cases and a portable JSON LLM-judge for rubric cases ([lib/eval.ts](lib/eval.ts)).

| Provider | env key | default model | free tier |
|---|---|---|---|
| Google Gemini | `GEMINI_API_KEY` | `gemini-2.5-flash` | ✅ (AI Studio) |
| xAI Grok | `XAI_API_KEY` | `grok-4` | where available |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-opus-4-8` | paid |

Add a vendor by appending a row to `PROVIDERS`. Each run is one `eval_run` per provider, so a single
`/api/run` populates `/compare` with a real cross-vendor comparison.

## Auth / security

- `/api/ingest` + `/api/run` require `Authorization: Bearer ${TRACER_INGEST_TOKEN}` and **fail closed**
  (503) when the token is unset (and `/api/run` also 503s when no provider key is present). zod on every
  ingest body. The "Run eval" button on `/` is operator-only — it prompts for the token (kept in
  `sessionStorage`), so a public visitor can't trigger provider spend.
- The dashboard is `access: public` (a shareable portfolio link); only seeded/demo data lives here.

## Standards & interop (the hybrid)

Nothing here is bespoke, so production can swap Tracer for a maintained backend:

- **Scores** are `0..1`; case scorers use `autoevals` names; a run = a dataset→task→scorer→experiment.
- **Ingest contract** is OTel-GenAI / OpenInference-shaped (`gen_ai.request.model`, `gen_ai.usage.*`,
  per-check `eval.score` / `eval.explanation`) — mapped to the DB by [lib/openinference.ts](lib/openinference.ts).
- **Swap to Langfuse/Phoenix:** point the upstream `greenlight verify --json` export (see the design
  doc, [docs/greenlight-eval-standardization.md](../../docs/greenlight-eval-standardization.md)) at
  their ingest instead of Tracer's — the result shape already matches what they consume.

## Data (Neon)

Two append-heavy tables — `eval_run` and `eval_case` ([drizzle/schema.ts](drizzle/schema.ts)).
**Regressions are derived on read** (a `lag()` window per `(tool, model, env)`); the pure mirror lives
in [lib/regression.ts](lib/regression.ts) and is unit-tested without a DB. Runtime reads use the pooled
`DATABASE_URL` (neon-http); migrations use the **direct** form of `DATABASE_URL` (`drizzle.config.ts`)
so they hit the same branch the runtime reads. The build runs `drizzle-kit migrate`; Greenlight's only
DB role is `migrations scan`.

## Troubleshooting

Hit `/api/health` on any env — it returns `{ ok, databaseUrlSet, directUrlSet, runs }` or the real error
(Server Component errors are masked in production):
- `relation "eval_run" does not exist` — migrations hit a different branch than the runtime reads;
  re-deploy so the build's `drizzle-kit migrate` runs against the current `DATABASE_URL`.
- `DATABASE_URL is not set` — wire the Neon pooled connection string (Vercel env / `infra/tracer.tf`).

## Local dev

```
export DATABASE_URL=...        # pooled Neon branch URL (migrations derive the direct endpoint)
export TRACER_INGEST_TOKEN=devtoken
export GEMINI_API_KEY=...       # any one provider key enables /api/run (Gemini = free)
pnpm db:migrate && pnpm dev     # http://localhost:3000
pnpm test                       # vitest: regression / pass-rate / judge parse / cost / OI mapper
```

```
# /api/run: tokenless → 503; no provider key → 503; GET → 405; valid bearer → 201 (one run per provider)
curl -s -XPOST localhost:3000/api/run -H "authorization: Bearer devtoken"

# /api/ingest accepts the native shape OR an OTel-GenAI/OpenInference result:
curl -s -XPOST localhost:3000/api/ingest -H "authorization: Bearer devtoken" -H 'content-type: application/json' \
  -d '{"tool":"tracer","passed":true,"attributes":{"gen_ai.request.model":"gemini-2.5-flash"},
       "checks":[{"name":"smoke","eval.score":1,"eval.explanation":"ok","passed":true}]}'
```

## Dogfood

[scripts/dogfood.mjs](scripts/dogfood.mjs) runs `greenlight verify tracer --json` and POSTs the
standards-shaped result to `/api/ingest` — so Tracer shows up in its own dashboard. It depends on the
upstream `verify --json` export (design doc above) and skips cleanly until that ships.
