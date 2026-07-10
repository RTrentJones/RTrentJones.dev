# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Personal site (`rtrentjones.dev`), a **thin consumer** of the [Greenlight](https://github.com/RTrentJones/greenlight) harness. This repo owns only the **manifest + content**; the lifecycle machinery (CLI, verify, adapters, loop) is pulled in from the `@rtrentjones/greenlight*` packages. Do not add framework logic here — changes to deploy/verify/promote behavior belong upstream in Greenlight and arrive via package updates.

`greenlight.config.ts` is the single source of truth for the setup (domain + tools). Everything else (CI, infra, the blog app) is wired to that manifest. The manifest now declares the blog plus five tools (`heistmind`, `bamcp`, `tracer`, `muse`, `polyphony`); their code lives under `tools/` (see Layout).

## Setup & common commands

```
mise install                 # Node 24 + pnpm 10.12.1 (toolchain pinned in mise.toml)
pnpm install                 # the published @rtrentjones/greenlight, plus blog deps

pnpm greenlight config       # load + validate the manifest, print it
pnpm greenlight doctor       # manifest + repo consistency checks

pnpm greenlight preview blog # build + serve locally + verify, one command (preferred local loop)

pnpm blog:build              # build the blog (alias: pnpm --filter rtrentjones-blog build)
pnpm blog:preview            # preview the built blog locally (serves on :4321)
pnpm greenlight verify blog --url http://localhost:4321   # run the verify harness against a running URL
```

The three `blog:*` / `verify` steps above are the manual decomposition of `greenlight preview blog`; reach for them when you need an intermediate step.

Inside `apps/blog/`: `pnpm dev` / `pnpm build` / `pnpm preview` (Astro). Lint/format the blog with Biome: `pnpm --filter rtrentjones-blog lint` (`biome check --error-on-warnings`) / `... format` (`biome check --write`); the only Biome config is `apps/blog/biome.json`. `tools/tracer` has a Vitest suite (run in CI by `tracer-db-tests.yml`); the blog itself has no unit tests yet — adding them is welcome. CI's cross-cutting quality gate is `pnpm greenlight doctor --strict` (warnings fail). The Greenlight `verify` harness (run against a previewed/deployed URL) is a "close the loop" end-to-end check for the deploy flow, not a substitute for unit/integration tests.

## Greenlight CLI

`pnpm greenlight <command>` (or `pnpm exec greenlight` in CI). Key commands:

- `config` — validate + print the manifest.
- `doctor` — manifest + repo consistency checks.
- `add <name> --lane <l> --target <t>` — scaffold a new tool from a lane template and append a manifest entry.
- `preview <name>` — build + serve locally + verify in one shot (the local dev loop).
- `deploy <name> --env <env>` — build + deploy via the target adapter (needs `CLOUDFLARE_API_TOKEN`).
- `verify <name> [--env <env> | --url <url>]` — run the verify harness. Mode is per-lane (`api`/`playwright` for web, `mcp` for MCP servers); the blog's checks are in `apps/blog/verify.config.ts` (RSS + sitemap parse, no broken internal links).
- `promote <name> [--perform] [--push]` — gated `develop → main` fast-forward.
- `secrets gather <name>` — guided, link-first token prompts pushed straight to GitHub Actions secrets (hidden input, never written to disk).
- `agent sync` — (re)install the deploy-verify-promote skill + MCP recommendations into this repo.

## Deploy / promote model

Branch → environment, enforced by `.github/workflows/`:

- **`develop` → beta**, **`main` → prod** (`deploy.yml`). PR → preview is deliberately NOT wired — Workers preview URLs aren't deterministic and `verify --env preview` throws by design; the local gate (`greenlight preview`) covers pre-merge.
- `deploy.yml` deploys **only the blog**; each other tool has its own workflow (`deploy-muse.yml`, `greenlight-deploy-bamcp.yml`, `greenlight-deploy-polyphony.yml`, `tracer-db-tests.yml`/`dogfood-tracer.yml`, infra via `infra.yml`). `promote.yml` is generalized via a `name` dispatch input over the allow-list `blog | heistmind | bamcp | tracer | muse | polyphony` (kept in sync with the manifest, checked by `doctor`).
- Promotion (`promote.yml`) is an explicit, manually-dispatched gated fast-forward, **SHA-pinned end to end**: capture develop's tip → verify beta `--expect-sha` → `promote --commit` that exact sha (refuses/limits the FF if develop moved) → **check out the promoted commit** (the FF moves the remote ref, not the CI working tree) → `ship` prod at that sha.
- Deploys are **creds-guarded**: without the `CLOUDFLARE_API_TOKEN` secret, deploy steps skip cleanly. **Promotion is NOT** — a missing cred may skip an action, never a check, so `promote.yml` fails loudly rather than fast-forwarding an unverified build.
- **Clean up merged branches.** Once a `feat/*` branch has shipped (fast-forwarded into `develop`/`main`), delete it locally **and** on the remote so the repo stays at `main` + `develop` plus only in-flight feature branches: `git checkout develop && git branch -d <branch> && git push origin --delete <branch>`.

The blog runs on **Cloudflare Workers Static Assets** (`apps/blog/wrangler.jsonc`), served at the apex (`prod`) and `beta.` subdomain via custom domains. Astro `site` is the real domain by default; `SITE_URL` overrides per-env (e.g. beta builds).

## Layout

- `greenlight.config.ts` — the manifest. The one file that defines this setup.
- `apps/blog/` — the blog. Astro 5 → Cloudflare Workers. Content is `src/content/blog/*.{md,mdx}`; frontmatter schema (`title`, `date`, optional `description`) is in `src/content.config.ts`. New posts = new files in that collection.
- `tools/` — the five manifest tools plus `pg_kafka`. **Two mechanisms**: git submodules (`bamcp`, `heistmind`, `polyphony`, `pg_kafka`) and local pnpm-workspace packages (`muse`, `tracer`). `pnpm-workspace.yaml` lists `apps/*`, `tools/muse`, `tools/tracer` — deliberately **not** `tools/*`, which would swallow the submodules into the workspace. Submodule pointer bumps surface in `git status` as `modified: tools/<name>` — that's pointer drift, not local edits; don't stage them unless intentionally bumping. `tools/pg_kafka` is a Rust Postgres extension **not** in the manifest; it feeds Tracer's build-time evidence (`pg-kafka-tracer.yml`).
- `verify/` — root-level verify specs for the submodule tools (`verify/bamcp.config.ts`, `verify/heistmind.config.ts`, `verify/polyphony.config.ts`). Local tools/apps carry their own `verify.config.ts` (`apps/blog/`, `tools/muse/`, `tools/tracer/`).
- `infra/*.tf` — Terraform instantiating Greenlight's modules (`tool`/`vercel`/`supabase`/`oci-*`/`keepalive`), **git-sourced by a `?ref=` pinned lockstep with the installed npm dep** (see `package.json`; `greenlight doctor` flags drift, `greenlight bump` re-pins). One `.tf` per tool; `greenlight add`/`adopt` emit them. Apply runs in `infra.yml` against **HCP Terraform** state with scoped secrets.

## Framework consumption

`package.json` depends on the **published** `@rtrentjones/greenlight`; Terraform pins the matching module tag (`?ref=v<version>`, lockstep — the exact version lives in `package.json`, never here, so these docs can't drift). Update the mechanics with `pnpm update @rtrentjones/greenlight && pnpm greenlight bump` (re-pins the `?ref=` + dep range in one command) — never by merging framework source into this repo.

This repo runs **v0.8**: CI ships via `greenlight ship` (build → deploy → SHA-gated verify → rollback), promotion is pinned to the verified commit (`verify --expect-sha` / `promote --commit`), and artifact identity is asserted against each tool's `/__version`. The bump record + remaining optional follow-ups are in `docs/greenlight-0.8-activation.md`.

## Greenlight loop (deploy → verify → promote)

This repo uses Greenlight. Ship changes through the deploy-verify-promote skill:
branch → change → deploy preview → `greenlight verify` → beta → verify → `greenlight promote` → prod → verify.

Agentic kit:
- Skill: `.claude/skills/deploy-verify-promote/SKILL.md` (the loop).
- MCP servers: `.mcp.json` recommends Cloudflare, Vercel, and Neon — run `/mcp` to authenticate.
- Per-provider skills: `.claude/skills/provider-*` (cloudflare, github, hcp, vercel, neon, gemini) map each tool's stack to its Greenlight role — consult when wiring or debugging that provider.
- Best-practice skills (one-time, user scope):
    `claude plugin marketplace add cloudflare/skills && claude plugin install cloudflare@cloudflare`
