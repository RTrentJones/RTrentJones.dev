// Wrapper-side verify spec for heistmind (next/vercel, external). The DEEP gate lives in the tool
// repo (greenlight-verify.yml on deployment_status runs its Playwright suite against each Vercel
// deployment); this spec is what `greenlight verify heistmind --env beta|prod` asserts FROM THE
// WRAPPER against the public domains — the surface both envs share, since prod serves the
// coming-soon holding page while beta serves the full app:
//  - `/` renders the real app shell (its <title>), not a Vercel error or a stale placeholder;
//  - the public legal pages serve (they stay reachable even behind the prod holding page);
//  - the Discord interactions endpoint has its public key configured: an UNSIGNED POST must be
//    rejected as a bad signature (401). A missing key answers 503 instead, which is exactly the
//    misconfiguration this catches. Nothing signed is ever sent, so it can't trigger a command.
// The Supabase database's liveness is the keepalive Worker's job (it queries `profiles` daily);
// /__version would need a route in the HeistMind repo, so identity stays "unverified" here.
export default {
  mode: 'api',
  checks: [
    {
      path: '/',
      status: 200,
      contains: '<title>HeistMind',
      notContains: 'Application error',
    },
    { path: '/legal/privacy', status: 200 },
    { path: '/legal/terms', status: 200 },
    {
      path: '/api/discord',
      method: 'POST',
      body: { type: 1 },
      status: 401,
      contains: 'invalid request signature',
    },
  ],
  // Vercel deployments can take a moment to alias after a promote — absorb it.
  settleRetries: 3,
  settleMs: 5000,
};
