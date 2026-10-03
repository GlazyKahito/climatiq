import { describe, expect, it } from 'vitest';
import {
  HEAT_STOPS,
  angleDelta,
  distanceForRadius,
  fibonacciSphere,
  heatColor,
  heatGradientCss,
  heatLevel,
  hexToRgb,
  inIndiaBBox,
  latLonToVec3,
  orientationFor,
  rgbToHex,
  vec3ToLatLon,
} from '@/components/globe/globe-math';
import { formatGridDay, heatGridCaption, heatGridStats, parseHeatGrid } from '@/components/globe/heat-grid';

describe('fibonacciSphere', () => {
  it('returns n lat/lon pairs within range', () => {
    const pts = fibonacciSphere(2000);
    expect(pts.length).toBe(4000);
    for (let i = 0; i < pts.length; i += 2) {
      expect(pts[i]).toBeGreaterThan(-90);
      expect(pts[i]).toBeLessThan(90);
      expect(pts[i + 1]).toBeGreaterThanOrEqual(-180);
      expect(pts[i + 1]).toBeLessThan(180);
    }
  });

  it('is evenly distributed (centroid ≈ origin, hemispheres balanced, equal-area latitude bands)', () => {
    const n = 5000;
    const pts = fibonacciSphere(n);
    let sx = 0, sy = 0, sz = 0, north = 0, tropics = 0;
    for (let i = 0; i < n; i++) {
      const [x, y, z] = latLonToVec3(pts[i * 2], pts[i * 2 + 1]);
      sx += x; sy += y; sz += z;
      if (pts[i * 2] > 0) north++;
      if (Math.abs(pts[i * 2]) < 30) tropics++;
    }
    expect(Math.hypot(sx, sy, sz) / n).toBeLessThan(0.01);
    expect(Math.abs(north - n / 2)).toBeLessThanOrEqual(1);
    // the band |lat| < 30° holds sin(30°) = 50 % of a sphere's area
    expect(tropics / n).toBeCloseTo(0.5, 2);
  });

  it('handles 0 and fractional counts', () => {
    expect(fibonacciSphere(0).length).toBe(0);
    expect(fibonacciSphere(3.7).length).toBe(6);
  });
});

describe('sphere coordinates', () => {
  it('maps (0,0) to +Z (towards the camera) and the north pole to +Y', () => {
    const [x, y, z] = latLonToVec3(0, 0);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(1);
    expect(latLonToVec3(90, 0)[1]).toBeCloseTo(1);
    expect(latLonToVec3(0, 90)[0]).toBeCloseTo(1);
  });

  it('round-trips lat/lon through vectors', () => {
    for (const [lat, lon] of [[22.5, 79], [-33.9, 151.2], [64.1, -21.9], [0, -179.5]]) {
      const v = latLonToVec3(lat, lon, 1.3);
      const back = vec3ToLatLon(...v);
      expect(back.lat).toBeCloseTo(lat, 6);
      expect(back.lon).toBeCloseTo(lon, 6);
    }
  });

  it('orientationFor brings the target point to face the camera', () => {
    const lat = 21.5, lon = 79;
    const { x: ax, y: ay } = orientationFor(lat, lon);
    let [x, y, z] = latLonToVec3(lat, lon);
    // three.js Euler XYZ applies Y first, then X, to a vector
    [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
    [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(1, 6);
  });

  it('angleDelta takes the short way round', () => {
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
  });

  it('India bbox contains Delhi and excludes Paris', () => {
    expect(inIndiaBBox(28.6, 77.2)).toBe(true);
    expect(inIndiaBBox(48.9, 2.35)).toBe(false);
  });

  it('distanceForRadius: a bigger on-screen radius needs a closer camera', () => {
    const far = distanceForRadius(150, 900, 35);
    const near = distanceForRadius(380, 900, 35);
    expect(near).toBeLessThan(far);
    expect(near).toBeGreaterThan(1);
  });
});

describe('heat ramp', () => {
  it('clamps below and above the ramp', () => {
    expect(rgbToHex(heatColor(-5))).toBe(HEAT_STOPS[0][1]);
    expect(rgbToHex(heatColor(60))).toBe(HEAT_STOPS[HEAT_STOPS.length - 1][1]);
    expect(rgbToHex(heatColor(Number.NaN))).toBe(HEAT_STOPS[0][1]);
  });

  it('hits every stop exactly and interpolates between them', () => {
    for (const [t, hex] of HEAT_STOPS) expect(rgbToHex(heatColor(t))).toBe(hex);
    const mid = heatColor(38.5);
    const a = hexToRgb('#eaa54c');
    const b = hexToRgb('#d9672b');
    expect(mid[1]).toBeLessThan(a[1]);
    expect(mid[1]).toBeGreaterThan(b[1]);
  });

  it('heatLevel is monotonic and bounded', () => {
    let prev = -1;
    for (let t = 20; t <= 52; t += 0.5) {
      const v = heatLevel(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });

  it('builds a CSS gradient with every stop', () => {
    const css = heatGradientCss();
    for (const [, hex] of HEAT_STOPS) expect(css).toContain(hex);
  });
});

describe('heat grid parsing', () => {
  const valid = {
    meta: { day: '2024-05-26', source: 'Open-Meteo archive', model: 'ERA5', license: 'CC BY 4.0', dataKind: 'reanalysis', note: 'x' },
    points: [
      { lat: 26.9, lon: 75.8, tmaxC: 46.2 },
      { lat: 28.6, lon: 77.2, tmaxC: 44.9 },
      { lat: 13.1, lon: 80.3, tmaxC: 36.1 },
    ],
  };

  it('accepts the documented shape', () => {
    const g = parseHeatGrid(valid);
    expect(g?.points).toHaveLength(3);
    expect(g?.meta.day).toBe('2024-05-26');
    expect(heatGridCaption(g!.meta)).toBe('ERA5 reanalysis · 26 May 2024 · via Open-Meteo (CC BY 4.0)');
  });

  it('drops malformed / implausible rows and rejects empty or non-object input', () => {
    const g = parseHeatGrid({ ...valid, points: [...valid.points, { lat: 'x', lon: 1, tmaxC: 2 }, { lat: 10, lon: 70, tmaxC: 99 }, null] });
    expect(g?.points).toHaveLength(3);
    expect(parseHeatGrid({ meta: {}, points: [] })).toBeNull();
    expect(parseHeatGrid(null)).toBeNull();
    expect(parseHeatGrid('nope')).toBeNull();
  });

  it('computes stats from real rows only', () => {
    const s = heatGridStats(valid.points)!;
    expect(s.count).toBe(3);
    expect(s.maxC).toBe(46.2);
    expect(s.hottest).toMatchObject({ lat: 26.9, lon: 75.8 });
    expect(s.atOrAbove45).toBe(1);
    expect(s.atOrAbove40).toBe(2);
    expect(heatGridStats([])).toBeNull();
  });

  it('formats days without locale/timezone drift', () => {
    expect(formatGridDay('2024-05-26')).toBe('26 May 2024');
    expect(formatGridDay('bad')).toBe('bad');
  });
});
