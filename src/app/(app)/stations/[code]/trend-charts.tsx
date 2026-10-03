'use client';

/**
 * 7-day station trend: two single-series charts (temperature, humidity) on a shared time axis — never a dual-axis
 * chart. Gaps in reporting stay visible as gaps. Values are labelled with their provenance by the parent panel.
 */
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useIsDark } from '@/components/map/geo';

export type TrendPoint = { t: number; temp: number | null; rh: number | null; suspect: boolean };

const IST = 'Asia/Kolkata';
const fmtTick = (t: number) => new Date(t).toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short' });
const fmtFull = (t: number) =>
  new Date(t).toLocaleString('en-IN', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' IST';

/** Inserts null points where consecutive reports are > 90 min apart so the line breaks at outages. */
export function withGaps(points: TrendPoint[], maxGapMs = 90 * 60_000): TrendPoint[] {
  const out: TrendPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i > 0 && points[i].t - points[i - 1].t > maxGapMs) out.push({ t: points[i - 1].t + 60 * 60_000, temp: null, rh: null, suspect: false });
    out.push(points[i]);
  }
  return out;
}

function Chart({
  data,
  dataKey,
  unit,
  color,
  domain,
  label,
  dark,
  showAxis,
}: {
  data: TrendPoint[];
  dataKey: 'temp' | 'rh';
  unit: string;
  color: string;
  domain: [number | 'auto' | 'dataMin', number | 'auto' | 'dataMax'];
  label: string;
  dark: boolean;
  showAxis: boolean;
}) {
  const ink = dark ? '#cdb9a4' : '#5f454a';
  const grid = dark ? 'rgba(245,235,208,0.10)' : 'rgba(127,1,31,0.10)';
  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-xs font-semibold text-fg-muted">{label}</figcaption>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }} syncId="station-trend">
            <CartesianGrid stroke={grid} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={fmtTick}
              tick={{ fill: ink, fontSize: 11 }}
              stroke={grid}
              hide={!showAxis}
              minTickGap={24}
            />
            <YAxis domain={domain} tick={{ fill: ink, fontSize: 11 }} stroke={grid} width={44} unit={unit} allowDecimals={false} />
            <Tooltip
              labelFormatter={(t) => fmtFull(Number(t))}
              formatter={(v) => (v == null ? ['no report', label] : [`${Number(v).toFixed(1)}${unit}`, label])}
              contentStyle={{
                background: dark ? 'rgba(30,10,16,0.95)' : 'rgba(255,252,244,0.97)',
                border: `1px solid ${grid}`,
                borderRadius: 10,
                fontSize: 12,
                color: dark ? '#f5ebd0' : '#22070e',
              }}
              cursor={{ stroke: ink, strokeDasharray: '3 3' }}
            />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export function TrendCharts({ points }: { points: TrendPoint[] }) {
  const dark = useIsDark();
  const data = withGaps(points);
  const hasRh = points.some((p) => p.rh != null);
  return (
    <div className="flex flex-col gap-3">
      <Chart data={data} dataKey="temp" unit=" °C" color={dark ? '#ff8aa0' : '#7f011f'} domain={['auto', 'auto']} label="Air temperature (°C)" dark={dark} showAxis={!hasRh} />
      {hasRh && <Chart data={data} dataKey="rh" unit=" %" color={dark ? '#7fb2e5' : '#2f5d8a'} domain={[0, 100]} label="Relative humidity (%)" dark={dark} showAxis />}
    </div>
  );
}
