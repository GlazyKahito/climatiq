'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, useScroll, useSpring } from 'motion/react';
import { ArrowRight, Menu, X } from 'lucide-react';
import { LogoMark, Wordmark } from '@/components/shell/logo';
import { heatGradientCss } from '@/components/globe/globe-math';
import { buttonClass } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

export type NavLink = { href: string; label: string };

/** Same-page section links: when Lenis smooth scrolling is on it glides there itself, so Next must not also jump. */
function onSectionLinkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  const url = new URL(e.currentTarget.href);
  if (!url.hash || url.pathname !== window.location.pathname) return;
  if (!document.documentElement.classList.contains('lenis')) return;
  e.preventDefault();
  window.history.replaceState(window.history.state, '', url.pathname + url.hash);
}

export const LANDING_LINKS: NavLink[] = [
  { href: '/#overview', label: 'Overview' },
  { href: '/#platform', label: 'Platform' },
  { href: '/#heat-intelligence', label: 'Heat criteria' },
  { href: '/features', label: 'Features' },
  { href: '/portal', label: 'Public portal' },
  { href: '/methodology', label: 'Methodology' },
];

/** Floating glass navigation for the public pages (landing + features). Motion handles only the mobile sheet. */
export function SiteNav({ links = LANDING_LINKS }: { links?: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const reduce = useReducedMotion();
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 260, damping: 40, restDelta: 0.001 });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
      <nav
        aria-label="Primary"
        className={cn(
          'pointer-events-auto relative mx-auto flex max-w-6xl items-center gap-2 rounded-2xl px-3 py-2 transition-[background,box-shadow,border-color] duration-300 sm:px-4',
          scrolled || open ? 'glass-strong' : 'glass',
        )}
      >
        {/* reading progress: a heat-ramp hairline along the bottom edge of the bar */}
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-x-4 -bottom-px h-[2px] origin-left rounded-full opacity-80"
          style={{ scaleX: reduce ? scrollYProgress : progress, background: heatGradientCss() }}
        />
        <Link href="/" className="flex items-center gap-2 rounded-lg pr-2 text-accent" aria-label="CLIMATIQ home">
          <LogoMark className="size-7" />
          <Wordmark className="text-[13px] text-fg sm:text-sm" />
        </Link>
        <ul className="ml-4 hidden items-center gap-0.5 lg:flex">
          {links.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                onClick={onSectionLinkClick}
                className="rounded-lg px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-accent-soft hover:text-fg"
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/login" className="hidden rounded-lg px-3 py-1.5 text-sm text-fg-muted hover:text-fg sm:inline-flex">
            Sign in
          </Link>
          <Link href="/command" className={buttonClass('primary', 'sm', 'group h-9 px-3.5')}>
            <span className="hidden min-[400px]:inline">Explore Dashboard</span>
            <span className="min-[400px]:hidden">Dashboard</span>
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
          <button
            ref={buttonRef}
            type="button"
            className="grid size-9 place-items-center rounded-lg text-fg-muted hover:bg-accent-soft hover:text-fg lg:hidden"
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="glass-strong pointer-events-auto mx-auto mt-2 max-w-6xl rounded-2xl p-2 lg:hidden"
          >
            <ul className="grid gap-0.5">
              {[...links, { href: '/login', label: 'Sign in' }].map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    onClick={(e) => {
                      onSectionLinkClick(e);
                      setOpen(false);
                    }}
                    className="block rounded-xl px-3 py-2.5 text-sm font-medium text-fg hover:bg-accent-soft"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
