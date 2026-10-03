/**
 * Tiny cross-component signal: "the globe has drawn its first real frame" (or settled on the static fallback).
 * The intro loader listens to it so its status line reflects actual asset readiness instead of a fake percentage.
 */
import { INTRO_ID } from '@/components/loader/constants';

export type GlobeReadyKind = 'webgl' | 'fallback';

const EVENT = 'cq:globe-ready';
type W = Window & { __cqGlobeReady?: GlobeReadyKind };

export function markGlobeReady(kind: GlobeReadyKind) {
  if (typeof window === 'undefined') return;
  const w = window as W;
  if (w.__cqGlobeReady) return;
  w.__cqGlobeReady = kind;
  window.dispatchEvent(new CustomEvent<GlobeReadyKind>(EVENT, { detail: kind }));
}

/** Calls back once the globe is ready (immediately if it already is). Returns an unsubscribe function. */
export function onGlobeReady(cb: (kind: GlobeReadyKind) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const w = window as W;
  if (w.__cqGlobeReady) {
    cb(w.__cqGlobeReady);
    return () => {};
  }
  const handler = (e: Event) => cb((e as CustomEvent<GlobeReadyKind>).detail);
  window.addEventListener(EVENT, handler, { once: true });
  return () => window.removeEventListener(EVENT, handler);
}

/** True when a globe exists on the current page (so the loader knows whether to wait for it). */
export function pageHasGlobe() {
  return typeof document !== 'undefined' && !!document.querySelector('[data-cq-globe]');
}

/**
 * True while the first-visit intro still covers the page. The globe holds its spin-in until the intro starts
 * revealing it, so the spin plays where people can see it instead of behind the overlay.
 */
export function isGlobeIntroHeld() {
  if (typeof document === 'undefined') return false;
  const intro = document.getElementById(INTRO_ID);
  return !!intro && intro.hasAttribute('data-active') && !intro.hasAttribute('data-reveal');
}
