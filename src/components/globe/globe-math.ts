/**
 * Pure maths for the CLIMATIQ globe (no three.js / DOM imports, so it is unit-testable and server-safe).
 *
 * Coordinate convention (right-handed, camera on +Z looking at the origin):
 *   x = cos(lat)·sin(lon) · r
 *   y = sin(lat) · r
 *   z = cos(lat)·cos(lon) · r
 * so (lat 0°, lon 0°) faces the camera. Rotating the globe group by Euler (x = lat·DEG, y = −lon·DEG, order XYZ)
 * brings (lat, lon) to the centre of the view.
 */

export const DEG = Math.PI / 180;

/** Where the globe comes to rest: central India, nudged north so the peninsula sits near the optical centre. */
export const INDIA_FOCUS = { lat: 21.5, lon: 79.0 } as const;

/** Approximate India bounding box (incl. islands) used to pre-filter point-in-India tests. */
export const INDIA_BBOX = { minLat: 5.5, maxLat: 37.5, minLon: 67.5, maxLon: 98.0 } as const;

/**
 * Evenly distributed points on a unit sphere using the golden-angle (Fibonacci) spiral.
 * Returns interleaved [lat0, lon0, lat1, lon1, …] in degrees, lon normalised to [-180, 180).
 */
export function fibonacciSphere(n: number): Float32Array {
  const count = Math.max(0, Math.floor(n));
  const out = new Float32Array(count * 2);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count; // (−1, 1), never exactly a pole
    const lat = Math.asin(y) / DEG;
    let lon = (((i * golden) % (2 * Math.PI)) / DEG) % 360;
    if (lon >= 180) lon -= 360;
    out[i * 2] = lat;
    out[i * 2 + 1] = lon;
  }
  return out;
}

export function latLonToVec3(lat: number, lon: number, r = 1): [number, number, number] {
  const la = lat * DEG;
  const lo = lon * DEG;
  const c = Math.cos(la);
  return [r * c * Math.sin(lo), r * Math.sin(la), r * c * Math.cos(lo)];
}

export function vec3ToLatLon(x: number, y: number, z: number): { lat: number; lon: number } {
  const r = Math.hypot(x, y, z) || 1;
  return { lat: Math.asin(y / r) / DEG, lon: Math.atan2(x, z) / DEG };
}

/** Euler angles (radians, order XYZ) that bring (lat, lon) to face the camera. */
export function orientationFor(lat: number, lon: number): { x: number; y: number } {
  return { x: lat * DEG, y: -lon * DEG };
}

/** Shortest signed angular difference a→b in radians, in (−π, π]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

export function inIndiaBBox(lat: number, lon: number): boolean {
  return lat >= INDIA_BBOX.minLat && lat <= INDIA_BBOX.maxLat && lon >= INDIA_BBOX.minLon && lon <= INDIA_BBOX.maxLon;
}

// ───────────────────────────── heat ramp ─────────────────────────────
/**
 * Daily-maximum temperature colour ramp: sand → amber → orange → wine.
 * Stops loosely follow the IMD plains thresholds (40 °C base, 45 / 47 °C absolute) so the ramp "turns" where risk does.
 * Colour is never the only channel: glyph height also encodes Tmax and the caption/legend gives numbers.
 */
export const HEAT_STOPS: ReadonlyArray<readonly [tempC: number, hex: string]> = [
  [26, '#f5ebd0'], // light sand
  [33, '#f0d58f'], // pale amber
  [37, '#eaa54c'], // amber
  [40, '#d9672b'], // orange (IMD plains base threshold)
  [45, '#b52a2a'], // red (IMD absolute heatwave)
  [47, '#9b1a39'], // wine (IMD absolute severe heatwave)
];

export const HEAT_MIN_C = HEAT_STOPS[0][0];
export const HEAT_MAX_C = HEAT_STOPS[HEAT_STOPS.length - 1][0];

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** sRGB colour (0..1 components) for a temperature, linearly interpolated between HEAT_STOPS and clamped. */
export function heatColor(tempC: number): [number, number, number] {
  if (!Number.isFinite(tempC) || tempC <= HEAT_STOPS[0][0]) return hexToRgb(HEAT_STOPS[0][1]);
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [t1, c1] = HEAT_STOPS[i];
    if (tempC <= t1) {
      const [t0, c0] = HEAT_STOPS[i - 1];
      const k = (tempC - t0) / (t1 - t0);
      const a = hexToRgb(c0);
      const b = hexToRgb(c1);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
  }
  return hexToRgb(HEAT_STOPS[HEAT_STOPS.length - 1][1]);
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const to = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** 0..1 normalised heat used for glyph height (eased so the hottest cells stand out). */
export function heatLevel(tempC: number, min = 30, max = HEAT_MAX_C): number {
  if (!Number.isFinite(tempC)) return 0;
  const k = Math.min(1, Math.max(0, (tempC - min) / (max - min)));
  return k * k * (3 - 2 * k) * 0.85 + k * 0.15;
}

/** CSS linear-gradient for legends, in the same stops as the 3D glyphs. */
export function heatGradientCss(direction = 'to right'): string {
  const span = HEAT_MAX_C - HEAT_MIN_C;
  return `linear-gradient(${direction}, ${HEAT_STOPS.map(([t, c]) => `${c} ${(((t - HEAT_MIN_C) / span) * 100).toFixed(1)}%`).join(', ')})`;
}

// ───────────────────────────── camera fit ─────────────────────────────
/**
 * Camera distance at which a unit sphere appears with the given on-screen radius (px), for a perspective camera
 * with vertical field of view `fovDeg` on a viewport `viewportH` px tall.
 */
export function distanceForRadius(radiusPx: number, viewportH: number, fovDeg: number): number {
  const halfFov = (fovDeg * DEG) / 2;
  const tanAlpha = Math.max(1e-3, ((2 * radiusPx) / Math.max(1, viewportH)) * Math.tan(halfFov));
  const alpha = Math.atan(tanAlpha);
  return 1 / Math.sin(Math.min(alpha, Math.PI / 2 - 1e-3));
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInOutCubic = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
