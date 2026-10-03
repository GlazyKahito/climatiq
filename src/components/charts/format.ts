/** Chart-local formatters (UTC-anchored so server and client render identical strings). */

export function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function weekdayDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function monthDayLabel(md: string): string {
  // 'MM-DD' → '27 May' (leap-safe: anchored in a leap year)
  return shortDay(`2024-${md}`);
}

export function monthYear(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function t1(v: number | null | undefined, unit = ' °C'): string {
  return v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}${unit}`;
}

export function signed(v: number | null | undefined, digits = 1, unit = ' °C'): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = v > 0 ? '+' : v < 0 ? '−' : '±';
  return `${s}${Math.abs(v).toFixed(digits)}${unit}`;
}

/** Nice y-domain covering all values, padded and snapped to a clean tick step (1, 2, 5 or 10). */
export function niceDomain(values: (number | null | undefined)[], pad = 1.5, min?: number): [number, number] {
  return niceScale(values, pad, min).domain;
}

/** Domain + evenly spaced ticks on clean numbers (e.g. 30, 35, 40 °C). */
export function niceScale(values: (number | null | undefined)[], pad = 1.5, min?: number): { domain: [number, number]; ticks: number[] } {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  let lo = v.length ? Math.min(...v) - pad : (min ?? 20);
  const hi0 = v.length ? Math.max(...v) + pad : 45;
  if (min != null) lo = Math.min(lo, min);
  const span = hi0 - lo;
  const step = span > 40 ? 10 : span > 14 ? 5 : span > 6 ? 2 : 1;
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi0 / step) * step;
  const ticks: number[] = [];
  for (let t = a; t <= b + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
  return { domain: [a, b], ticks };
}

/** Every k-th category so that at most `max` labels are shown, always ending on the last item. */
export function everyNth<T>(items: T[], max = 8): T[] {
  if (items.length <= max) return items;
  const k = Math.ceil(items.length / max);
  const out: T[] = [];
  for (let i = items.length - 1; i >= 0; i -= k) out.unshift(items[i]);
  return out;
}
