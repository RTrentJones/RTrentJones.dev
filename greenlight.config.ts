import { defineConfig } from '@rtrentjones/greenlight-shared';

export default defineConfig({
  domain: 'rtrentjones.dev',
  alerts: { sink: 'github-issue' },
  blog: { lane: 'astro', target: 'workers', data: 'none' },
  tools: [
    // HeistMind — code lives in RTrentJones/HeistMind; Vercel + Supabase are configured
    // from this wrapper's infra. `external` = registry pointer (deployed from its own
    // repo via Vercel git integration); verify/doctor target it by URL.
    {
      name: 'heistmind',
      lane: 'next',
      target: 'vercel',
      data: 'supabase',
      auth: 'oauth',
      envs: ['beta', 'prod'],
      external: true,
      adopted: true,
    },
  ],
});
