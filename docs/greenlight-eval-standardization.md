# Design doc — Greenlight eval standardization + verify result export

> **Status:** proposed. **Repo:** this is upstream work for `RTrentJones/greenlight` (the framework),
> consumed by `RTrentJones.dev` (this repo) via a normal `@rtrentjones/greenlight` version bump + the
> matching Terraform `?ref=`. **Motivating consumer:** the Tracer evals dashboard (`tools/tracer`).

## 1. Context

Tracer stores Greenlight `verify` results (eval / agent-web runs) and shows pass-rate-over-time,
regressions, and cross-provider model comparisons. Building it surfaced two facts:

1. **The eval-dashboard space is mature** — Langfuse, Braintrust, and Arize Phoenix already do this, with
   SDKs, CI integrations, and a converging **standard** data model: scores in `0..1`, the
   *dataset → task → scorer → experiment* shape, LLM-as-judge scorers (e.g. Braintrust's open-source
   `autoevals`), and **OpenTelemetry GenAI semantic conventions** / **OpenInference** for the
   trace/eval span attributes.
2. **Greenlight's `eval` mode is non-standard and has no machine-readable output.** It judges on a
   **1–5** scale and only prints a human report to stdout. That makes its results (a) incomparable with
   the rest of the ecosystem and (b) impossible to forward to *any* backend without scraping stdout.

To keep clean separation (Tracer-specific glue lives in Tracer, not the framework) while letting
**other** Greenlight adopters use maintained backends, Greenlight should emit **generic,
standards-conforming** eval results. Then:

- Tracer consumes the export via its own glue script (`tools/tracer/scripts/dogfood.mjs`).
- Everyone else points the same export at Langfuse / Phoenix.
- Greenlight core never learns anything Tracer-specific.

## 2. Goals / non-goals

**Goals**
- Make Greenlight's `eval` scoring conform to the **0..1** standard (with `autoevals`-style scorer names).
- Add a **generic** `greenlight verify --json` export in an **OTel-GenAI / OpenInference**-shaped schema.
- Keep the export backend-agnostic (Tracer, Langfuse, Phoenix, or any OTLP consumer).

**Non-goals (now)**
- No Tracer-specific sink in core (Tracer's POST glue stays in Tracer).
- No full plugin/hook framework (YAGNI — revisit when a *second* post-verify consumer appears; see §8).
- No OTLP/gRPC exporter yet (JSON-to-stdout is enough; OTLP is a later, additive option — §7).

## 3. Current state (what we're changing)

From the installed `@rtrentjones/greenlight@0.5.1` (`dist/` bundles):

- **`eval` mode** (`chunk-XWTOJHLV.js`): spec is
  `{ mode:'eval', cases:[{ name, tool, args, rubric, minScore? }], model? }`. `minScore` **defaults to
  4**. The built-in `llmJudge({ rubric, result })` uses `claude-sonnet-4-6` and a system prompt that
  says *"Score … on a **1–5** scale (5 = fully satisfies). Reply ONLY with JSON
  `{"score":<1-5>,"pass":<bool>,"reason":<short>}`"*; a case fails if `score < minScore` or `pass===false`.
- **`agent-web` mode** (`chunk-KVOI4UL2.js`): `{ mode:'agent-web', scenarios:[{ name, task,
  asserts:[{selector|textContains|urlContains}] }], model?, maxSteps? }`; driver model
  `claude-sonnet-4-6`; produces boolean `checks`.
- **Report shape** (`chunk-QFKE5JKC.js`): `{ pass, mode, url, checks:[{ name, pass, detail? }], logs? }`;
  `allPass(reports)` rolls up. **No tokens / cost / duration / score** on the report, and **no JSON
  output path** — `verify` only calls `printReport()` to stdout (`bin.js`). The only manifest "sink"
  is `alerts.sink` (github-issue), used for deploy-failure alerts, not results.

## 4. The standard we conform to

- **Scores `0..1`** (Braintrust/`autoevals`/OpenInference all use `0..1`; `1.0` = perfect).
- **`autoevals` scorer vocabulary** for names: `Factuality`, `Summary`, `ClosedQA`, `ExactMatch`,
  `Levenshtein`, `JSONDiff`, … (`autoevals` is MIT, returns `0..1`, and its LLM scorers accept any
  OpenAI-compatible endpoint via `openAiBaseUrl`/`openAiApiKey` — so they run on free tiers).
- **OTel-GenAI semantic conventions** for run/span attributes: `gen_ai.request.model`,
  `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, operation duration; **OpenInference** for
  per-eval attributes: `eval.<name>.score` (`0..1`), `eval.<name>.label`, `eval.<name>.explanation`.

## 5. Change A — eval scoring `1–5` → `0..1` (BREAKING)

`llmJudge` and the `eval` spec move to `0..1`:

- Judge system prompt: *"Score 0..1 (1 = fully satisfies). Reply ONLY with JSON
  `{"score":<0..1>,"pass":<bool>,"rationale":<one sentence>}`."* (`reason` → `rationale` to match the
  ecosystem; keep reading `reason` as a fallback for one release.)
- Spec field `minScore` default **4 → 0.8**; a case passes iff `score >= minScore && pass !== false`.
- Clamp parsed scores into `[0,1]` defensively (a stray `1–5` reply clamps to `1`, not silently passing).
- **Optionally reuse `autoevals` upstream**: replace the hand-rolled judge with `autoevals` scorers
  (`Factuality`/`ClosedQA`/`Summary` for rubric cases, `ExactMatch`/`JSONDiff` for exact cases). This is
  the cleanest path and removes bespoke judge code; if not adopted, at least rename to the `0..1` shape.

**Breaking-change handling:** bump the Greenlight **minor/major** version; in the release notes, list the
`minScore` change and grep every consumer's `verify/*.config.ts` for `mode:'eval'` + `minScore` and
rescale (`4/5 → 0.8`, `3/5 → 0.6`). In this repo today only the (future) tracer eval config would use it;
`bamcp` uses `mcp`/`api`, the blog uses `api` — so the blast radius is small but must be checked.

## 6. Change B — generic `verify --json` export (ADDITIVE)

Add a `--json` flag (and/or `GREENLIGHT_VERIFY_JSON=1`) to `greenlight verify`. When set, after running
`verifyAll`, print **one** JSON object (the standards-shaped result) to stdout — *instead of / in addition
to* the human report (suggest: human report to **stderr**, JSON to **stdout**, so `… --json | jq` is clean).

The report builder must additionally capture, where available: the model under test
(`gen_ai.request.model`), token usage (`gen_ai.usage.*` — agent-web already counts judge/driver tokens
internally; thread them through), wall-clock duration, and per-check `score` + `explanation` (today only
`eval` has a score; give `agent-web`/`api` checks a derived `score` of `1.0`/`0.0` from `pass`).

### 6.1 Export schema (v1) — exactly what Tracer's adapter consumes

This matches `tools/tracer/lib/openinference.ts` (`isOpenInferenceResult` + `fromOpenInference`):

```jsonc
{
  "schemaVersion": "1",
  "tool": "tracer",                       // manifest tool name
  "mode": "eval",                          // verify mode that produced this ("eval" | "agent-web" | "api" | …)
  "env": "prod",                           // "prod" | "beta" | "preview"
  "git_sha": "abc1234",                    // nullable
  "passed": true,                          // run-level rollup (allPass)
  "pass_rate": 0.75,                       // 0..1; omit and Tracer derives from checks
  "duration_ms": 4200,                     // nullable
  "attributes": {                          // OTel-GenAI run/span attributes (all optional)
    "gen_ai.request.model": "claude-opus-4-8",
    "gen_ai.usage.input_tokens": 1500,
    "gen_ai.usage.output_tokens": 800,
    "gen_ai.response.cost": 0.12
  },
  "checks": [                              // one per case/scenario/assertion
    {
      "name": "summarize-changelog",       // autoevals scorer name where applicable
      "passed": true,
      "input": "…", "expected": "…", "output": "…",   // all optional
      "eval.score": 0.95,                  // OpenInference: 0..1, nullable
      "eval.explanation": "faithful; names both changes"
    }
  ]
}
```

**Contract note:** Tracer distinguishes this from its native shape by the presence of `checks` (native
uses `cases`). Keep `checks` as the array key. Unknown keys are ignored, so the schema can grow additively.

## 7. Backend-agnostic consumption

The `--json` output is generic. Consumers:

- **Tracer** — `tools/tracer/scripts/dogfood.mjs` runs `greenlight verify tracer --json` and POSTs the
  object to `/api/ingest` (bearer-authed); Tracer's `lib/openinference.ts` maps it to its tables.
- **Langfuse** — pipe the object into a Langfuse score/trace via their SDK (OTel-compatible ingestion).
- **Phoenix** — Phoenix ingests OpenInference natively; the per-check `eval.*` attributes map directly.
- **Later (optional):** add an OTLP exporter so `verify` can emit spans straight to any OTel collector —
  additive, behind a flag; the JSON schema above is the human-debuggable equivalent.

**Adoption guidance to document in Greenlight:** Tracer is a personal/portfolio backend; other adopters
should send `verify --json` to **Langfuse** (OSS, self-host) or **Phoenix** (OTel-native) rather than
stand up Tracer.

## 8. Future: `onVerifyComplete` plugin hook (deferred)

If a *second* post-verify consumer appears (Slack alert, a second dashboard), generalize the `--json`
path into an `onVerifyComplete(result)` hook so sinks register as plugins rather than core growing a flag
per destination. **Do not build this now** — one consumer (the `--json` pipe) is YAGNI-correct. The v1
schema (§6.1) is the stable contract a hook would pass through, so this stays forward-compatible.

## 9. Rollout / sequencing

1. **Tracer in-repo (done, this repo):** multi-provider `/api/run`, `agent-web` verify, infra keys, and
   the `lib/openinference.ts` ingest adapter — Tracer already **accepts** the v1 schema (unit-tested).
   `scripts/dogfood.mjs` is committed but **inert** until `--json` exists.
2. **Greenlight core (this doc):** Change A (0..1) + Change B (`--json`) in one release (the `--json`
   payload should carry 0..1 scores, so ship together). Version bump; migrate consumer `eval` configs.
3. **This repo, after the release:** `pnpm update @rtrentjones/greenlight`, bump the `?ref=` in
   `infra/*.tf`, and turn the dogfood CI step live.

## 10. Testing (upstream)

- Unit: judge JSON parse + `0..1` clamp; `minScore` pass/fail boundary at `0.8`; the result→`--json`
  serializer against the v1 schema (a golden fixture shared with Tracer's `openinference.test.ts`).
- Integration: `greenlight verify <tool> --json | jq .` yields a v1 object; piping it to a stub ingest
  returns 201. Round-trip the golden fixture through Tracer's `fromOpenInference` to prove parity.

## 11. Open questions

- **Reuse `autoevals` in core, or just rename to 0..1?** Reuse is cleaner and removes bespoke judge code,
  but adds a dependency to the framework. Recommendation: reuse (it's small, MIT, free-tier-friendly).
- **Per-check `score` for non-eval modes:** derive `1.0`/`0.0` from `pass` (proposed), or leave null?
  Deriving keeps `/compare` and pass-rate math uniform across modes.
- **stdout vs stderr split** for `--json`: proposed JSON→stdout, human→stderr. Confirm no existing
  tooling parses the human report from stdout.

## Appendix — field mapping

| Greenlight result | `--json` (v1) | OpenInference / OTel-GenAI | Tracer column |
|---|---|---|---|
| tool | `tool` | resource `service.name` | `eval_run.tool` |
| model under test | `attributes["gen_ai.request.model"]` | `gen_ai.request.model` | `eval_run.model` |
| verify mode | `mode` | span name | `eval_run.mode` |
| env | `env` | `deployment.environment` | `eval_run.env` |
| rollup pass | `passed` / `pass_rate` | — | `eval_run.passed` / `pass_rate` |
| duration | `duration_ms` | `gen_ai.client.operation.duration` | `eval_run.duration_ms` |
| tokens | `attributes["gen_ai.usage.*"]` | `gen_ai.usage.input/output_tokens` | `eval_run.tokens_in/out` |
| cost | `attributes["gen_ai.response.cost"]` | (vendor ext.) | `eval_run.cost_usd` |
| per-case name | `checks[].name` | scorer name | `eval_case.name` |
| per-case score (0..1) | `checks[]["eval.score"]` | `eval.<name>.score` | `eval_case.score` |
| per-case rationale | `checks[]["eval.explanation"]` | `eval.<name>.explanation` | `eval_case.judge_rationale` |
