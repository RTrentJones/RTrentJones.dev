// Verify the deployed app renders AND reads Neon: the page runs a live SELECT, so a missing table or
// a bad connection 500s instead of returning the marker text. The settle absorbs Vercel propagation.
export default {
  mode: 'api',
  checks: [{ path: '/', status: 200, contains: 'note(s) from Neon' }],
  settleRetries: 6,
  settleMs: 5000,
};
