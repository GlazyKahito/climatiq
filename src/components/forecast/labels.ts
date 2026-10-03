/** Client-safe labels and helpers for forecast UI. */
import type { DataKind } from '@/lib/domain';

export const SCENARIO_LABEL = {
  replay: 'Historical replay · May 2024 · ERA5 + CLIMATIQ hindcast',
  live: 'Live',
} as const;

export const ZONE_THRESHOLD: Record<'plains' | 'coastal' | 'hilly', number> = { plains: 40, coastal: 37, hilly: 30 };
export const ZONE_LABEL: Record<'plains' | 'coastal' | 'hilly', string> = { plains: 'plains', coastal: 'coastal', hilly: 'hilly' };

export const RESOLUTION_LABEL: Record<string, string> = {
  'state-centroid': 'State centroid (single grid point at the state’s centre)',
  'district-centroid': 'District centroid (single grid point at the district’s centre)',
  point: 'Point location',
};

export function resolutionLabel(r: string | null | undefined) {
  if (!r) return 'Unknown resolution';
  const key = Object.keys(RESOLUTION_LABEL).find((k) => r === k || r.startsWith(`${k} `) || r.startsWith(`${k}(`));
  return key ? RESOLUTION_LABEL[key] : r;
}

export const IMD_CATEGORY_TEXT: Record<string, string> = {
  none: 'Does not meet IMD heatwave criteria',
  heatwave: 'Meets IMD heatwave criteria',
  severe_heatwave: 'Meets IMD severe-heatwave criteria',
};

export const KIND_SOURCE: Partial<Record<DataKind, string>> = {
  model_forecast: 'CLIMATIQ baseline model',
  nwp_forecast: 'Open-Meteo Forecast API',
  reanalysis: 'ERA5 via Open-Meteo archive',
  simulated: 'CLIMATIQ demo simulator',
  observed: 'Station observations',
};

export function isDataKind(k: string): k is DataKind {
  return ['observed', 'reanalysis', 'nwp_forecast', 'model_forecast', 'simulated'].includes(k);
}

export function triggeredByLabel(t: string) {
  if (t === 'seed') return 'demo seed';
  if (t === 'cron') return 'scheduled job';
  if (t.startsWith('user:')) return 'a signed-in user';
  if (t.startsWith('admin:')) return 'an administrator';
  if (t.startsWith('maintenance:')) return 'a maintenance job';
  return t;
}
