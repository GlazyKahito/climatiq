'use client';

import { useState, useTransition } from 'react';
import { Moon, Sun, SunMoon } from 'lucide-react';
import { setTheme } from '@/app/actions/session';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { value: 'light', label: 'Light Sand', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Follow system', icon: SunMoon },
] as const;

export function ThemeChoice({ initial }: { initial: 'light' | 'dark' | 'system' }) {
  const [value, setValue] = useState(initial);
  const [, start] = useTransition();
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
      {OPTIONS.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => {
            setValue(v);
            const resolved = v === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : v;
            document.documentElement.dataset.theme = resolved;
            start(() => setTheme(v));
          }}
          className={cn(
            'flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-sm font-medium transition',
            value === v ? 'border-accent bg-accent-soft text-fg' : 'border-line bg-glass-strong text-fg-muted hover:text-fg',
          )}
        >
          <Icon className="size-5" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}
