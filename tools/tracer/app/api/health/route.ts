import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db';

// Diagnostic endpoint: reports whether the DB env is wired (the two booleans) and whether a live query
// works. Public + reads-only, so it returns a GENERIC failure to the caller and logs the real cause to
// the function logs — the raw Neon/Postgres error text (host, role, schema) must not leak to anonymous
// visitors. The booleans + server logs are enough to diagnose. Hit it on any env, e.g.
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
    // Real cause to the logs (where the operator can see it); generic message to the public response.
    console.error('health: db check failed', e);
    return NextResponse.json(
      { ok: false, databaseUrlSet, directUrlSet, error: 'db unreachable' },
      { status: 503 },
    );
  }
}
