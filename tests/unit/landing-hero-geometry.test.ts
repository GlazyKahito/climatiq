import { describe, expect, it } from 'vitest';
import { HERO_CARD, cardFor, clipInset, clipInsetAt, globeShiftPercent, heroGlobeRadius, posterDiameterCss } from '@/components/landing/hero-geometry';

describe('scroll-hero geometry', () => {
  it('picks the mobile card below 768 px', () => {
    expect(cardFor(390)).toBe(HERO_CARD.mobile);
    expect(cardFor(1440)).toBe(HERO_CARD.desktop);
  });

  it('builds the card clip-path inset', () => {
    expect(clipInset(HERO_CARD.desktop)).toBe('inset(50.00% 20.00% 4.50% 20.00% round 28.00px)');
  });

  it('interpolates every clip-path edge linearly from the card to full-bleed', () => {
    const nums = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
    const c = HERO_CARD.desktop;
    // regression: the bottom inset must shrink from 4.5 % toward 0, never jump (a string tween once produced 45 %)
    expect(nums(clipInsetAt(c, 0.25))).toEqual([37.5, 15, 3.38, 15, 21]);
    expect(nums(clipInsetAt(c, 0.5))).toEqual([25, 10, 2.25, 10, 14]);
    expect(nums(clipInsetAt(c, 1))).toEqual([0, 0, 0, 0, 0]);
    expect(clipInsetAt(c, -1)).toBe(clipInset(c)); // clamped
    expect(nums(clipInsetAt(c, 2))).toEqual([0, 0, 0, 0, 0]);
  });

  it('centres the globe in the card', () => {
    // desktop card spans 50 % → 95.5 % of the stage, so its centre is 22.75 % below the stage centre
    expect(globeShiftPercent(HERO_CARD.desktop)).toBeCloseTo(22.75, 5);
  });

  it('grows the globe monotonically as the frame expands and keeps it inside the card at rest', () => {
    for (const [w, h] of [[1440, 900], [390, 844], [1024, 768]]) {
      const c = cardFor(w);
      const r0 = heroGlobeRadius(w, h, 0);
      expect(2 * r0).toBeLessThanOrEqual(Math.min(w * (1 - 2 * c.side), h * (1 - c.top - c.bottom)));
      let prev = r0;
      for (let p = 0.1; p <= 1.0001; p += 0.1) {
        const r = heroGlobeRadius(w, h, p);
        expect(r).toBeGreaterThanOrEqual(prev);
        prev = r;
      }
      expect(heroGlobeRadius(w, h, 2)).toBeCloseTo(heroGlobeRadius(w, h, 1)); // clamped
    }
  });

  it('expresses the poster size with container-query units matching the radius formula', () => {
    expect(posterDiameterCss(HERO_CARD.desktop)).toBe('calc(0.840 * min(60.00cqw, 45.50cqh))');
  });
});
