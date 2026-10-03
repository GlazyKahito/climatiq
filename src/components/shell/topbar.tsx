'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { Bell, ChevronRight, CircleHelp, History, LogOut, MapPin, Radio, Search, UserRound, Users } from 'lucide-react';
import { restartTour } from '@/components/tour/guided-tour';
import { cn } from '@/lib/utils';
import { fmtRelative, type Severity } from '@/lib/domain';
import { SeverityBadge, DemoTag } from '@/components/ui/badges';
import { demoLogin, logout, setScenario } from '@/app/actions/session';
import { markNotificationsRead } from '@/app/actions/inbox';

export type TopbarProps = {
  user: { name: string; designation: string | null; roleLabel: string; scopeLabel: string; isDemo: boolean };
  scenario: 'live' | 'replay';
  replayLabel: string;
  inbox: {
    unread: number;
    items: { id: string; title: string; body: string; link: string | null; createdAt: string; read: boolean; severity: Severity | null }[];
  };
  demoAccounts: { id: string; name: string; roleLabel: string; scopeLabel: string }[] | null;
};

const SEGMENT_LABELS: Record<string, string> = {
  command: 'Command center',
  forecasts: 'Heatwave prediction',
  stations: 'Weather stations',
  advisories: 'Advisories & alerts',
  alerts: 'Alerts',
  response: 'Response CRM',
  incidents: 'Incidents',
  analytics: 'Climate analytics',
  admin: 'Administration',
  settings: 'Profile & settings',
};

export function Topbar(props: TopbarProps) {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  return (
    <header className="glass-strong flex min-w-0 flex-1 items-center gap-2 rounded-2xl px-3 py-2">
      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-sm md:flex">
        {segments.map((seg, i) => {
          const href = '/' + segments.slice(0, i + 1).join('/');
          const label = SEGMENT_LABELS[seg] ?? decodeURIComponent(seg);
          const last = i === segments.length - 1;
          return (
            <span key={href} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />}
              {last ? (
                <span aria-current="page" className="truncate font-semibold">
                  {label}
                </span>
              ) : (
                <Link href={href} className="truncate text-fg-muted hover:text-fg">
                  {label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-1.5">
        <RegionSearch />
        <ScenarioSwitch scenario={props.scenario} replayLabel={props.replayLabel} />
        <button type="button" onClick={() => restartTour()} className="hidden rounded-xl p-2 text-fg-muted hover:bg-accent-soft hover:text-fg sm:block" aria-label="Start guided tour" title="Guided tour">
          <CircleHelp className="size-[18px]" aria-hidden />
        </button>
        <NotificationsMenu inbox={props.inbox} />
        <UserMenu user={props.user} demoAccounts={props.demoAccounts} />
      </div>
    </header>
  );
}

function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

type RegionHit = { code: string; name: string; level: string; parentName: string | null; isPilot: boolean };

function RegionSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<RegionHit[]>([]);
  const [active, setActive] = useState(0);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const listId = useId();

  const queryReady = q.trim().length >= 2;
  const visibleHits = queryReady ? hits : [];

  useEffect(() => {
    if (!queryReady) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/regions?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.ok) {
          setHits(((await res.json()) as { data: RegionHit[] }).data);
          setActive(0);
        }
      } catch {
        /* aborted */
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, queryReady]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.querySelector('input')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ref]);

  const go = (h: RegionHit) => {
    setOpen(false);
    setQ('');
    router.push(`/forecasts/${h.code}`);
  };

  return (
    <div ref={ref} className="relative" data-tour="search">
      <div className="flex items-center gap-2 rounded-xl border border-line bg-glass-strong px-2.5 py-1.5 focus-within:border-accent">
        <Search className="size-4 text-fg-subtle" aria-hidden />
        <input
          type="search"
          role="combobox"
          aria-expanded={open && visibleHits.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Search states, districts and cities"
          placeholder="Search location…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, visibleHits.length - 1));
            if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
            if (e.key === 'Enter' && visibleHits[active]) go(visibleHits[active]);
          }}
          className="w-28 bg-transparent text-sm outline-none placeholder:text-fg-subtle sm:w-44"
        />
        <kbd className="hidden rounded border border-line px-1 text-[10px] text-fg-subtle sm:inline">Ctrl K</kbd>
      </div>
      {open && visibleHits.length > 0 && (
        <ul id={listId} role="listbox" className="glass-strong absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-2xl p-1.5">
          {visibleHits.map((h, i) => (
            <li key={h.code} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h)}
                className={cn('flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm', i === active && 'bg-accent-soft')}
              >
                <MapPin className="size-4 shrink-0 text-accent" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{h.name}</span>
                  <span className="block truncate text-xs capitalize text-fg-muted">
                    {h.level}
                    {h.parentName ? ` · ${h.parentName}` : ''}
                  </span>
                </span>
                {h.isPilot && <span className="rounded bg-accent-soft px-1.5 text-[10px] font-semibold text-accent">PILOT</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScenarioSwitch({ scenario, replayLabel }: { scenario: 'live' | 'replay'; replayLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div role="radiogroup" aria-label="Data scenario" className="hidden items-center rounded-xl border border-line bg-glass-strong p-0.5 text-xs sm:flex" data-tour="scenario">
      {(
        [
          ['live', 'Live', Radio, 'Current real data and CLIMATIQ forecasts for today'],
          ['replay', 'Replay', History, replayLabel],
        ] as const
      ).map(([value, label, Icon, title]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={scenario === value}
          title={title}
          disabled={pending}
          onClick={() =>
            start(async () => {
              await setScenario(value);
              router.refresh();
            })
          }
          className={cn('flex items-center gap-1 rounded-lg px-2 py-1 font-semibold transition', scenario === value ? 'bg-wine text-sand dark:bg-accent dark:text-accent-fg' : 'text-fg-muted hover:text-fg')}
        >
          <Icon className="size-3.5" aria-hidden /> {label}
        </button>
      ))}
    </div>
  );
}

function NotificationsMenu({ inbox }: { inbox: TopbarProps['inbox'] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative" data-tour="notifications">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-xl p-2 text-fg-muted hover:bg-accent-soft hover:text-fg"
        aria-label={`Notifications, ${inbox.unread} unread`}
        aria-expanded={open}
      >
        <Bell className="size-[18px]" aria-hidden />
        {inbox.unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-wine px-1 text-[10px] font-bold text-sand dark:bg-accent dark:text-accent-fg">
            {inbox.unread > 99 ? '99+' : inbox.unread}
          </span>
        )}
      </button>
      {open && (
        <div className="glass-strong absolute right-0 top-11 z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-2xl p-2">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-sm font-semibold">Notifications</p>
            {inbox.unread > 0 && (
              <button
                type="button"
                className="text-xs font-medium text-accent hover:underline"
                onClick={async () => {
                  await markNotificationsRead('all');
                  router.refresh();
                }}
              >
                Mark all read
              </button>
            )}
          </div>
          <p className="px-2 pb-1 text-[11px] text-fg-subtle">In-app only · CLIMATIQ-generated, not official warnings</p>
          {inbox.items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-fg-muted">You&apos;re all caught up.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {inbox.items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.link ?? '/advisories'}
                    onClick={() => {
                      setOpen(false);
                      if (!n.read) void markNotificationsRead([n.id]);
                    }}
                    className={cn('flex flex-col gap-1 rounded-xl px-2 py-2 hover:bg-accent-soft', !n.read && 'bg-accent-soft/60')}
                  >
                    <span className="flex items-center gap-2">
                      {!n.read && <span className="size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{n.title}</span>
                      {n.severity && <SeverityBadge severity={n.severity} size="sm" />}
                    </span>
                    <span className="line-clamp-2 text-xs text-fg-muted">{n.body}</span>
                    <span className="text-[11px] text-fg-subtle">{fmtRelative(n.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/advisories?tab=notifications" onClick={() => setOpen(false)} className="mt-1 block rounded-xl px-2 py-2 text-center text-xs font-semibold text-accent hover:bg-accent-soft">
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}

function UserMenu({ user, demoAccounts }: { user: TopbarProps['user']; demoAccounts: TopbarProps['demoAccounts'] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('');
  return (
    <div ref={ref} className="relative" data-tour="user-menu">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 hover:bg-accent-soft"
      >
        <span className="grid size-8 place-items-center rounded-lg bg-wine font-heading text-xs font-bold text-sand dark:bg-accent dark:text-accent-fg">{initials}</span>
        <span className="hidden text-left leading-tight xl:block">
          <span className="block max-w-36 truncate text-xs font-semibold">{user.name}</span>
          <span className="block max-w-36 truncate text-[11px] text-fg-muted">{user.roleLabel}</span>
        </span>
      </button>
      {open && (
        <div className="glass-strong absolute right-0 top-11 z-50 w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl p-2">
          <div className="px-2 py-2">
            <p className="text-sm font-semibold">{user.name}</p>
            <p className="text-xs text-fg-muted">{user.designation}</p>
            <p className="mt-1 text-xs">
              <span className="font-medium">{user.roleLabel}</span> · <span className="text-fg-muted">{user.scopeLabel}</span>
            </p>
            {user.isDemo && <DemoTag className="mt-2" label="Fictional demo account" />}
          </div>
          <Link href="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm hover:bg-accent-soft">
            <UserRound className="size-4" aria-hidden /> Profile & settings
          </Link>
          {demoAccounts && demoAccounts.length > 0 && (
            <div className="mt-1 border-t border-line pt-2" data-tour="role-switcher">
              <p className="flex items-center gap-1.5 px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                <Users className="size-3.5" aria-hidden /> Demo · switch role
              </p>
              <ul className="max-h-64 overflow-y-auto">
                {demoAccounts.map((a) => (
                  <li key={a.id}>
                    <form action={demoLogin}>
                      <input type="hidden" name="userId" value={a.id} />
                      <input type="hidden" name="next" value={pathname} />
                      <button type="submit" className="flex w-full flex-col rounded-xl px-2 py-1.5 text-left hover:bg-accent-soft">
                        <span className="text-xs font-semibold">{a.roleLabel}</span>
                        <span className="text-[11px] text-fg-muted">
                          {a.name} · {a.scopeLabel}
                        </span>
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <form action={logout} className="mt-1 border-t border-line pt-1">
            <button type="submit" className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm text-fg-muted hover:bg-accent-soft hover:text-fg">
              <LogOut className="size-4" aria-hidden /> Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
