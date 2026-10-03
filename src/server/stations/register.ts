/**
 * Registration of FUTURE IoT stations and API-key rotation. Authorisation (`station:manage` on the region) is
 * enforced by the caller (server action); these functions validate, persist and audit.
 * The plaintext API key is returned exactly once and never stored — only its SHA-256 hash.
 */
import { and, eq, like } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db/types';
import { dataSources, regions, weatherStations } from '../db/schema';
import { SOURCE_KEYS } from '../db/seed/reference';
import { audit } from '../audit/log';
import { HttpError } from '../http';
import { generateStationKey, hashStationKey } from './validation';

export const SENSOR_KEYS = ['temperature', 'humidity', 'wind', 'pressure'] as const;

const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().pipe(schema).optional());

export const registerStationSchema = z.object({
  name: z.string().trim().min(3, 'Name must be at least 3 characters').max(80, 'Name must be at most 80 characters'),
  regionCode: z.string().trim().min(2, 'Choose a state or district').max(80),
  lat: z.coerce.number({ error: 'Latitude is required' }).min(6, 'Latitude must be within India (6–37.6° N)').max(37.6, 'Latitude must be within India (6–37.6° N)'),
  lon: z.coerce.number({ error: 'Longitude is required' }).min(68, 'Longitude must be within India (68–97.5° E)').max(97.5, 'Longitude must be within India (68–97.5° E)'),
  elevationM: optionalNumber(z.number().int('Elevation must be a whole number of metres').min(-100).max(8000)),
  sensors: z.array(z.enum(SENSOR_KEYS)).min(1, 'Select at least one sensor'),
});
export type RegisterStationInput = z.infer<typeof registerStationSchema>;

type Actor = { id: string; name: string; isDemo?: boolean };

/** Looks up a state/district usable as a station region. */
export async function stationRegion(db: DB, code: string) {
  const [r] = await db
    .select({ id: regions.id, code: regions.code, name: regions.name, level: regions.level, path: regions.path })
    .from(regions)
    .where(eq(regions.code, code))
    .limit(1);
  if (!r || (r.level !== 'state' && r.level !== 'district')) return null;
  return r;
}

export async function registerIotStation(db: DB, input: RegisterStationInput, actor: Actor) {
  const region = await stationRegion(db, input.regionCode);
  if (!region) throw new HttpError(400, 'Unknown state or district');
  const [source] = await db.select({ id: dataSources.id }).from(dataSources).where(eq(dataSources.key, SOURCE_KEYS.iot)).limit(1);
  if (!source) throw new HttpError(503, 'IoT gateway data source is not configured');

  const stateCode = region.path.split('/')[1] ?? region.code;
  const prefix = `IOT-${stateCode.replace(/^IN-/, '')}-`;
  const existing = await db.select({ code: weatherStations.code }).from(weatherStations).where(like(weatherStations.code, `${prefix}%`));
  let next = existing.reduce((m, r) => Math.max(m, Number(r.code.slice(prefix.length)) || 0), 0) + 1;

  const apiKey = generateStationKey();
  for (let attempt = 0; attempt < 5; attempt++, next++) {
    const code = `${prefix}${String(next).padStart(3, '0')}`;
    const inserted = await db
      .insert(weatherStations)
      .values({
        code,
        name: input.name,
        regionId: region.id,
        lat: input.lat,
        lon: input.lon,
        elevationM: input.elevationM ?? null,
        stationType: 'iot',
        sourceId: source.id,
        status: 'planned',
        isSimulated: false,
        sensors: [...input.sensors],
        apiKeyHash: hashStationKey(apiKey),
        isDemo: actor.isDemo ?? false,
      })
      .onConflictDoNothing({ target: weatherStations.code })
      .returning({ id: weatherStations.id, code: weatherStations.code });
    if (inserted.length) {
      await audit(db, {
        actor,
        action: 'station.register',
        entityType: 'weather_station',
        entityId: code,
        regionId: region.id,
        after: { code, name: input.name, region: region.code, lat: input.lat, lon: input.lon, sensors: input.sensors, stationType: 'iot' },
      });
      return { id: inserted[0].id, code, apiKey, regionId: region.id };
    }
  }
  throw new HttpError(409, 'Could not allocate a station code, please retry');
}

/** Issues a new API key for an IoT station (the old key stops working immediately). */
export async function rotateStationKey(db: DB, code: string, actor: Actor) {
  const [s] = await db
    .select({ id: weatherStations.id, regionId: weatherStations.regionId, stationType: weatherStations.stationType })
    .from(weatherStations)
    .where(eq(weatherStations.code, code))
    .limit(1);
  if (!s) throw new HttpError(404, 'Station not found');
  if (s.stationType !== 'iot') throw new HttpError(400, 'Only IoT stations have API keys');
  const apiKey = generateStationKey();
  await db.update(weatherStations).set({ apiKeyHash: hashStationKey(apiKey) }).where(and(eq(weatherStations.id, s.id)));
  await audit(db, { actor, action: 'station.rotate_key', entityType: 'weather_station', entityId: code, regionId: s.regionId, after: { rotated: true } });
  return { code, apiKey };
}
