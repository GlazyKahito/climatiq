import type { Metadata } from 'next';
import { Download, Map as MapIcon } from 'lucide-react';
import { EmptyState, LinkButton, PageHeader, Panel } from '@/components/ui/primitives';
import { ProvenanceBadge } from '@/components/ui/badges';
import { SeverityStack, type StackRow } from '@/components/charts/severity-stack';
import { shortDay, weekdayDay } from '@/components/charts/format';
import { RunHeader } from '@/components/forecast/run-header';
import { RegionsTable } from '@/components/forecast/regions-table';
import { RunForecastButton } from '@/components/forecast/run-forecast-button';
import { DayLink, TopRisks } from '@/components/forecast/parts';
import { SCENARIO_LABEL, triggeredByLabel } from '@/components/forecast/labels';
import { requirePagePermission } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { currentScenario } from '@/server/scenario';
import { forecastTable, lastRunAttempt, latestRunDetail, runDays, runInputKinds, severityByDay, topRisks } from '@/server/analytics/forecast-views';
import { can } from '@/lib/rbac';
import { fmtDateTime } from '@/lib/domain';
import { runLiveForecast } from './actions';

export const metadata: Metadata = { title: 'Heatwave prediction' };

export default async function ForecastsPage({ searchParams }: PageProps<'/forecasts'>) {
  const user = await requirePagePermission('dashboard:view');
  const sp = await searchParams;
  const scenario = await currentScenario();
  const db = getDb();
  const canRun = can(user.assignments, 'forecast:run');
  const canExport = can(user.assignments, 'analytics:export');
  const run = await latestRunDetail(db, scenario);
  const runButton = canRun ? <RunForecastButton action={runLiveForecast} scenario={scenario} /> : null;

  if (!run) {
    const attempt = await lastRunAttempt(db, scenario);
    return (
      <div className="flex flex-col gap-5">
        <PageHeader eyebrow="Heatwave prediction" title="Regional heat-risk forecast" description={`Scenario: ${SCENARIO_LABEL[scenario]}`} actions={runButton} />
        <Panel>
          <EmptyState title={scenario === 'live' ? 'No live forecast is available yet' : 'No replay forecast has been generated'}>
            {scenario === 'live' ? (
              <p>
                Live runs need current NWP guidance from Open-Meteo and recent ERA5 history. They may be missing when the server is offline or the external API was
                unreachable. {canRun ? 'You can start a run now with “Run live forecast now”.' : 'Ask a climate analyst or administrator to start a run.'} Switch the scenario
                to the historical replay (top bar) to explore the May 2024 heatwave.
              </p>
            ) : (
              <p>The historical replay is created by the demo seed. Ask an administrator to re-run the seed or the replay forecast.</p>
            )}
            {attempt && (
              <p className="mt-2 text-xs">
                Last attempt: {fmtDateTime(attempt.createdAt)} by {triggeredByLabel(attempt.triggeredBy)} — status <strong>{attempt.status}</strong>
                {attempt.error ? ` (${attempt.error})` : ''}.
              </p>
            )}
          </EmptyState>
        </Panel>
      </div>
    );
  }

  const [days, inputKinds, sevStates, sevDistricts] = await Promise.all([
    runDays(db, run.id),
    runInputKinds(db, run.id),
    severityByDay(db, run.id, 'state'),
    severityByDay(db, run.id, 'district'),
  ]);
  const requested = typeof sp.day === 'string' ? sp.day : undefined;
  const day = requested && days.includes(requested) ? requested : (days[0] ?? run.issuedFor);
  const rows = await forecastTable(db, run.id, day);
  const top = topRisks(rows, 8);
  const dayLabel = `${weekdayDay(day)} (D+${rows[0]?.horizonDay ?? '?'})`;

  const atRiskByDay = new Map<string, number>();
  for (const s of [...sevStates, ...sevDistricts]) atRiskByDay.set(s.day, (atRiskByDay.get(s.day) ?? 0) + s.high + s.extreme);

  const toRows = (list: typeof sevStates): StackRow[] =>
    list.map((d) => ({
      key: d.day,
      text: `${shortDay(d.day)} (D+${d.horizonDay})`,
      label: shortDay(d.day),
      sublabel: `D+${d.horizonDay}`,
      href: `/forecasts?day=${d.day}`,
      selected: d.day === day,
      counts: { low: d.low, moderate: d.moderate, high: d.high, extreme: d.extreme },
    }));

  const provenance = (
    <>
      <ProvenanceBadge kind="model_forecast" source={`${run.modelKey} · run ${run.id.slice(0, 8)}`} updated={fmtDateTime(run.createdAt)} />
      <span className="text-[11px] text-fg-subtle">CLIMATIQ severity classes derived from IMD heatwave criteria — an indicator, not an IMD declaration.</span>
    </>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Heatwave prediction"
        title="Regional heat-risk forecast"
        description="Daily maximum temperature forecasts, CLIMATIQ severity and uncertainty for every state/UT and pilot district. Decision support — not an official IMD forecast."
        actions={
          <>
            <LinkButton href="/command" variant="secondary" size="sm">
              <MapIcon className="size-3.5" aria-hidden /> Command center
            </LinkButton>
            {canExport && (
              <a href={`/api/v1/export/forecasts.csv?run=${run.id}`} download className="inline-flex h-8 items-center gap-2 rounded-xl px-3 text-xs font-medium text-fg glass hover:bg-glass-strong">
                <Download className="size-3.5" aria-hidden /> Export run CSV
              </a>
            )}
            {runButton}
          </>
        }
      />

      <RunHeader run={run} inputKinds={inputKinds} />

      <nav aria-label="Target day" className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-fg-subtle">Target day</h2>
        <div className="relative -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {days.map((d, i) => (
            <DayLink key={d} day={d} horizonDay={i + 1} selected={d === day} href={`/forecasts?day=${d}`} severityCount={atRiskByDay.get(d) ?? 0} />
          ))}
        </div>
      </nav>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Panel
          className="xl:col-span-3"
          title="Severity distribution by forecast day"
          description="Number of regions in each CLIMATIQ severity class. Select a day to update the list and table."
        >
          <div className="flex flex-col gap-6">
            <SeverityStack rows={toRows(sevStates)} title="States & union territories" unit="states" provenance={provenance} />
            <SeverityStack
              rows={toRows(sevDistricts)}
              title="Pilot districts"
              unit="districts"
              footnote="Districts are loaded for the pilot states only (Rajasthan, Uttar Pradesh, Delhi, Odisha, Maharashtra, Telangana, Himachal Pradesh); each district is forecast at its centroid."
            />
          </div>
        </Panel>
        <Panel className="xl:col-span-2" title={`Top risks · ${dayLabel}`} description="Highest severity first, then predicted Tmax. Select a region for details.">
          <TopRisks items={top} dayLabel={dayLabel} />
        </Panel>
      </div>

      <Panel title="All regions" description={`Forecasts for ${dayLabel}. Sort by any column; filters apply instantly.`}>
        <RegionsTable
          dayLabel={dayLabel}
          rows={rows.map((r) => ({
            code: r.code,
            name: r.name,
            level: r.level,
            stateCode: r.stateCode,
            stateName: r.stateName,
            predictedTmaxC: r.predictedTmaxC,
            lowerC: r.lowerC,
            upperC: r.upperC,
            departureC: r.departureC,
            severity: r.severity,
            peakSeverity: r.peakSeverity,
            confidence: r.confidence,
            confidenceScore: r.confidenceScore,
            durationDays: r.durationDays,
          }))}
        />
      </Panel>
    </div>
  );
}
