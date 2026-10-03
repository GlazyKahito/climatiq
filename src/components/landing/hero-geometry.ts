/**
 * Shared geometry for the scroll-expansion hero: the framed "card" the globe starts in, and how large the globe is
 * at each expansion stage. Used by the CSS initial state (pre-hydration), the GSAP timeline and the R3F camera rig,
 * so the server-rendered poster, the animated frame and the 3D globe all line up.
 */
import { clamp01, lerp } from '@/components/globe/globe-math';

/** Card insets (fractions of the stage), corner radius (px) and globe fill (radius ÷ min(card W, card H)). */
export type CardGeometry = { top: number; bottom: number; side: number; radius: number; fill: number };

export const HERO_CARD: { desktop: CardGeometry; mobile: CardGeometry } = {
  desktop: { top: 0.5, bottom: 0.045, side: 0.2, radius: 28, fill: 0.42 },
  mobile: { top: 0.52, bottom: 0.03, side: 0.04, radius: 22, fill: 0.37 },
};

export const MOBILE_MAX = 767.98;

/** Globe radius as a share of min(viewport W, H) when expanded. */
const FILL_FULL = { desktop: 0.37, mobile: 0.45 };

export function cardFor(width: number): CardGeometry {
  return width <= MOBILE_MAX ? HERO_CARD.mobile : HERO_CARD.desktop;
}

export function clipInset(c: CardGeometry): string {
  return `inset(${(c.top * 100).toFixed(2)}% ${(c.side * 100).toFixed(2)}% ${(c.bottom * 100).toFixed(2)}% ${(c.side * 100).toFixed(2)}% round ${c.radius}px)`;
}
export const CLIP_FULL = 'inset(0.00% 0.00% 0.00% 0.00% round 0px)';

/** Vertical offset (in % of the stage height) that centres the globe inside the card. */
export function globeShiftPercent(c: CardGeometry): number {
  return (c.top + (1 - c.top - c.bottom) / 2 - 0.5) * 100;
}

/** On-screen globe radius (px) for a stage of `width`×`height` at expansion progress `p` (0 card → 1 full-bleed). */
export function heroGlobeRadius(width: number, height: number, p: number): number {
  const c = cardFor(width);
  const cardW = width * (1 - 2 * c.side);
  const cardH = height * (1 - c.top - c.bottom);
  const r0 = c.fill * Math.min(cardW, cardH);
  const r1 = (width <= MOBILE_MAX ? FILL_FULL.mobile : FILL_FULL.desktop) * Math.min(width, height);
  return lerp(r0, r1, clamp01(p));
}

/**
 * CSS length for the poster's diameter in the card state (mirrors heroGlobeRadius(…, 0)). Uses container query
 * units, so the element's ancestor stage must set `container-type: size`.
 */
export function posterDiameterCss(c: CardGeometry): string {
  const w = ((1 - 2 * c.side) * 100).toFixed(2);
  const h = ((1 - c.top - c.bottom) * 100).toFixed(2);
  return `calc(${(2 * c.fill).toFixed(3)} * min(${w}cqw, ${h}cqh))`;
}
