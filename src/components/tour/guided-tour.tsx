'use client';

/**
 * Interactive, multi-page guided walkthrough of the demo story.
 * - Steps point at `[data-tour="…"]` anchors; when an anchor is missing the step is shown as a centred card.
 * - Steps on modules the current role cannot open are skipped automatically.
 * - Skippable, restartable (from Settings or the help button), keyboard accessible (Esc closes, ←/→ navigate),
 *   respects reduced motion. Progress is kept in localStorage (wrapped in try/catch).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';

type Step = { route?: string; target?: string; title: string; body: string };

const STEPS: Step[] = [
  {
    route: '/command',
    title: 'Welcome to CLIMATIQ',
    body: 'A climate-intelligence command center for heatwaves in India. Everything here is decision support — CLIMATIQ forecasts and advisories are never official IMD warnings. This tour follows a real event: the late-May 2024 North-India heatwave.',
  },
  {
    route: '/command',
    target: 'scenario',
    title: 'Live data or historical replay',
    body: 'Live shows today’s real data and forecasts. Replay rebuilds 26 May 2024 from real ERA5 reanalysis and the weather-model forecasts as issued then — so you can see how CLIMATIQ would have flagged the heatwave. Incidents and people in the demo are fictional.',
  },
  { route: '/command', target: 'map', title: 'Nationwide heat map', body: 'States are coloured by forecast heat risk for the selected day, with a heat layer from a 1° grid. Click a pilot state to drill down to its districts; every colour also has a text label and there is a table view.' },
  { route: '/command', target: 'metrics', title: 'What matters right now', body: 'Hottest forecast, how many regions reach High or Extreme, active alerts, station status and data freshness — each with its source and last-updated time.' },
  {
    route: '/forecasts/IN-RJ-CHURU',
    target: 'forecast-chart',
    title: 'Inspect a forecast',
    body: 'Churu, Rajasthan: predicted maximum with its uncertainty band, the weather-model guidance and the reference normal. Severity follows IMD heatwave criteria as estimated by CLIMATIQ; confidence is a heuristic, not a probability.',
  },
  { route: '/forecasts/IN-RJ-CHURU', target: 'forecast-factors', title: 'Why the risk is high', body: 'Contributing factors explain each forecast: departure from normal, persistent heat, dry air, warm nights and the guidance used.' },
  { route: '/advisories', target: 'advisories', title: 'AI-assisted advisories', body: 'Advisories are generated from the validated forecast for four audiences, start as drafts and must be approved by an authorised official before publication. If the AI service is unavailable a deterministic template is used.' },
  { route: '/advisories', target: 'alerts', title: 'Automated alerts', body: 'Each forecast run raises de-duplicated alerts for regions meeting the configured severity and confidence rules, and notifies the responsible teams in-app.' },
  { route: '/response', target: 'crm', title: 'Coordinate the response', body: 'Turn alerts into incidents, assign teams and officials, track tasks and deadlines, and keep an audited activity timeline.' },
  { route: '/analytics', target: 'accuracy', title: 'History and accuracy', body: 'Five years of history, heatwave frequency, regional comparisons — and how the replay hindcast compared with what actually happened.' },
  { route: '/stations', target: 'stations', title: 'Weather stations', body: 'No physical stations are deployed yet: demo stations are clearly marked SIMULATED. Real IoT stations can already send observations through the authenticated REST ingestion API.' },
  { target: 'notifications', title: 'Notifications', body: 'Alerts and assignments for your regions arrive here. Delivery is in-app only in this prototype.' },
  { target: 'user-menu', title: 'Switch roles', body: 'In demo mode you can switch between fictional accounts — state administrator, field responder, analyst, public user — and see permissions and regions change.' },
  { title: 'You’re ready', body: 'Explore freely. The public portal shows what citizens see, and the methodology page explains every source, method and limitation. Restart this tour any time from Settings.' },
];

const KEY = 'cq.tour.v1';
const EVENT = 'cq:tour:restart';

type Saved = { status: 'active' | 'done'; step: number };

/** In-memory fallback so the tour still works when storage is blocked (progress is then not remembered). */
let memory = '';

function readRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return memory;
  }
}
function parse(raw: string): Saved | null {
  try {
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}
function save(s: Saved) {
  const raw = JSON.stringify(s);
  try {
    localStorage.setItem(KEY, raw);
  } catch {
    memory = raw;
  }
  window.dispatchEvent(new Event(EVENT));
}
function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/** Restart the tour from anywhere (Settings button, help button). */
export function restartTour() {
  save({ status: 'active', step: 0 });
}

export function GuidedTour({ allowedRoutes, autoStart }: { allowedRoutes: string[]; autoStart: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const steps = useMemo(() => STEPS.filter((s) => !s.route || allowedRoutes.some((r) => s.route!.startsWith(r))), [allowedRoutes]);
  const raw = useSyncExternalStore(subscribe, readRaw, () => '');
  const state = useMemo(() => parse(raw), [raw]);
  const [spot, setSpot] = useState<{ key: string; rect: DOMRect } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // First demo sign-in: start the tour once (writes to the external store; no local state involved).
  useEffect(() => {
    if (autoStart && readRaw() === '') save({ status: 'active', step: 0 });
  }, [autoStart]);

  const active = state?.status === 'active';
  const index = Math.min(state?.step ?? 0, steps.length - 1);
  const step = steps[index];
  const spotKey = `${index}:${pathname}`;
  const rect = spot?.key === spotKey ? spot.rect : null;

  const go = useCallback(
    (next: number) => {
      if (next >= steps.length) {
        save({ status: 'done', step: 0 });
        return;
      }
      save({ status: 'active', step: Math.max(0, next) });
    },
    [steps.length],
  );
  const close = useCallback(() => go(steps.length), [go, steps.length]);

  // Navigate to the step's route when needed.
  useEffect(() => {
    if (!active || !step?.route) return;
    if (!pathname.startsWith(step.route)) router.push(step.route);
  }, [active, step, pathname, router]);

  // Locate the target element (it may render after navigation / data loading).
  useLayoutEffect(() => {
    if (!active || !step?.target) return;
    let tries = 0;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout>;
    const find = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
        const update = () => setSpot({ key: spotKey, rect: el.getBoundingClientRect() });
        update();
        const onScroll = () => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(update);
        };
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
        cleanup = () => {
          window.removeEventListener('scroll', onScroll, true);
          window.removeEventListener('resize', onScroll);
        };
        setTimeout(update, 400);
      } else if (tries++ < 25) timer = setTimeout(find, 120);
    };
    let cleanup = () => {};
    find();
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      cleanup();
    };
  }, [active, step, spotKey, reduce]);

  useEffect(() => {
    if (!active) return;
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') go(index + 1);
      if (e.key === 'ArrowLeft') go(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, index, go, close]);

  if (!active || !step) return null;

  const pad = 8;
  const spotlight = rect ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : null;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const cardW = Math.min(380, vw - 24);
  let cardPos: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  if (spotlight) {
    const below = spotlight.top + spotlight.height + 12;
    const fitsBelow = below + 220 < vh;
    const top = fitsBelow ? below : Math.max(12, spotlight.top - 232);
    const left = Math.min(Math.max(12, spotlight.left), vw - cardW - 12);
    cardPos = { left, top };
  }

  return (
    <div className="fixed inset-0 z-[60]" aria-live="polite">
      {/* dimmer with spotlight cut-out */}
      <svg className="pointer-events-auto absolute inset-0 h-full w-full" aria-hidden onClick={close}>
        <defs>
          <mask id="cq-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {spotlight && <rect x={spotlight.left} y={spotlight.top} width={spotlight.width} height={spotlight.height} rx={16} fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(20,4,9,0.55)" mask="url(#cq-tour-mask)" />
        {spotlight && <rect x={spotlight.left} y={spotlight.top} width={spotlight.width} height={spotlight.height} rx={16} fill="none" stroke="#F5EBD0" strokeWidth={2} />}
      </svg>
      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          ref={cardRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cq-tour-title"
          aria-describedby="cq-tour-body"
          className="glass-strong absolute rounded-2xl p-5 outline-none"
          style={{ ...cardPos, width: cardW }}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -6 }}
          transition={{ duration: 0.22 }}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
              Guided tour · {index + 1} / {steps.length}
            </p>
            <button type="button" onClick={close} className="-m-1 rounded-lg p-1 text-fg-muted hover:bg-accent-soft hover:text-fg" aria-label="Close tour">
              <X className="size-4" />
            </button>
          </div>
          <h2 id="cq-tour-title" className="mt-1 text-lg font-semibold">
            {step.title}
          </h2>
          <p id="cq-tour-body" className="mt-1 text-sm text-fg-muted">
            {step.body}
          </p>
          <div className="mt-4 flex items-center justify-between gap-2">
            <button type="button" onClick={close} className="text-xs font-medium text-fg-muted hover:text-fg hover:underline">
              Skip tour
            </button>
            <div className="flex gap-2">
              {index > 0 && (
                <button type="button" onClick={() => go(index - 1)} className="inline-flex items-center gap-1 rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-accent-soft">
                  <ArrowLeft className="size-4" aria-hidden /> Back
                </button>
              )}
              <button type="button" onClick={() => go(index + 1)} className="inline-flex items-center gap-1 rounded-xl bg-wine px-3 py-1.5 text-sm font-semibold text-sand hover:bg-wine-600 dark:bg-accent dark:text-accent-fg">
                {index === steps.length - 1 ? 'Finish' : 'Next'} {index < steps.length - 1 && <ArrowRight className="size-4" aria-hidden />}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
