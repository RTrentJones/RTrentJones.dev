// Wrapper-side verify spec for heistmind (next/vercel, external). The DEEP gate lives in the
// tool repo (greenlight-verify.yml on deployment_status runs its own suite against each Vercel
// deployment); this spec is what `greenlight verify heistmind --env beta|prod` asserts FROM THE
// WRAPPER: the deployment is reachable and serving. No status pinned — the app may answer / with
// a redirect to its sign-in flow; a connection failure or timeout still fails the check.
export default {
  mode: 'api',
  checks: [{ path: '/' }],
  // Vercel deployments can take a moment to alias after a promote — absorb it.
  settleRetries: 3,
  settleMs: 5000,
};
