import { defineConfig } from '@rtrentjones/greenlight-shared';

export default defineConfig({
  domain: 'rtrentjones.dev',
  alerts: { sink: 'github-issue' },
  blog: { lane: 'astro', target: 'workers', data: 'none' },
  tools: [],
});
