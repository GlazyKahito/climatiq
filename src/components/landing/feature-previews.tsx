import { useId, type ReactNode } from 'react';
import { CheckCircle2, CircleDot, Database, PenLine, Send, ShieldCheck } from 'lucide-react';
import { DemoTag, OriginTag, SeverityBadge } from '@/components/ui/badges';
import { INCIDENT_STATUS_META, SEVERITIES } from '@/lib/domain';
import { cn } from '@/lib/utils';
import type { IndiaArt } from '@/server/landing/geo-art';
import type { FeatureId } from './features-data';

/**
 * Visual previews for each module. Only the command-center map uses data (the real ERA5 replay grid, when present);
 * everything else is an explicitly labelled schematic with no numbers, so nothing on the landing page is invented.
 */

function Frame({ label, tag, children, className }: { label: string; tag: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-full min-h-[260px] flex-col overflow-hidden rounded-2xl border border-line bg-bg-elevated/80 shadow-glass', className)}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="flex gap-1" aria-hidden>
          <span className="size-2 rounded-full bg-line-strong" />
          <span className="size-2 rounded-full bg-line-strong" />
          <span className="size-2 rounded-full bg-line-strong" />
        </span>
        <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">{label}</span>
        <span className="ml-auto shrink-0">{tag}</span>
      </div>
      <div className="relative flex-1 p-3">{children}</div>
    </div>
  );
}

const Schematic = () => (
  <span className="rounded border border-dashed border-line-strong px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-subtle">
    Schematic · no data
  </span>
);

const Bar = ({ w, className }: { w: string; className?: string }) => <span className={cn('block h-2 rounded-full bg-line-strong/70', className)} style={{ width: w }} />;

/** India outline with the real ERA5 replay grid as heat cells (or outline only when the grid is missing). */
export function IndiaHeatMap({ art, className, heat = true, title }: { art: IndiaArt; className?: string; heat?: boolean; title?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const clipId = `cq-india-clip-${uid}`;
  const shapeId = `cq-india-shape-${uid}`;
  return (
    <svg viewBox={`0 0 ${art.width} ${art.height}`} className={cn('h-full w-full', className)} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <path id={shapeId} d={art.outline} />
        <clipPath id={clipId}>
          <use href={`#${shapeId}`} />
        </clipPath>
      </defs>
      <use href={`#${shapeId}`} className="fill-accent/5" />
      {heat && art.heat.length > 0 && (
        <g clipPath={`url(#${clipId})`} fill="none" strokeLinecap="square">
          {art.heat.map((h) => (
            <path key={h.fromC} d={h.d} stroke={h.color} strokeWidth={art.cell * 1.06} />
          ))}
        </g>
      )}
      <use href={`#${shapeId}`} fill="none" className="stroke-accent" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function CommandPreview({ india, heatLabel }: { india: IndiaArt; heatLabel: string | null }) {
  return (
    <Frame
      label="climatiq / command"
      tag={
        heatLabel ? (
          <span className="inline-flex items-center gap-1 rounded border border-line-strong px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
            <Database className="size-2.5" aria-hidden /> Real data · ERA5
          </span>
        ) : (
          <Schematic />
        )
      }
    >
      <div className="grid h-full grid-cols-[1.1fr_1fr] gap-3">
        <div className="relative rounded-xl bg-accent-soft/60 p-2">
          <IndiaHeatMap art={india} title={heatLabel ? `Map of India coloured by ${heatLabel}` : 'Outline of India'} />
          {heatLabel && <p className="absolute inset-x-2 bottom-1.5 truncate font-mono text-[9px] text-fg-subtle">{heatLabel}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-subtle">Risk levels</p>
          <div className="flex flex-col items-start gap-1.5">
            {[...SEVERITIES].reverse().map((s) => (
              <SeverityBadge key={s} severity={s} size="sm" />
            ))}
          </div>
          <div className="mt-auto space-y-1.5 rounded-lg border border-line p-2">
            <Bar w="70%" />
            <Bar w="45%" />
            <Bar w="58%" />
          </div>
        </div>
      </div>
    </Frame>
  );
}

function PredictionPreview() {
  // Shapes only — illustrates how the band, NWP and persistence relate; deliberately no axis values.
  return (
    <Frame label="climatiq / forecasts / district" tag={<Schematic />}>
      <svg viewBox="0 0 320 190" className="h-full w-full" aria-hidden>
        <line x1="20" y1="62" x2="310" y2="62" className="stroke-sev-high" strokeDasharray="4 4" strokeWidth="1" />
        <text x="306" y="56" textAnchor="end" className="fill-sev-high font-mono text-[9px]">heatwave threshold</text>
        <path d="M20 120 C70 100 110 70 160 64 S250 78 310 96 L310 150 C250 132 200 122 160 118 S70 136 20 140 Z" className="fill-accent/12" />
        <path d="M20 130 C70 112 110 80 160 86 S250 106 310 126" fill="none" className="stroke-fg-subtle" strokeDasharray="2 4" strokeWidth="1.4" />
        <path d="M20 128 C70 108 110 66 160 70 S250 92 310 108" fill="none" className="stroke-fg-muted" strokeDasharray="6 4" strokeWidth="1.4" />
        <path d="M20 129 C70 110 110 72 160 77 S250 98 310 116" fill="none" className="stroke-accent" strokeWidth="2.4" />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <text key={i} x={20 + i * 48} y="178" textAnchor="middle" className="fill-fg-subtle font-mono text-[9px]">
            D+{i + 1}
          </text>
        ))}
      </svg>
      <ul className="absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-fg-muted">
        <li className="flex items-center gap-1"><span className="h-0.5 w-4 bg-accent" aria-hidden />CLIMATIQ</li>
        <li className="flex items-center gap-1"><span className="h-0.5 w-4 border-t-2 border-dashed border-fg-muted" aria-hidden />NWP</li>
        <li className="flex items-center gap-1"><span className="h-0.5 w-4 border-t-2 border-dotted border-fg-subtle" aria-hidden />Persistence</li>
        <li className="flex items-center gap-1"><span className="h-2 w-4 rounded-sm bg-accent/15" aria-hidden />80 % band</li>
      </ul>
    </Frame>
  );
}

function StationsPreview() {
  const rows = [
    { status: 'Online', tone: 'var(--sev-low)' },
    { status: 'Stale', tone: 'var(--sev-moderate)' },
    { status: 'Offline', tone: 'var(--fg-subtle)' },
  ];
  return (
    <Frame label="climatiq / stations" tag={<DemoTag label="Simulated stations" />}>
      <ul className="flex h-full flex-col gap-2">
        {rows.map((r) => (
          <li key={r.status} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
            <CircleDot className="size-4 shrink-0" style={{ color: r.tone }} aria-hidden />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Bar w="55%" />
              <Bar w="32%" className="h-1.5 opacity-70" />
            </div>
            <svg viewBox="0 0 60 20" className="h-5 w-16" aria-hidden>
              <path d="M0 14 L10 11 L20 12 L30 7 L40 9 L50 5 L60 8" fill="none" stroke={r.tone} strokeWidth="1.5" />
            </svg>
            <span className="w-14 text-right text-[10px] font-semibold uppercase tracking-wide" style={{ color: r.tone }}>
              {r.status}
            </span>
          </li>
        ))}
        <li className="mt-auto rounded-lg border border-dashed border-line-strong px-3 py-2 font-mono text-[10px] text-fg-subtle">
          POST /api/v1/stations/{'{code}'}/observations · per-station API key
        </li>
      </ul>
    </Frame>
  );
}

function AdvisoriesPreview() {
  const steps = [
    { icon: PenLine, label: 'AI draft' },
    { icon: ShieldCheck, label: 'Approved' },
    { icon: Send, label: 'Published' },
  ];
  return (
    <Frame label="climatiq / advisories / draft" tag={<Schematic />}>
      <div className="flex h-full flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <OriginTag origin="climatiq" />
          {['Government', 'Field teams', 'Public'].map((a) => (
            <span key={a} className="rounded-full border border-line px-2 py-0.5 text-[10px] text-fg-muted">
              {a}
            </span>
          ))}
        </div>
        <div className="space-y-2 rounded-xl border border-line p-3">
          <Bar w="78%" className="h-2.5 bg-fg-subtle/40" />
          <Bar w="96%" />
          <Bar w="88%" />
          <Bar w="64%" />
        </div>
        <ol className="mt-auto flex items-center gap-2">
          {steps.map((s, i) => (
            <li key={s.label} className="flex items-center gap-2">
              <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold', i === 1 ? 'bg-accent text-accent-fg' : 'border border-line-strong text-fg-muted')}>
                <s.icon className="size-3" aria-hidden /> {s.label}
              </span>
              {i < steps.length - 1 && <span className="h-px w-4 bg-line-strong" aria-hidden />}
            </li>
          ))}
        </ol>
      </div>
    </Frame>
  );
}

function ResponsePreview() {
  const cols: { key: keyof typeof INCIDENT_STATUS_META; cards: string[] }[] = [
    { key: 'reported', cards: ['P1', 'P3'] },
    { key: 'in_progress', cards: ['P2', 'P2'] },
    { key: 'monitoring', cards: ['P3'] },
  ];
  return (
    <Frame label="climatiq / response" tag={<DemoTag label="Fictional demo" />}>
      <div className="grid h-full grid-cols-3 gap-2">
        {cols.map((c) => (
          <div key={c.key} className="flex flex-col gap-2 rounded-xl bg-accent-soft/60 p-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">{INCIDENT_STATUS_META[c.key].label}</p>
            {c.cards.map((p, i) => (
              <div key={i} className="space-y-1.5 rounded-lg border border-line bg-bg-elevated p-2">
                <span className={cn('inline-block rounded px-1.5 py-0.5 font-mono text-[9px] font-bold', p === 'P1' ? 'bg-accent text-accent-fg' : 'bg-line-strong/60 text-fg-muted')}>{p}</span>
                <Bar w="90%" />
                <Bar w="60%" className="h-1.5 opacity-70" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Frame>
  );
}

function AnalyticsPreview() {
  return (
    <Frame label="climatiq / analytics / verification" tag={<Schematic />}>
      <div className="grid h-full grid-rows-[auto_1fr] gap-2">
        <div className="grid grid-cols-4 gap-2">
          {['MAE', 'RMSE', 'Bias', 'Hit rate'].map((m) => (
            <div key={m} className="rounded-lg border border-line px-2 py-1.5">
              <p className="font-mono text-[9px] uppercase tracking-wider text-fg-subtle">{m}</p>
              <Bar w="70%" className="mt-1.5 h-2.5 bg-fg-subtle/30" />
            </div>
          ))}
        </div>
        <svg viewBox="0 0 320 120" className="h-full w-full" preserveAspectRatio="none" aria-hidden>
          {[30, 60, 90].map((y) => (
            <line key={y} x1="0" x2="320" y1={y} y2={y} className="stroke-line" strokeWidth="1" />
          ))}
          <path d="M0 90 C40 80 60 50 100 56 S170 30 210 44 S280 70 320 40" fill="none" className="stroke-fg-subtle" strokeWidth="2" />
          <path d="M0 94 C40 76 60 58 100 50 S170 38 210 40 S280 62 320 46" fill="none" className="stroke-accent" strokeWidth="2" strokeDasharray="5 3" />
        </svg>
      </div>
    </Frame>
  );
}

function PortalPreview({ india }: { india: IndiaArt }) {
  return (
    <Frame label="climatiq.in / portal" tag={<Schematic />}>
      <div className="flex h-full items-center justify-center gap-4">
        <div className="flex h-full max-h-[230px] w-[130px] flex-col gap-2 rounded-[22px] border-4 border-line-strong bg-bg p-2.5">
          <span className="mx-auto h-1 w-8 rounded-full bg-line-strong" aria-hidden />
          <p className="text-[9px] font-semibold uppercase tracking-wider text-accent">Your district</p>
          <Bar w="80%" className="h-2.5 bg-fg-subtle/40" />
          <div className="rounded-lg border border-line p-1.5">
            <IndiaHeatMap art={india} heat={false} className="h-16" />
          </div>
          <Bar w="95%" />
          <Bar w="70%" />
          <span className="mt-auto rounded-md bg-accent/90 py-1 text-center text-[9px] font-semibold text-accent-fg">Precautions</span>
        </div>
        <ul className="hidden max-w-[150px] space-y-2 text-[11px] text-fg-muted sm:block">
          <li className="flex gap-1.5"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />Approved public advisories only</li>
          <li className="flex gap-1.5"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />No account needed</li>
          <li className="flex gap-1.5"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />Links to official IMD warnings</li>
        </ul>
      </div>
    </Frame>
  );
}

function MethodologyPreview() {
  return (
    <Frame label="climatiq / methodology" tag={<span className="font-mono text-[9px] uppercase tracking-wider text-fg-subtle">baseline-v1</span>}>
      <pre className="h-full overflow-hidden whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-fg-muted">
        <span className="text-fg-subtle">{'// transparent statistical baseline\n'}</span>
        <span className="text-fg">normal(d)</span>
        {'      = 5-yr ERA5 day-of-year mean\n'}
        <span className="text-fg">anomaly₀</span>
        {'       = mean(Tmax[t−2..t]) − normal\n'}
        <span className="text-fg">persist(h)</span>
        {'     = normal(d+h) + anomaly₀·e^(−h/3)\n'}
        <span className="text-accent">prediction(h)</span>
        {' = w·NWP(h) + (1−w)·persist(h)\n'}
        <span className="text-fg">σ(h)</span>
        {'           = 1 + 0.35h + 0.5|NWP − persist|\n'}
        <span className="text-fg-subtle">{'// interval = prediction ± 1.28σ (uncalibrated)'}</span>
      </pre>
    </Frame>
  );
}

export function FeaturePreview({ id, india, heatLabel }: { id: FeatureId; india: IndiaArt; heatLabel: string | null }) {
  switch (id) {
    case 'command-center':
      return <CommandPreview india={india} heatLabel={heatLabel} />;
    case 'heatwave-prediction':
      return <PredictionPreview />;
    case 'weather-stations':
      return <StationsPreview />;
    case 'advisories-alerts':
      return <AdvisoriesPreview />;
    case 'response-crm':
      return <ResponsePreview />;
    case 'climate-analytics':
      return <AnalyticsPreview />;
    case 'public-portal':
      return <PortalPreview india={india} />;
    case 'methodology':
      return <MethodologyPreview />;
  }
}
