'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useRef, useTransition, type ReactNode } from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

export type FilterField =
  | { name: string; label: string; type: 'select'; options: { value: string; label: string }[]; value?: string; allLabel?: string }
  | { name: string; label: string; type: 'search'; value?: string; placeholder?: string }
  | { name: string; label: string; type: 'checkbox'; value?: string };

const fieldCls =
  'h-9 w-full rounded-xl border border-line-strong bg-glass-strong px-2.5 text-sm text-fg outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30';

/**
 * GET filter form: works without JS (submit button), and with JS applies instantly on change.
 * `hidden` keeps params such as the active tab.
 */
export function FilterForm({ fields, hidden = {}, className, extra }: { fields: FilterField[]; hidden?: Record<string, string>; className?: string; extra?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();

  const apply = () => {
    const form = ref.current;
    if (!form) return;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(hidden)) params.set(k, v);
    for (const [k, v] of new FormData(form).entries()) if (typeof v === 'string' && v !== '' && !(k in hidden)) params.set(k, v);
    start(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  };
  const resetHref = `${pathname}?${new URLSearchParams(hidden).toString()}`;

  return (
    <form
      ref={ref}
      method="get"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      className={cn('flex flex-wrap items-end gap-2', className)}
      aria-busy={pending}
      role="search"
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {fields.map((f) => (
        <div key={f.name} className={cn('flex min-w-0 flex-col gap-1', f.type === 'search' ? 'w-full sm:w-56' : f.type === 'checkbox' ? '' : 'w-[calc(50%-0.25rem)] sm:w-40')}>
          {f.type !== 'checkbox' && (
            <label htmlFor={`f-${f.name}`} className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
              {f.label}
            </label>
          )}
          {f.type === 'select' && (
            <select id={`f-${f.name}`} name={f.name} defaultValue={f.value ?? ''} onChange={apply} className={cn(fieldCls, 'pr-7')}>
              {f.allLabel !== undefined && <option value="">{f.allLabel}</option>}
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {f.type === 'search' && (
            <input id={`f-${f.name}`} type="search" name={f.name} defaultValue={f.value ?? ''} placeholder={f.placeholder} className={fieldCls} />
          )}
          {f.type === 'checkbox' && (
            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-line-strong bg-glass-strong px-3 text-sm">
              <input type="checkbox" name={f.name} value="true" defaultChecked={f.value === 'true'} onChange={apply} className="accent-[var(--accent)]" />
              {f.label}
            </label>
          )}
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <button type="submit" className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-fg glass hover:bg-glass-strong">
          <SlidersHorizontal aria-hidden className="size-3.5" /> Apply
        </button>
        <a href={resetHref} className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-fg-muted hover:bg-accent-soft hover:text-fg">
          <RotateCcw aria-hidden className="size-3.5" /> Reset
        </a>
        {extra}
      </div>
      {pending && (
        <span role="status" className="text-xs text-fg-subtle">
          Updating…
        </span>
      )}
    </form>
  );
}
