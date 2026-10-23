# Tracer — model evals dashboard

The persistence + UI layer for Greenlight's `verify --mode eval`, `agent-web`, API, and project-specific runs (for example `pg_kafka`): store every
eval run, show pass-rate over time, flag regressions, compare models **across providers**, and surface
the LLM judge's rationale. **`next` lane · `vercel` target · `neon` data.**

> **Where this sits:** the eval-dashboard space is mature (Langfuse, Braintrust, Arize Phoenix). Tracer
> is a deliberately small **portfolio backend** built for the Greenlight CI loop — but everything it
> stores conforms to a standard (`0..1` scores, OTel-GenAI / OpenInference ingest shape, `autoevals`
> scorer names), so the same data can flow to Langfuse/Phoenix instead (see *Standards & interop*).

## Surface

- `/` — overview: one card per project with every live **signal** (a `tool · mode · suite · env` feed),
  its sparkline (pass rate, or the headline metric for a benchmark), latest verdict and freshness; stale
  signals fold into a "+ N stale" link. A *needs attention* list of gating, fresh signals whose latest
  run failed or regressed; summary tiles; recent runs (eval, check and benchmark runs; `?pipeline=1`
  adds the delivery pipeline). Delivery-pipeline stages (Greenlight `ship` build/deploy/verify/rollback)
  are shown apart from quality signals (evals, checks, benchmarks). The operator "Run provider eval"
  control sits at the bottom.
- `/projects/[tool]` — a project's signals (stale ones folded below the table), then for the selected signal: pass rate per run (one line
  per model), **metric trends** (one small chart per numeric metric the producer reports, e.g. F1,
  MRR, msgs/sec), and a **case × run matrix** over the last 15 runs that marks **flaky** cases (verdict
  flipped twice or more on the same suite). Reported cases show their score on a neutral cell.
- `/runs` — every run in 90 days, filterable by project, mode, suite, model, env, regressions-only
  and failures-only.
- `/runs/[id]` — provenance (commit link, branch, CI run, labels), metrics with the baseline run's
  values, a **diff against the baseline run in the series** (newly failing, newly passing, score
  moves, cases added or removed, and a code-diff link), and the cases grouped by category with the
  judge's rationale. The baseline is the one the lists use (see *Signal states*).
- `/compare` — latest run per model on exactly one project/mode/suite/env (never across suites; it
  defaults to the newest suite with cases), aligned case by case, with the cases the models disagree on
  first. Each column is headed `model · MM-DD · sha7`, so a stale arm is visible.
- `GET /api/summary/[tool]` and `GET /api/badge/[tool]` — public JSON status and an SVG badge
  (`?signal=<key>` narrows to one signal), cached for five minutes. Embed in a README:
  `![tracer](https://tracer.rtrentjones.dev/api/badge/bamcp)`.
- `POST /api/ingest` — accept one run + its cases. Bearer-authed, zod-validated. Accepts **either**
  the native shape **or** a standard OTel-GenAI/OpenInference verify result ([lib/openinference.ts](lib/openinference.ts)).
- `POST /api/run` — optional: run the demo suite against every enabled provider, store the results.
  Bearer-authed, fails closed.

## Ingest contract

`POST /api/ingest` with `Authorization: Bearer $TRACER_INGEST_TOKEN` and a JSON body
([lib/schema.ts](lib/schema.ts) is the source of truth):

| field | required | meaning |
|---|---|---|
| `tool` | ✓ | project key (`bamcp`, `polyphony`, …): a slug matching `^[\w.-]{1,64}$` (ASCII), else 422 |
| `mode` | ✓ | signal type (`truthset`, `eval`, `llm-eval`, `benchmark`, `api+test`, `deploy`, …) |
| `model` | ✓ | model or system under test (`gemini-3.5-flash-lite`, `deterministic`, …) |
| `env` | ✓ | where it ran (`ci`, `prod`, `beta`, or an experiment label) |
| `passed` | ✓ | the run's own verdict |
| `gating` | | default `true`. `false` = *trended, not gated*: the signal keeps its trend but is labelled *tracked* and never makes the project, badge or attention list red |
| `pass_rate` | | 0..1; drives trends and regressions |
| `suite` | | dataset/benchmark within the mode (`synthetic_v1`, `dracula`); its own series |
| `git_sha`, `repo`, `branch` | | `repo` is `owner/name`; with a hex sha it becomes a commit link |
| `source_url` | | http(s) link to the CI run or report |
| `metrics` | | `{ key: number }`, ≤64 keys (`[\w.:/-]`), charted per run |
| `labels` | | `{ key: string }`, ≤64 keys (judge, trigger, dataset version, …); see *Label conventions* |
| `duration_ms`, `cost_usd`, `tokens_in`, `tokens_out` | | run cost/latency |
| `cases[]` | | ≤1000 × `{ name, passed, score?, input?, expected?, output?, judge_rationale?, category?, metrics? }`. `name` may be up to 16 384 chars but is stored clipped to 255 (254 + `…`); keep the full text in `expected`/`output`. `category: "reported"` marks a measurement rather than a check (below) |

A **series** is `(tool, mode, suite, model, env)`: a run is a regression when its `pass_rate` drops
below its baseline, the latest earlier run in the series that has a `pass_rate` and is not incomplete.
A **signal** is `(tool, mode, suite, env)` — the same feed across model changes — and is what the
overview and project pages group by.

### Label conventions

Labels are free-form, but these keys change how Tracer reads a run:

| label | effect |
|---|---|
| `cadence` | `weekly` or `on-demand`; anything else (or absent) is `daily`. Sets the freshness windows: daily is fresh ≤48 h, aging ≤8 d, stale beyond; weekly is fresh ≤8 d, aging ≤15 d; on-demand is fresh ≤48 h and otherwise aging, never stale |
| `headline_metric` | a key of the run's `metrics`. A benchmark shows that value (and its sparkline) instead of the pass rate |
| `headline_unit` | display unit for the headline, e.g. `msgs/s` |
| `errored` / `skipped` | comma lists of step names. Either marks the run *incomplete* |
| `judge_provider` / `judge_model` | the grader. A change against the baseline marks the run *not comparable* |
| `version` | the producer's own version string (pg_kafka's bench version lives here) |
| `legacy_env` / `legacy_model` | the original value of a row relabelled by migration `0004` |

### Signal states

Every surface (overview, project page, run page, `/api/summary`, `/api/badge`) uses one status function
over the same window (the newest 20 runs per signal, 180 days), so they always agree:

- **failing** — the latest run's `passed` is false.
- **regressed** — it passed, but its `pass_rate` is below the baseline's.
- **incomplete** — a step errored or was skipped (`labels.errored`/`skipped`), or a non-pipeline run has
  no scored cases. Neutral: it is neither a failure nor a regression, and it is never used as a baseline.
- **tracked** — the run was ingested with `gating: false`. Its pass rate is shown, but it never makes
  the project, badge or attention list failing or regressed.
- **stale** — no run within the signal's cadence. Stale signals fold away and don't count toward
  health; a project whose every signal is stale reads as stale.
- **not comparable** — the judge (`judge_provider`/`judge_model`) differs from the baseline's, so no
  regression is claimed.

A case with `category: "reported"` is a measurement, not a check: it shows its score on a neutral
cell and is left out of pass rates, flaky detection, failure counts and the newly failing/passing diff.

## Producers

| project | producer | signal(s) |
|---|---|---|
| project | producer | signal(s) | notes |
|---|---|---|---|
| tracer | [`dogfood-tracer.yml`](../../.github/workflows/dogfood-tracer.yml) (daily `greenlight verify --json`) | `api+test · prod` | model `greenlight-verify` |
| pg_kafka | [`pg-kafka-tracer.yml`](../../.github/workflows/pg-kafka-tracer.yml) (daily, from pg_kafka's evidence branch) | `benchmark · ci` | model `pg_kafka` (bench version in `labels.version`); posts only when bench.json changes (commit + throughput), `cadence: weekly`; headline `msgs/s` |
| blog | `greenlight ship` stage events | `build`/`deploy`/`verify`/`rollback` · `prod`/`beta` | delivery pipeline |
| bamcp | `bamcp.eval.tracer` in BAMCP's `ci.yml` (push to main) and `eval-nightly.yml` | `truthset · synthetic_v1` / `indel_v1 · ci`, `llm-eval · test_cases`, `llm-eval · comparison` | truthset gates; `llm-eval` is published with `gating: false` (tracked) |
| polyphony | `evals.run --tracer` in Polyphony's `evals.yml` (dispatch / `evals/.run-eval`) | `eval · <book> · ci` | `cadence: on-demand`; attribution is a `reported` case |

BAMCP and Polyphony POST from their own CI, so each repo needs a `TRACER_INGEST_TOKEN` Actions secret
with the same value as this repo's `TF_VAR_TRACER_INGEST_TOKEN`:

```
gh secret set TRACER_INGEST_TOKEN -R RTrentJones/BAMCP        # paste the TF_VAR_TRACER_INGEST_TOKEN value
gh secret set TRACER_INGEST_TOKEN -R RTrentJones/Polyphony
```

To confirm a producer is wired, check its CI log or step summary for `tracer ingest -> 201` (Polyphony)
or `Tracer: published … (201)` (BAMCP), then open `/projects/<tool>`. Both publish best-effort: without
the secret they skip with a warning, and a failed POST never fails their eval jobs.

## Multi-provider `/api/run`

Vendor-agnostic by design — target many providers' **free tiers**, not just Anthropic. Most vendors
expose an OpenAI-compatible endpoint, so one `openai`-SDK adapter covers Gemini / Grok / Groq / etc.;
Anthropic gets its own adapter ([lib/providers.ts](lib/providers.ts)). Each provider is gated on its own
key and **fails soft** — `/api/run` exercises only the providers whose key is present, so a full run can
cost **$0** (Gemini Flash). Generation is scored by `autoevals` deterministic scorers (`ExactMatch`,
`JSONDiff`) for exact-answer cases and a portable JSON LLM-judge for rubric cases ([lib/eval.ts](lib/eval.ts)).

| Provider | env key | default model | free tier |
|---|---|---|---|
| Google Gemini | `GEMINI_API_KEY` | `gemini-3.8-flash` | ✅ (AI Studio) |
| xAI Grok | `XAI_API_KEY` | `grok-4` | where available |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-opus-4-8` | paid |

Add a vendor by appending a row to `PROVIDERS`. Each run is one `eval_run` per provider, so a single
`/api/run` populates `/compare` with a real cross-vendor comparison.

## Auth / security

- `/api/ingest` + `/api/run` require `Authorization: Bearer ${TRACER_INGEST_TOKEN}` and **fail closed**
  (503) when the token is unset (and `/api/run` also 503s when no provider key is present). The bearer
  check is **constant-time** ([lib/auth.ts](lib/auth.ts)); zod validates every ingest body. The "Run
  eval" button on `/` is operator-only — it prompts for the token (kept in `sessionStorage`), so a
  public visitor can't trigger provider spend.
- **Cost / blast radius:** one token gates both the (free) write path and the (spending) `/api/run`, so
  a leaked `TRACER_INGEST_TOKEN` can burn LLM budget. Mitigations: fixed small suite, `maxDuration`,
  and **free-by-default** — set only `GEMINI_API_KEY` and a full run costs **$0**; a paid key
  (`ANTHROPIC_API_KEY`) makes *every* `/api/run` spend, so set it deliberately. There's no per-IP
  rate-limit — keep the token secret and rotate it if exposed.
- The dashboard is `access: public` (a shareable portfolio link) but evidence-only: migrations do not seed demo rows, and empty states remain empty until a real producer ingests data.

## Standards & interop (the hybrid)

Nothing here is bespoke, so production can swap Tracer for a maintained backend:

- **Scores** are `0..1`; case scorers use `autoevals` names; a run = a dataset→task→scorer→experiment.
- **Ingest contract** is OTel-GenAI / OpenInference-shaped (`gen_ai.request.model`, `gen_ai.usage.*`,
  per-check `eval.score` / `eval.explanation`) — mapped to the DB by [lib/openinference.ts](lib/openinference.ts).
- **Swap to Langfuse/Phoenix:** point the upstream `greenlight verify --json` export (see the design
  doc, [docs/greenlight-eval-standardization.md](../../docs/greenlight-eval-standardization.md)) at
  their ingest instead of Tracer's — the result shape already matches what they consume.

## Data (Neon)

Two append-heavy tables — `eval_run` and `eval_case` ([drizzle/schema.ts](drizzle/schema.ts)). Migrations are schema/cleanup only: `0001_seed.sql` is intentionally empty, `0002_remove_seeded_demo_data.sql` removes the legacy portfolio fixtures so only real ingested runs are visible, and `0003_provenance.sql` adds the nullable provenance/metrics columns (`suite`, `repo`, `branch`, `source_url`, `metrics`, `labels`, case `category`/`metrics`), and `0004` adds `eval_run.gating` (default `true`) and relabels legacy rows in place (old values kept in `labels.legacy_env` / `legacy_model` / `version`; no scores or verdicts change, nothing is deleted).
**Regressions, signals, diffs and flaky cases are derived on read in TypeScript** — `deriveRegressions`
([lib/regression.ts](lib/regression.ts)) and [lib/signals.ts](lib/signals.ts), applied by
[lib/queries.ts](lib/queries.ts). They are pure and unit-tested without a DB; there is no SQL mirror.
Reads are bounded (90 days for run lists, the newest 20–40 runs per signal for the overview and
project pages). Runtime reads use the pooled
`DATABASE_URL` (neon-http); migrations use the **direct** form of `DATABASE_URL` (`drizzle.config.ts`)
so they hit the same branch the runtime reads. The build runs `drizzle-kit migrate`; Greenlight's only
DB role is `migrations scan`.

## Troubleshooting

Hit `/api/health` on any env — it returns `{ ok, databaseUrlSet, directUrlSet, runs }`, or on failure a
**503** with a generic `{ ok:false, …, error:"db unreachable" }`. The raw DB error is never returned to
the (public) caller — the real cause is in the **function logs** (`health: db check failed`). The two
booleans + the logs are enough to diagnose; in the logs you'll see e.g.:
- `relation "eval_run" does not exist` — migrations hit a different branch than the runtime reads;
  re-deploy so the build's `drizzle-kit migrate` runs against the current `DATABASE_URL`.
- `DATABASE_URL is not set` — wire the Neon pooled connection string (Vercel env / `infra/tracer.tf`).

## Local dev

A `localhost` `DATABASE_URL` uses node-postgres instead of Neon's HTTP driver (or force it with
`TRACER_DB_DRIVER=pg|neon`), so a stock Postgres is enough:

```
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/tracer   # or a pooled Neon branch URL
export TRACER_INGEST_TOKEN=devtoken
export GEMINI_API_KEY=...       # any one provider key enables /api/run (Gemini = free)
pnpm db:migrate && pnpm dev     # http://localhost:3000
pnpm test                       # vitest: regression / signals / pass-rate / judge parse / cost / OI mapper / badge / public routes
TEST_DATABASE_URL=1 pnpm test   # + the DB-backed query suite (TRUNCATEs — point it at a scratch database)
pnpm greenlight preview tracer  # from the repo root: build + serve on :4321 + verify (the local gate)
```

```
# /api/run: tokenless → 503; no provider key → 503; GET → 405; valid bearer → 201 (one run per provider)
curl -s -XPOST localhost:3000/api/run -H "authorization: Bearer devtoken"

# /api/ingest accepts the native shape OR an OTel-GenAI/OpenInference result:
curl -s -XPOST localhost:3000/api/ingest -H "authorization: Bearer devtoken" -H 'content-type: application/json' \
  -d '{"tool":"tracer","passed":true,"attributes":{"gen_ai.request.model":"gemini-3.8-flash"},
       "checks":[{"name":"smoke","eval.score":1,"eval.explanation":"ok","passed":true}]}'
```

## Dogfood

[scripts/dogfood.mjs](scripts/dogfood.mjs) runs `greenlight verify tracer --json` and POSTs the
standards-shaped result to `/api/ingest` — so Tracer shows up in its own dashboard. It depends on the
upstream `verify --json` export (design doc above) and skips cleanly until that ships.
