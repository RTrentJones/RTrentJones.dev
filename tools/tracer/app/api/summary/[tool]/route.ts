import { NextResponse } from 'next/server';
import { projectSummary } from '../../../../lib/summary';

// Public, read-only JSON status for a project: its health rollup plus the latest run of every signal
// (`?signal=<key>` narrows to one). For READMEs, status pages, and CI that wants to gate on Tracer.
// Errors return a generic 503 (the raw DB error goes to the function logs, as in /api/health).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ tool: string }> }) {
  // Route params arrive decoded; decoding again would throw on a literal `%` (a 500 outside the try).
  const { tool } = await params;
  try {
    const s = await projectSummary(tool, new URL(req.url).searchParams.get('signal') ?? undefined);
    if (s.health === 'empty') return NextResponse.json({ tool, error: 'no runs for this project' }, { status: 404 });
    return NextResponse.json(s, { headers: { 'cache-control': 'public, max-age=60, s-maxage=300' } });
  } catch (e) {
    console.error('summary: failed', e);
    return NextResponse.json({ tool, error: 'unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
