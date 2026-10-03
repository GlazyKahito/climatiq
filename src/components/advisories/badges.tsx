import { Archive, BadgeCheck, Bot, CheckCheck, CircleDot, Clock3, FilePen, FileText, History, Megaphone, Radio, Send, ShieldOff, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AUDIENCE_META, type Audience } from '@/lib/domain';

const chip = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap';

export const ADVISORY_STATUS_META = {
  draft: { label: 'Draft', icon: FilePen, cls: 'border-line-strong text-fg-muted' },
  approved: { label: 'Approved', icon: BadgeCheck, cls: 'border-[color-mix(in_srgb,var(--prov-observed)_45%,transparent)] text-[var(--prov-observed)]' },
  published: { label: 'Published', icon: Send, cls: 'border-accent/40 bg-accent-soft text-accent' },
  archived: { label: 'Archived', icon: Archive, cls: 'border-dashed border-line-strong text-fg-subtle' },
} as const;

export function AdvisoryStatusBadge({ status, className }: { status: keyof typeof ADVISORY_STATUS_META; className?: string }) {
  const m = ADVISORY_STATUS_META[status];
  const Icon = m.icon;
  return (
    <span className={cn(chip, m.cls, className)}>
      <Icon aria-hidden className="size-3" /> {m.label}
    </span>
  );
}

export function AudienceBadge({ audience, className }: { audience: Audience; className?: string }) {
  const Icon = audience === 'public' ? Megaphone : audience === 'field_team' ? Radio : audience === 'disaster_mgmt' ? ShieldOff : Users;
  return (
    <span className={cn(chip, 'border-line text-fg-muted', className)} title="Intended audience">
      <Icon aria-hidden className="size-3" /> {AUDIENCE_META[audience].label}
    </span>
  );
}

export const ALERT_STATUS_META = {
  active: { label: 'Active', icon: CircleDot, cls: 'border-accent/40 bg-accent-soft text-accent' },
  acknowledged: { label: 'Acknowledged', icon: CheckCheck, cls: 'border-[color-mix(in_srgb,var(--prov-observed)_45%,transparent)] text-[var(--prov-observed)]' },
  resolved: { label: 'Resolved', icon: BadgeCheck, cls: 'border-line-strong text-fg-muted' },
  expired: { label: 'Expired', icon: Clock3, cls: 'border-dashed border-line-strong text-fg-subtle' },
} as const;

export function AlertStatusBadge({ status, className }: { status: keyof typeof ALERT_STATUS_META; className?: string }) {
  const m = ALERT_STATUS_META[status];
  const Icon = m.icon;
  return (
    <span className={cn(chip, m.cls, className)}>
      <Icon aria-hidden className="size-3" /> {m.label}
    </span>
  );
}

/** Marks content derived from the historical replay so it is never mistaken for a current situation. */
export function ScenarioBadge({ scenario, className }: { scenario: string | null | undefined; className?: string }) {
  if (scenario !== 'replay') {
    return scenario === 'live' ? (
      <span className={cn(chip, 'border-line text-fg-muted', className)}>
        <Radio aria-hidden className="size-3" /> Live
      </span>
    ) : null;
  }
  return (
    <span className={cn(chip, 'border-dashed border-[var(--prov-reanalysis)] text-[var(--prov-reanalysis)]', className)} title="Historical replay of the late-May 2024 heatwave — not a current situation">
      <History aria-hidden className="size-3" /> Replay · May 2024
    </span>
  );
}

export function ProviderChip({ provider, modelName, fallback, className }: { provider: string; modelName: string; fallback?: boolean; className?: string }) {
  const isTemplate = provider === 'template';
  return (
    <span
      className={cn(chip, 'border-line font-medium text-fg-muted', fallback && 'border-dashed', className)}
      title={`${isTemplate ? 'Deterministic CLIMATIQ template' : `AI provider ${provider}`} · ${modelName}${fallback ? ' · AI provider unavailable, template fallback used' : ''}`}
    >
      {isTemplate ? <FileText aria-hidden className="size-3" /> : <Bot aria-hidden className="size-3" />}
      {isTemplate ? 'Template' : provider === 'gemini' ? 'Gemini' : provider === 'anthropic' ? 'Claude' : provider}
      {fallback && <span className="text-fg-subtle">· fallback</span>}
    </span>
  );
}
