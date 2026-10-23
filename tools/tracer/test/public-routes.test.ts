import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as badgeGET } from '../app/api/badge/[tool]/route';
import { GET as summaryGET } from '../app/api/summary/[tool]/route';

// The public read routes with no database (DATABASE_URL unset, so every DB read throws). Next hands
// route params over already decoded, so `/api/badge/%25` arrives as `%`: a second decode would throw
// outside the handler's try and 500. The badge must still render (grey "unavailable", never edge-cached)
// and the summary must answer a generic 503 that leaks nothing about the DB.

// The raw error goes to the function logs (console.error); capture it so it is asserted, not printed.
let savedUrl: string | undefined;
let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  savedUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  logged.mockRestore();
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
});

const params = (tool: string) => ({ params: Promise.resolve({ tool }) });

describe('GET /api/badge/[tool] without a DB', () => {
  it('renders an uncached "unavailable" SVG for /api/badge/%25', async () => {
    const res = await badgeGET(new Request('http://t/api/badge/%25'), params('%'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const svg = await res.text();
    expect(svg).toContain('<svg');
    expect(svg).toContain('unavailable');
    expect(svg).not.toMatch(/DATABASE_URL|postgres/i);
    expect(logged).toHaveBeenCalled();
  });
});

describe('GET /api/summary/[tool] without a DB', () => {
  it('returns a generic 503 JSON for /api/summary/50%25', async () => {
    const res = await summaryGET(new Request('http://t/api/summary/50%25'), params('50%'));
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toContain('application/json');
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ tool: '50%', error: 'unavailable' });
    expect(text).not.toMatch(/DATABASE_URL|postgres|neon|relation/i);
    expect(logged).toHaveBeenCalled();
  });
});
