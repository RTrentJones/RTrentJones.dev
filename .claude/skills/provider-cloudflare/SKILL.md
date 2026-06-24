---
name: provider-cloudflare
description: How Cloudflare works in a Greenlight setup — the zone/DNS provider for every tool, Workers as the keepalive/blog target, token scoping (Workers Scripts:Edit + Zone DNS:Edit), and the Cloudflare MCP. Use when wiring DNS, the keepalive worker, a workers-target tool, or debugging a Cloudflare apply/token.
---

# provider-cloudflare

Cloudflare is the **always-on** provider in Greenlight: it owns the DNS zone for the
domain (every tool's `<name>.<domain>` CNAME), hosts the **keepalive** Worker (a Cron
Trigger, immune to repo-inactivity disable), and is the `target: workers` runtime for the
blog and throwaway MCP dev targets.

## Token — `CLOUDFLARE_API_TOKEN`

One token, these scopes (a missing scope took down a live apply more than once):
- **Account · Workers Scripts · Edit** — deploy the keepalive worker / workers-target tools.
- **Zone · DNS · Edit** — the subdomain CNAMEs.
- **Account · Account Settings · Read** — read account id.
- **Account · Cloudflare Tunnel · Edit** — only if a tool uses `target: oci` (the cloudflared
  tunnel). Without it, the tunnel resource fails with **403 Forbidden** on `cfd_tunnel` at apply.

Create at dash → My Profile → API Tokens → Custom Token. Store in `.greenlight/secrets.env`
(gitignored) and push to GitHub Actions with `greenlight secrets sync`. `greenlight add`
verifies it against `/user/tokens/verify` (status must be `active`) before you commit.

## Terraform modules

- `infra/modules/tool` — the subdomain DNS record. `proxied = target != "vercel"` (Vercel
  needs an unproxied CNAME to `cname.vercel-dns.com`; everything else is proxied).
- `infra/modules/keepalive` — `cloudflare_workers_script` + `cloudflare_workers_cron_trigger`,
  self-contained (ships its own bundled `worker.js`). One worker aggregates all targets via
  `targets_json`; do **not** emit a worker per tool. Needs a workers.dev subdomain registered
  on the account once (error 10063 if missing).

## MCP

`.mcp.json` wires `cloudflare` (Workers/DNS/R2/KV/D1/builds/observability) + `cloudflare-docs`.
Run `/mcp` to authenticate. For richer help: the `cloudflare@cloudflare` plugin skill.

## Gotchas
- A DNS record for the apex managed by **wrangler** (Workers custom domain) collides with a
  Terraform `cloudflare_dns_record` for the same name — pick one owner per record.
- The `observability` block on `cloudflare_workers_script` has a provider bug
  (propagation_policy conversion error) — leave it off.
