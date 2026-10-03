'use server';

import { revalidatePath } from 'next/cache';
import { authorize, AuthError } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { rateLimit, HttpError } from '@/server/http';
import { audit } from '@/server/audit/log';
import { runForecast } from '@/server/forecasting/run';

export type RunForecastState = {
  ok: boolean;
  message: string;
  status?: 'succeeded' | 'partial' | 'failed';
  runId?: string;
  regions?: number;
  at: number;
};

/**
 * "Run forecast now" — triggers a new LIVE baseline run (today's date, Open-Meteo NWP + ERA5 history).
 * Requires `forecast:run`; rate-limited per user; the request is audited with the requesting user as actor
 * (the pipeline itself also records a system audit entry for the run).
 */
export async function runLiveForecast(): Promise<RunForecastState> {
  const at = Date.now();
  let user;
  try {
    user = await authorize('forecast:run');
    rateLimit(`forecast-run:${user.id}`, 3, 5 * 60_000);
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, message: e.status === 401 ? 'Please sign in again.' : 'You do not have permission to run forecasts.', at };
    if (e instanceof HttpError) return { ok: false, message: e.message, at };
    throw e;
  }

  const db = getDb();
  try {
    const result = await runForecast(db, { scenario: 'live', triggeredBy: `user:${user.id}` });
    await audit(db, {
      actor: { id: user.id, name: user.name },
      action: 'forecast.run_requested',
      entityType: 'forecast_run',
      entityId: result.runId,
      after: { scenario: 'live', status: result.status, regions: result.regions },
    });
    revalidatePath('/forecasts', 'layout');
    revalidatePath('/command');
    const message =
      result.status === 'succeeded'
        ? `Live forecast generated for ${result.regions} regions.`
        : result.status === 'partial'
          ? `Live forecast generated for ${result.regions} regions; some regions lacked inputs.`
          : `Forecast run failed${result.error ? `: ${result.error}` : ''}. The previous run remains in use.`;
    return { ok: result.status !== 'failed', message, status: result.status, runId: result.runId, regions: result.regions, at };
  } catch (e) {
    console.error('[forecasts] run failed', e);
    return { ok: false, message: 'The forecast run could not be started. The previous run remains in use.', at };
  }
}
