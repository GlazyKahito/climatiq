/**
 * Open-Meteo adapter (https://open-meteo.com) — free, no API key for non-commercial use, CC BY 4.0 data.
 *  - Forecast API: NWP guidance (best-match models) up to 16 days.
 *  - Historical Weather API: ERA5 reanalysis (lags real time by ~5 days).
 * Requests are batched (multiple coordinates per call), retried with exponential backoff on 429/5xx and timeouts.
 */
import { z } from 'zod';
import type { DayInput } from '../../forecasting/baseline';

export type Point = { key: string; lat: number; lon: number };
export type DailySeries = { key: string; lat: number; lon: number; elevation: number | null; days: DayInput[] };

export const DAILY_VARS = [
  'temperature_2m_max',
  'temperature_2m_min',
  'apparent_temperature_max',
  'relative_humidity_2m_mean',
  'wind_speed_10m_max',
  'shortwave_radiation_sum',
] as const;
export type DailyVar = (typeof DAILY_VARS)[number];

/** Approximate Open-Meteo free-tier cost (weighted API calls) — see docs/research/data-sources.md §1.4. */
export function estimateCalls(locations: number, variables: number, days: number) {
  return Math.max(1, (variables / 10) * Math.max(1, days / 14)) * locations;
}

const dailySchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  elevation: z.number().nullable().optional(),
  daily: z.object({
    time: z.array(z.string()),
    temperature_2m_max: z.array(z.number().nullable()),
    temperature_2m_min: z.array(z.number().nullable()).optional(),
    apparent_temperature_max: z.array(z.number().nullable()).optional(),
    relative_humidity_2m_mean: z.array(z.number().nullable()).optional(),
    wind_speed_10m_max: z.array(z.number().nullable()).optional(),
    shortwave_radiation_sum: z.array(z.number().nullable()).optional(),
  }),
});

export class OpenMeteoError extends Error {
  constructor(
    message: string,
    public status?: number,
    public retryable = false,
  ) {
    super(message);
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type OpenMeteoOptions = {
  forecastUrl?: string;
  archiveUrl?: string;
  apiKey?: string;
  fetchImpl?: FetchLike;
  maxRetries?: number;
  batchSize?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRequest?: (info: { url: string; attempt: number; status?: number }) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class OpenMeteoClient {
  private o: Required<Omit<OpenMeteoOptions, 'apiKey' | 'onRequest'>> & Pick<OpenMeteoOptions, 'apiKey' | 'onRequest'>;
  public requests = 0;

  constructor(opts: OpenMeteoOptions = {}) {
    this.o = {
      forecastUrl: opts.forecastUrl ?? 'https://api.open-meteo.com/v1/forecast',
      archiveUrl: opts.archiveUrl ?? 'https://archive-api.open-meteo.com/v1/archive',
      apiKey: opts.apiKey,
      fetchImpl: opts.fetchImpl ?? ((u, i) => fetch(u, i)),
      maxRetries: opts.maxRetries ?? 3,
      batchSize: opts.batchSize ?? 50,
      timeoutMs: opts.timeoutMs ?? 30_000,
      sleep: opts.sleep ?? defaultSleep,
      onRequest: opts.onRequest,
    };
  }

  /** Daily NWP forecast for each point (days 0..forecastDays-1, local IST dates). */
  async forecast(points: Point[], forecastDays = 7, pastDays = 0): Promise<DailySeries[]> {
    return this.batched(points, (batch) => {
      const p = this.baseParams(batch);
      p.set('forecast_days', String(Math.min(16, Math.max(1, forecastDays))));
      if (pastDays) p.set('past_days', String(Math.min(92, pastDays)));
      return `${this.o.forecastUrl}?${p}`;
    });
  }

  /** Daily ERA5 reanalysis between two dates (inclusive). Long ranges are split per point batch. */
  async archive(
    points: Point[],
    startDate: string,
    endDate: string,
    opts: { model?: 'era5' | 'era5_land' | 'best_match'; variables?: readonly DailyVar[] } = {},
  ): Promise<DailySeries[]> {
    return this.batched(points, (batch) => {
      const p = this.baseParams(batch, opts.variables);
      p.set('start_date', startDate);
      p.set('end_date', endDate);
      if (opts.model && opts.model !== 'best_match') p.set('models', opts.model);
      return `${this.o.archiveUrl}?${p}`;
    });
  }

  private baseParams(batch: Point[], variables: readonly DailyVar[] = DAILY_VARS) {
    const p = new URLSearchParams();
    p.set('latitude', batch.map((b) => b.lat.toFixed(4)).join(','));
    p.set('longitude', batch.map((b) => b.lon.toFixed(4)).join(','));
    p.set('daily', variables.join(','));
    p.set('timezone', 'Asia/Kolkata');
    if (this.o.apiKey) p.set('apikey', this.o.apiKey);
    return p;
  }

  private async batched(points: Point[], urlFor: (batch: Point[]) => string): Promise<DailySeries[]> {
    const out: DailySeries[] = [];
    for (let i = 0; i < points.length; i += this.o.batchSize) {
      const batch = points.slice(i, i + this.o.batchSize);
      const json = await this.getJson(urlFor(batch));
      const arr = Array.isArray(json) ? json : [json];
      if (arr.length !== batch.length) throw new OpenMeteoError(`Expected ${batch.length} locations, got ${arr.length}`);
      arr.forEach((item, idx) => out.push(toSeries(batch[idx], dailySchema.parse(item))));
    }
    return out;
  }

  private async getJson(url: string): Promise<unknown> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.o.maxRetries + 1; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs);
      try {
        this.requests++;
        const res = await this.o.fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
        this.o.onRequest?.({ url: redact(url), attempt, status: res.status });
        if (res.ok) return await res.json();
        const body = await res.text().catch(() => '');
        const retryable = res.status === 429 || res.status >= 500;
        lastErr = new OpenMeteoError(`Open-Meteo HTTP ${res.status}: ${body.slice(0, 200)}`, res.status, retryable);
        if (!retryable) throw lastErr;
        const retryAfter = Number(res.headers.get('retry-after'));
        await this.o.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
      } catch (e) {
        if (e instanceof OpenMeteoError && !e.retryable) throw e;
        lastErr = e instanceof OpenMeteoError ? e : new OpenMeteoError(`Network error: ${(e as Error).message}`, undefined, true);
        if (attempt <= this.o.maxRetries) await this.o.sleep(backoff(attempt));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }
}

function backoff(attempt: number) {
  return Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
}

function redact(url: string) {
  return url.replace(/apikey=[^&]+/, 'apikey=***');
}

function toSeries(point: Point, r: z.infer<typeof dailySchema>): DailySeries {
  const d = r.daily;
  return {
    key: point.key,
    lat: r.latitude,
    lon: r.longitude,
    elevation: r.elevation ?? null,
    days: d.time.map((day, i) => ({
      day,
      tmaxC: d.temperature_2m_max[i] ?? null,
      tminC: d.temperature_2m_min?.[i] ?? null,
      apparentTmaxC: d.apparent_temperature_max?.[i] ?? null,
      rhMeanPct: d.relative_humidity_2m_mean?.[i] ?? null,
      windMaxKmh: d.wind_speed_10m_max?.[i] ?? null,
      radiationMj: d.shortwave_radiation_sum?.[i] ?? null,
    })),
  };
}

/** Client configured from (optional) environment overrides — works in scripts without full env validation. */
export function openMeteoFromEnv(opts: OpenMeteoOptions = {}) {
  return new OpenMeteoClient({
    forecastUrl: process.env.OPEN_METEO_FORECAST_URL || undefined,
    archiveUrl: process.env.OPEN_METEO_ARCHIVE_URL || undefined,
    apiKey: process.env.OPEN_METEO_API_KEY || undefined,
    ...opts,
  });
}
