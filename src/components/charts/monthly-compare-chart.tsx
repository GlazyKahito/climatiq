'use client';

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ReactNode } from 'react';
import { ChartFrame, Legend, LegendItem, TooltipCard } from './chart-frame';
import { MONTHS, niceScale, t1 } from './format';

export type MonthlyRegion = { code: string; name: string; slot: number; months: Record<string, number | null> };

const label = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

/** Regional comparison: monthly mean Tmax per region (≤ 4 categorical series, one °C axis). */
export function MonthlyCompareChart({ months, regions, provenance, footnote }: { months: string[]; regions: MonthlyRegion[]; provenance?: ReactNode; footnote?: ReactNode }) {
  const data = months.map((m) => {
    const row: Record<string, string | number | null> = { m };
    for (const r of regions) row[r.code] = r.months[m] ?? null;
    return row;
  });
  const { domain, ticks } = niceScale(regions.flatMap((r) => Object.values(r.months)), 1);
  const summary = regions
    .map((r) => {
      const vals = Object.entries(r.months).filter(([, v]) => v != null) as [string, number][];
      const hottest = vals.reduce<[string, number] | null>((a, b) => (a == null || b[1] > a[1] ? b : a), null);
      return `${r.name}: ${vals.length} months with data${hottest ? `, hottest ${label(hottest[0])} at ${t1(hottest[1])}` : ''}`;
    })
    .join('; ');
  return (
    <ChartFrame
      title="Monthly mean daily maximum temperature"
      description="°C · months with at least 10 days of data"
      summary={`Monthly mean Tmax by region. ${summary}.`}
      provenance={provenance}
      footnote={footnote}
      table={{
        caption: 'Monthly mean Tmax by region (°C)',
        columns: ['Month', ...regions.map((r) => `${r.name} (°C)`)],
        rows: months.map((m) => [label(m), ...regions.map((r) => r.months[m] ?? null)]),
        numeric: regions.map((_, i) => i + 1),
      }}
      legend={
        <Legend>
          {regions.map((r) => (
            <LegendItem key={r.code} label={r.name} color={`var(--viz-${r.slot + 1})`} />
          ))}
        </Legend>
      }
    >
      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="m" tickFormatter={label} tickLine={false} interval="preserveStartEnd" minTickGap={20} tickMargin={6} />
            <YAxis domain={domain} ticks={ticks} tickLine={false} axisLine={false} width={50} allowDecimals={false} tickFormatter={(v: number) => `${v}°C`} />
            {regions.map((r) => (
              <Line
                key={r.code}
                dataKey={r.code}
                stroke={`var(--viz-${r.slot + 1})`}
                strokeWidth={2}
                strokeLinecap="round"
                dot={false}
                activeDot={{ r: 4, fill: `var(--viz-${r.slot + 1})`, stroke: 'var(--viz-surface)', strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
            <Tooltip
              cursor={{ stroke: 'var(--viz-axis)', strokeWidth: 1 }}
              isAnimationActive={false}
              content={({ active, label: l }) => {
                if (!active || l == null) return null;
                const row = data.find((d) => d.m === l);
                if (!row) return null;
                return (
                  <TooltipCard
                    title={label(String(l))}
                    rows={regions.map((r) => ({ key: r.code, label: r.name, value: t1(row[r.code] as number | null), color: `var(--viz-${r.slot + 1})` }))}
                  />
                );
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
