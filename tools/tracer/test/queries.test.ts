import { describe, expect, it } from 'vitest';
import { getRun } from '../lib/queries';

// getRun validates the id against a UUID regex BEFORE touching the DB: a malformed id returns null
// (→ notFound) instead of binding into `WHERE id = …` and raising a Postgres "invalid input syntax for
// type uuid" cast error (which renders as a misleading "DATABASE_URL misconfigured" boundary). Because
// the guard short-circuits ahead of getDb(), these cases need no database connection.
describe('getRun id validation', () => {
  it('returns null for a non-UUID id without touching the DB', async () => {
    await expect(getRun('not-a-uuid')).resolves.toBeNull();
    await expect(getRun('123')).resolves.toBeNull();
    await expect(getRun('')).resolves.toBeNull();
    await expect(getRun("'; DROP TABLE eval_run;--")).resolves.toBeNull();
    await expect(getRun('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')).resolves.toBeNull(); // right shape, bad hex
  });
});
