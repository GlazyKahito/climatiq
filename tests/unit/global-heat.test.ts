import { describe, expect, it } from 'vitest';
import { GLOBE_TINT_STOPS, buildCellIndex, hotness, sampleTmax, tintColor } from '@/components/globe/global-heat';
import { hexToRgb } from '@/components/globe/globe-math';

describe('global heat context layer', () => {
  it('maps temperatures onto the tint ramp, clamped at both ends', () => {
    expect(tintColor(26)).toEqual(hexToRgb('#efe2c4'));
    expect(tintColor(-40)).toEqual(hexToRgb(GLOBE_TINT_STOPS[0][1]));
    expect(tintColor(60)).toEqual(hexToRgb(GLOBE_TINT_STOPS[GLOBE_TINT_STOPS.length - 1][1]));
    const mid = tintColor(29.5); // halfway between the 26 °C and 33 °C stops
    const a = hexToRgb('#efe2c4');
    const b = hexToRgb('#f4cf86');
    mid.forEach((v, i) => expect(v).toBeCloseTo((a[i] + b[i]) / 2, 5));
  });

  it('emphasises only hot cells', () => {
    expect(hotness(20)).toBe(0);
    expect(hotness(30)).toBe(0);
    expect(hotness(38)).toBeCloseTo(0.5);
    expect(hotness(50)).toBe(1);
  });

  it('returns a cell value at its centre and blends bilinearly between centres', () => {
    // 2.5° cells centred at (1.25, 1.25) and (1.25, 3.75)
    const idx = buildCellIndex(
      [
        { lat: 1.25, lon: 1.25, tmaxC: 30 },
        { lat: 1.25, lon: 3.75, tmaxC: 40 },
      ],
      2.5,
    );
    expect(sampleTmax(idx, 1.25, 1.25)).toBeCloseTo(30);
    expect(sampleTmax(idx, 1.25, 2.5)).toBeCloseTo(35); // halfway between the two centres
    expect(sampleTmax(idx, 1.25, 3.125)).toBeCloseTo(37.5);
  });

  it('renormalises over the neighbours that exist and gives null far from any data', () => {
    const idx = buildCellIndex([{ lat: 1.25, lon: 1.25, tmaxC: 30 }], 2.5);
    expect(sampleTmax(idx, 2, 2)).toBeCloseTo(30); // only one of four neighbours has data
    expect(sampleTmax(idx, -40, 120)).toBeNull();
  });

  it('wraps across the antimeridian', () => {
    const idx = buildCellIndex(
      [
        { lat: 61.25, lon: 178.75, tmaxC: 10 },
        { lat: 61.25, lon: -178.75, tmaxC: 20 },
      ],
      2.5,
    );
    expect(sampleTmax(idx, 61.25, 180)).toBeCloseTo(15);
    expect(sampleTmax(idx, 61.25, -180)).toBeCloseTo(15);
  });
});
