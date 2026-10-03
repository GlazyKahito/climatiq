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
 * The resolved page theme (`<html data-theme>`), updated live when the user toggles it. Light Sand is the default
 * (and the server snapshot), so WebGL palettes start light and only switch when the page is dark.
 */
export function useDocTheme(): DocTheme {
  return useSyncExternalStore(subscribe, read, () => 'light');
}
