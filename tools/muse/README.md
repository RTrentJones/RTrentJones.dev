# agent — autonomous Gemini-backed Worker

A cron-triggered Cloudflare Worker that calls **Gemini** (free tier), stores the result in **KV**,
and serves it. Scaffolded by `greenlight add <name> --lane agent --target workers --data kv`.

## What it does

- `scheduled` (cron, daily) → prompt Gemini → store the text + metadata in KV.
- `GET /` — the latest output (plain text).
- `GET /status` — `{ ok, lastRun, model, preview }` (the verify target).
- `POST /run` — force a run; **bearer-gated** (`Authorization: Bearer $RUN_TOKEN`).

## Setup (once)

`greenlight add` already rewrote the worker `name` + route domain in `wrangler.toml`. Then:

1. **KV namespace** — `pnpm exec wrangler kv namespace create STATE`, and paste the id into the
   three `id = "REPLACE_WITH_KV_NAMESPACE_ID"` slots in `wrangler.toml`.
2. **Secrets** (per env — the key never goes in the repo):
   - `pnpm exec wrangler secret put GEMINI_API_KEY --env prod` — your Google AI Studio key (free,
     `aistudio.google.com/apikey`).
   - `pnpm exec wrangler secret put RUN_TOKEN --env prod` — any random string.
3. **Deploy → seed → verify**:
   - `pnpm greenlight deploy <name>` (or `pnpm exec wrangler deploy --env prod`).
   - `curl -XPOST https://<name>.<domain>/run -H "Authorization: Bearer $RUN_TOKEN"` (seed the first run).
   - `pnpm greenlight verify <name> --env prod`.

## Free-tier safety

The daily cron is ~1 Gemini call/day (the free tier allows ~1500/day). `/run` is bearer-gated so it
can't be used to burn the quota. The key lives **only** as a Worker secret.

See the `provider-gemini` skill + [docs/agents-plan.md](../../docs/agents-plan.md).
