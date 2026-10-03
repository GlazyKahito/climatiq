import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  assessBatch,
  generateStationKey,
  hashStationKey,
  MAX_BATCH,
  parseBearer,
  parseObservationPayload,
  verifyStationKey,
} from '@/server/stations/validation';
import { effectiveStatus } from '@/server/stations/status';
import { climatologyCurve, diurnalShape, hourlyTimeline, resolveAnchor, simulateStation } from '@/server/stations/simulate';

const NOW = new Date('2026-05-26T09:00:00Z'); // 14:30 IST
const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();
const H = 3_600_000;

describe('IoT payload validation', () => {
  it('accepts a single observation object', () => {
    const recs = parseObservationPayload({ observedAt: '2026-05-26T14:00:00+05:30', tempC: 44.2, humidityPct: 18 });
    expect(recs).toHaveLength(1);
    expect(recs[0].tempC).toBe(44.2);
  });

  it('accepts a batch and enforces the 500-record cap', () => {
    const one = { observedAt: iso(H), tempC: 40 };
    expect(parseObservationPayload({ observations: [one, { ...one, observedAt: iso(2 * H) }] })).toHaveLength(2);
    const tooMany = Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ observedAt: iso(i * 60_000), tempC: 30 }));
    expect(() => parseObservationPayload({ observations: tooMany })).toThrow(ZodError);
    expect(() => parseObservationPayload({ observations: [] })).toThrow(ZodError);
  });

  it('rejects malformed payloads (types, unknown keys, timestamps without timezone)', () => {
    expect(() => parseObservationPayload({ observedAt: iso(H), tempC: '40' })).toThrow(ZodError);
    expect(() => parseObservationPayload({ observedAt: iso(H) })).toThrow(ZodError);
    expect(() => parseObservationPayload({ observedAt: iso(H), tempC: 40, temperature: 40 })).toThrow(ZodError);
    expect(() => parseObservationPayload({ observedAt: '2026-05-26T14:00:00', tempC: 40 })).toThrow(ZodError);
    expect(() => parseObservationPayload([{ observedAt: iso(H), tempC: 40 }])).toThrow(ZodError);
    expect(() => parseObservationPayload(null)).toThrow(ZodError);
  });
});

describe('assessBatch', () => {
  it('rejects timestamps more than 10 minutes in the future but allows small clock skew', () => {
    const res = assessBatch(
      [
        { observedAt: new Date(NOW.getTime() + 11 * 60_000).toISOString(), tempC: 40 },
        { observedAt: new Date(NOW.getTime() + 5 * 60_000).toISOString(), tempC: 40 },
      ],
      [],
      NOW,
    );
    expect(res[0]).toMatchObject({ ok: false, reason: 'future_timestamp' });
    expect(res[1]).toMatchObject({ ok: true, quality: 'unverified' });
  });

  it('rejects observations older than 30 days', () => {
    const res = assessBatch([{ observedAt: iso(31 * 24 * H), tempC: 30 }], [], NOW);
    expect(res[0]).toMatchObject({ ok: false, reason: 'too_old' });
  });

  it('rejects physically impossible values and flags implausible ones as suspect', () => {
    const res = assessBatch(
      [
        { observedAt: iso(1 * H), tempC: 70 },
        { observedAt: iso(2 * H), tempC: 30, humidityPct: 120 },
        { observedAt: iso(5 * H), tempC: 53.5 },
        { observedAt: iso(8 * H), tempC: 30, windKmh: 180 },
      ],
      [],
      NOW,
    );
    expect(res[0]).toMatchObject({ ok: false, reason: 'out_of_range' });
    expect(res[1]).toMatchObject({ ok: false, reason: 'out_of_range' });
    expect(res[2]).toMatchObject({ ok: true, quality: 'suspect', flags: ['implausible_tempC'] });
    expect(res[3]).toMatchObject({ ok: true, quality: 'suspect', flags: ['implausible_windKmh'] });
  });

  it('flags sudden jumps against the previous observation (batch or stored), never marks verified', () => {
    const res = assessBatch(
      [
        { observedAt: iso(3 * H), tempC: 38 },
        { observedAt: iso(2 * H), tempC: 39 },
        { observedAt: iso(1 * H), tempC: 49.5 }, // +10.5 °C within an hour
        { observedAt: iso(0), tempC: 48 },
      ],
      [],
      NOW,
    );
    expect(res.map((r) => (r.ok ? r.quality : r.reason))).toEqual(['unverified', 'unverified', 'suspect', 'unverified']);
    expect(res[2].ok && res[2].flags).toContain('sudden_jump_tempC');
    expect(res.some((r) => r.ok && (r.quality as string) === 'verified')).toBe(false);

    const stored = [{ observedAt: new Date(NOW.getTime() - 90 * 60_000), tempC: 25, humidityPct: 80, pressureHpa: 1000 }];
    const vsStored = assessBatch([{ observedAt: iso(30 * 60_000), tempC: 26, humidityPct: 20, pressureHpa: 1000 }], stored, NOW);
    expect(vsStored[0]).toMatchObject({ ok: true, quality: 'suspect' });
    expect(vsStored[0].ok && vsStored[0].flags).toEqual(['sudden_jump_humidityPct']);
  });

  it('does not compare across long gaps', () => {
    const res = assessBatch(
      [
        { observedAt: iso(6 * H), tempC: 25 },
        { observedAt: iso(1 * H), tempC: 44 },
      ],
      [],
      NOW,
    );
    expect(res.every((r) => r.ok && r.quality === 'unverified')).toBe(true);
  });

  it('marks duplicate timestamps inside one request', () => {
    const t = '2026-05-26T13:00:00+05:30';
    const res = assessBatch(
      [
        { observedAt: t, tempC: 40 },
        { observedAt: '2026-05-26T07:30:00Z', tempC: 41 }, // same instant, different offset
      ],
      [],
      NOW,
    );
    expect(res[0].ok).toBe(true);
    expect(res[1]).toMatchObject({ ok: false, reason: 'duplicate_in_batch' });
  });
});

describe('station API keys', () => {
  it('stores only a SHA-256 hash and verifies in constant time', () => {
    const key = generateStationKey();
    expect(key.startsWith('cqst_')).toBe(true);
    const hash = hashStationKey(key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(key);
    expect(verifyStationKey(key, hash)).toBe(true);
    expect(verifyStationKey(`${key}x`, hash)).toBe(false);
    expect(verifyStationKey(key, null)).toBe(false);
    expect(verifyStationKey(key, 'not-a-hash')).toBe(false);
    expect(generateStationKey()).not.toBe(key);
  });

  it('parses bearer headers', () => {
    expect(parseBearer('Bearer cqst_abcdefgh123')).toBe('cqst_abcdefgh123');
    expect(parseBearer('bearer   cqst_abcdefgh123 ')).toBe('cqst_abcdefgh123');
    expect(parseBearer('Basic abc')).toBeNull();
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer('Bearer short')).toBeNull();
  });
});

describe('station status & simulator', () => {
  it('derives an effective status from freshness', () => {
    expect(effectiveStatus('online', new Date(NOW.getTime() - 30 * 60_000), NOW)).toBe('online');
    expect(effectiveStatus('online', new Date(NOW.getTime() - 5 * H), NOW)).toBe('degraded');
    expect(effectiveStatus('online', new Date(NOW.getTime() - 30 * H), NOW)).toBe('offline');
    expect(effectiveStatus('degraded', new Date(NOW.getTime() - 2 * H), NOW)).toBe('degraded');
    expect(effectiveStatus('planned', null, NOW)).toBe('planned');
    expect(effectiveStatus('online', null, NOW)).toBe('offline');
  });

  it('produces a deterministic, plausible diurnal cycle', () => {
    expect(diurnalShape(6)).toBeCloseTo(0);
    expect(diurnalShape(15)).toBeCloseTo(1);
    const timeline = hourlyTimeline(NOW, 7);
    expect(timeline).toHaveLength(168);
    const anchor = () => ({ tmaxC: 45, tminC: 30, rhMeanPct: 25, windMaxKmh: 18, basis: 'daily_climate' as const });
    const a = simulateStation({ code: 'SIM-X-1', lat: 27, zone: 'plains', behaviour: 'online' }, timeline, anchor);
    const b = simulateStation({ code: 'SIM-X-1', lat: 27, zone: 'plains', behaviour: 'online' }, timeline, anchor);
    expect(a).toEqual(b);
    expect(a).toHaveLength(168);
    for (const o of a) {
      expect(o.tempC).toBeGreaterThan(27);
      expect(o.tempC).toBeLessThan(48);
      expect(o.humidityPct!).toBeGreaterThanOrEqual(4);
    }
    const offline = simulateStation({ code: 'SIM-X-2', lat: 27, zone: 'plains', behaviour: 'offline', silentHours: 40 }, timeline, anchor);
    expect(offline.length).toBeLessThan(168 - 39);
    const degraded = simulateStation({ code: 'SIM-X-3', lat: 27, zone: 'plains', behaviour: 'degraded' }, timeline, anchor);
    expect(degraded.length).toBeLessThan(168);
  });

  it('prefers real daily data, then persistence, then normals, then the documented curve', () => {
    const daily = new Map([['2026-05-25', { tmaxC: 44, tminC: 29, rhMeanPct: 20, windMaxKmh: 15 }]]);
    expect(resolveAnchor('2026-05-25', daily, new Map(), 27, 'plains')).toMatchObject({ basis: 'daily_climate', tmaxC: 44 });
    expect(resolveAnchor('2026-05-26', daily, new Map(), 27, 'plains')).toMatchObject({ basis: 'recent_persistence', tmaxC: 44 });
    const normals = new Map([[160, { normalTmaxC: 41, normalTminC: 28 }]]);
    expect(resolveAnchor('2026-06-09', new Map(), normals, 27, 'plains')).toMatchObject({ basis: 'climate_normals', tmaxC: 41 });
    const curve = resolveAnchor('2026-10-03', new Map(), new Map(), 31.1, 'hilly');
    expect(curve.basis).toBe('climatology_curve');
    expect(curve.tmaxC).toBeLessThan(climatologyCurve(27, 'plains', '2026-10-03').tmaxC);
  });
});
