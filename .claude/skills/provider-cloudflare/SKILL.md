---
name: provider-cloudflare
description: Cloudflare in a Greenlight setup — the always-on DNS/zone provider, the keepalive Worker host, the workers runtime. Use when wiring DNS, the keepalive Worker, a workers-target tool, or debugging a Cloudflare apply or token scope.
---

# provider-cloudflare

Cloudflare is the **always-on** provider: it owns the DNS zone for the domain (every tool's
`<name>.<domain>` CNAME), hosts the **keepalive** Worker (a Cron Trigger, immune to
repo-inactivity disable), and is the `target: workers` runtime for the blog and throwaway MCP
dev targets.

## Token — `CLOUDFLARE_API_TOKEN`

Scopes, creation, and the verify command live in
[tokens-reference.md](https://github.com/RTrentJones/greenlight/blob/main/docs/tokens-reference.md).
The short of it: **Account · Workers Scripts:Edit + Zone · DNS:Edit + Account · Account
Settings:Read** (+ **Account · Cloudflare Tunnel:Edit** only if any tool is `target: oci`).
Single store: **GitHub Actions secrets** (no local secret file). `greenlight add` fails fast on a
mis-scoped token — beyond `status: active` it probes `/accounts`, so a Zone-DNS-only token (which
can't see the account it needs) is rejected before you commit.

## Terraform modules

- `infra/modules/tool` — the subdomain DNS record. `proxied = target != "vercel"` (Vercel needs an
  unproxied CNAME to `cname.vercel-dns.com`; everything else is proxied).
- `infra/modules/keepalive` — `cloudflare_workers_script` + `cloudflare_workers_cron_trigger`,
  self-contained (bundled `worker.js`). **One** worker aggregates all targets via `targets_json`;
  do not emit a worker per tool.

## MCP

`.mcp.json` wires `cloudflare` (Workers/DNS/R2/KV/D1/builds/observability) + `cloudflare-docs`.
Run `/mcp` to authenticate.

## Gotchas
- **Account id from a scoped token (`/memberships` 403).** A scoped API token can't call
  `/memberships` to discover the account id, so Workers/wrangler deploys that need it fail. Resolve
  the account id **from the zone** in CI (the agent-lane deploy workflow does exactly this) or write
  it into `wrangler.toml` at `add` time — never rely on `/memberships`.
- **workers.dev subdomain (error 10063).** A first Workers deploy needs a workers.dev subdomain
  registered on the account once.
- **Wrangler vs Terraform DNS ownership.** A record managed by wrangler (a Workers custom domain)
  collides with a Terraform `cloudflare_dns_record` of the same name — one owner per record.
- **`observability` block on `cloudflare_workers_script`** trips a provider bug (propagation_policy
  conversion error) — leave it off.
