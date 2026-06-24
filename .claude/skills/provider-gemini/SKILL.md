---
name: provider-gemini
description: How the `agent` lane works in Greenlight — an autonomous cron-triggered Cloudflare Worker backed by Google Gemini (free tier). Covers the GEMINI_API_KEY (Google AI Studio, no billing), the gemini-2.5-flash generateContent call, the wrangler deploy (cron + KV + secret + custom_domain), the /, /status, /run surface, api-mode verify, and the free-tier safety envelope. Use when building, deploying, or verifying an agent tool.
---

# provider-gemini

The `agent` lane is an **autonomous tool**: a Cloudflare Worker that wakes on a **cron trigger**,
calls **Gemini** (Google's LLM, free tier), does low-stakes work, stores the result in KV, and
exposes a tiny HTTP surface. It's the keepalive Worker pattern promoted to a user tool — free,
always-available, immune to repo-inactivity, no OCI box, no new paid account.

`agent` → target **workers**, data **none | kv** (kv holds the last output + run metadata).

## Token — `GEMINI_API_KEY`

Create it at **Google AI Studio** (https://aistudio.google.com/apikey) — **free tier, no billing,
no card**. `greenlight add` verifies it against `…/v1beta/models?key=…` (HTTP 200). One key serves
every agent (shared, not per-tool). It is a **Cloudflare Worker secret** (`wrangler secret put
GEMINI_API_KEY`) — never in the repo.

## The model + call

`gemini-2.5-flash` (fast; generous free limits — ~15 RPM / 1500 req/day, so a daily cron is ~1/day).

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}
{ "contents": [{ "parts": [{ "text": "<prompt>" }] }] }
→ candidates[0].content.parts[0].text
```

## Deploy — wrangler (workers target)

Like the astro blog: cron + KV + secret + `custom_domain` in `wrangler.toml`; no Terraform.

```toml
[triggers]
crons = ["0 13 * * *"]            # daily; stays far under the free-tier quota
[[kv_namespaces]]
binding = "STATE"
[[routes]]
pattern = "<name>.<domain>"
custom_domain = true
```

## Surface

| route | purpose |
|---|---|
| `scheduled()` | the cron: prompt Gemini → `STATE.put(today, text + metadata)` |
| `GET /` | the latest output (public, read-only) |
| `GET /status` | `{ ok, lastRun, model, preview }` — the **api-mode verify** target |
| `POST /run` | force a run — **bearer-gated** (a `RUN_TOKEN` secret) so randoms can't burn the Gemini quota; lets deploy/verify seed the first output |

## Verify — `api` mode on `/status`

`verify.config.ts` hits `/status` and asserts `ok: true` + a recent run. (Output *quality* is a
future `eval` mode — LLM-judged.) Because the first cron may not have fired at deploy time, the
deploy step `POST /run`s once to seed, then verifies.

## Safety envelope

- **Low-stakes / read-only** first agents (generate → store → serve; no destructive external actions).
- **Bearer on `/run`**; the cron frequency stays far under the free-tier daily limit.
- Key is **secret-only** (a Worker secret), never committed or echoed.

## No keepalive

An agent needs no keepalive — the cron *is* its heartbeat and the Worker is always-available
(Cloudflare's edge, not a reclaimable box). Don't add it to `module.keepalive.targets_json`.
