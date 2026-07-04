import { defineConfig } from '@rtrentjones/greenlight';

export default defineConfig({
  domain: 'rtrentjones.dev',
  alerts: { sink: 'github-issue' },
  blog: { lane: 'astro', target: 'workers', data: 'none' },
  tools: [
    { name: 'heistmind', lane: 'next', target: 'vercel', data: 'supabase', auth: 'oauth', access: 'public', envs: ['beta', 'prod'], dir: 'tools/heistmind', adopted: true, external: true, tokens: ['TF_VAR_HEISTMIND_GITHUB_ADMIN_TOKEN', 'TF_VAR_HEISTMIND_SUPABASE_DATABASE_PASSWORD', 'TF_VAR_HEISTMIND_DISCORD_CLIENT_ID', 'TF_VAR_HEISTMIND_DISCORD_CLIENT_SECRET', 'TF_VAR_HEISTMIND_DISCORD_PUBLIC_KEY', 'TF_VAR_HEISTMIND_DISCORD_DEV_PUBLIC_KEY', 'VERCEL_AUTOMATION_BYPASS_SECRET_HEISTMIND'] },
    { name: 'bamcp', lane: 'mcp', target: 'oci', data: 'none', auth: 'oauth', access: 'public', envs: ['prod'], dir: 'tools/bamcp', adopted: true, external: true, port: 8000, preview: { command: 'docker compose --profile preview up --build', teardown: 'docker compose --profile preview down -v', port: 8000, path: '/mcp' }, tokens: ['GREENLIGHT_STATUS_TOKEN_BAMCP', 'BAMCP_VERIFY_TOKEN'] },
    // Per-tool secret names are the DECLARED DEFAULT (so each project can differentiate its keys). For
    // THIS project the LLM provider keys are sourced from the shared account secrets (GEMINI/ANTHROPIC/
    // XAI_API_KEY — same value the agent lane uses) — that per-project override lives in infra.yml.
    { name: 'tracer', lane: 'next', target: 'vercel', data: 'neon', auth: 'none', access: 'public', envs: ['prod', 'beta'], tokens: ['TF_VAR_TRACER_INGEST_TOKEN', 'TF_VAR_TRACER_ANTHROPIC_API_KEY', 'TF_VAR_TRACER_GEMINI_API_KEY', 'TF_VAR_TRACER_XAI_API_KEY'] },
    { name: 'muse', lane: 'agent', target: 'workers', data: 'kv', auth: 'none', access: 'public', envs: ['prod'] },
  ],
});
