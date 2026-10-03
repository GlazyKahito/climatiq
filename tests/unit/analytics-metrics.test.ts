import { describe, expect, it } from 'vitest';
import { confusion, describe as describeStats, errorStats, heatDaysByYear, monthlyMeans, rollingMean, summariseAccuracy, type VerificationPoint } from '@/server/analytics/metrics';
import { dayOfYear } from '@/server/forecasting/baseline';
import { addDays } from '@/lib/domain';

describe('errorStats', () => {
  it('computes MAE, RMSE and bias (predicted − observed)', () => {
    const s = errorStats([1, -1, 2, -2])!;
    expect(s.n).toBe(4);
    expect(s.mae).toBe(1.5);
    expect(s.rmse).toBeCloseTo(Math.sqrt(10 / 4), 2);
    expect(s.bias).toBe(0);
    expect(s.maxAbs).toBe(2);
  });

  it('reports a warm bias when the model over-predicts', () => {
    expect(errorStats([1.5, 0.5, 1])!.bias).toBe(1);
  });

  it('returns null for no data and ignores non-finite values', () => {
    expect(errorStats([])).toBeNull();
    expect(errorStats([Number.NaN, 2])!.n).toBe(1);
  });
});

describe('confusion', () => {
  it('builds a predicted × observed matrix and ≥ High event scores', () => {
    const c = confusion([
      { predicted: 'high', observed: 'high' }, // hit
      { predicted: 'extreme', observed: 'high' }, // hit (event), off by one
      { predicted: 'moderate', observed: 'extreme' }, // miss
      { predicted: 'high', observed: 'low' }, // false alarm
      { predicted: 'low', observed: 'low' }, // correct negative
    ]);
    expect(c.n).toBe(5);
    expect(c.matrix[2][2]).toBe(1);
    expect(c.matrix[3][2]).toBe(1);
    expect(c.matrix[1][3]).toBe(1);
    expect(c.exact).toBe(2);
    expect(c.withinOne).toBe(3);
    expect(c.event).toMatchObject({ hits: 2, misses: 1, falseAlarms: 1, correctNegatives: 1 });
    expect(c.event.pod).toBeCloseTo(2 / 3, 3);
    expect(c.event.far).toBeCloseTo(1 / 3, 3);
    expect(c.event.csi).toBe(0.5);
  });

  it('returns null rates when no events exist', () => {
    const c = confusion([{ predicted: 'low', observed: 'low' }]);
    expect(c.event.pod).toBeNull();
    expect(c.event.far).toBeNull();
    expect(c.exactRate).toBe(1);
  });
});

describe('summariseAccuracy', () => {
  const p = (o: Partial<VerificationPoint>): VerificationPoint => ({
    regionId: 1,
    regionCode: 'IN-RJ',
    regionName: 'Rajasthan',
    level: 'state',
    horizonDay: 1,
    predictedTmaxC: 45,
    lowerC: 43,
    upperC: 47,
    observedTmaxC: 44,
    errorC: 1,
    predictedSeverity: 'high',
    observedSeverity: 'high',
    modelKey: 'baseline-v1',
    ...o,
  });

  it('groups by horizon, region and model and measures band coverage', () => {
    const s = summariseAccuracy([
      p({ horizonDay: 1, errorC: 1 }),
      p({ horizonDay: 1, errorC: -1, regionId: 2, regionCode: 'IN-UP', regionName: 'Uttar Pradesh', observedTmaxC: 46 }),
      p({ horizonDay: 2, errorC: 3, observedTmaxC: 42 }), // outside band (43–47)
    ]);
    expect(s.overall!.n).toBe(3);
    expect(s.byHorizon.map((h) => [h.horizonDay, h.n, h.mae])).toEqual([
      [1, 2, 1],
      [2, 1, 3],
    ]);
    expect(s.byRegion[0].regionCode).toBe('IN-UP'); // lowest MAE first
    expect(s.bandCoverage).toEqual({ inside: 2, n: 3, rate: 0.667 });
    expect(s.byModel[0]).toMatchObject({ modelKey: 'baseline-v1', n: 3, bandCoverageRate: 0.667 });
  });

  it('handles an empty dataset', () => {
    const s = summariseAccuracy([]);
    expect(s.overall).toBeNull();
    expect(s.byHorizon).toEqual([]);
    expect(s.bandCoverage.rate).toBeNull();
  });
});

describe('rollingMean', () => {
  it('averages over a trailing calendar window and respects the minimum count', () => {
    const pts = Array.from({ length: 5 }, (_, i) => ({ day: addDays('2024-05-01', i), value: i + 1 }));
    expect(rollingMean(pts, 3, 2)).toEqual([null, 1.5, 2, 3, 4]);
  });

  it('does not bridge seasonal gaps', () => {
    const pts = [
      { day: '2023-06-29', value: 40 },
      { day: '2023-06-30', value: 42 },
      { day: '2024-04-20', value: 38 },
    ];
    expect(rollingMean(pts, 30, 2)).toEqual([null, 41, null]);
  });

  it('skips null values inside the window', () => {
    const pts = [
      { day: '2024-05-01', value: 40 },
      { day: '2024-05-02', value: null },
      { day: '2024-05-03', value: 44 },
    ];
    expect(rollingMean(pts, 3, 2)).toEqual([null, null, 42]);
  });
});

describe('heatDaysByYear', () => {
  const normals = new Map<number, number>();
  for (let d = 1; d <= 366; d++) normals.set(d, 40);

  it('counts High and Extreme days with the IMD-derived plains thresholds', () => {
    const days = [
      { day: '2024-05-20', tmaxC: 41 }, // +1 → low
      { day: '2024-05-21', tmaxC: 43 }, // +3 → moderate
      { day: '2024-05-22', tmaxC: 44.6 }, // +4.6 → high
      { day: '2024-05-23', tmaxC: 45.2 }, // ≥45 absolute → high
      { day: '2024-05-24', tmaxC: 47.1 }, // ≥47 absolute → extreme
      { day: '2023-05-24', tmaxC: 46.6 }, // +6.6 → extreme
      { day: '2023-05-25', tmaxC: null }, // ignored
    ];
    const ys = heatDaysByYear(days, normals, 'plains');
    expect(ys).toEqual([
      { year: 2023, daysEvaluated: 1, moderate: 0, high: 0, extreme: 1, heatwaveDays: 1, maxTmaxC: 46.6 },
      { year: 2024, daysEvaluated: 5, moderate: 1, high: 2, extreme: 1, heatwaveDays: 3, maxTmaxC: 47.1 },
    ]);
  });

  it('uses the hilly base threshold of 30 °C', () => {
    const hill = new Map<number, number>([[dayOfYear('2024-05-22'), 25]]);
    const ys = heatDaysByYear([{ day: '2024-05-22', tmaxC: 30.5 }], hill, 'hilly');
    expect(ys[0]).toMatchObject({ high: 1, heatwaveDays: 1 }); // +5.5 and ≥ 30 °C
  });

  it('does not evaluate days without a reference normal', () => {
    const ys = heatDaysByYear([{ day: '2024-05-22', tmaxC: 48 }], new Map(), 'plains');
    expect(ys[0]).toMatchObject({ daysEvaluated: 0, heatwaveDays: 0 });
  });
});

describe('monthlyMeans / describe', () => {
  it('averages by year-month and drops sparse months', () => {
    const days = [
      ...Array.from({ length: 10 }, (_, i) => ({ day: addDays('2024-05-01', i), tmaxC: 40 + (i % 2) })),
      { day: '2024-06-01', tmaxC: 44 },
    ];
    expect(monthlyMeans(days)).toEqual([{ year: 2024, month: 5, mean: 40.5, n: 10, max: 41 }]);
    expect(monthlyMeans(days, 1)).toHaveLength(2);
  });

  it('describes a sample', () => {
    expect(describeStats([1, 2, 3, null])).toMatchObject({ n: 3, mean: 2, max: 3, min: 1 });
    expect(describeStats([])).toMatchObject({ n: 0, mean: null });
  });
});
