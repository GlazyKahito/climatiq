/**
 * IoT observation payload validation and plausibility checks (pure functions — unit-tested).
 *
 * Pipeline per record:
 *   1. Shape/type validation (Zod) — a malformed payload rejects the whole request (400).
 *   2. Timestamp window — more than 10 min in the future or older than 30 days → record rejected.
 *   3. Hard physical limits — outside → record rejected (never stored).
 *   4. Soft plausibility limits and sudden jumps vs. the neighbouring observation → stored with quality `suspect`.
 *   5. Everything else is stored as `unverified`. Nothing is ever auto-`verified`.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const MAX_BATCH = 500;
export const FUTURE_TOLERANCE_MS = 10 * 60_000;
export const MAX_AGE_MS = 30 * 86_400_000;

/** Outside these bounds a value is physically implausible → record rejected. (temp matches the DB check constraint.) */
export const HARD_LIMITS = {
  tempC: [-60, 65],
  humidityPct: [0, 100],
  windKmh: [0, 400],
  pressureHpa: [300, 1100],
} as const;

/** Outside these bounds a value is possible but unusual for India → stored as `suspect`. */
export const SOFT_LIMITS = {
  tempC: [-35, 52],
  windKmh: [0, 150],
  pressureHpa: [500, 1060],
} as const;

/** Change between consecutive observations ≤ JUMP_WINDOW_MS apart above these deltas → `suspect`. */
export const JUMP_WINDOW_MS = 2 * 3_600_000;
export const JUMP_LIMITS = { tempC: 8, humidityPct: 50, pressureHpa: 6 } as const;

const num = z.number({ error: 'must be a number' });
const optionalNum = num.nullable().optional();

export const observationSchema = z
  .object({
    observedAt: z.iso.datetime({ offset: true, error: 'must be an ISO-8601 timestamp with a timezone (e.g. 2026-05-26T14:00:00+05:30)' }),
    tempC: num,
    humidityPct: optionalNum,
    windKmh: optionalNum,
    pressureHpa: optionalNum,
  })
  .strict();

export type ObservationInput = z.infer<typeof observationSchema>;

const batchSchema = z
  .object({
    observations: z.array(observationSchema).min(1, 'observations must not be empty').max(MAX_BATCH, `at most ${MAX_BATCH} observations per request`),
  })
  .strict();

/** Accepts a single observation object or `{ observations: [...] }`. Throws ZodError on malformed input. */
export function parseObservationPayload(body: unknown): ObservationInput[] {
  if (body && typeof body === 'object' && !Array.isArray(body) && 'observations' in body) {
    return batchSchema.parse(body).observations;
  }
  return [observationSchema.parse(body)];
}

export type RejectReason = 'future_timestamp' | 'too_old' | 'out_of_range' | 'duplicate_in_batch';

export type AssessedRecord =
  | {
      index: number;
      ok: true;
      observedAt: Date;
      tempC: number;
      humidityPct: number | null;
      windKmh: number | null;
      pressureHpa: number | null;
      quality: 'unverified' | 'suspect';
      flags: string[];
    }
  | { index: number; ok: false; reason: RejectReason; detail: string };

export type NeighbourObs = { observedAt: Date; tempC: number | null; humidityPct: number | null; pressureHpa: number | null };

type Field = keyof typeof HARD_LIMITS;

/**
 * Assesses a batch. `context` are already-stored observations of the same station around the batch window,
 * used for jump detection (together with earlier records of the batch itself).
 */
export function assessBatch(records: ObservationInput[], context: NeighbourObs[], now: Date = new Date()): AssessedRecord[] {
  const out: AssessedRecord[] = new Array(records.length);
  const seen = new Set<number>();
  const accepted: { index: number; obs: NeighbourObs }[] = [];

  records.forEach((r, index) => {
    const observedAt = new Date(r.observedAt);
    const t = observedAt.getTime();
    if (t - now.getTime() > FUTURE_TOLERANCE_MS) {
      out[index] = { index, ok: false, reason: 'future_timestamp', detail: 'observedAt is more than 10 minutes in the future' };
      return;
    }
    if (now.getTime() - t > MAX_AGE_MS) {
      out[index] = { index, ok: false, reason: 'too_old', detail: 'observedAt is older than 30 days' };
      return;
    }
    const values: Record<Field, number | null> = {
      tempC: r.tempC,
      humidityPct: r.humidityPct ?? null,
      windKmh: r.windKmh ?? null,
      pressureHpa: r.pressureHpa ?? null,
    };
    for (const f of Object.keys(HARD_LIMITS) as Field[]) {
      const v = values[f];
      const [lo, hi] = HARD_LIMITS[f];
      if (v != null && (v < lo || v > hi)) {
        out[index] = { index, ok: false, reason: 'out_of_range', detail: `${f}=${v} is outside the physical range ${lo}…${hi}` };
        return;
      }
    }
    if (seen.has(t)) {
      out[index] = { index, ok: false, reason: 'duplicate_in_batch', detail: 'another record in this request has the same observedAt' };
      return;
    }
    seen.add(t);

    const flags: string[] = [];
    for (const f of Object.keys(SOFT_LIMITS) as (keyof typeof SOFT_LIMITS)[]) {
      const v = values[f];
      const [lo, hi] = SOFT_LIMITS[f];
      if (v != null && (v < lo || v > hi)) flags.push(`implausible_${f}`);
    }
    out[index] = {
      index,
      ok: true,
      observedAt,
      tempC: r.tempC,
      humidityPct: values.humidityPct,
      windKmh: values.windKmh,
      pressureHpa: values.pressureHpa,
      quality: 'unverified',
      flags,
    };
    accepted.push({ index, obs: { observedAt, tempC: r.tempC, humidityPct: values.humidityPct, pressureHpa: values.pressureHpa } });
  });

  // Jump detection against the nearest earlier observation (stored or in this batch) within the window.
  const timeline = [...context.map((obs) => ({ index: -1, obs })), ...accepted].sort(
    (a, b) => a.obs.observedAt.getTime() - b.obs.observedAt.getTime() || a.index - b.index,
  );
  for (let i = 0; i < timeline.length; i++) {
    const cur = timeline[i];
    if (cur.index < 0) continue;
    const prev = findPrevious(timeline, i);
    if (!prev) continue;
    const rec = out[cur.index];
    if (!rec.ok) continue;
    for (const f of Object.keys(JUMP_LIMITS) as (keyof typeof JUMP_LIMITS)[]) {
      const a = prev[f];
      const b = cur.obs[f];
      if (a != null && b != null && Math.abs(b - a) > JUMP_LIMITS[f]) rec.flags.push(`sudden_jump_${f}`);
    }
  }
  for (const rec of out) if (rec.ok && rec.flags.length) rec.quality = 'suspect';
  return out;
}

function findPrevious(timeline: { index: number; obs: NeighbourObs }[], i: number): NeighbourObs | null {
  const t = timeline[i].obs.observedAt.getTime();
  for (let j = i - 1; j >= 0; j--) {
    const p = timeline[j].obs;
    const dt = t - p.observedAt.getTime();
    if (dt <= 0) continue; // same timestamp (a stored duplicate) is not a "previous" observation
    return dt <= JUMP_WINDOW_MS ? p : null;
  }
  return null;
}

// ───────────── Station API keys (only the SHA-256 hash is stored) ─────────────
export const STATION_KEY_PREFIX = 'cqst_';

export function generateStationKey(): string {
  return `${STATION_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
}

export function hashStationKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Constant-time comparison of a presented key against the stored hash. */
export function verifyStationKey(key: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const a = Buffer.from(hashStationKey(key), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Extracts the token from `Authorization: Bearer <token>`. */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S{8,200})\s*$/i.exec(header);
  return m ? m[1] : null;
}
