'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { CheckCheck, Loader2, MailOpen, Mail } from 'lucide-react';
import { markNotificationsRead, markNotificationsUnread } from '@/app/actions/inbox';

export function MarkAllReadButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          await markNotificationsRead('all');
          router.refresh();
        })
      }
      className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-wine px-3 text-xs font-semibold text-sand hover:bg-wine-600 disabled:opacity-50 dark:bg-accent dark:text-accent-fg"
    >
      {pending ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <CheckCheck aria-hidden className="size-3.5" />} Mark all read
    </button>
  );
}

export function ToggleReadButton({ id, read }: { id: string; read: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={read ? 'Mark as unread' : 'Mark as read'}
      title={read ? 'Mark as unread' : 'Mark as read'}
      onClick={() =>
        start(async () => {
          if (read) await markNotificationsUnread([id]);
          else await markNotificationsRead([id]);
          router.refresh();
        })
      }
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-accent-soft hover:text-fg disabled:opacity-50"
    >
      {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : read ? <Mail aria-hidden className="size-4" /> : <MailOpen aria-hidden className="size-4" />}
    </button>
  );
}

/** Opening a notification marks it read (fire-and-forget) and navigates to its link. */
export function NotificationLink({ id, href, read, children, className }: { id: string; href: string; read: boolean; children: React.ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        if (!read) void markNotificationsRead([id]);
        router.push(href);
      }}
    >
      {children}
    </a>
  );
}
