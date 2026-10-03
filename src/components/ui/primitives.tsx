import Link from 'next/link';
import { AlertCircle, Inbox, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ComponentProps, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', className?: string) {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-[background,transform,box-shadow,color] duration-200 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] cursor-pointer select-none',
    size === 'sm' && 'h-8 px-3 text-xs',
    size === 'md' && 'h-10 px-4 text-sm',
    size === 'lg' && 'h-12 px-6 text-base',
    variant === 'primary' && 'bg-wine text-sand shadow-[0_8px_24px_-10px_rgba(127,1,31,0.7)] hover:bg-wine-600 dark:bg-accent dark:text-accent-fg',
    variant === 'secondary' && 'glass text-fg hover:bg-glass-strong',
    variant === 'ghost' && 'text-fg-muted hover:bg-accent-soft hover:text-fg',
    variant === 'danger' && 'bg-[#8f1d1d] text-white hover:bg-[#a52525]',
    className,
  );
}

export function Button({ variant, size, className, ...props }: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({ variant, size, className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  as: Tag = 'section',
  footer,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: 'section' | 'div' | 'article' | 'aside';
  footer?: ReactNode;
  id?: string;
}) {
  return (
    <Tag id={id} className={cn('glass rounded-[var(--radius-glass)]', className)} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold tracking-wide text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('px-5 pb-5 pt-3', bodyClassName)}>{children}</div>
      {footer && <footer className="border-t border-line px-5 py-3 text-xs text-fg-muted">{footer}</footer>}
    </Tag>
  );
}

export function MetricCard({
  label,
  value,
  unit,
  hint,
  trend,
  footer,
  className,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  trend?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('glass flex flex-col gap-1 rounded-2xl px-4 py-3.5', className)}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="min-w-0 break-words font-display text-2xl font-bold tabular text-fg">{value}</span>
        {unit && <span className="text-sm text-fg-muted">{unit}</span>}
        {trend && <span className="ml-auto text-xs">{trend}</span>}
      </span>
      {hint && <span className="text-xs text-fg-muted">{hint}</span>}
      {footer && <div className="mt-1">{footer}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center">
      <Inbox aria-hidden className="size-6 text-fg-subtle" />
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-md text-sm text-fg-muted">{children}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', children, retryHref }: { title?: string; children?: ReactNode; retryHref?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-line-strong px-6 py-10 text-center">
      <AlertCircle aria-hidden className="size-6 text-accent" />
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-md text-sm text-fg-muted">{children}</div>}
      {retryHref && (
        <LinkButton href={retryHref} variant="secondary" size="sm">
          <RotateCcw className="size-3.5" aria-hidden /> Retry
        </LinkButton>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-xl bg-accent-soft', className)} />;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">{eyebrow}</p>}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const fieldBase =
  'w-full rounded-xl border border-line-strong bg-glass-strong px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30';

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-semibold text-fg-muted">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-fg-subtle">{hint}</p>}
      {error && (
        <p className="text-xs font-medium text-accent" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input(props: ComponentProps<'input'>) {
  return <input {...props} className={cn(fieldBase, props.className)} />;
}
export function Select(props: ComponentProps<'select'>) {
  return <select {...props} className={cn(fieldBase, 'pr-8', props.className)} />;
}
export function Textarea(props: ComponentProps<'textarea'>) {
  return <textarea {...props} className={cn(fieldBase, 'min-h-24', props.className)} />;
}
