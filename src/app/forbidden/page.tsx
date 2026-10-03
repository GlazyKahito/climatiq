import type { Metadata } from 'next';
import { ShieldAlert } from 'lucide-react';
import { LinkButton } from '@/components/ui/primitives';
import { PERMISSIONS, type Permission } from '@/lib/rbac';

export const metadata: Metadata = { title: 'Access restricted' };

export default async function ForbiddenPage({ searchParams }: PageProps<'/forbidden'>) {
  const need = (await searchParams).need;
  const perm = typeof need === 'string' && need in PERMISSIONS ? (need as Permission) : null;
  return (
    <main className="atmosphere grid min-h-dvh place-items-center px-4">
      <div className="glass-strong max-w-md rounded-3xl p-8 text-center">
        <ShieldAlert className="mx-auto size-8 text-accent" aria-hidden />
        <h1 className="mt-3 text-xl font-semibold">This area isn&apos;t available for your role</h1>
        <p className="mt-2 text-sm text-fg-muted">
          {perm ? `It requires the permission “${PERMISSIONS[perm]}”.` : 'Your account does not have access to this module.'} Access is granted by role and geographic assignment.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <LinkButton href="/command" variant="secondary">
            Command center
          </LinkButton>
          <LinkButton href="/portal">Public portal</LinkButton>
        </div>
      </div>
    </main>
  );
}
