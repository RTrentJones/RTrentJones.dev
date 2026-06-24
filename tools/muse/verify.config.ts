// The agent exposes GET /status with last-run metadata. The deploy step seeds a run (POST /run)
// before verify, so /status reports ok:true — assert that. settle absorbs Cloudflare propagation.
export default {
  mode: 'api',
  checks: [{ path: '/status', status: 200, contains: '"ok":true' }],
  settleRetries: 6,
  settleMs: 5000,
};
