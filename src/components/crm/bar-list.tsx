import Link from 'next/link';
import type { ReactNode } from 'react';

export type BarItem = { key: string; label: ReactNode; value: number; href?: string; hint?: string; secondary?: number };

/**
 * Accessible horizontal bar list (single-hue magnitude bars, value always printed as text, so the list doubles as its
 * own table). Optional `secondary` renders a lighter overlay segment (e.g. active vs total).
 */
export function BarList({ items, unit, secondaryLabel, emptyText = 'No data yet.' }: { items: BarItem[]; unit: string; secondaryLabel?: string; emptyText?: string }) {
  if (!items.length) return <p className="text-sm text-fg-muted">{emptyText}</p>;
  const max = Math.max(1, ...items.map((i) => Math.max(i.value, i.secondary ?? 0)));
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((i) => {
        const title = `${typeof i.label === 'string' ? i.label : i.key}: ${i.value} ${unit}${i.secondary != null ? ` · ${i.secondary} ${secondaryLabel ?? ''}` : ''}${i.hint ? ` — ${i.hint}` : ''}`;
        const row = (
          <div className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3" title={title}>
            <span className="truncate text-sm">{i.label}</span>
            <span className="relative h-2.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--fg)_7%,transparent)]" aria-hidden>
              {i.secondary != null && (
                <span className="absolute inset-y-0 left-0 rounded-full bg-[color-mix(in_srgb,var(--accent)_25%,transparent)]" style={{ width: `${(i.secondary / max) * 100}%` }} />
              )}
              <span className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(i.value / max) * 100}%`, minWidth: i.value > 0 ? 4 : 0 }} />
            </span>
            <span className="text-right text-sm font-semibold tabular">
              {i.value}
              {i.secondary != null && <span className="font-normal text-fg-subtle"> / {i.secondary}</span>}
            </span>
          </div>
        );
        return (
          <li key={i.key}>
            {i.href ? (
              <Link href={i.href} className="block rounded-lg px-1 py-0.5 hover:bg-accent-soft">
                {row}
              </Link>
            ) : (
              <div className="px-1 py-0.5">{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
