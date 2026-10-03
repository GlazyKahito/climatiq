import { describe, expect, it, vi } from 'vitest';
import { estimateCalls, OpenMeteoClient, OpenMeteoError } from '@/server/ingestion/adapters/open-meteo';

const day = (lat: number) => ({
  latitude: lat,
  longitude: 75,
  elevation: 200,
  daily: { time: ['2024-05-27', '2024-05-28'], temperature_2m_max: [46.1, null], temperature_2m_min: [30, 31] },
});

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('OpenMeteoClient', () => {
  it('parses multi-location responses in input order', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([day(26), day(27)]));
    const c = new OpenMeteoClient({ fetchImpl, sleep: async () => {} });
    const out = await c.forecast([{ key: 'a', lat: 26, lon: 75 }, { key: 'b', lat: 27, lon: 75 }], 2);
    expect(out.map((s) => s.key)).toEqual(['a', 'b']);
    expect(out[0].days[0]).toMatchObject({ day: '2024-05-27', tmaxC: 46.1, tminC: 30 });
    expect(out[0].days[1].tmaxC).toBeNull();
    const url = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('latitude=26.0000%2C27.0000');
    expect(url).toContain('timezone=Asia%2FKolkata');
  });

  it('wraps a single-location object response', async () => {
    const c = new OpenMeteoClient({ fetchImpl: async () => jsonResponse(day(26)), sleep: async () => {} });
    expect(await c.archive([{ key: 'x', lat: 26, lon: 75 }], '2024-05-27', '2024-05-28', { model: 'era5' })).toHaveLength(1);
  });

  it('retries 429 / 5xx with back-off and then succeeds', async () => {
    let n = 0;
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => (++n < 3 ? jsonResponse({ reason: 'busy' }, n === 1 ? 429 : 503, { 'retry-after': '1' }) : jsonResponse([day(26)])));
    const c = new OpenMeteoClient({ fetchImpl, sleep });
    const out = await c.forecast([{ key: 'a', lat: 26, lon: 75 }]);
    expect(out).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(1000); // honours Retry-After
  });

  it('does not retry client errors', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ reason: 'bad' }, 400));
    const c = new OpenMeteoClient({ fetchImpl, sleep: async () => {} });
    await expect(c.forecast([{ key: 'a', lat: 26, lon: 75 }])).rejects.toBeInstanceOf(OpenMeteoError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up after max retries on network errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const c = new OpenMeteoClient({ fetchImpl, sleep: async () => {}, maxRetries: 2 });
    await expect(c.forecast([{ key: 'a', lat: 26, lon: 75 }])).rejects.toThrow(/Network error/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('splits requests into batches', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const lats = new URL(url).searchParams.get('latitude')!.split(',');
      return jsonResponse(lats.map((l) => day(Number(l))));
    });
    const c = new OpenMeteoClient({ fetchImpl, sleep: async () => {}, batchSize: 2 });
    const pts = [1, 2, 3, 4, 5].map((i) => ({ key: String(i), lat: 20 + i, lon: 75 }));
    expect(await c.forecast(pts)).toHaveLength(5);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('estimates weighted API cost like the free-tier calculator', () => {
    expect(estimateCalls(1, 6, 7)).toBe(1);
    expect(estimateCalls(1, 1, 1826)).toBeCloseTo(13.04, 1);
    expect(estimateCalls(10, 2, 72)).toBeCloseTo(10.29, 1);
  });
});
