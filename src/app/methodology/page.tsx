import type { Metadata } from 'next';
import Link from 'next/link';
import { desc, eq, sql } from 'drizzle-orm';
import { ExternalLink } from 'lucide-react';
import { PublicFooter, PublicHeader } from '@/components/public/public-chrome';
import { ProvenanceBadge, SeverityBadge } from '@/components/ui/badges';
import { Panel } from '@/components/ui/primitives';
import { getDb } from '@/server/db/client';
import { dataSources, forecastRuns, forecastVerifications, forecasts, ingestionRuns, severityThresholds } from '@/server/db/schema';
import { fmtDateTime } from '@/lib/domain';

export const metadata: Metadata = {
  title: 'Methodology & data transparency',
  description: 'How CLIMATIQ forecasts heat risk, which data it uses, and its limitations.',
};

const TOC = [
  ['status', 'What is implemented'],
  ['sources', 'Data sources'],
  ['forecasting', 'Forecasting method'],
  ['severity', 'Severity classification'],
  ['confidence', 'Confidence & uncertainty'],
  ['advisories', 'AI advisory generation'],
  ['alerts', 'Automated alerts'],
  ['accuracy', 'Forecast accuracy evaluation'],
  ['simulated-data', 'Demo & simulated data'],
  ['geography', 'Geography & resolution'],
  ['limitations', 'Limitations'],
  ['privacy', 'Privacy & data handling'],
] as const;

export default async function MethodologyPage() {
  const db = getDb();
  const [sources, thresholds, lastRuns, lastIngestion, accuracy] = await Promise.all([
    db.select().from(dataSources).orderBy(dataSources.id),
    db.select().from(severityThresholds).orderBy(severityThresholds.zone, severityThresholds.id),
    db.select({ scenario: forecastRuns.scenario, issuedFor: forecastRuns.issuedFor, createdAt: forecastRuns.createdAt, inputs: forecastRuns.inputs }).from(forecastRuns).where(eq(forecastRuns.status, 'succeeded')).orderBy(desc(forecastRuns.createdAt)).limit(2),
    db.select({ finishedAt: ingestionRuns.finishedAt, job: ingestionRuns.job }).from(ingestionRuns).where(eq(ingestionRuns.status, 'succeeded')).orderBy(desc(ingestionRuns.finishedAt)).limit(1),
    db
      .select({ h: forecasts.horizonDay, n: sql<number>`count(*)::int`, mae: sql<number>`round(avg(abs(${forecastVerifications.errorC}))::numeric, 2)::float`, bias: sql<number>`round(avg(${forecastVerifications.errorC})::numeric, 2)::float` })
      .from(forecastVerifications)
      .innerJoin(forecasts, eq(forecasts.id, forecastVerifications.forecastId))
      .groupBy(forecasts.horizonDay)
      .orderBy(forecasts.horizonDay),
  ]);

  return (
    <div className="atmosphere min-h-dvh">
      <PublicHeader />
      <main id="main" className="mx-auto max-w-6xl px-4 pt-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">Methodology & data transparency</p>
        <h1 className="mt-1 font-heading text-3xl font-semibold tracking-tight sm:text-4xl">What CLIMATIQ knows, how it knows it, and where it is uncertain</h1>
        <p className="mt-2 max-w-3xl text-fg-muted">
          CLIMATIQ is a hackathon-stage decision-support prototype. It is <strong className="text-fg">not</strong> an official meteorological service and never replaces warnings from the India
          Meteorological Department (IMD) or disaster-management authorities.
        </p>

        <div className="mt-8 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
            <ol className="flex flex-wrap gap-2 text-sm lg:flex-col lg:gap-1">
              {TOC.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`} className="block rounded-lg px-2 py-1 text-fg-muted hover:bg-accent-soft hover:text-fg">
                    {label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="flex min-w-0 flex-col gap-4 [&_h2]:scroll-mt-24">
            <Panel id="status" title="What is implemented, approximated or planned">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-fg-subtle">
                      <th className="py-2 pr-3">Capability</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="[&_td]:py-2 [&_td]:pr-3 [&_td]:align-top [&_tr]:border-b [&_tr]:border-line/60">
                    <tr><td>Historical climate (5 years)</td><td>Implemented — real data</td><td>ERA5 reanalysis via Open-Meteo for all states; seasonal windows for pilot districts.</td></tr>
                    <tr><td>Live forecast guidance</td><td>Implemented — real data</td><td>Open-Meteo forecast API (numerical weather prediction), refreshed by ingestion runs.</td></tr>
                    <tr><td>Heat forecasting model</td><td>Implemented — statistical baseline</td><td>baseline-v1 (no machine learning yet). Adapter interface ready for ML models.</td></tr>
                    <tr><td>Severity classification</td><td>Approximation of IMD criteria</td><td>Uses a 5-year reference climate instead of IMD&apos;s 1991–2020 station normals.</td></tr>
                    <tr><td>Official IMD warnings</td><td>Not connected</td><td>IMD&apos;s API requires registration/approval; the adapter is in place but not configured.</td></tr>
                    <tr><td>Weather stations (IoT)</td><td>Ingestion API implemented; stations simulated</td><td>No physical hardware is deployed. Demo stations are clearly labelled SIMULATED.</td></tr>
                    <tr><td>AI advisories</td><td>Implemented with fallback</td><td>LLM provider when configured; otherwise a deterministic template. Human approval before publication.</td></tr>
                    <tr><td>Notifications</td><td>In-app only</td><td>Email/SMS channels are planned through the notification abstraction.</td></tr>
                    <tr><td>Incidents, users, teams</td><td>Fictional demo data</td><td>All people and incidents in the demo are invented.</td></tr>
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel id="sources" title="Data sources" description="Every chart, map and metric in CLIMATIQ shows which of these it came from and when it was last updated.">
              <ul className="flex flex-col gap-3">
                {sources.map((s) => (
                  <li key={s.id} className="rounded-xl border border-line p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{s.name}</span>
                      <span className="rounded bg-accent-soft px-1.5 text-[11px] font-semibold uppercase text-accent">{s.kind.replace('_', ' ')}</span>
                      <span className={s.isConfigured ? 'text-xs text-sev-low' : 'text-xs text-accent'}>{s.isConfigured ? 'active' : 'not configured'}</span>
                    </div>
                    {s.notes && <p className="mt-1 text-sm text-fg-muted">{s.notes}</p>}
                    <p className="mt-1 text-xs text-fg-subtle">
                      {s.license} · {s.attribution}
                      {s.url?.startsWith('http') && (
                        <>
                          {' '}·{' '}
                          <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">
                            docs <ExternalLink className="size-3" aria-hidden />
                          </a>
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
              {lastIngestion[0]?.finishedAt && <p className="mt-3 text-xs text-fg-muted">Last successful ingestion: {fmtDateTime(lastIngestion[0].finishedAt)} ({lastIngestion[0].job}).</p>}
            </Panel>

            <Panel id="forecasting" title="Forecasting method — baseline-v1">
              <div className="space-y-3 text-sm text-fg-muted">
                <p>For every state and every district of the pilot states, CLIMATIQ forecasts the daily maximum temperature for the next 7 days by blending three ingredients:</p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li><strong className="text-fg">Reference climate</strong> — the average maximum for that date over 5 recent years of ERA5 reanalysis (±7-day window).</li>
                  <li><strong className="text-fg">Persistence</strong> — how far above or below that reference the last three days were; the anomaly fades with a 3-day time scale.</li>
                  <li><strong className="text-fg">Numerical weather guidance</strong> — Open-Meteo&apos;s forecast, weighted 85 % on day 1 falling to 55 % by day 7.</li>
                </ol>
                <pre className="overflow-x-auto rounded-xl bg-accent-soft p-3 font-mono text-xs text-fg">{`prediction(h) = w_h · NWP(h) + (1 − w_h) · [normal(d+h) + anomaly₀ · e^(−h/3)]
σ(h)          = 0.9 + 0.3·h + 0.25·min(|NWP(h) − persistence(h)|, 6)   (+0.8 °C without NWP)
range         = prediction ± 1.28·σ   (nominal 80 % band — heuristic, not calibrated)`}</pre>
                <p>
                  <strong className="text-fg">Historical replay.</strong> To show the system on a real event, CLIMATIQ replays the late-May 2024 North-India heatwave: the forecast is made as of 26 May 2024 using only
                  information available then — ERA5 history up to that day and the weather-model forecasts <em>as they were issued</em> (Open-Meteo Previous Runs API). It is then compared with what ERA5 later
                  recorded. The replay is history, never a current warning.
                </p>
                <p>The model is registered behind a versioned interface; every forecast run stores its model version, inputs and parameters so future machine-learning models can be compared fairly.</p>
              </div>
              {lastRuns.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {lastRuns.map((r) => (
                    <ProvenanceBadge key={r.createdAt.toISOString()} kind="model_forecast" source={`${r.scenario} run for ${r.issuedFor}`} updated={fmtDateTime(r.createdAt)} />
                  ))}
                </div>
              )}
            </Panel>

            <Panel id="severity" title="Severity classification">
              <p className="text-sm text-fg-muted">
                IMD declares a heat wave when a station&apos;s maximum reaches at least 40 °C in the plains, 37 °C on the coast or 30 °C in the hills <em>and</em> is 4.5–6.4 °C above normal (severe: more than
                6.4 °C), or when it reaches 45 °C (severe: 47 °C) in the plains; IMD also requires two stations over two consecutive days (
                <a className="text-accent hover:underline" href="https://internal.imd.gov.in/section/nhac/dynamic/FAQ_heat_wave.pdf" target="_blank" rel="noreferrer">
                  IMD FAQ on Heat Wave
                </a>
                ). CLIMATIQ maps these criteria onto four levels. Only the High and Extreme rules mirror IMD text; Moderate is a CLIMATIQ band. Thresholds are configurable by administrators (audited).
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-fg-subtle">
                      <th className="py-2 pr-3">Zone</th>
                      <th className="py-2 pr-3">Level</th>
                      <th className="py-2 pr-3">Rule</th>
                      <th className="py-2">Mirrors IMD?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {thresholds.map((t) => (
                      <tr key={t.id} className="border-b border-line/60 align-top">
                        <td className="py-2 pr-3 capitalize">{t.zone}</td>
                        <td className="py-2 pr-3">
                          <SeverityBadge severity={t.level} size="sm" />
                        </td>
                        <td className="py-2 pr-3 text-fg-muted">{t.basis}</td>
                        <td className="py-2">{t.isOfficialCriterion ? 'Yes (approximation)' : 'No — CLIMATIQ'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-fg-muted">
                Climate zones are a documented CLIMATIQ heuristic: hill states/UTs and Himachal Pradesh districts (except low-lying Una) use hill criteria; listed coastal districts (Odisha, Konkan) and coastal states/UTs use
                coastal criteria; everything else uses plains criteria. IMD does not publish this mapping.
              </p>
            </Panel>

            <Panel id="confidence" title="Confidence & uncertainty">
              <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
                <li>Each forecast carries a range (nominal 80 % band) and a confidence label (low/medium/high) with a 0–1 score.</li>
                <li>The score is a <strong className="text-fg">heuristic</strong> from the spread σ — it grows with lead time and when weather-model guidance disagrees with persistence. It is not a calibrated probability.</li>
                <li>Forecasts are made at one point per district (or one point per state for non-pilot states). Cities display their district&apos;s forecast; CLIMATIQ never implies city-level precision.</li>
                <li>ERA5 reanalysis is a model reconstruction on a ~25 km grid; it tends to under-estimate local station extremes.</li>
              </ul>
            </Panel>

            <Panel id="advisories" title="AI advisory generation">
              <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
                <li>Advisories are written from a validated forecast bundle (regions, temperatures, ranges, severity, confidence, contributing factors, sources). The model is instructed not to invent observations, sources, official warnings or certainty, and its output is checked against a schema.</li>
                <li>Source references are attached by the server, not by the AI. Provider, model, prompt version and generation time are stored with every advisory.</li>
                <li>If the AI provider is unavailable or no key is configured, a deterministic template writes the advisory and the fallback is recorded — the platform never blocks on AI.</li>
                <li>Every advisory starts as a draft and must be approved by an authorised official before it is published. Advisories are tailored for government, disaster-management teams, field teams and the public.</li>
              </ul>
            </Panel>

            <Panel id="alerts" title="Automated alerts">
              <p className="text-sm text-fg-muted">
                After each forecast run, alerts are raised for regions whose forecast meets configurable rules (minimum severity, minimum confidence, maximum lead time). Duplicates are prevented per region,
                day and severity; a cooldown stops re-alerting after resolution; every alert is audited and delivered as an in-app notification to users responsible for that region. Alerts are always labelled
                as CLIMATIQ-generated — never as official warnings.
              </p>
            </Panel>

            <Panel id="accuracy" title="Forecast accuracy evaluation">
              <p className="text-sm text-fg-muted">
                Every forecast run is retained. When the truth becomes available, forecasts are verified against it (error = predicted − observed). For the historical replay, the truth is ERA5 reanalysis, not
                station observations, and it is a single event — so these numbers illustrate the method and are <strong className="text-fg">not</strong> a validated measure of skill.
              </p>
              {accuracy.length > 0 ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <caption className="pb-2 text-left text-xs text-fg-subtle">Replay hindcast vs ERA5 (all states and pilot districts)</caption>
                    <thead>
                      <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-fg-subtle">
                        <th className="py-2 pr-3">Lead time</th>
                        <th className="py-2 pr-3">Samples</th>
                        <th className="py-2 pr-3">Mean absolute error</th>
                        <th className="py-2">Bias</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accuracy.map((a) => (
                        <tr key={a.h} className="border-b border-line/60">
                          <td className="py-1.5 pr-3">Day {a.h}</td>
                          <td className="tabular py-1.5 pr-3">{a.n}</td>
                          <td className="tabular py-1.5 pr-3">{a.mae.toFixed(2)} °C</td>
                          <td className="tabular py-1.5">{a.bias > 0 ? '+' : ''}{a.bias.toFixed(2)} °C</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-2 text-sm text-fg-muted">No verified forecasts yet.</p>
              )}
              <p className="mt-2 text-xs text-fg-muted">
                Detailed breakdowns by region, lead time and severity are in{' '}
                <Link href="/analytics" className="text-accent hover:underline">
                  Climate analytics
                </Link>{' '}
                (sign-in required).
              </p>
            </Panel>

            <Panel id="simulated-data" title="Demo & simulated data">
              <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
                <li>Demo weather stations and their observations are synthetic (no physical IoT hardware exists yet). They are always labelled SIMULATED and never mixed into real-data analytics.</li>
                <li>Users, teams, incidents, tasks and the response story are fictional. Demo records are flagged so the demo can be reset without touching real configuration.</li>
                <li>If real climate data cannot be retrieved, CLIMATIQ shows the last-updated time and a stale/missing notice — it never silently substitutes demo values.</li>
              </ul>
            </Panel>

            <Panel id="geography" title="Geography & resolution">
              <p className="text-sm text-fg-muted">
                Hierarchy India → state/UT → district → city. Boundaries come from geoBoundaries (state data from DataMeet, CC BY 2.5 IN; 2021 districts, ODbL), simplified for the web and depicting India&apos;s
                official claims; they are <strong className="text-fg">not authenticated by the Survey of India</strong>, which is the standard for official political maps of India. Cities are from GeoNames
                (CC BY 4.0). Districts are loaded for seven pilot states and UTs — Rajasthan, Uttar Pradesh, Maharashtra, Odisha, Telangana, Himachal Pradesh and Delhi — chosen to cover IMD&apos;s core heatwave
                zone and the plains, coastal and hill criteria. Some district boundaries predate later reorganisations.
              </p>
            </Panel>

            <Panel id="limitations" title="Limitations">
              <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
                <li>Not an official warning; not validated for operational use; uncertainty bands are not calibrated.</li>
                <li>Departures use a 5-year reanalysis reference, not IMD&apos;s 30-year station normals; the IMD two-station/two-day declaration rule is not applied.</li>
                <li>Heat stress also depends on humidity, night temperatures, exposure and vulnerability; CLIMATIQ shows humidity and warm-night factors but does not model health impacts.</li>
                <li>Open-Meteo&apos;s free service has rate limits and no uptime guarantee; data freshness is shown everywhere.</li>
              </ul>
            </Panel>

            <Panel id="privacy" title="Privacy & data handling">
              <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
                <li>Stored personal data is limited to account name, email, designation, role/region assignments and a bcrypt password hash. Demo accounts are fictional.</li>
                <li>Sessions use signed, http-only cookies. Actions that change data are written to an audit log with minimal before/after snapshots (no passwords or secrets).</li>
                <li>Only public weather data is sent to the AI provider — never personal data. Free AI tiers may use prompts to improve their services.</li>
                <li>Read notifications are deleted after 30 days; live forecast runs are kept for about 13 months for accuracy analysis. This prototype is not certified against any specific regulation.</li>
              </ul>
            </Panel>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
