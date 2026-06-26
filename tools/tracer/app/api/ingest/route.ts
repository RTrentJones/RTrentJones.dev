import { NextResponse } from 'next/server';
import { insertRun } from '../../../lib/insert-run';
import { fromOpenInference, isOpenInferenceResult } from '../../../lib/openinference';
import { evalRunInput } from '../../../lib/schema';

// The ingest seam: eval results POST here. Accepts EITHER the native EvalRunInput shape OR a standard
// OTel-GenAI/OpenInference-shaped verify result (mapped by lib/openinference), so the same endpoint
// receives Tracer's own /api/run output and a future `greenlight verify --json` export. Mutating, so
// bearer-authed; fails CLOSED (503) when no token is configured. Node runtime; this only writes.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const token = process.env.TRACER_INGEST_TOKEN;
  // Fail closed: with no token wired, ingest is disabled rather than open.
  if (!token) {
    return NextResponse.json({ error: 'ingest disabled (TRACER_INGEST_TOKEN unset)' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${token}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  // Standards-shaped payload (OTel-GenAI/OpenInference) is mapped to the native shape first.
  const candidate = isOpenInferenceResult(body) ? fromOpenInference(body) : body;

  const parsed = evalRunInput.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 422 });
  }

  try {
    const id = await insertRun(parsed.data);
    return NextResponse.json({ id, cases: parsed.data.cases.length }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'insert failed' }, { status: 500 });
  }
}
