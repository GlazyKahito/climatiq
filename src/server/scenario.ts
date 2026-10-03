import 'server-only';
import { cookies } from 'next/headers';
import { env } from './config/env';

export type Scenario = 'live' | 'replay';

/** Historical replay used for the demo story — real ERA5 reanalysis, CLIMATIQ hindcasts. */
export const REPLAY = {
  issuedFor: '2024-05-26',
  label: 'Historical replay · late-May 2024 North-India heatwave (ERA5 reanalysis + CLIMATIQ hindcast)',
  shortLabel: 'Replay: May 2024 heatwave',
};

export async function currentScenario(): Promise<Scenario> {
  const v = (await cookies()).get('cq_scenario')?.value;
  if (v === 'live' || v === 'replay') return v;
  // Demo deployments open on the historical replay so judges see a heat event; production defaults to live.
  return env().DEMO_MODE ? 'replay' : 'live';
}
