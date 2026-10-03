'use client';

import { useEffect } from 'react';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { INTRO_DONE_EVENT, INTRO_ID } from '@/components/loader/constants';

gsap.registerPlugin(ScrollTrigger);

/**
 * Inertial smooth scrolling for the public pages (Lenis), driven by GSAP's ticker so every ScrollTrigger scene (the
 * hero expansion, section reveals) reads the same smoothed position on the same frame. In-page links (`/#overview`)
 * glide too and honour each section's `scroll-margin`. Off under reduced motion; paused while the first-visit intro
 * covers the page. Nested scrollers opt out with `data-lenis-prevent`.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const lenis = new Lenis({ autoRaf: false, anchors: true, lerp: 0.09, wheelMultiplier: 0.95 });
    lenis.on('scroll', ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0); // keep scroll and scrubbed scenes in lockstep after a long frame

    const resume = () => lenis.start();
    if (document.getElementById(INTRO_ID)?.hasAttribute('data-active')) {
      lenis.stop();
      window.addEventListener(INTRO_DONE_EVENT, resume, { once: true });
    }

    return () => {
      window.removeEventListener(INTRO_DONE_EVENT, resume);
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33); // GSAP's default, for the rest of the app
      lenis.destroy();
    };
  }, []);
  return null;
}
