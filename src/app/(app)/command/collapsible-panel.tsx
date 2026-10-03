'use client';

import { useId, useSyncExternalStore, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

const KEY = 'cq.command.collapsed';

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

const EVENT = 'cq:command-collapsed';
function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/** Glass panel whose body can be collapsed (state remembered per panel in localStorage). */
export function CollapsiblePanel({
  id,
  title,
  description,
  icon,
  badge,
  children,
  defaultOpen = true,
  className,
  footer,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  footer?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const bodyId = useId();
  // Remembered state lives in localStorage (external store); the server render uses `defaultOpen`.
  const stored = useSyncExternalStore(
    subscribe,
    () => {
      const v = readCollapsed()[id];
      return v === undefined ? 'unset' : v ? 'collapsed' : 'open';
    },
    () => 'unset' as const,
  );
  const open = stored === 'unset' ? defaultOpen : stored === 'open';
  const toggle = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...readCollapsed(), [id]: open }));
    } catch {
      /* storage unavailable — the panel simply won't remember its state */
    }
    window.dispatchEvent(new Event(EVENT));
  };

  return (
    <section className={cn('glass rounded-[var(--radius-glass)]', className)} aria-labelledby={`${bodyId}-h`}>
      <h2 id={`${bodyId}-h`} className="m-0">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex w-full items-center gap-2 rounded-[var(--radius-glass)] px-4 py-3 text-left"
        >
          {icon && <span className="text-accent">{icon}</span>}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold tracking-wide text-fg">{title}</span>
            {description && <span className="block text-xs font-normal text-fg-muted">{description}</span>}
          </span>
          {badge}
          <ChevronDown className={cn('size-4 shrink-0 text-fg-muted transition-transform', !open && '-rotate-90')} aria-hidden />
        </button>
      </h2>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={bodyId}
            key="body"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">{children}</div>
            {footer && <div className="border-t border-line px-4 py-2.5 text-[11px] text-fg-muted">{footer}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
