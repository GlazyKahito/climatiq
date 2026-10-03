import { Ban, CheckCircle2, Circle, CircleDashed, CircleDot, Eye, Flag, Lock, PlayCircle, Search, TimerOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { INCIDENT_STATUS_META, PRIORITY_META, type IncidentStatus, type Priority } from '@/lib/domain';

const chip = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap';

const STATUS_STYLE: Record<IncidentStatus, { icon: typeof Circle; cls: string }> = {
  reported: { icon: CircleDashed, cls: 'border-accent/40 text-accent' },
  triaged: { icon: Search, cls: 'border-[color-mix(in_srgb,var(--sev-moderate)_50%,transparent)] text-[var(--sev-moderate-fg)]' },
  in_progress: { icon: PlayCircle, cls: 'border-[color-mix(in_srgb,var(--sev-high)_50%,transparent)] bg-[var(--sev-high-bg)] text-[var(--sev-high-fg)]' },
  monitoring: { icon: Eye, cls: 'border-[color-mix(in_srgb,var(--prov-observed)_50%,transparent)] text-[var(--prov-observed)]' },
  resolved: { icon: CheckCircle2, cls: 'border-[color-mix(in_srgb,var(--sev-low)_50%,transparent)] text-[var(--sev-low-fg)]' },
  closed: { icon: Lock, cls: 'border-line-strong text-fg-subtle' },
};

export function IncidentStatusBadge({ status, className }: { status: IncidentStatus; className?: string }) {
  const s = STATUS_STYLE[status];
  const Icon = s.icon;
  return (
    <span className={cn(chip, s.cls, className)}>
      <Icon aria-hidden className="size-3" /> {INCIDENT_STATUS_META[status].label}
    </span>
  );
}

/** Priority uses shape + text (P1–P4); colour weight decreases with priority. */
export function PriorityBadge({ priority, className, long = false }: { priority: Priority; className?: string; long?: boolean }) {
  const strong = priority === 'p1' || priority === 'p2';
  return (
    <span
      className={cn(chip, 'font-mono', priority === 'p1' ? 'border-accent bg-accent text-accent-fg' : strong ? 'border-accent/50 text-accent' : 'border-line-strong text-fg-muted', className)}
      title={PRIORITY_META[priority].label}
    >
      <Flag aria-hidden className="size-3" /> {long ? PRIORITY_META[priority].label : priority.toUpperCase()}
    </span>
  );
}

export const TASK_STATUS_META = {
  todo: { label: 'To do', icon: Circle, cls: 'border-line-strong text-fg-muted' },
  in_progress: { label: 'In progress', icon: CircleDot, cls: 'border-[color-mix(in_srgb,var(--sev-high)_50%,transparent)] text-[var(--sev-high-fg)]' },
  blocked: { label: 'Blocked', icon: Ban, cls: 'border-accent/50 bg-accent-soft text-accent' },
  done: { label: 'Done', icon: CheckCircle2, cls: 'border-[color-mix(in_srgb,var(--sev-low)_50%,transparent)] text-[var(--sev-low-fg)]' },
} as const;
export type TaskStatus = keyof typeof TASK_STATUS_META;

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const m = TASK_STATUS_META[status];
  const Icon = m.icon;
  return (
    <span className={cn(chip, m.cls)}>
      <Icon aria-hidden className="size-3" /> {m.label}
    </span>
  );
}

export function OverdueChip({ className }: { className?: string }) {
  return (
    <span className={cn(chip, 'border-accent bg-accent-soft text-accent', className)}>
      <TimerOff aria-hidden className="size-3" /> Overdue
    </span>
  );
}
