'use client';

import { useSyncExternalStore } from 'react';

export type DocTheme = 'light' | 'dark';

function read(): DocTheme {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return 'dark';
  if (t === 'light') return 'light';
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function subscribe(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}

/**
 * The resolved page theme (`<html data-theme>`). The site renders dark (app/layout.tsx), so dark is also the server
 * snapshot and WebGL palettes start dark without a light flash on hydration.
 */
export function useDocTheme(): DocTheme {
  return useSyncExternalStore(subscribe, read, () => 'dark');
}
