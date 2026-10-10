// The agent exposes GET /status with run metadata. The deploy step seeds a run (POST /run) before
// verify. Assert the things that actually break, not just that the Worker answers:
//  - ok:true — there is output AND the latest attempt did not fail (a failed cron run flips it);
//  - lastRun is recent — the cron is daily, so >26h means it stopped (a retired model, a revoked
//    key) while /status kept answering 200. lastError names the cause in the failure detail.
// requireIdentity: the deploy bakes GREENLIGHT_SHA and verify runs with --expect-sha, so /__version
// must report the shipped commit. settle absorbs Cloudflare propagation.
export default {
  mode: 'api',
  checks: [
    {
      path: '/status',
      status: 200,
      json: [
        { path: 'ok', equals: true },
        { path: 'lastError', equals: null },
        { path: 'lastRun', maxAgeHours: 26 },
      ],
    },
  ],
  requireIdentity: true,
  settleRetries: 6,
  settleMs: 5000,
};
