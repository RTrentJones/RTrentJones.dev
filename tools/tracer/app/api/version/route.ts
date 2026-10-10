import { NextResponse } from 'next/server';

// Artifact identity (the Greenlight /__version convention): the commit this deployment was built
// from, so `greenlight verify --expect-sha` can prove the URL serves the artifact being gated rather
// than a previous deployment still aliased to the domain. Vercel sets VERCEL_GIT_COMMIT_SHA on
// git-triggered builds; GREENLIGHT_SHA covers a CLI build. Served at /__version via the rewrite in
// next.config.mjs (an `_`-prefixed app folder would be private, not routable).
export const dynamic = 'force-dynamic';

export function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GREENLIGHT_SHA || null;
  return NextResponse.json({ sha });
}
