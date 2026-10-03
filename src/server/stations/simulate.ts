/**
 * Deterministic simulator for the DEMO weather stations (no physical hardware exists).
 *
 * Every value produced here is stored with `data_kind = 'simulated'` and shown with SIMULATED labels.
 *
 * Daily anchors (Tmax/Tmin/RH/wind) per station-day come from, in order of preference:
 *   1. `daily_climate` of the station's district for that day (ERA5 reanalysis / NWP, real data);
 *   2. persistence: the mean of the latest ≤3 `daily_climate` days within the previous 10 days;
 *   3. `climate_normals` of the district for that day-of-year (CLIMATIQ few-year ERA5 reference);
 *   4. the documented demo climatology curve below (approximate, hand-tabulated monthly means).
 * Hourly values are then shaped with a diurnal cycle (Tmin ≈ 06:00 IST, Tmax ≈ 15:00 IST) plus seeded noise.
 */

export type ClimateZone = 'plains' | 'coastal' | 'hilly';
export type AnchorBasis = 'daily_climate' | 'recent_persistence' | 'climate_normals' | 'climatology_curve';
export type DayAnchor = { tmaxC: number; tminC: number; rhMeanPct: number | null; windMaxKmh: number | null; basis: AnchorBasis };

// ───────────── Seeded randomness ─────────────
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG — small, fast and deterministic for a given seed. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng: () => number) {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ───────────── Documented demo climatology (approximate; NOT an official normal) ─────────────
type Regime = 'north_plains' | 'central_plains' | 'coastal' | 'hills';
/** Approximate monthly mean Tmax / Tmin (°C) and mean RH (%) — Jan…Dec. */
const CURVES: Record<Regime, { tmax: number[]; tmin: number[]; rh: number[] }> = {
  north_plains: {
    tmax: [21, 24, 30, 37, 41, 40, 35, 33, 34, 33, 28, 23],
    tmin: [7, 10, 15, 21, 26, 28, 27, 26, 25, 19, 12, 8],
    rh: [65, 55, 45, 30, 30, 45, 75, 80, 70, 55, 55, 65],
  },
  central_plains: {
    tmax: [29, 32, 36, 40, 43, 37, 31, 30, 32, 32, 30, 28],
    tmin: [13, 16, 20, 24, 28, 27, 24, 24, 23, 20, 15, 12],
    rh: [50, 40, 30, 25, 30, 60, 85, 85, 80, 65, 55, 55],
  },
  coastal: {
    tmax: [30, 31, 32, 33, 34, 32, 30, 30, 31, 33, 33, 31],
    tmin: [18, 19, 22, 25, 27, 26, 25, 25, 25, 24, 22, 19],
    rh: [65, 65, 68, 70, 72, 82, 86, 86, 83, 75, 68, 65],
  },
  hills: {
    tmax: [9, 11, 15, 20, 24, 25, 22, 21, 21, 19, 15, 12],
    tmin: [2, 3, 7, 11, 15, 16, 16, 15, 13, 10, 6, 4],
    rh: [60, 60, 55, 45, 45, 60, 85, 88, 78, 60, 52, 55],
  },
};

export function regimeFor(lat: number, zone: ClimateZone): Regime {
  if (zone === 'hilly') return 'hills';
  if (zone === 'coastal') return 'coastal';
  return lat >= 24 ? 'north_plains' : 'central_plains';
}

/** Linear interpolation between mid-month values for a calendar day (YYYY-MM-DD). */
export function climatologyCurve(lat: number, zone: ClimateZone, day: string): DayAnchor {
  const c = CURVES[regimeFor(lat, zone)];
  const d = new Date(`${day}T00:00:00Z`);
  const month = d.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), month + 1, 0)).getUTCDate();
  const pos = (d.getUTCDate() - 0.5) / daysInMonth - 0.5; // −0.5 … +0.5 around mid-month
  const other = pos >= 0 ? (month + 1) % 12 : (month + 11) % 12;
  const w = Math.abs(pos);
  const lerp = (arr: number[]) => arr[month] * (1 - w) + arr[other] * w;
  return { tmaxC: lerp(c.tmax), tminC: lerp(c.tmin), rhMeanPct: lerp(c.rh), windMaxKmh: null, basis: 'climatology_curve' };
}

// ───────────── Hourly shaping ─────────────
const IST_OFFSET_MS = 5.5 * 3_600_000;

export function istDay(t: Date) {
  return new Date(t.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
export function istHour(t: Date) {
  const d = new Date(t.getTime() + IST_OFFSET_MS);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

/** Diurnal shape 0 (Tmin, ~06:00 IST) → 1 (Tmax, ~15:00 IST) → back towards 0 overnight. */
export function diurnalShape(hourIst: number) {
  if (hourIst >= 6 && hourIst <= 15) return (1 - Math.cos((Math.PI * (hourIst - 6)) / 9)) / 2;
  const h = hourIst < 6 ? hourIst + 24 : hourIst; // 15 … 30
  return (1 + Math.cos((Math.PI * (h - 15)) / 15)) / 2;
}

/** Hourly timestamps (aligned to whole IST hours) covering the `days` days up to the last whole hour before `now`. */
export function hourlyTimeline(now: Date, days: number) {
  const hour = 3_600_000;
  const last = Math.floor((now.getTime() + IST_OFFSET_MS) / hour) * hour - IST_OFFSET_MS;
  const out: Date[] = [];
  for (let t = last - (days * 24 - 1) * hour; t <= last; t += hour) out.push(new Date(t));
  return out;
}

export type SimProfile = {
  code: string;
  lat: number;
  zone: ClimateZone;
  /** 'online' → reports every hour; 'degraded' → gaps + intermittent humidity sensor; 'offline' → stopped reporting. */
  behaviour: 'online' | 'degraded' | 'offline';
  /** For offline stations: hours since the last report. */
  silentHours?: number;
};

export type SimObservation = {
  observedAt: Date;
  tempC: number;
  humidityPct: number | null;
  windKmh: number | null;
  pressureHpa: number | null;
};

const round1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Generates hourly simulated observations for one station. Pure and deterministic for (profile, now, anchors). */
export function simulateStation(profile: SimProfile, timeline: Date[], anchorFor: (day: string) => DayAnchor): SimObservation[] {
  const rng = mulberry32(hashSeed(profile.code));
  const out: SimObservation[] = [];
  const cutoff =
    profile.behaviour === 'offline' && timeline.length
      ? timeline[timeline.length - 1].getTime() - (profile.silentHours ?? 36) * 3_600_000
      : Infinity;
  let tNoise = 0;
  let rhNoise = 0;
  let humidityFault = false;
  for (const t of timeline) {
    // Advance the noise processes every hour so values do not depend on which hours are dropped.
    tNoise = 0.7 * tNoise + 0.35 * gaussian(rng);
    rhNoise = 0.6 * rhNoise + 2 * gaussian(rng);
    const windNoise = 1.5 * gaussian(rng);
    const pNoise = 0.3 * gaussian(rng);
    const gap = rng();
    if (rng() < 0.04) humidityFault = !humidityFault;

    if (t.getTime() > cutoff) continue;
    if (profile.behaviour === 'degraded' && gap < 0.25) continue;

    const day = istDay(t);
    const a = anchorFor(day);
    const s = diurnalShape(istHour(t));
    const temp = a.tminC + (a.tmaxC - a.tminC) * s + tNoise;
    const rhMean = a.rhMeanPct ?? 50;
    const rhAmp = Math.min(30, 0.6 * rhMean);
    const rh = clamp(rhMean + (0.5 - s) * rhAmp + rhNoise, 4, 100);
    const windMax = a.windMaxKmh ?? 14;
    const wind = Math.max(0, windMax * (0.3 + 0.55 * s) + windNoise);
    const doy = Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.UTC(Number(day.slice(0, 4)), 0, 0)) / 86_400_000);
    // Mean-sea-level-equivalent pressure: seasonal cycle + semi-diurnal tide.
    const pressure = 1005 + 7 * Math.cos((2 * Math.PI * (doy - 15)) / 365) + 1.2 * Math.cos((2 * Math.PI * (istHour(t) - 10)) / 12) + pNoise;

    out.push({
      observedAt: t,
      tempC: round1(clamp(temp, -40, 55)),
      humidityPct: profile.behaviour === 'degraded' && humidityFault ? null : round1(rh),
      windKmh: round1(wind),
      pressureHpa: round1(pressure),
    });
  }
  return out;
}

/** Picks the anchor for a day from available real daily data, normals and the demo curve (see file header). */
export function resolveAnchor(
  day: string,
  daily: Map<string, { tmaxC: number | null; tminC: number | null; rhMeanPct: number | null; windMaxKmh: number | null }>,
  normals: Map<number, { normalTmaxC: number; normalTminC: number | null }>,
  lat: number,
  zone: ClimateZone,
): DayAnchor {
  const curve = climatologyCurve(lat, zone, day);
  const same = daily.get(day);
  if (same?.tmaxC != null && same.tminC != null) {
    return { tmaxC: same.tmaxC, tminC: same.tminC, rhMeanPct: same.rhMeanPct ?? curve.rhMeanPct, windMaxKmh: same.windMaxKmh, basis: 'daily_climate' };
  }
  const recent: { tmaxC: number; tminC: number; rh: number | null; wind: number | null }[] = [];
  for (let back = 1; back <= 10 && recent.length < 3; back++) {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - back);
    const r = daily.get(d.toISOString().slice(0, 10));
    if (r?.tmaxC != null && r.tminC != null) recent.push({ tmaxC: r.tmaxC, tminC: r.tminC, rh: r.rhMeanPct, wind: r.windMaxKmh });
  }
  if (recent.length) {
    const mean = (f: (x: (typeof recent)[number]) => number | null) => {
      const v = recent.map(f).filter((x): x is number => x != null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    return {
      tmaxC: mean((x) => x.tmaxC)!,
      tminC: mean((x) => x.tminC)!,
      rhMeanPct: mean((x) => x.rh) ?? curve.rhMeanPct,
      windMaxKmh: mean((x) => x.wind),
      basis: 'recent_persistence',
    };
  }
  const doy = Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.UTC(Number(day.slice(0, 4)), 0, 0)) / 86_400_000);
  const n = normals.get(doy);
  if (n) {
    return { tmaxC: n.normalTmaxC, tminC: n.normalTminC ?? n.normalTmaxC - (curve.tmaxC - curve.tminC), rhMeanPct: curve.rhMeanPct, windMaxKmh: null, basis: 'climate_normals' };
  }
  return curve;
}
