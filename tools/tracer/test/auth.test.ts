import { describe, expect, it } from 'vitest';
import { timingSafeBearer } from '../lib/auth';

describe('timingSafeBearer', () => {
  const token = 'a'.repeat(64); // stand-in for an `openssl rand -hex 32` value

  it('accepts the exact `Bearer <token>`', () => {
    expect(timingSafeBearer(`Bearer ${token}`, token)).toBe(true);
  });

  it('rejects a wrong token of the same length', () => {
    expect(timingSafeBearer(`Bearer ${'b'.repeat(64)}`, token)).toBe(false);
  });

  it('rejects shorter/longer headers without throwing (hash equalizes length)', () => {
    expect(timingSafeBearer('Bearer short', token)).toBe(false);
    expect(timingSafeBearer(`Bearer ${token}extra`, token)).toBe(false);
  });

  it('rejects a null header, an unset token, and a missing scheme', () => {
    expect(timingSafeBearer(null, token)).toBe(false);
    expect(timingSafeBearer(`Bearer ${token}`, undefined)).toBe(false);
    expect(timingSafeBearer(token, token)).toBe(false); // bare token, no "Bearer " prefix
  });
});
