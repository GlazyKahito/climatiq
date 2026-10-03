import { describe, expect, it } from 'vitest';
import { TIER_SETTINGS, fpsFromDeltas, pickTier, stepDown, tierFromFps, type Capabilities } from '@/components/globe/perf-tier';

const desktop: Capabilities = { webgl: true, webgl2: true, cores: 12, memoryGb: 16, mobile: false, saveData: false };

describe('pickTier', () => {
  it('no WebGL → static fallback', () => {
    expect(pickTier({ ...desktop, webgl: false, webgl2: false })).toBe('fallback');
  });
  it('capable desktop → high', () => {
    expect(pickTier(desktop)).toBe('high');
    expect(pickTier({ ...desktop, cores: null, memoryGb: null })).toBe('high');
  });
  it('mid-range hints → medium', () => {
    expect(pickTier({ ...desktop, cores: 4 })).toBe('medium');
    expect(pickTier({ ...desktop, mobile: true })).toBe('medium');
    expect(pickTier({ ...desktop, mobile: true, memoryGb: 4 })).toBe('medium');
  });
  it('weak devices → low', () => {
    expect(pickTier({ ...desktop, cores: 2, memoryGb: 2 })).toBe('low');
    expect(pickTier({ ...desktop, webgl2: false, mobile: true, saveData: true })).toBe('low');
  });
});

describe('tierFromFps', () => {
  it('keeps the tier when smooth', () => {
    expect(tierFromFps('high', 60)).toBe('high');
    expect(tierFromFps('medium', 48)).toBe('medium');
  });
  it('steps down one level when middling', () => {
    expect(tierFromFps('high', 40)).toBe('medium');
    expect(tierFromFps('medium', 35)).toBe('low');
    expect(tierFromFps('low', 35)).toBe('low');
  });
  it('drops to low when slow and to the static fallback only when already low and very slow', () => {
    expect(tierFromFps('high', 20)).toBe('low');
    expect(tierFromFps('low', 12)).toBe('fallback');
    expect(tierFromFps('high', 12)).toBe('low');
  });
  it('ignores invalid samples', () => {
    expect(tierFromFps('high', Number.NaN)).toBe('high');
    expect(tierFromFps('medium', 0)).toBe('medium');
  });
});

describe('fpsFromDeltas', () => {
  it('uses the median frame time so one hitch does not dominate', () => {
    const deltas = Array(89).fill(1 / 60).concat([0.5]);
    expect(fpsFromDeltas(deltas)).toBeCloseTo(60, 0);
  });
  it('returns NaN with no usable samples', () => {
    expect(fpsFromDeltas([])).toBeNaN();
    expect(fpsFromDeltas([0, -1, 5])).toBeNaN();
  });
});

describe('tier settings', () => {
  it('degrade monotonically', () => {
    expect(TIER_SETTINGS.high.dots).toBeGreaterThan(TIER_SETTINGS.medium.dots);
    expect(TIER_SETTINGS.medium.dots).toBeGreaterThan(TIER_SETTINGS.low.dots);
    expect(TIER_SETTINGS.high.dpr[1]).toBeGreaterThanOrEqual(TIER_SETTINGS.medium.dpr[1]);
    expect(TIER_SETTINGS.low.halos).toBe(false);
  });
  it('stepDown saturates at fallback', () => {
    expect(stepDown('high')).toBe('medium');
    expect(stepDown('low', 3)).toBe('fallback');
  });
});
