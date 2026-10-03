'use client';

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ReactNode } from 'react';
import { SEVERITY_META, type Severity } from '@/lib/domain';
import { ChartFrame, Legend, LegendItem, TooltipCard } from './chart-frame';
import { everyNth, niceScale, shortDay, t1, weekdayDay } from './format';

export type ForecastChartPoint = {
  day: string;
  /** ERA5 reanalysis daily Tmax (history before issue; verification truth after issue for hindcasts). */
  reanalysis: number | null;
  predicted: number | null;
  lower: number | null;
  upper: number | null;
  nwp: number | null;
  normal: number | null;
  severity: Severity | null;
};

type Row = ForecastChartPoint & { band: [number, number] | null };

function Diamond(props: { cx?: number; cy?: number; value?: unknown }) {
  const { cx, cy, value } = props;
  if (cx == null || cy == null || value == null) return <g />;
  const s = 5;
  return (
    <path
      d={`M${cx} ${cy - s} L${cx + s} ${cy} L${cx} ${cy + s} L${cx - s} ${cy} Z`}
      fill="var(--viz-nwp)"
      stroke="var(--viz-surface)"
      strokeWidth={2}
    />
  );
}

/**
 * CLIMATIQ forecast chart: predicted Tmax with its nominal 80 % band, NWP guidance points, reference normal,
 * zone heatwave base threshold and ERA5 reanalysis on one time axis. Single y-axis (°C).
 */
export function ForecastChart({
  points,
  issuedFor,
  threshold,
  zoneLabel,
  normalBasis,
  provenance,
  footnote,
  hindcast,
}: {
  points: ForecastChartPoint[];
  issuedFor: string;
  threshold: number;
  zoneLabel: string;
  normalBasis: string;
  provenance?: ReactNode;
  footnote?: ReactNode;
  hindcast: boolean;
}) {
  const data: Row[] = points.map((p) => ({ ...p, band: p.lower != null && p.upper != null ? [p.lower, p.upper] : null }));
  const { domain, ticks } = niceScale(
    points.flatMap((p) => [p.reanalysis, p.predicted, p.lower, p.upper, p.nwp, p.normal]).concat([threshold]),
    1,
  );
  const xTicks = everyNth(points.map((p) => p.day), 9);
  const fc = points.filter((p) => p.predicted != null);
  const hasNwp = points.some((p) => p.nwp != null);
  const hasNormal = points.some((p) => p.normal != null);
  const hasReanalysis = points.some((p) => p.reanalysis != null);
  const truthAfterIssue = points.some((p) => p.day > issuedFor && p.reanalysis != null);
  const peak = fc.reduce<ForecastChartPoint | null>((m, p) => (m == null || (p.predicted ?? -99) > (m.predicted ?? -99) ? p : m), null);

  const summary = fc.length
    ? `Forecast of daily maximum temperature issued for ${shortDay(issuedFor)}. ${fc
        .map((p) => `${shortDay(p.day)}: ${t1(p.predicted)} (band ${t1(p.lower)} to ${t1(p.upper)})${p.severity ? `, ${SEVERITY_META[p.severity].label}` : ''}`)
        .join('; ')}. Peak ${t1(peak?.predicted)} on ${peak ? shortDay(peak.day) : '—'}. Heatwave base threshold ${threshold} °C.`
    : 'No forecast values available.';

  const table = {
    caption: 'Forecast and reanalysis values by day (°C)',
    columns: ['Day', 'Predicted Tmax (°C)', 'Band low (°C)', 'Band high (°C)', 'NWP guidance (°C)', 'Reference normal (°C)', 'ERA5 reanalysis (°C)', 'Severity'],
    rows: points.map((p) => [
      `${shortDay(p.day)}${p.day === issuedFor ? ' (issue date)' : ''}`,
      p.predicted,
      p.lower,
      p.upper,
      p.nwp,
      p.normal,
      p.reanalysis,
      p.severity ? SEVERITY_META[p.severity].label : null,
    ]),
    numeric: [1, 2, 3, 4, 5, 6],
  };

  return (
    <ChartFrame
      summary={summary}
      table={table}
      provenance={provenance}
      footnote={footnote}
      title="Daily maximum temperature — forecast and context"
      description={`°C · ${hindcast ? 'hindcast' : 'forecast'} issued for ${shortDay(issuedFor)} (vertical line)`}
      legend={
        <Legend>
          <LegendItem label="CLIMATIQ predicted Tmax" color="var(--viz-model)" />
          <LegendItem label="Nominal 80 % band (heuristic, uncalibrated)" color="var(--viz-band)" kind="band" />
          {hasNwp && <LegendItem label="NWP guidance (Open-Meteo)" color="var(--viz-nwp)" kind="dot" />}
          {hasReanalysis && <LegendItem label={truthAfterIssue ? 'ERA5 reanalysis (history + verification)' : 'ERA5 reanalysis (recent history)'} color="var(--viz-reanalysis)" />}
          {hasNormal && <LegendItem label={`Reference normal (${normalBasis})`} color="var(--viz-normal)" kind="dashed" />}
          <LegendItem label={`Heatwave base ${threshold} °C (${zoneLabel})`} color="var(--viz-threshold)" kind="dashed" />
        </Legend>
      }
    >
      <div className="h-[300px] w-full sm:h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 18, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} strokeWidth={1} />
            <XAxis
              dataKey="day"
              tickFormatter={shortDay}
              tickLine={false}
              axisLine={{ strokeWidth: 1 }}
              ticks={xTicks}
              interval="preserveEnd"
              minTickGap={8}
              tickMargin={6}
            />
            <YAxis
              domain={domain}
              ticks={ticks}
              tickLine={false}
              axisLine={false}
              width={52}
              allowDecimals={false}
              tickFormatter={(v: number) => `${v}°C`}
            />
            <ReferenceLine
              y={threshold}
              stroke="var(--viz-threshold)"
              strokeDasharray="5 4"
              strokeWidth={1.25}
              ifOverflow="extendDomain"
              label={{ value: `${threshold} °C base`, position: 'insideTopLeft', offset: 6 }}
            />
            <ReferenceLine x={issuedFor} stroke="var(--viz-axis)" strokeWidth={1} label={{ value: 'Issued', position: 'top', offset: 6 }} />
            <Area dataKey="band" type="monotone" fill="var(--viz-band)" stroke="none" isAnimationActive={false} connectNulls={false} activeDot={false} />
            <Line dataKey="normal" type="monotone" stroke="var(--viz-normal)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} isAnimationActive={false} />
            <Line
              dataKey="reanalysis"
              type="monotone"
              stroke="var(--viz-reanalysis)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4, fill: 'var(--viz-reanalysis)', stroke: 'var(--viz-surface)', strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="predicted"
              type="monotone"
              stroke="var(--viz-model)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={{ r: 4, fill: 'var(--viz-model)', stroke: 'var(--viz-surface)', strokeWidth: 2 }}
              activeDot={{ r: 5, fill: 'var(--viz-model)', stroke: 'var(--viz-surface)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <Line dataKey="nwp" stroke="none" dot={<Diamond />} activeDot={false} isAnimationActive={false} legendType="none" />
            <Tooltip
              cursor={{ stroke: 'var(--viz-axis)', strokeWidth: 1 }}
              isAnimationActive={false}
              content={({ active, label }) => {
                if (!active || label == null) return null;
                const p = data.find((d) => d.day === label);
                if (!p) return null;
                const rows = [
                  p.predicted != null && { key: 'p', label: 'CLIMATIQ predicted', value: t1(p.predicted), color: 'var(--viz-model)' },
                  p.band && { key: 'b', label: 'nominal 80 % band', value: `${t1(p.lower, '')}–${t1(p.upper)}`, color: 'var(--viz-band)', kind: 'rect' as const },
                  p.nwp != null && { key: 'n', label: 'NWP guidance', value: t1(p.nwp), color: 'var(--viz-nwp)', kind: 'dot' as const },
                  p.reanalysis != null && { key: 'r', label: p.day > issuedFor ? 'ERA5 reanalysis (verification)' : 'ERA5 reanalysis', value: t1(p.reanalysis), color: 'var(--viz-reanalysis)' },
                  p.normal != null && { key: 'm', label: 'reference normal', value: t1(p.normal), color: 'var(--viz-normal)', kind: 'dashed' as const },
                ].filter(Boolean) as Parameters<typeof TooltipCard>[0]['rows'];
                return (
                  <TooltipCard
                    title={`${weekdayDay(String(label))}${String(label) === issuedFor ? ' · issue date' : ''}`}
                    rows={rows.length ? rows : [{ key: 'none', label: 'no data for this day', value: '—' }]}
                    note={p.severity ? `CLIMATIQ severity: ${SEVERITY_META[p.severity].label}` : undefined}
                  />
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
