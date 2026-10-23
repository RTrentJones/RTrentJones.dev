import { badgeMessage, badgeSvg } from '../../../../lib/badge';
import { projectSummary } from '../../../../lib/summary';

// Public SVG status badge for a project (`?signal=<key>` narrows it to one signal, `?label=` renames
// the left half). Read-only and cheap; cached at the edge for five minutes so README embeds don't hit
// Neon on every view. A DB failure renders a grey "unavailable" badge rather than a broken image.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ tool: string }> }) {
  // Route params arrive decoded; decoding again would throw on a literal `%` (a 500 outside the try).
  const { tool } = await params;
  const url = new URL(req.url);
  const label = url.searchParams.get('label') || tool;
  let svg: string;
  // An outage badge must not be edge-cached for minutes after the DB recovers.
  let cache = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';
  try {
    const s = await projectSummary(tool, url.searchParams.get('signal') ?? undefined);
    svg = badgeSvg(label, badgeMessage(s), s.health);
  } catch (e) {
    console.error('badge: summary failed', e);
    svg = badgeSvg(label, 'unavailable', 'stale');
    cache = 'no-store';
  }
  return new Response(svg, {
    headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': cache },
  });
}
