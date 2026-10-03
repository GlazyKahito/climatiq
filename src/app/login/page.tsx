import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, FlaskConical } from 'lucide-react';
import { LogoMark, Wordmark } from '@/components/shell/logo';
import { getCurrentUser } from '@/server/auth/dal';
import { listDemoAccounts } from '@/server/auth/demo';
import { getDb } from '@/server/db/client';
import { env } from '@/server/config/env';
import { demoLogin } from '@/app/actions/session';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const sp = await searchParams;
  const next = typeof sp.next === 'string' && sp.next.startsWith('/') && !sp.next.startsWith('//') ? sp.next : '/command';
  if (await getCurrentUser()) redirect(next);
  const demo = env().DEMO_MODE ? await listDemoAccounts(getDb()) : [];

  return (
    <main className="atmosphere grain relative min-h-dvh overflow-hidden px-4 py-10">
      <div className="relative z-10 mx-auto flex max-w-5xl flex-col gap-8">
        <Link href="/" className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden /> Back to home
        </Link>
        <div className="flex items-center gap-3 text-accent">
          <LogoMark className="size-10" />
          <div>
            <Wordmark className="text-xl text-fg" />
            <p className="text-sm text-fg-muted">Understand the Heat. Anticipate the Risk.</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
          <section className="glass-strong rounded-3xl p-6" aria-labelledby="signin-title">
            <h1 id="signin-title" className="text-xl font-semibold">
              Sign in
            </h1>
            <p className="mt-1 text-sm text-fg-muted">Access the climate command center.</p>
            <LoginForm next={next} />
            <p className="mt-6 text-xs text-fg-subtle">
              Looking for public heat information?{' '}
              <Link href="/portal" className="font-semibold text-accent hover:underline">
                Open the public portal
              </Link>{' '}
              — no account needed.
            </p>
          </section>

          {demo.length > 0 && (
            <section className="glass rounded-3xl p-6" aria-labelledby="demo-title">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="demo-title" className="text-xl font-semibold">
                  One-click demo access
                </h2>
                <span className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--prov-simulated)', borderColor: 'var(--prov-simulated)' }}>
                  <FlaskConical className="size-3" aria-hidden /> Demo mode
                </span>
              </div>
              <p className="mt-1 text-sm text-fg-muted">
                Every account below is fictional. Pick a role to explore what it can see and do — you can switch roles later from the account menu. Password for all demo accounts: <code className="rounded bg-accent-soft px-1 font-mono text-xs">climatiq-demo</code>
              </p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {demo.map((a) => (
                  <li key={a.id}>
                    <form action={demoLogin}>
                      <input type="hidden" name="userId" value={a.id} />
                      <input type="hidden" name="next" value={a.roleKey === 'public' ? '/portal' : next} />
                      <button
                        type="submit"
                        className="group flex w-full flex-col items-start rounded-2xl border border-line bg-glass-strong px-4 py-3 text-left transition hover:-translate-y-0.5 hover:border-accent hover:shadow-[var(--shadow-glass)]"
                      >
                        <span className="text-sm font-semibold group-hover:text-accent">{a.roleLabel}</span>
                        <span className="text-xs text-fg-muted">
                          {a.name} · {a.scopeLabel}
                        </span>
                        {a.designation && <span className="mt-0.5 text-[11px] text-fg-subtle">{a.designation}</span>}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
