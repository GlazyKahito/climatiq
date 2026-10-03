import { describe, expect, it } from 'vitest';
import { classify, heatSpellLength } from '@/server/forecasting/severity';

describe('classify (CLIMATIQ classes derived from IMD heatwave criteria)', () => {
  it('plains: heatwave when Tmax ≥ 40 °C and departure ≥ 4.5 °C', () => {
    expect(classify(41.5, 36.5, 'plains')).toMatchObject({ severity: 'high', imdCategory: 'heatwave' });
  });

  it('plains: severe heatwave when departure ≥ 6.5 °C', () => {
    expect(classify(44, 37, 'plains')).toMatchObject({ severity: 'extreme', imdCategory: 'severe_heatwave' });
  });

  it('plains: absolute 45 °C is a heatwave even with a small departure', () => {
    expect(classify(45.2, 44.5, 'plains')).toMatchObject({ severity: 'high' });
  });

  it('plains: absolute 47 °C is a severe heatwave without any normal', () => {
    expect(classify(47.3, null, 'plains')).toMatchObject({ severity: 'extreme' });
  });

  it('below the 40 °C plains base threshold stays low regardless of departure', () => {
    expect(classify(39.4, 30, 'plains').severity).toBe('low');
  });

  it('moderate band: Tmax ≥ base and departure 2.5–4.4 °C', () => {
    expect(classify(41, 38, 'plains')).toMatchObject({ severity: 'moderate', imdCategory: 'none' });
  });

  it('coastal uses a 37 °C base threshold', () => {
    expect(classify(37.5, 32.5, 'coastal').severity).toBe('high');
    expect(classify(36.9, 30, 'coastal').severity).toBe('low');
  });

  it('hilly uses a 30 °C base threshold and has no absolute plains criterion', () => {
    expect(classify(31, 26, 'hilly').severity).toBe('high');
    expect(classify(46, 45, 'hilly').severity).toBe('low');
  });

  it('always explains its decision', () => {
    expect(classify(44, 37, 'plains').reason).toMatch(/above the reference normal/);
  });
});

describe('heatSpellLength', () => {
  it('counts consecutive days at or above high', () => {
    expect(heatSpellLength(['high', 'extreme', 'moderate', 'high'], 0)).toBe(2);
    expect(heatSpellLength(['low', 'high'], 0)).toBe(0);
    expect(heatSpellLength(['low', 'high', 'high'], 1)).toBe(2);
  });
});
