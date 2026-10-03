import { AlertTriangle, Clock3, Info, ListChecks, Zap } from 'lucide-react';
import type { AdvisoryContent } from '@/server/db/schema';
import { cn } from '@/lib/utils';

const PRIORITY = {
  immediate: { label: 'Immediate', icon: Zap, cls: 'text-accent' },
  soon: { label: 'Soon', icon: Clock3, cls: 'text-[var(--sev-moderate-fg)]' },
  routine: { label: 'Routine', icon: ListChecks, cls: 'text-fg-muted' },
} as const;

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-subtle">{title}</h3>
      {children}
    </section>
  );
}

/** Renders structured advisory content (provider-agnostic). Text is shown as-is; nothing is rendered as HTML. */
export function AdvisoryContentView({ content, compact = false }: { content: AdvisoryContent; compact?: boolean }) {
  const groups = (['immediate', 'soon', 'routine'] as const)
    .map((p) => ({ p, items: content.recommendedActions.filter((a) => (a.priority ?? 'routine') === p) }))
    .filter((g) => g.items.length);
  return (
    <div className="flex flex-col gap-6">
      <Section title="Summary">
        <p className={cn('leading-relaxed text-fg', compact ? 'text-sm' : 'text-base')}>{content.summary}</p>
      </Section>

      <Section title="Forecast details">
        <ul className="flex flex-col gap-2">
          {content.forecastDetails
            .split('\n')
            .filter(Boolean)
            .map((line, i) => (
              <li key={i} className="rounded-xl border border-line bg-glass-strong/40 px-3 py-2 text-sm leading-relaxed">
                {line}
              </li>
            ))}
        </ul>
      </Section>

      <Section title="Contributing factors">
        <ul className="flex flex-col gap-1.5">
          {content.contributingFactors.map((f, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed">
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-[var(--sev-high-fg)]" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Recommended actions">
        <div className="flex flex-col gap-4">
          {groups.map(({ p, items }) => {
            const M = PRIORITY[p];
            const Icon = M.icon;
            return (
              <div key={p} className="flex flex-col gap-2">
                <p className={cn('flex items-center gap-1.5 text-xs font-semibold', M.cls)}>
                  <Icon aria-hidden className="size-3.5" /> {M.label}
                  <span className="font-normal text-fg-subtle">· {items.length}</span>
                </p>
                <ol className="flex flex-col gap-1.5">
                  {items.map((a, i) => (
                    <li key={i} className="flex flex-col gap-0.5 rounded-xl border border-line px-3 py-2 sm:flex-row sm:items-start sm:gap-3">
                      <span className="flex-1 text-sm leading-relaxed">{a.action}</span>
                      {a.audience && <span className="shrink-0 text-[11px] font-medium text-fg-subtle sm:mt-0.5">{a.audience}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Confidence & uncertainty">
        <p className="flex gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2 text-sm leading-relaxed">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
          <span>{content.uncertainty}</span>
        </p>
      </Section>

      <Section title="Limitations">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-fg-muted marker:text-fg-subtle">
          {content.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
