import { createHash, timingSafeEqual } from 'node:crypto';

// Constant-time bearer check for the mutating/spending routes (/api/ingest, /api/run). A plain
// `header !== \`Bearer ${token}\`` compares char-by-char and short-circuits, leaking a timing
// side-channel; hashing both sides to a fixed-width digest first means timingSafeEqual always gets
// equal-length buffers (no throw, no length leak) and runs in constant time. Node runtime only.
export function timingSafeBearer(header: string | null, token: string | undefined): boolean {
  if (!header || !token) return false;
  const a = createHash('sha256').update(header).digest();
  const b = createHash('sha256').update(`Bearer ${token}`).digest();
  return timingSafeEqual(a, b);
}
