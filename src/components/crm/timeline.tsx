import Link from 'next/link';
import { ArrowRightLeft, Link2, ListTodo, MessageSquare, PencilLine, Plus, UserPlus } from 'lucide-react';
import { fmtDateTime, fmtRelative } from '@/lib/domain';

const KIND = {
  created: { icon: Plus, label: 'Created' },
  status_change: { icon: ArrowRightLeft, label: 'Status' },
  note: { icon: MessageSquare, label: 'Note' },
  assignment: { icon: UserPlus, label: 'Assignment' },
  task: { icon: ListTodo, label: 'Task' },
  link: { icon: Link2, label: 'Link' },
  update: { icon: PencilLine, label: 'Update' },
} as const;

export type TimelineItem = { id: number; kind: string; body: string; createdAt: string; actorName: string | null; ref?: string; title?: string };

/** Activity timeline (newest first). With `showIncident`, each entry links to its incident. */
export function ActivityTimeline({ items, showIncident = false }: { items: TimelineItem[]; showIncident?: boolean }) {
  if (!items.length) return <p className="text-sm text-fg-muted">No activity yet.</p>;
  return (
    <ol className="relative flex flex-col gap-4 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-px before:bg-line-strong">
      {items.map((a) => {
        const K = KIND[a.kind as keyof typeof KIND] ?? KIND.update;
        const Icon = K.icon;
        return (
          <li key={a.id} className="relative flex gap-3">
            <span className="z-10 grid size-7 shrink-0 place-items-center rounded-full border border-line bg-bg-elevated text-fg-muted">
              <Icon aria-hidden className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm leading-relaxed">
                {a.kind === 'note' ? <span className="whitespace-pre-line">“{a.body}”</span> : a.body}
              </p>
              <p className="mt-0.5 text-[11px] text-fg-subtle">
                {K.label} · {a.actorName ?? 'System'} ·{' '}
                <time dateTime={a.createdAt} title={fmtDateTime(a.createdAt)}>
                  {fmtRelative(a.createdAt)}
                </time>
                {showIncident && a.ref && (
                  <>
                    {' · '}
                    <Link href={`/response/incidents/${a.ref}`} className="font-mono font-medium text-accent hover:underline">
                      {a.ref}
                    </Link>
                  </>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
