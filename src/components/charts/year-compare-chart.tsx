'use client';

import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ReactNode } from 'react';
import { ChartFrame, Legend, LegendItem, TooltipCard } from './chart-frame';
import { everyNth, monthDayLabel, niceScale, t1 } from './format';

export type YearSeries = { year: number; values: Record<string, number | null>; mean: number | null; max: number | null; days: number; atOrAbove: number };

/**
 * Emphasis chart: the same calendar window in earlier years (context grey), their mean, and the reference year's
 * reanalysis + CLIMATIQ forecast highlighted. Single °C axis.
 */
export function YearCompareChart({
  keys,
  years,
  refYear,
  predicted,
  forecastFrom,
  forecastTo,
  threshold,
  provenance,
  footnote,
}: {
  keys: string[];
  years: YearSeries[];
  refYear: number;
  predicted: Record<string, number | null>;
  forecastFrom: string | null;
  forecastTo: string | null;
  threshold: number;
  provenance?: ReactNode;
  footnote?: ReactNode;
}) {
  const earlier = years.filter((y) => y.year < refYear);
  const ref = years.find((y) => y.year === refYear) ?? null;
  const data = keys.map((k) => {
    const prev = earlier.map((y) => y.values[k]).filter((v): v is number => v != null);
    const row: Record<string, number | string | null> = {
      md: k,
      mean: prev.length ? Math.round((prev.reduce((a, b) => a + b, 0) / prev.length) * 10) / 10 : null,
      ref: ref?.values[k] ?? null,
      predicted: predicted[k] ?? null,
    };
    for (const y of earlier) row[`y${y.year}`] = y.values[k] ?? null;
    return row;
  });
  const { domain, ticks } = niceScale(data.flatMap((r) => Object.entries(r).filter(([k]) => k !== 'md').map(([, v]) => v as number | null)).concat([threshold]), 1);
  const xTicks = everyNth(keys, 9);
  const span = earlier.length ? `${earlier[0].year}–${earlier.at(-1)!.year}` : 'none';

  const summary = `Daily maximum temperature for ${monthDayLabel(keys[0] ?? '01-01')}–${monthDayLabel(keys.at(-1) ?? '01-01')}: ${years
    .map((y) => `${y.year} mean ${t1(y.mean)}, max ${t1(y.max)}, ${y.atOrAbove} days at or above ${threshold} °C`)
    .join('; ')}.`;

  return (
    <ChartFrame
      title="Same calendar window in earlier years"
      description={`Daily Tmax, °C · earlier years ${span} vs ${refYear}`}
      summary={summary}
      provenance={provenance}
      footnote={footnote}
      table={{
        caption: 'Same-window statistics by year',
        columns: ['Year', 'Days with data', 'Mean Tmax (°C)', 'Max Tmax (°C)', `Days ≥ ${threshold} °C`],
        rows: years.map((y) => [y.year === refYear ? `${y.year} (reference)` : String(y.year), y.days, y.mean, y.max, y.atOrAbove]),
        numeric: [1, 2, 3, 4],
      }}
      legend={
        <Legend>
          {earlier.length > 0 && <LegendItem label={`Earlier years ${span} (each line)`} color="var(--viz-context)" />}
          {earlier.length > 1 && <LegendItem label="Mean of earlier years" color="var(--viz-ink-2)" kind="dashed" />}
          {ref && <LegendItem label={`${refYear} ERA5 reanalysis`} color="var(--viz-reanalysis)" />}
          {Object.values(predicted).some((v) => v != null) && <LegendItem label={`${refYear} CLIMATIQ forecast`} color="var(--viz-model)" />}
        </Legend>
      }
    >
      <div className="h-[260px] w-full sm:h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="md" tickFormatter={monthDayLabel} tickLine={false} ticks={xTicks} interval="preserveEnd" minTickGap={8} tickMargin={6} />
            <YAxis domain={domain} ticks={ticks} tickLine={false} axisLine={false} width={52} allowDecimals={false} tickFormatter={(v: number) => `${v}°C`} />
            {forecastFrom && forecastTo && (
              <ReferenceArea x1={forecastFrom} x2={forecastTo} fill="var(--viz-band)" fillOpacity={0.5} ifOverflow="hidden" label={{ value: 'Forecast window', position: 'insideTop', offset: 6 }} />
            )}
            <ReferenceLine y={threshold} stroke="var(--viz-threshold)" strokeDasharray="5 4" strokeWidth={1.25} />
            {earlier.map((y) => (
              <Line key={y.year} dataKey={`y${y.year}`} stroke="var(--viz-context)" strokeWidth={1.5} dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />
            ))}
            {earlier.length > 1 && <Line dataKey="mean" stroke="var(--viz-ink-2)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} isAnimationActive={false} />}
            <Line dataKey="ref" stroke="var(--viz-reanalysis)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: 'var(--viz-reanalysis)', stroke: 'var(--viz-surface)', strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="predicted" stroke="var(--viz-model)" strokeWidth={2} dot={{ r: 3.5, fill: 'var(--viz-model)', stroke: 'var(--viz-surface)', strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />
            <Tooltip
              cursor={{ stroke: 'var(--viz-axis)', strokeWidth: 1 }}
              isAnimationActive={false}
              content={({ active, label }) => {
                if (!active || label == null) return null;
                const r = data.find((d) => d.md === label);
                if (!r) return null;
                const rows = [
                  r.predicted != null && { key: 'p', label: `${refYear} CLIMATIQ forecast`, value: t1(r.predicted as number), color: 'var(--viz-model)' },
                  r.ref != null && { key: 'r', label: `${refYear} reanalysis`, value: t1(r.ref as number), color: 'var(--viz-reanalysis)' },
                  r.mean != null && { key: 'm', label: `mean ${span}`, value: t1(r.mean as number), color: 'var(--viz-ink-2)', kind: 'dashed' as const },
                  ...earlier
                    .slice()
                    .reverse()
                    .map((y) => r[`y${y.year}`] != null && { key: `y${y.year}`, label: String(y.year), value: t1(r[`y${y.year}`] as number), color: 'var(--viz-context)' }),
                ].filter(Boolean) as Parameters<typeof TooltipCard>[0]['rows'];
                return <TooltipCard title={monthDayLabel(String(label))} rows={rows.length ? rows : [{ key: 'none', label: 'no data', value: '—' }]} />;
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
