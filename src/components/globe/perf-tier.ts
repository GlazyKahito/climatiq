/**
 * Performance tiers for the 3D globe.
 *
 *  - `high`     full dot field, DPR ≤ 1.5, atmosphere + glyph halos
 *  - `medium`   ~60 % of the dots, DPR ≤ 1.25, no MSAA, halos kept, thinner outline
 *  - `low`      sparse dots, DPR 1, no halos (cheapest shaders)
 *  - `fallback` no WebGL (or a device that cannot hold ~15 fps) → static SVG globe
 *
 * The initial tier comes from cheap capability hints (WebGL, cores, device memory, Save-Data, coarse pointer);
 * a short in-canvas FPS sample (~1.5 s after warm-up) can then step it down.
 */

export type Tier = 'high' | 'medium' | 'low' | 'fallback';
export type RenderTier = Exclude<Tier, 'fallback'>;

export type Capabilities = {
  webgl: boolean;
  webgl2: boolean;
  /** navigator.hardwareConcurrency (null when unknown) */
  cores: number | null;
  /** navigator.deviceMemory in GB (Chromium only; null when unknown) */
  memoryGb: number | null;
  /** coarse primary pointer / small screen — phones and most tablets */
  mobile: boolean;
  /** navigator.connection.saveData */
  saveData: boolean;
};

export type TierSettings = {
  /** global Fibonacci samples (≈30 % land after classification) */
  dots: number;
  /** India-only oversampling factor (denser dots inside the highlighted country) */
  indiaDensity: number;
  dpr: [number, number];
  /** dot diameter as a share of the mean dot spacing */
  dotScale: number;
  halos: boolean;
  atmosphere: boolean;
  /** India outline width in CSS px (fat lines); `0` → 1-px GL lines */
  outlineWidth: number;
  sphereSegments: number;
  /** antialias on the WebGL context */
  antialias: boolean;
};

export const TIER_SETTINGS: Record<RenderTier, TierSettings> = {
  high: { dots: 24000, indiaDensity: 5, dpr: [1, 1.5], dotScale: 0.5, halos: true, atmosphere: true, outlineWidth: 1.6, sphereSegments: 72, antialias: true },
  medium: { dots: 15000, indiaDensity: 4, dpr: [1, 1.25], dotScale: 0.5, halos: true, atmosphere: true, outlineWidth: 1.3, sphereSegments: 56, antialias: false },
  low: { dots: 8000, indiaDensity: 3, dpr: [1, 1], dotScale: 0.52, halos: false, atmosphere: true, outlineWidth: 0, sphereSegments: 40, antialias: false },
};

const ORDER: Tier[] = ['high', 'medium', 'low', 'fallback'];

export function stepDown(tier: Tier, steps = 1): Tier {
  return ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(tier) + steps)];
}

/** Initial tier from capability hints only (no rendering yet). */
export function pickTier(c: Capabilities): Tier {
  if (!c.webgl) return 'fallback';
  let penalty = 0;
  if (!c.webgl2) penalty += 1;
  if (c.cores != null) penalty += c.cores <= 2 ? 2 : c.cores <= 4 ? 1 : 0;
  if (c.memoryGb != null) penalty += c.memoryGb <= 2 ? 2 : c.memoryGb <= 4 ? 1 : 0;
  if (c.mobile) penalty += 1;
  if (c.saveData) penalty += 1;
  return penalty === 0 ? 'high' : penalty <= 2 ? 'medium' : 'low';
}

/**
 * Adjust a tier from a measured frame rate. Never steps *up* (a short sample cannot prove headroom).
 * fps ≥ 48 → keep · 30–48 → one step down · < 30 → low · < 15 while already low → static fallback.
 */
export function tierFromFps(tier: RenderTier, fps: number): Tier {
  if (!Number.isFinite(fps) || fps <= 0) return tier;
  if (fps >= 48) return tier;
  if (fps >= 30) return tier === 'high' ? 'medium' : tier === 'medium' ? 'low' : 'low';
  if (tier === 'low' && fps < 15) return 'fallback';
  return 'low';
}

/** Robust fps from a list of frame deltas (seconds): median frame time, so shader-compile hitches don't dominate. */
export function fpsFromDeltas(deltas: number[]): number {
  const valid = deltas.filter((d) => Number.isFinite(d) && d > 0 && d < 1);
  if (valid.length === 0) return NaN;
  const sorted = [...valid].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return 1 / median;
}

/** Browser-only capability probe. Safe to call during an effect; returns a "no WebGL" record on the server. */
export function detectCapabilities(): Capabilities {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { webgl: false, webgl2: false, cores: null, memoryGb: null, mobile: false, saveData: false };
  }
  let webgl = false;
  let webgl2 = false;
  try {
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2');
    webgl2 = !!gl2;
    webgl = webgl2 || !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
    // Release the probe context immediately so it doesn't count against the browser's context limit.
    (gl2 as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl = false;
  }
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const cores = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : null;
  const memoryGb = typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 ? nav.deviceMemory : null;
  let mobile = false;
  try {
    mobile = window.matchMedia('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) < 820;
  } catch {
    mobile = false;
  }
  return { webgl, webgl2, cores, memoryGb, mobile, saveData: !!nav.connection?.saveData };
}
