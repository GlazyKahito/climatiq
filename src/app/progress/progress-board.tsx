'use client';

import { useEffect, useState } from 'react';

type Status = 'todo' | 'doing' | 'done' | 'blocked';
type Item = { id: string; phase: string; title: string; status: Status; note: string };
type Progress = { project: string; updatedAt: string; items: Item[]; log: { time: string; msg: string }[] };

const STATUS_LABEL: Record<Status, string> = {
  todo: 'Pending',
  doing: 'In progress',
  done: 'Done',
  blocked: 'Blocked',
};

const STATUS_STYLE: Record<Status, React.CSSProperties> = {
  todo: { background: 'rgba(127,1,31,0.06)', color: '#7F011F99', border: '1px solid #7F011F22' },
  doing: { background: '#F5EBD0', color: '#7F011F', border: '1px solid #7F011F' },
  done: { background: '#7F011F', color: '#F5EBD0', border: '1px solid #7F011F' },
  blocked: { background: '#2b2b2b', color: '#F5EBD0', border: '1px solid #2b2b2b' },
};

function fmt(t: string) {
  return new Date(t).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export function ProgressBoard() {
  const [data, setData] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/dev/progress', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as Progress;
        if (alive) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load');
      }
    };
    load();
    const id = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const done = data?.items.filter((i) => i.status === 'done').length ?? 0;
  const total = data?.items.length ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const phases = data ? [...new Set(data.items.map((i) => i.phase))] : [];

  return (
    <main
      style={{ background: '#F5EBD0', color: '#2a0a12', minHeight: '100vh' }}
      className="px-4 py-10 sm:px-10"
    >
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-semibold uppercase tracking-[0.3em]" style={{ color: '#7F011F' }}>
          Live build tracker · updates every 3 s
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl" style={{ color: '#7F011F' }}>
          CLIMATIQ
        </h1>
        <p className="mt-1 text-lg">Understand the Heat. Anticipate the Risk.</p>

        <section aria-label="Overall progress" className="mt-8">
          <div className="flex items-end justify-between text-sm">
            <span>
              {done} of {total} work items complete
            </span>
            <span>{data ? `Last update: ${fmt(data.updatedAt)}` : error ? `Error: ${error}` : 'Loading…'}</span>
          </div>
          <div
            className="mt-2 h-3 w-full overflow-hidden rounded-full"
            style={{ background: 'rgba(127,1,31,0.12)' }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: '#7F011F' }} />
          </div>
        </section>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_320px]">
          <section aria-label="Work items" className="space-y-6">
            {phases.map((phase) => (
              <div key={phase}>
                <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: '#7F011F' }}>
                  {phase}
                </h2>
                <ul className="mt-2 space-y-2">
                  {data!.items
                    .filter((i) => i.phase === phase)
                    .map((i) => (
                      <li
                        key={i.id}
                        className="rounded-xl px-4 py-3"
                        style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(127,1,31,0.15)' }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="font-medium">{i.title}</span>
                          <span className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold" style={STATUS_STYLE[i.status]}>
                            {STATUS_LABEL[i.status]}
                          </span>
                        </div>
                        {i.note && <p className="mt-1 text-sm opacity-75">{i.note}</p>}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </section>

          <aside aria-label="Activity log">
            <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: '#7F011F' }}>
              Activity log
            </h2>
            <ol className="mt-2 space-y-3 text-sm">
              {data?.log.map((l, idx) => (
                <li key={idx} className="border-l-2 pl-3" style={{ borderColor: '#7F011F' }}>
                  <div className="text-xs opacity-60">{fmt(l.time)}</div>
                  <div>{l.msg}</div>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </div>
    </main>
  );
}
