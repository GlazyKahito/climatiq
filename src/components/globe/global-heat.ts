/**
 * Global context layer for the globe: real ERA5 daily Tmax on a coarse land grid (scripts/fetch-global-heat.ts),
 * used to tint every land dot outside India so the replay day reads in its world context. Pure and dependency-free
 * (unit-tested); dots with no nearby cell keep the plain land colour — nothing is interpolated across empty space.
 */
import { clamp01, hexToRgb } from './globe-math';
import type { HeatPoint } from './heat-grid';

export const GLOBAL_HEAT_URL = '/data/heat-grid-global.json';
export const GLOBAL_HEAT_DEFAULT_RES = 2.5;

/** Dark-globe tint: cool blue → sand (26 °C, the heat ramp's floor) → amber → hot pink-red. Brightens with heat. */
export const GLOBE_TINT_STOPS: ReadonlyArray<readonly [tempC: number, hex: string]> = [
  [-10, '#5d8fc7'],
  [5, '#8eb3d4'],
  [18, '#cfd3cc'],
  [26, '#efe2c4'],
  [33, '#f4cf86'],
  [38, '#f39a4c'],
  [42, '#f2663f'],
  [46, '#ff4f6d'],
];

export function tintColor(tempC: number): [number, number, number] {
  const s = GLOBE_TINT_STOPS;
  if (!(tempC > s[0][0])) return hexToRgb(s[0][1]);
  for (let i = 1; i < s.length; i++) {
    if (tempC <= s[i][0]) {
      const k = (tempC - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      const a = hexToRgb(s[i - 1][1]);
      const b = hexToRgb(s[i][1]);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
  }
  return hexToRgb(s[s.length - 1][1]);
}

/** CSS gradient of the tint ramp, for legends. */
export function tintGradientCss(direction = 'to right'): string {
  const lo = GLOBE_TINT_STOPS[0][0];
  const span = GLOBE_TINT_STOPS[GLOBE_TINT_STOPS.length - 1][0] - lo;
  return `linear-gradient(${direction}, ${GLOBE_TINT_STOPS.map(([t, c]) => `${c} ${(((t - lo) / span) * 100).toFixed(1)}%`).join(', ')})`;
}

/** Emphasis for hot dots (size and brightness): 0 up to 30 °C, 1 from 46 °C. */
export const hotness = (tempC: number) => clamp01((tempC - 30) / 16);

/** Cells keyed by grid row/column; cell (i, j) is centred on (−90 + (i + ½)·res, −180 + (j + ½)·res). */
export type CellIndex = { res: number; cols: number; cells: Map<number, number> };

export function buildCellIndex(points: readonly HeatPoint[], res = GLOBAL_HEAT_DEFAULT_RES): CellIndex {
  const cols = Math.round(360 / res);
  const cells = new Map<number, number>();
  for (const p of points) {
    const i = Math.floor((p.lat + 90) / res);
    const j = Math.floor((p.lon + 180) / res);
    cells.set(i * cols + (((j % cols) + cols) % cols), p.tmaxC);
  }
  return { res, cols, cells };
}

/** Bilinear Tmax from the four surrounding cell centres that have data (renormalised); null if none of them do. */
export function sampleTmax(index: CellIndex, lat: number, lon: number): number | null {
  const { res, cols, cells } = index;
  const fi = (lat + 90) / res - 0.5;
  const fj = (lon + 180) / res - 0.5;
  const i0 = Math.floor(fi);
  const j0 = Math.floor(fj);
  const ty = fi - i0;
  const tx = fj - j0;
  let sum = 0;
  let wsum = 0;
  for (const [di, dj, w] of [
    [0, 0, (1 - ty) * (1 - tx)],
    [0, 1, (1 - ty) * tx],
    [1, 0, ty * (1 - tx)],
    [1, 1, ty * tx],
  ] as const) {
    const j = (((j0 + dj) % cols) + cols) % cols; // wraps across the antimeridian
    const v = cells.get((i0 + di) * cols + j);
    if (v === undefined || w <= 0) continue;
    sum += v * w;
    wsum += w;
  }
  return wsum > 0 ? sum / wsum : null;
}
