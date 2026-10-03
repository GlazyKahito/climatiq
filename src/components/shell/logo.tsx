import { cn } from '@/lib/utils';

/** CLIMATIQ mark: a stylised globe with a heat arc. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden>
      <defs>
        <linearGradient id="cq-heat" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#7F011F" />
          <stop offset="0.6" stopColor="#D1501A" />
          <stop offset="1" stopColor="#E1C98D" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.2" />
      <ellipse cx="16" cy="16" rx="6" ry="13" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.2" />
      <path d="M3 16h26" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.2" />
      <path d="M5.5 22.5A13 13 0 0 1 22 4.4" fill="none" stroke="url(#cq-heat)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="20.5" cy="13.5" r="2.4" fill="#7F011F" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={cn('font-display text-[15px] font-bold tracking-[0.22em]', className)}>CLIMATIQ</span>;
}
