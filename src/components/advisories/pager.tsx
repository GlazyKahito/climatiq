import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Offset pagination via links (keeps all other query params). */
export function Pager({ total, limit, offset, params, path }: { total: number; limit: number; offset: number; params: Record<string, string>; path: string }) {
  if (total <= limit) return total > 0 ? <p className="text-xs text-fg-subtle">{total} shown</p> : null;
  const href = (o: number) => `${path}?${new URLSearchParams({ ...params, offset: String(o) }).toString()}`;
  const prev = Math.max(offset - limit, 0);
  const next = offset + limit;
  const btn = 'inline-flex h-8 items-center gap-1 rounded-xl px-3 text-xs font-medium glass hover:bg-glass-strong';
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-fg-muted tabular">
        {offset + 1}–{Math.min(offset + limit, total)} of {total}
      </p>
      <div className="flex gap-1.5">
        {offset > 0 ? (
          <Link href={href(prev)} className={btn} scroll={false}>
            <ChevronLeft aria-hidden className="size-3.5" /> Previous
          </Link>
        ) : (
          <span className={cn(btn, 'pointer-events-none opacity-40')} aria-disabled>
            <ChevronLeft aria-hidden className="size-3.5" /> Previous
          </span>
        )}
        {next < total ? (
          <Link href={href(next)} className={btn} scroll={false}>
            Next <ChevronRight aria-hidden className="size-3.5" />
          </Link>
        ) : (
          <span className={cn(btn, 'pointer-events-none opacity-40')} aria-disabled>
            Next <ChevronRight aria-hidden className="size-3.5" />
          </span>
        )}
      </div>
    </nav>
  );
}
