import { eq } from 'drizzle-orm';
import type { DB } from '../types';
import { seedState } from '../schema';
import { runForecast, REPLAY_ISSUED_FOR } from '../../forecasting/run';

/**
 * Creates the demo forecast runs:
 *  - replay: CLIMATIQ hindcast issued 2024-05-26 from real ERA5 history (verified against ERA5 afterwards)
 *  - live:   today's run with real Open-Meteo NWP guidance (recorded as failed if the API is unreachable — no fake data)
 */
export async function seedForecasts(db: DB, log: (m: string) => void = () => {}) {
  const history = await db.select().from(seedState).where(eq(seedState.step, 'history')).limit(1);
  if (!history.length) return { incomplete: true, reason: 'climate history not imported yet' };
  const replay = await runForecast(db, { scenario: 'replay', issuedFor: REPLAY_ISSUED_FOR, triggeredBy: 'seed', skipAlerts: true });
  log(`Replay hindcast (${REPLAY_ISSUED_FOR}): ${replay.status}, ${replay.regions} regions`);
  // Older live data in the snapshot lags real time by ~5 days; the live run uses it for persistence + Open-Meteo NWP.
  const live = await runForecast(db, { scenario: 'live', triggeredBy: 'seed', skipAlerts: true });
  log(`Live run: ${live.status}${live.error ? ` (${live.error})` : ''}, ${live.regions} regions`);
  return { replay: replay.status, live: live.status };
}
