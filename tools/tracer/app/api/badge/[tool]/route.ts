import { badgeMessage, badgeSvg } from '../../../../lib/badge';
import { projectSummary } from '../../../../lib/summary';

// Public SVG status badge for a project (`?signal=<key>` narrows it to one signal, `?label=` renames
// the left half). Read-only and cheap; cached at the edge for five minutes so README embeds don't hit
// Neon on every view. A DB failure renders a grey "unavailable" badge rather than a broken image.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ tool: string }> }) {
  const { tool: raw } = await params;
  const tool = decodeURIComponent(raw);
  const url = new URL(req.url);
  const label = url.searchParams.get('label') || tool;
  let svg: string;
  try {
    const s = await projectSummary(tool, url.searchParams.get('signal') ?? undefined);
    svg = badgeSvg(label, badgeMessage(s), s.health);
  } catch (e) {
    console.error('badge: summary failed', e);
    svg = badgeSvg(label, 'unavailable', 'stale');
  }
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
