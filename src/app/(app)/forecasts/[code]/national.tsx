import { EmptyState, MetricCard, Panel } from '@/components/ui/primitives';
import { ProvenanceBadge, SeverityBadge } from '@/components/ui/badges';
import { SeverityStack } from '@/components/charts/severity-stack';
import { shortDay, t1 } from '@/components/charts/format';
import { RunHeader } from '@/components/forecast/run-header';
import { ChildrenList, Limitations, OfficialWarnings } from '@/components/forecast/parts';
import { getDb } from '@/server/db/client';
import { childrenSeverity, imdSource, officialWarningsFor, runInputKinds, severityByDay, type RunDetail } from '@/server/analytics/forecast-views';
import { addDays, fmtDateTime, SEVERITY_META, type Severity } from '@/lib/domain';
import type { Scenario } from '@/server/scenario';

/** India-level view: there is no national forecast, so this aggregates the state forecasts of the run. */
export async function NationalSummary({ run, countryId, scenario }: { run: RunDetail | null; countryId: number; scenario: Scenario }) {
  const db = getDb();
  if (!run) {
    return (
      <Panel>
        <EmptyState title="No forecast run is available for this scenario">
          {scenario === 'live'
            ? 'No live run has been generated yet (Open-Meteo may be unreachable). Switch to the historical replay in the top bar.'
            : 'The replay hindcast has not been generated.'}
        </EmptyState>
      </Panel>
    );
  }
  const [states, sevStates, sevDistricts, inputKinds, imd] = await Promise.all([
    childrenSeverity(db, run.id, countryId),
    severityByDay(db, run.id, 'state'),
    severityByDay(db, run.id, 'district'),
    runInputKinds(db, run.id),
    imdSource(db),
  ]);
  const warnings = await officialWarningsFor(db, [countryId, ...states.map((s) => s.regionId)], { from: addDays(run.issuedFor, 1), to: addDays(run.issuedFor, run.horizonDays) });
  const rank = (s: Severity | null) => (s ? SEVERITY_META[s].rank : -1);
  const sorted = [...states].sort((a, b) => rank(b.peakSeverity) - rank(a.peakSeverity) || (b.peakTmaxC ?? 0) - (a.peakTmaxC ?? 0));
  const atRisk = states.filter((s) => rank(s.peakSeverity) >= 2).length;
  const districtPeak = sevDistricts.reduce((m, d) => Math.max(m, d.high + d.extreme), 0);
  const hottest = sorted.reduce<(typeof sorted)[number] | null>((m, s) => (s.peakTmaxC != null && (m == null || s.peakTmaxC > (m.peakTmaxC ?? -99)) ? s : m), null);

  return (
    <div className="flex flex-col gap-5">
      <RunHeader run={run} inputKinds={inputKinds} />
      <section aria-label="National headline" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard label="States/UTs reaching High+" value={atRisk} unit={`of ${states.filter((s) => s.hasForecast).length}`} hint="Peak severity over the forecast horizon." />
        <MetricCard label="Pilot districts at High+ (worst day)" value={districtPeak} hint="Maximum number of districts at High or Extreme on any single day." />
        <MetricCard
          label="Hottest state forecast"
          value={hottest ? t1(hottest.peakTmaxC, '') : '—'}
          unit="°C"
          hint={hottest ? <>{hottest.name} · {hottest.peakSeverity && <SeverityBadge severity={hottest.peakSeverity} size="sm" />}</> : undefined}
        />
      </section>
      <Panel title="Severity distribution by day" description="No national forecast is produced — these are counts of state and pilot-district forecasts.">
        <div className="flex flex-col gap-6">
          <SeverityStack
            rows={sevStates.map((d) => ({ key: d.day, text: shortDay(d.day), label: shortDay(d.day), sublabel: `D+${d.horizonDay}`, href: `/forecasts?day=${d.day}`, counts: d }))}
            title="States & union territories"
            unit="states"
            provenance={<ProvenanceBadge kind="model_forecast" source={run.modelKey} updated={fmtDateTime(run.createdAt)} />}
          />
          <SeverityStack
            rows={sevDistricts.map((d) => ({ key: d.day, text: shortDay(d.day), label: shortDay(d.day), sublabel: `D+${d.horizonDay}`, href: `/forecasts?day=${d.day}`, counts: d }))}
            title="Pilot districts"
            unit="districts"
          />
        </div>
      </Panel>
      <Panel title="States & union territories" description="Sorted by peak severity, then peak predicted Tmax.">
        <ChildrenList items={sorted} childLabel="states" />
      </Panel>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Official warnings">
          <OfficialWarnings warnings={warnings} imdConfigured={Boolean(imd?.isConfigured)} />
        </Panel>
        <Panel title="Limitations & uncertainty">
          <Limitations hindcast={run.isHindcast} resolution="State and district centroids (single grid points)" />
        </Panel>
      </div>
    </div>
  );
}
