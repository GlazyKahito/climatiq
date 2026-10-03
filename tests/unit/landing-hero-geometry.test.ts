import { describe, expect, it } from 'vitest';
import { CLIP_FULL, HERO_CARD, cardFor, clipInset, globeShiftPercent, heroGlobeRadius, posterDiameterCss } from '@/components/landing/hero-geometry';

describe('scroll-hero geometry', () => {
  it('picks the mobile card below 768 px', () => {
    expect(cardFor(390)).toBe(HERO_CARD.mobile);
    expect(cardFor(1440)).toBe(HERO_CARD.desktop);
  });

  it('builds clip-path insets with the same number of components as the full-bleed state (GSAP-tweenable)', () => {
    const card = clipInset(HERO_CARD.desktop);
    expect(card).toMatch(/^inset\(50\.00% 20\.00% 4\.50% 20\.00% round 28px\)$/);
    const nums = (s: string) => s.match(/[\d.]+/g)?.length;
    expect(nums(card)).toBe(nums(CLIP_FULL));
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
