# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Personal site (`rtrentjones.dev`), a **thin consumer** of the [Greenlight](https://github.com/RTrentJones/greenlight) harness. This repo owns only the **manifest + content**; the lifecycle machinery (CLI, verify, adapters, loop) is pulled in from the `@rtrentjones/greenlight*` packages. Do not add framework logic here — changes to deploy/verify/promote behavior belong upstream in Greenlight and arrive via package updates.

`greenlight.config.ts` is the single source of truth for the setup (domain + tools). Everything else (CI, infra, the blog app) is wired to that manifest.

## Setup & common commands

```
mise install                 # Node 24 + pnpm 10.12.1 (toolchain pinned in mise.toml)
pnpm install                 # framework from vendored tarballs (see below), plus blog deps

pnpm greenlight config       # load + validate the manifest, print it
pnpm greenlight doctor       # manifest + repo consistency checks

pnpm greenlight preview blog # build + serve locally + verify, one command (preferred local loop)

pnpm blog:build              # build the blog (alias: pnpm --filter rtrentjones-blog build)
pnpm blog:preview            # preview the built blog locally (serves on :4321)
pnpm greenlight verify blog --url http://localhost:4321   # run the verify harness against a running URL
```

The three `blog:*` / `verify` steps above are the manual decomposition of `greenlight preview blog`; reach for them when you need an intermediate step.

Inside `apps/blog/`: `pnpm dev` / `pnpm build` / `pnpm preview` (Astro). No test runner or linter is configured yet — adding tests is welcome and valuable. The Greenlight `verify` harness (run against a previewed/deployed URL) is a "close the loop" end-to-end check for the deploy flow, not a substitute for unit/integration tests.

## Greenlight CLI

`pnpm greenlight <command>` (or `pnpm exec greenlight` in CI). Key commands:

- `config` — validate + print the manifest.
- `doctor` — manifest + repo consistency checks.
- `add <name> --lane <l> --target <t>` — scaffold a new tool from a lane template and append a manifest entry.
- `preview <name>` — build + serve locally + verify in one shot (the local dev loop).
- `deploy <name> --env <env>` — build + deploy via the target adapter (needs `CLOUDFLARE_API_TOKEN`).
- `verify <name> [--env <env> | --url <url>]` — run the verify harness. Mode is per-lane (`api`/`playwright` for web, `mcp` for MCP servers); the blog's checks are in `apps/blog/verify.config.ts` (RSS + sitemap parse, no broken internal links).
- `promote <name> [--perform] [--push]` — gated `develop → main` fast-forward.
- `secrets sync` — push local `.greenlight/secrets.env` to the configured secret stores.
- `agent sync` — (re)install the deploy-verify-promote skill + MCP recommendations into this repo.

## Deploy / promote model

Branch → environment, enforced by `.github/workflows/`:

- **PR → preview**, **`develop` → beta**, **`main` → prod** (`deploy.yml`).
- Promotion (`promote.yml`) is an explicit, manually-dispatched gated fast-forward: verify beta → fast-forward `develop` onto `main` → verify prod.
- CI is **creds-guarded**: without the `CLOUDFLARE_API_TOKEN` secret, deploy/verify steps skip cleanly rather than fail.

The blog runs on **Cloudflare Workers Static Assets** (`apps/blog/wrangler.jsonc`), served at the apex (`prod`) and `beta.` subdomain via custom domains. Astro `site` is the real domain by default; `SITE_URL` overrides per-env (e.g. beta builds).

## Layout

- `greenlight.config.ts` — the manifest. The one file that defines this setup.
- `apps/blog/` — the blog. Astro 5 → Cloudflare Workers. Content is `src/content/blog/*.{md,mdx}`; frontmatter schema (`title`, `date`, optional `description`) is in `src/content.config.ts`. New posts = new files in that collection.
- `infra/main.tf` — Terraform that instantiates Greenlight's `module "tool"` / `module "repo"`, **git-sourced by `?ref=v0.1.0`**. `greenlight add` appends blocks. Real apply needs Cloudflare/GitHub creds + the R2 backend (gated).
- `vendor/*.tgz` — vendored framework tarballs (see below).

## Framework consumption — important

`package.json` currently **bootstraps the framework from vendored tarballs** (`vendor/*.tgz`, wired via both `dependencies` and `pnpm.overrides`) because the `@rtrentjones/greenlight*` packages aren't on npm yet. This is temporary.

**After the framework's first `npm publish`:** delete `vendor/`, switch the `@rtrentjones/greenlight*` deps from `file:vendor/...` to `^0.1.0`, and ensure the framework is tagged so `infra/main.tf`'s `?ref=` resolves. Updates then arrive via `pnpm update` — never by merging framework source into this repo.

## Greenlight loop (deploy → verify → promote)

This repo uses Greenlight. Ship changes through the deploy-verify-promote skill:
branch → change → deploy preview → `greenlight verify` → beta → verify → `greenlight promote` → prod → verify.

Agentic kit:
- Skill: `.claude/skills/deploy-verify-promote/SKILL.md` (the loop).
- MCP servers: `.mcp.json` recommends Cloudflare's — run `/mcp` to authenticate.
- Best-practice skills (one-time, user scope):
    `claude plugin marketplace add cloudflare/skills && claude plugin install cloudflare@cloudflare`
