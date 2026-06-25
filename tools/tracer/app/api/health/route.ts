import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db';

// Diagnostic endpoint: reports whether the DB env is wired and whether a live query works, returning
// the real error as JSON (Server Component errors are masked in production, so this is how you see the
// actual cause from a browser). Reads only; safe to leave public. Hit it on any env, e.g.
// https://beta.tracer.rtrentjones.dev/api/health
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const databaseUrlSet = Boolean(process.env.DATABASE_URL);
  const directUrlSet = Boolean(process.env.DIRECT_URL);

  try {
    const db = getDb();
    // SELECT 1 proves connectivity; the run count proves the schema + migrations are present.
    await db.execute(sql`SELECT 1`);
    const res = await db.execute(sql`SELECT count(*)::int AS runs FROM eval_run`);
    const runs = (res.rows[0] as { runs: number } | undefined)?.runs ?? 0;
    return NextResponse.json({ ok: true, databaseUrlSet, directUrlSet, runs });
  } catch (e) {
    return NextResponse.json(
      { ok: false, databaseUrlSet, directUrlSet, error: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    );
  }
}
