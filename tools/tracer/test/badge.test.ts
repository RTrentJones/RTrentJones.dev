import { describe, expect, it } from 'vitest';
import { badgeMessage, badgeSvg } from '../lib/badge';

describe('badge', () => {
  it('renders a labelled SVG and escapes XML', () => {
    const svg = badgeSvg('<bamcp>', 'passing', 'passing');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('&lt;bamcp&gt;: passing');
    expect(svg).not.toContain('<bamcp>');
    expect(svg).toContain('#0b7f0b');
  });

  it('words the message by health', () => {
    expect(badgeMessage({ health: 'failing', failing: 2, regressed: 0 })).toBe('2 failing');
    expect(badgeMessage({ health: 'regressed', failing: 0, regressed: 1 })).toBe('regressed');
    expect(badgeMessage({ health: 'empty', failing: 0, regressed: 0 })).toBe('no data');
    expect(badgeMessage({ health: 'passing', failing: 0, regressed: 0 })).toBe('passing');
  });
});
