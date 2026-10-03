'use client';

import { useCallback, useSyncExternalStore } from 'react';

const EVENT = 'cq:local-flag';
/** In-memory fallback when storage is blocked (private mode, disabled cookies). */
const memory = new Map<string, boolean>();

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

function read(key: string) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return memory.get(key) ?? false;
  }
}

/** Boolean preference persisted in localStorage; renders `false` on the server and during hydration. */
export function useLocalFlag(key: string): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => false,
  );
  const set = useCallback(
    (next: boolean) => {
      try {
        localStorage.setItem(key, next ? '1' : '0');
      } catch {
        memory.set(key, next); // storage unavailable — keep for this page session only
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );
  return [value, set];
}
