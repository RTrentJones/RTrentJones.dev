---
name: deploy-verify-promote
description: Ship a change through Greenlight's loop — deploy to preview/beta, verify with the shared harness, then gated-promote develop→main to prod. Use when making a change to a Greenlight tool or the blog and you want it shipped with confidence, or when explicitly asked to deploy/verify/promote.
---

# deploy-verify-promote

The execution discipline for changing a Greenlight tool or the blog. The verify
harness and promote guard are the **same code CI runs**, so passing locally means
passing in CI. This is what lets a change (or a long string of changes) be shipped
with objective confidence rather than vibes.

## Input

- `<name>` — a manifest entry: `blog`, or a tool name from `greenlight.config.ts`.

## Deterministic URL scheme (never scrape deploy logs)

| Subject | prod | beta |
|---|---|---|
| tool | `https://<name>.<domain>` | `https://beta.<name>.<domain>` |
| blog (apex) | `https://<domain>` | `https://beta.<domain>` |
| mcp connect | *(tool url)* `+ /mcp` | same `+ /mcp` |

`preview` is per-target and comes from the adapter's `deploy()` result. Everything
else is computed by `resolveUrl` in `@rtrentjones/greenlight-shared`.

## Procedure

1. **Branch** — `git checkout -b <type>/<slug>` (e.g. `post/hello`, `fix/mcp-auth`).
2. **Make the change.**
3. **Preview** — push; the target's git integration produces a preview deploy. Verify it.
   - Local/CI: `runLoop` (build → deploy → verify) from `@rtrentjones/greenlight-loop`.
   - Standalone / local server: `pnpm greenlight verify <name> --url <preview-or-localhost-url>`.
4. **Beta** — merge to `develop` → beta deploy. `pnpm greenlight verify <name> --env beta`.
   Mode is chosen by lane: `api`/`playwright` for web, `mcp` for MCP servers.
5. **Promote** — `pnpm greenlight promote <name>`. Checks the fast-forward guard
   (`develop → main`). If it refuses (diverged `main`), reconcile and retry — never force-push.
6. **Prod** — after promote, `pnpm greenlight verify <name> --env prod`.

## Rules

- `verify` exits non-zero if any check fails; the report lists each. **Never promote a
  tool whose beta verify is failing.**
- Connect URL for MCP tools is the tool URL + `/mcp`; `verify` handles this by lane.
- Real per-target deploys are wired in phases (greenlight-v1.md §16); the loop, verify,
  and promote guard are stable now.

## Cross-repo note

In standalone repos (BAMCP, ejected tools) this skill is delivered by the **Greenlight
Claude Code plugin** (Phase 7), and the mechanics by the `@rtrentjones/greenlight*` npm
deps; the per-repo parameters come from that repo's `greenlight.config.ts`.
