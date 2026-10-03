import { describe, expect, it } from 'vitest';
import { buildNormals, confidenceFrom, dayOfYear, forecastRegion, type DayInput } from '@/server/forecasting/baseline';

function flatNormals(tmax: number, tmin = 26) {
  const m = new Map<number, { tmax: number; tmin: number | null }>();
  for (let d = 1; d <= 366; d++) m.set(d, { tmax, tmin });
  return m;
}

const issuedFor = '2024-05-26';
const history: DayInput[] = [
  { day: '2024-05-24', tmaxC: 45, tminC: 30 },
  { day: '2024-05-25', tmaxC: 46, tminC: 31 },
  { day: '2024-05-26', tmaxC: 47, tminC: 31 },
];

describe('forecastRegion (baseline-v1)', () => {
  it('produces one point per horizon day with a valid interval', () => {
    const out = forecastRegion({ regionId: 1, zone: 'plains', resolution: 'district-centroid', history, nwp: [], normals: flatNormals(40), historyKind: 'reanalysis' }, issuedFor, 5);
    expect(out).toHaveLength(5);
    for (const p of out) {
      expect(p.lowerC).toBeLessThanOrEqual(p.predictedTmaxC);
      expect(p.upperC).toBeGreaterThanOrEqual(p.predictedTmaxC);
      expect(p.confidenceScore).toBeGreaterThan(0);
      expect(p.confidenceScore).toBeLessThan(1);
    }
    expect(out[0].targetDate).toBe('2024-05-27');
  });

  it('decays a positive anomaly towards the normal without NWP', () => {
    const out = forecastRegion({ regionId: 1, zone: 'plains', resolution: 'point', history, nwp: [], normals: flatNormals(40), historyKind: 'reanalysis' }, issuedFor, 7);
    expect(out[0].predictedTmaxC).toBeGreaterThan(out[6].predictedTmaxC);
    expect(out[6].predictedTmaxC).toBeGreaterThan(40);
  });

  it('weights NWP guidance heavily at short horizons', () => {
    const nwp: DayInput[] = [{ day: '2024-05-27', tmaxC: 48 }];
    const [p] = forecastRegion({ regionId: 1, zone: 'plains', resolution: 'point', history, nwp, normals: flatNormals(40), historyKind: 'reanalysis' }, issuedFor, 1);
    expect(p.predictedTmaxC).toBeGreaterThan(46.5);
    expect(p.nwpTmaxC).toBe(48);
    expect(p.inputKinds).toContain('nwp_forecast');
  });

  it('flags a severe heatwave spell and computes its duration', () => {
    const out = forecastRegion({ regionId: 1, zone: 'plains', resolution: 'point', history, nwp: [], normals: flatNormals(36), historyKind: 'reanalysis' }, issuedFor, 3); // anomaly +10 °C → day-1 departure ≈ +7.2 °C
    expect(out[0].severity).toBe('extreme');
    expect(out[0].durationDays).toBeGreaterThanOrEqual(1);
    expect(out[0].factors.some((f) => f.key === 'classification')).toBe(true);
  });

  it('is less confident without NWP', () => {
    expect(confidenceFrom(2, true).score).toBeGreaterThan(confidenceFrom(2, false).score);
  });
});

describe('buildNormals', () => {
  it('averages within a ±window day-of-year band', () => {
    const hist: DayInput[] = [
      { day: '2022-05-20', tmaxC: 40 },
      { day: '2023-05-21', tmaxC: 42 },
    ];
    const n = buildNormals(hist, 3);
    expect(n.get(dayOfYear('2024-05-20'))?.tmax).toBeCloseTo(41, 0);
    expect(n.has(dayOfYear('2024-01-01'))).toBe(false);
  });
});
