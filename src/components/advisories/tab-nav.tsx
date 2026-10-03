import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type TabItem = { key: string; label: string; href: string; count?: number | null; icon?: ReactNode; tour?: string };

/** Link-based tabs (server-rendered, works without JS). */
export function TabNav({ items, active, label }: { items: TabItem[]; active: string; label: string }) {
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto px-1">
      <ul className="glass inline-flex min-w-max items-center gap-1 rounded-2xl p-1">
        {items.map((t) => {
          const on = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={on ? 'page' : undefined}
                data-tour={t.tour}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition',
                  on ? 'bg-wine text-sand shadow-sm dark:bg-accent dark:text-accent-fg' : 'text-fg-muted hover:bg-accent-soft hover:text-fg',
                )}
              >
                {t.icon}
                {t.label}
                {t.count != null && t.count > 0 && (
                  <span className={cn('rounded-full px-1.5 text-[11px] font-bold tabular', on ? 'bg-sand/20' : 'bg-accent-soft text-accent')}>{t.count > 999 ? '999+' : t.count}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
