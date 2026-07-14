# Tracer staff-engineer evaluation and roadmap

## Executive critique

Tracer has the right shape for a portfolio-grade eval signal: append-only runs, case-level evidence,
provider-agnostic ingest, OpenInference-compatible mapping, regression derivation, and public read-only
views. The strongest architectural choice is that the data model is generic over `tool`, `mode`, `env`,
and `model`, so it can represent LLM evals, agent-web checks, API checks, and non-LLM project signals
such as `pg_kafka` without adding project-specific tables.

The biggest credibility gap was seeded demo data. A dashboard that mixes real and synthetic eval rows
is useful for UI development, but it weakens the portfolio signal because visitors cannot distinguish
actual project performance from fixtures. This PR changes the posture to evidence-only: new migrations
must not insert fake runs, and a cleanup migration deletes the legacy seeded rows while preserving real
producer data.

## What is good

- **Small, legible core.** Two append-heavy tables (`eval_run`, `eval_case`) are enough for time-series
  eval tracking without committing to a heavyweight observability backend.
- **Standards-aware ingest.** Native payloads and OpenInference-shaped results can both land in the
  same schema, which keeps the door open for Langfuse/Phoenix export later.
- **Case-level interpretability.** Storing `input`, `expected`, `output`, `score`, `passed`, and
  `judge_rationale` gives reviewers the failure evidence, not just an aggregate pass rate.
- **Generic dimensions.** `tool`, `mode`, `env`, and `model` allow Tracer to track `tracer`, `bamcp`,
  `pg_kafka`, and future side projects without schema forks.
- **Fail-closed write paths.** Ingest and run endpoints require bearer auth and validate bodies before
  writing.

## What is not yet staff-level

- **No provenance boundary.** Rows do not yet record source type, producer version, CI URL, dataset
  version, or config hash. Without provenance, reproducibility and trust rely on convention.
- **No explicit real-vs-fixture guardrail beyond migration policy.** Removing seed data solves the
  visible problem, but the ingest contract should eventually include a `source`/`provenance` object and
  production should reject `synthetic`, `sample`, or `demo` sources.
- **Regression semantics are simple.** Comparing pass-rate to the immediately previous run is a good
  start, but top-tier eval systems also need baseline branches, statistical windows, severity, and
  noisy-test quarantine.
- **Dataset lineage is implicit.** Case names align compare views, but there is no first-class dataset
  id/version or task taxonomy.
- **No artifact links.** Side-project signals become much stronger when each run points to a commit,
  CI job, benchmark artifact, trace export, or generated report.
- **Limited operational controls.** There is no rate limit, write audit log, environment separation, or
  retention/export policy.

## PR plan implemented here: remove seeded/fake data

1. Make the legacy seed migration intentionally empty so fresh environments do not create demo runs.
2. Add a cleanup migration that deletes only the exact legacy fixture rows by matching their known
   tool/model/mode/env/git_sha/pass-rate tuple and seeded case names.
3. Update Tracer documentation to state that the dashboard is evidence-only and supports project-specific
   modes such as `pg_kafka`.
4. Keep the generic schema intact so real `bamcp`, `pg_kafka`, API, and LLM eval producers continue to
   ingest through the same path.

## Next steps to become a top-tier side-project signal

### 1. Provenance and trust

- Add `source_kind`, `source_url`, `producer`, `producer_version`, `dataset_id`, `dataset_version`,
  `config_hash`, and `run_group` columns or a normalized metadata table.
- Require a non-demo source for production ingest.
- Link every run to a commit SHA and CI/build URL when available.
- Add a signed or HMAC-authenticated ingest option for CI producers.

### 2. Dataset and case taxonomy

- Introduce stable dataset ids and semantic case tags (`safety`, `tool-use`, `latency`, `exactness`,
  `pg_kafka.replication`, `pg_kafka.schema-change`, etc.).
- Track case ownership and expected flake/noise level.
- Show score distributions by tag, not only pass-rate by model.

### 3. Stronger regression detection

- Compare against named baselines (`main`, last release, best known good), not only previous run.
- Add rolling windows, minimum sample sizes, and severity thresholds.
- Support manual adjudication for known flaky cases.
- Emit a machine-readable gate result that CI can consume.

### 4. Multi-project support, including `pg_kafka`

- Treat `tool` as the project key and `mode` as the signal type. Examples:
  - `tool=pg_kafka`, `mode=integration` for Postgres-to-Kafka replication tests.
  - `tool=pg_kafka`, `mode=compat` for Postgres/Kafka version-matrix checks.
  - `tool=pg_kafka`, `mode=benchmark` for throughput/latency runs.
  - `tool=tracer`, `mode=eval` for LLM judge suites.
- Use case names and tags to encode project-specific dimensions without schema forks.
- Add optional numeric metrics for non-LLM projects, either as attributes JSON or a side table, so
  `pg_kafka` can track lag, throughput, p95 latency, and error counts alongside pass/fail.

### 5. Portfolio-quality presentation

- Add an evidence banner that says “real ingested runs only” and links to the ingest contract.
- Show provenance links in run detail pages.
- Add a public “latest signal” summary per project: current health, last regression, coverage areas,
  and most recent real run time.
- Export a static badge/SVG or JSON endpoint that side-project README files can embed.

### 6. Interop and escape hatches

- Keep OpenInference compatibility, but add export jobs to Langfuse/Phoenix-compatible formats.
- Provide a documented CLI example for `greenlight verify --json | tracer ingest`.
- Add a backfill/import script that can ingest historical CI artifacts without creating synthetic rows.
