'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CalendarClock, Loader2, Plus, Trash2, UserRound } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui/primitives';
import { OverdueChip, PriorityBadge, TASK_STATUS_META, TaskStatusBadge, type TaskStatus } from '@/components/crm/badges';
import { PRIORITY_META, fmtDate, type Priority } from '@/lib/domain';
import { cn } from '@/lib/utils';
import { createTaskAction, deleteTaskAction, updateTaskAction } from '../actions';

export type TaskRow = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  completedAt: string | null;
  overdue: boolean;
  canEdit: boolean;
  statusOnly: boolean;
};
type Person = { id: string; name: string };

const toDateInput = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : '');
const small = 'h-8 rounded-lg px-2 py-0 text-xs';

function TaskItem({ incidentRef, task, assignees, manage, currentUserId }: { incidentRef: string; task: TaskRow; assignees: Person[]; manage: boolean; currentUserId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Parameters<typeof updateTaskAction>[2]) =>
    start(async () => {
      const res = await updateTaskAction(incidentRef, task.id, patch);
      setError(res.ok ? null : res.error);
      if (res.ok) router.refresh();
    });

  return (
    <li className={cn('flex flex-col gap-2 rounded-xl border border-line p-3', task.status === 'done' && 'opacity-75')} aria-busy={pending}>
      <div className="flex flex-wrap items-start gap-2">
        <span className={cn('min-w-0 flex-1 text-sm font-medium', task.status === 'done' && 'line-through decoration-fg-subtle')}>{task.title}</span>
        <PriorityBadge priority={task.priority} />
        {task.overdue && <OverdueChip />}
        {pending && <Loader2 aria-label="Saving" className="size-4 animate-spin text-fg-subtle" />}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-fg-muted">
        {task.canEdit ? (
          <label className="flex items-center gap-1.5">
            <span className="sr-only">Status of “{task.title}”</span>
            <Select value={task.status} onChange={(e) => update({ status: e.target.value })} className={cn(small, 'w-32')} disabled={pending}>
              {Object.entries(TASK_STATUS_META).map(([v, m]) => (
                <option key={v} value={v}>
                  {m.label}
                </option>
              ))}
            </Select>
          </label>
        ) : (
          <TaskStatusBadge status={task.status} />
        )}
        {manage && task.canEdit && !task.statusOnly ? (
          <>
            <label className="flex items-center gap-1">
              <UserRound aria-hidden className="size-3.5" />
              <span className="sr-only">Assignee</span>
              <Select value={task.assigneeId ?? ''} onChange={(e) => update({ assigneeId: e.target.value || null })} className={cn(small, 'w-40')} disabled={pending}>
                <option value="">Unassigned</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex items-center gap-1">
              <span className="sr-only">Priority</span>
              <Select value={task.priority} onChange={(e) => update({ priority: e.target.value })} className={cn(small, 'w-20')} disabled={pending}>
                {Object.keys(PRIORITY_META).map((p) => (
                  <option key={p} value={p}>
                    {p.toUpperCase()}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex items-center gap-1">
              <CalendarClock aria-hidden className="size-3.5" />
              <span className="sr-only">Due date</span>
              <Input type="date" defaultValue={toDateInput(task.dueAt)} onBlur={(e) => e.target.value !== toDateInput(task.dueAt) && update({ dueAt: e.target.value || null })} className={cn(small, 'w-36')} disabled={pending} />
            </label>
            <button
              type="button"
              onClick={() =>
                confirm('Delete this task?') &&
                start(async () => {
                  const res = await deleteTaskAction(incidentRef, task.id);
                  setError(res.ok ? null : res.error);
                  if (res.ok) router.refresh();
                })
              }
              className="ml-auto inline-flex size-8 items-center justify-center rounded-lg text-fg-subtle hover:bg-accent-soft hover:text-accent"
              aria-label={`Delete task “${task.title}”`}
            >
              <Trash2 aria-hidden className="size-4" />
            </button>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1">
              <UserRound aria-hidden className="size-3.5" /> {task.assigneeName ?? 'Unassigned'}
              {task.assigneeId === currentUserId && <span className="font-semibold text-accent">(you)</span>}
            </span>
            {task.dueAt && (
              <span className="inline-flex items-center gap-1">
                <CalendarClock aria-hidden className="size-3.5" /> Due {fmtDate(task.dueAt)}
              </span>
            )}
          </>
        )}
        {task.completedAt && <span>Done {fmtDate(task.completedAt)}</span>}
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-accent">
          {error}
        </p>
      )}
    </li>
  );
}

export function TaskList({
  incidentRef,
  tasks,
  assignees,
  manage,
  currentUserId,
}: {
  incidentRef: string;
  tasks: TaskRow[];
  assignees: Person[];
  manage: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState<Priority>('p3');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {tasks.length === 0 ? (
        <p className="text-sm text-fg-muted">No tasks yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tasks.map((t) => (
            <TaskItem key={t.id} incidentRef={incidentRef} task={t} assignees={assignees} manage={manage} currentUserId={currentUserId} />
          ))}
        </ul>
      )}
      {manage && (
        <form
          className="flex flex-col gap-2 rounded-xl border border-dashed border-line-strong p-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await createTaskAction(incidentRef, { title, assigneeId: assignee, priority, dueAt: due });
              setError(res.ok ? null : res.error);
              if (res.ok) {
                setTitle('');
                setDue('');
                router.refresh();
              }
            });
          }}
        >
          <label htmlFor="new-task" className="text-xs font-semibold text-fg-muted">
            Add a task
          </label>
          <Input id="new-task" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Set up a water point at the bus stand" maxLength={300} />
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={cn(small, 'w-44')}>
              <option value="">Unassigned</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={cn(small, 'w-24')}>
              {Object.keys(PRIORITY_META).map((p) => (
                <option key={p} value={p}>
                  {p.toUpperCase()}
                </option>
              ))}
            </Select>
            <Input aria-label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} className={cn(small, 'w-36')} />
            <Button type="submit" size="sm" disabled={pending || title.trim().length < 3} className="ml-auto">
              {pending ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Plus aria-hidden className="size-3.5" />} Add task
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs font-medium text-accent">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
