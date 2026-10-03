'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useLocalFlag } from '@/lib/use-local-flag';
import { ChevronsLeft, Menu, X } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import type { NavItem } from '@/lib/nav';
import { NAV_ICONS } from './icons';
import { LogoMark, Wordmark } from './logo';
import { Topbar, type TopbarProps } from './topbar';
import { GuidedTour } from '@/components/tour/guided-tour';

export type ShellProps = {
  nav: NavItem[];
  secondaryNav: NavItem[];
  topbar: TopbarProps;
  tour: { allowedRoutes: string[]; autoStart: boolean };
  children: ReactNode;
};

const COLLAPSE_KEY = 'cq.sidebar.collapsed';

export function AppShell({ nav, secondaryNav, topbar, tour, children }: ShellProps) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const [collapsed, setCollapsed] = useLocalFlag(COLLAPSE_KEY);
  // The drawer is "open for a path": navigating anywhere else closes it without an effect.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const mobileOpen = drawerPath === pathname;
  const setMobileOpen = (open: boolean) => setDrawerPath(open ? pathname : null);

  const toggle = () => setCollapsed(!collapsed);

  const navList = (compact: boolean) => (
    <nav aria-label="Primary" className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-2">
      <ul className="flex flex-col gap-1">
        {nav.map((item) => (
          <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} compact={compact} />
        ))}
      </ul>
      <div>
        {!compact && <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-fg-subtle">More</p>}
        <ul className="flex flex-col gap-1">
          {secondaryNav.map((item) => (
            <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} compact={compact} />
          ))}
        </ul>
      </div>
    </nav>
  );

  return (
    <div className="atmosphere relative flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-wine focus:px-3 focus:py-2 focus:text-sand">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <motion.aside
        data-tour="sidebar"
        className="glass sticky top-3 z-30 m-3 hidden h-[calc(100dvh-1.5rem)] shrink-0 flex-col rounded-[1.5rem] lg:flex"
        animate={{ width: collapsed ? 76 : 264 }}
        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 34 }}
      >
        <div className={cn('flex items-center gap-2 px-4 pb-3 pt-4', collapsed && 'justify-center px-2')}>
          <Link href="/" className="flex items-center gap-2 text-accent" aria-label="CLIMATIQ home">
            <LogoMark />
            {!collapsed && <Wordmark className="text-fg" />}
          </Link>
        </div>
        {navList(collapsed)}
        <div className="border-t border-line p-3">
          <button
            type="button"
            onClick={toggle}
            className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs text-fg-muted hover:bg-accent-soft hover:text-fg"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
          >
            <ChevronsLeft className={cn('size-4 transition-transform', collapsed && 'rotate-180')} aria-hidden />
            {!collapsed && 'Collapse'}
          </button>
        </div>
      </motion.aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              className="glass-strong fixed inset-y-0 left-0 z-50 flex w-72 flex-col rounded-r-3xl lg:hidden"
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 360, damping: 36 }}
              aria-label="Navigation"
            >
              <div className="flex items-center justify-between px-4 pb-3 pt-4">
                <Link href="/" className="flex items-center gap-2 text-accent">
                  <LogoMark />
                  <Wordmark className="text-fg" />
                </Link>
                <button type="button" onClick={() => setMobileOpen(false)} className="rounded-lg p-2 hover:bg-accent-soft" aria-label="Close navigation">
                  <X className="size-5" />
                </button>
              </div>
              {navList(false)}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-20 px-3 pt-3 lg:pl-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="glass rounded-xl p-2.5 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="size-5" />
            </button>
            <Topbar {...topbar} />
          </div>
        </div>
        <main id="main" className="min-w-0 flex-1 px-3 pb-10 pt-4 lg:pl-0 lg:pr-4">
          {children}
        </main>
      </div>
      <GuidedTour allowedRoutes={tour.allowedRoutes} autoStart={tour.autoStart} />
    </div>
  );
}

function NavLink({ item, active, compact }: { item: NavItem; active: boolean; compact: boolean }) {
  const Icon = NAV_ICONS[item.icon];
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        title={compact ? item.label : item.description}
        className={cn(
          'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
          compact && 'justify-center px-0',
          active ? 'bg-wine text-sand shadow-[0_10px_24px_-14px_rgba(127,1,31,0.9)] dark:bg-accent dark:text-accent-fg' : 'text-fg-muted hover:bg-accent-soft hover:text-fg',
        )}
      >
        {Icon && <Icon className="size-[18px] shrink-0" aria-hidden />}
        {!compact && <span className="truncate">{item.label}</span>}
        {compact && <span className="sr-only">{item.label}</span>}
      </Link>
    </li>
  );
}
