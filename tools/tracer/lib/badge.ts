import type { Health } from './signals';

// Shields-style status badge as a self-contained SVG string, so a project README can embed
// `![tracer](https://tracer.rtrentjones.dev/api/badge/bamcp)`. Pure (no DB), unit-tested. Text widths
// are estimated from a per-character average, which is close enough for an 11px Verdana label.

const COLORS: Record<Health, string> = {
  passing: '#0b7f0b',
  regressed: '#a86b00',
  failing: '#c02f2f',
  stale: '#6b6a66',
  empty: '#6b6a66',
};

const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string);

const textWidth = (s: string) => Math.round(s.length * 6.6 + 10);

export function badgeSvg(label: string, message: string, health: Health): string {
  const l = escapeXml(label.slice(0, 60));
  const m = escapeXml(message.slice(0, 60));
  const lw = textWidth(label.slice(0, 60));
  const mw = textWidth(message.slice(0, 60));
  const w = lw + mw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${l}: ${m}"><title>${l}: ${m}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${mw}" height="20" fill="${COLORS[health]}"/><rect width="${w}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${lw / 2}" y="14">${l}</text><text x="${lw + mw / 2}" y="14">${m}</text></g></svg>`;
}

/** The badge message for a health rollup, e.g. "passing", "2 failing", "regressed". */
export function badgeMessage(h: { health: Health; failing: number; regressed: number }): string {
  switch (h.health) {
    case 'failing':
      return `${h.failing} failing`;
    case 'regressed':
      return h.regressed > 1 ? `${h.regressed} regressed` : 'regressed';
    case 'empty':
      return 'no data';
    default:
      return h.health;
  }
}
