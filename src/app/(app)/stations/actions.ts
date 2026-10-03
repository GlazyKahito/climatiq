'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize, AuthError } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { HttpError, rateLimit } from '@/server/http';
import { registerIotStation, registerStationSchema, rotateStationKey, stationRegion } from '@/server/stations/register';
import { getStation } from '@/server/stations/queries';

export type RegisterState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      values?: { name?: string; regionCode?: string; lat?: string; lon?: string; elevationM?: string; sensors?: string[] };
      result?: { code: string; name: string; apiKey: string };
    }
  | undefined;

/** Registers a FUTURE IoT station (station:manage on the chosen region). The API key is returned once. */
export async function registerStationAction(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  const values = {
    name: String(formData.get('name') ?? ''),
    regionCode: String(formData.get('regionCode') ?? ''),
    lat: String(formData.get('lat') ?? ''),
    lon: String(formData.get('lon') ?? ''),
    elevationM: String(formData.get('elevationM') ?? ''),
    sensors: formData.getAll('sensors').map(String),
  };
  const parsed = registerStationSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0] ?? 'form')] ??= i.message;
    return { fieldErrors, values };
  }
  const db = getDb();
  const region = await stationRegion(db, parsed.data.regionCode);
  if (!region) return { fieldErrors: { regionCode: 'Choose a state or district from the list' }, values };
  try {
    const user = await authorize('station:manage', region.id);
    rateLimit(`station-register:${user.id}`, 10, 60_000);
    const res = await registerIotStation(db, parsed.data, { id: user.id, name: user.name, isDemo: user.isDemo });
    revalidatePath('/stations');
    return { result: { code: res.code, name: parsed.data.name, apiKey: res.apiKey } };
  } catch (err) {
    if (err instanceof AuthError) return { error: err.status === 401 ? 'Please sign in again.' : `You cannot register stations in ${region.name}.`, values };
    if (err instanceof HttpError) return { error: err.message, values };
    console.error('[stations] register failed', err);
    return { error: 'Registration failed. Please retry.', values };
  }
}

export type RotateState = { error?: string; apiKey?: string } | undefined;

/** Issues a new API key for an IoT station; the previous key stops working immediately. */
export async function rotateKeyAction(_prev: RotateState, formData: FormData): Promise<RotateState> {
  const code = z.string().regex(/^[A-Z0-9-]{3,40}$/).safeParse(formData.get('code'));
  if (!code.success) return { error: 'Invalid station' };
  const db = getDb();
  const station = await getStation(db, code.data);
  if (!station) return { error: 'Station not found' };
  try {
    const user = await authorize('station:manage', station.regionId);
    rateLimit(`station-rotate:${user.id}`, 5, 60_000);
    const res = await rotateStationKey(db, station.code, { id: user.id, name: user.name, isDemo: user.isDemo });
    return { apiKey: res.apiKey };
  } catch (err) {
    if (err instanceof AuthError) return { error: 'You are not allowed to manage this station.' };
    if (err instanceof HttpError) return { error: err.message };
    console.error('[stations] key rotation failed', err);
    return { error: 'Key rotation failed. Please retry.' };
  }
}
