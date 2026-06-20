// Verify spec for HeistMind (external tool — code in RTrentJones/HeistMind). Lives here
// in the wrapper because the tool is a registry pointer; `greenlight verify heistmind
// --env beta|prod` loads it and runs against the deployed Vercel URL.
//
// Plain object (VerifySpec from @rtrentjones/greenlight-verify) — no import needed.
// Refine the checks once we see the live app (the home route may redirect to auth; add
// a stable public/health route). `status` checks do NOT follow redirects.
export default {
  mode: 'api',
  checks: [{ path: '/', status: 200 }],
};
