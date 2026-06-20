import { defineConfig } from '@rtrentjones/greenlight-shared';

export default defineConfig({
  domain: 'rtrentjones.dev',
  alerts: { sink: 'github-issue' },
  blog: { lane: 'astro', target: 'workers', data: 'none' },
  tools: [
    { name: 'heistmind', lane: 'next', target: 'vercel', data: 'supabase', auth: 'oauth', access: 'public', envs: ['beta', 'prod'], adopted: true, external: true },
    { name: 'bamcp', lane: 'mcp', target: 'oci', data: 'none', auth: 'oauth', access: 'public', envs: ['beta', 'prod'], dir: 'tools/bamcp', adopted: true, external: true },
  ],
});
