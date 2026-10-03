/** Zod schemas shared by the forecasts / analytics / export route handlers and pages. */
import { z } from 'zod';
import { pathWithin } from '@/lib/rbac';

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'Not a valid calendar date');

export const regionCode = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9-]+$/, 'Region codes contain letters, digits and hyphens (e.g. IN-RJ)'));

export const scenarioParam = z.enum(['live', 'replay']);
export const runParam = z.uuid('run must be a forecast run id (UUID)');

/** Comma-separated list of up to `max` region codes. */
export const regionList = (max = 4) =>
  z
    .string()
    .max(400)
    .transform((s) => [...new Set(s.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean))])
    .pipe(z.array(z.string().regex(/^[A-Z0-9-]+$/)).min(1).max(max, `Select at most ${max} regions`));

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Keeps rows whose region path lies within one of the user's scopes (null scope = nationwide). */
export function filterByScopes<T extends { path: string }>(rows: T[], scopes: (string | null)[]): T[] {
  if (scopes.includes(null)) return rows;
  return rows.filter((r) => scopes.some((s) => pathWithin(r.path, s)));
}
