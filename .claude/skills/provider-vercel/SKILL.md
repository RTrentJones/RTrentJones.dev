---
name: provider-vercel
description: How Vercel works in a Greenlight setup — the default target for the `next` lane, configure-existing-project model (domains + env vars by project_id; deploys ride git integration), team-scoped token, and the Vercel MCP. Use when wiring a next/vercel tool, env vars, domains, or debugging a Vercel deploy.
---

# provider-vercel

Vercel is the default `target` for the `next` lane. Greenlight does **not** create or deploy
the project — it **configures an existing** Vercel project (domains + environment variables)
by `project_id`, and the app's own repo deploys via Vercel's **git integration** (push →
build). The wrapper owns infra; the tool repo owns deploys.

## Token — `VERCEL_API_TOKEN`

Account → Settings → Tokens. **Scope it to the team** that owns the project. The Terraform
`vercel` provider also takes `team` (the `team_…` id). Store in `.greenlight/secrets.env`;
`greenlight add` verifies it against `/v2/user` (HTTP 200) before commit.

## Terraform module — `infra/modules/vercel`

Manages the **existing** project (nothing to import — it configures by id):
- `domain` → adds `<name>.<domain>` (production) + `beta.<name>.<domain>` (preview/`beta_branch`).
- `environment` + `environment_values` → env vars per target (`production` / `preview`).
  Wire Supabase creds straight from the `supabase` module's outputs — no manual copy (that
  manual copy was the old fragility).

The DNS CNAME is the **cloudflare** `tool` module, unproxied (`proxied = false`) → `cname.vercel-dns.com`.

## The verify loop — tool-CI on `deployment_status`

Because Vercel deploys (not the wrapper), the verify gate runs in the **tool repo's own CI**, not a
wrapper deploy listener. `greenlight adopt … --target vercel` emits, into the tool repo:
- **`.github/workflows/greenlight-verify.yml`** — triggers on GitHub's **`deployment_status`** event
  (Vercel posts a deployment + `target_url`); on `state == success` it runs
  `npx @rtrentjones/greenlight verify --url <target_url> --spec verify/<name>.config.ts`. The result
  is a check on the commit — no wrapper round-trip, no dispatch/status PATs (Vercel owns deploy + URL
  + its own statuses).
- **`verify/<name>.config.ts`** — a verifyAll array: `api` (deployed URL 200) + `test` (the tool's
  suite) + `agent-web` (LLM drives the live UI), where agent-web is **config-gated on
  `ANTHROPIC_API_KEY`** (omitted when unset → the gate stays green on api + test alone).

`greenlight verify --url <url> --spec <path>` is the **manifest-free** mode that makes this work
without carrying the wrapper's `greenlight.config.ts` into the tool repo.

**Deployment Protection gotcha:** `deployment_status.target_url` is the `*.vercel.app` *deployment*
URL, which Vercel **Deployment Protection** gates (→ **401**) even though the public custom domain
is 200. To verify the real app, create a **Protection Bypass for Automation** secret (Vercel →
project → Settings → Deployment Protection) and set it as `VERCEL_AUTOMATION_BYPASS_SECRET_<TOOL>` (per-tool — the bypass value is per Vercel project, so a second vercel tool never collides) on the
tool repo — the api check sends it as `x-vercel-protection-bypass` and asserts 200. Without it the
generated spec asserts **401** (the deployment is served + protected), so the gate stays green.

## MCP

`.mcp.json` wires `vercel` (hosted, OAuth, read-only). Run `/mcp` and authenticate in the
browser. Use it to read deployments, build logs, runtime logs, projects.

## Gotchas
- **ENV_CONFLICT** on apply = a var with that key/target already exists on the project. Delete
  the pre-existing ones (Vercel dashboard or API) then re-apply, or import them.
- The Greenlight `beta_branch` must match the repo's actual pre-prod branch (HeistMind uses
  `development`; new tools use `develop`).
- `next` can also target `workers` (V0/V2) — default is vercel.
