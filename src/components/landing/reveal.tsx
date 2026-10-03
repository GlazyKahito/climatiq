'use client';

import { useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { useGSAP } from '@gsap/react';
import { cn } from '@/lib/utils';

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

const ENTER = 'top 88%';

/**
 * Scroll-storytelling reveals (GSAP). Markers on children:
 *   data-reveal          rise, fade and de-blur in as they enter the viewport, batched so siblings stagger together
 *   data-reveal="split"  headings: words rise out of a per-line mask (SplitText; re-splits on resize and font load)
 *   data-reveal="clip"   panels and previews: wipe open upward behind a rounded clip
 *   data-reveal="line"   draws a horizontal rule
 *   data-count           a single number counts up from 0 as its card reveals (the real value is in the HTML until then)
 *   data-parallax="<n>"  drifts an element by n% of its height while the section scrolls
 * Content is fully visible without JavaScript and under reduced motion (no hidden state is server-rendered).
 * Never put Motion animations on the same elements.
 */
export function Reveal({ children, className, as: Tag = 'div', id }: { children: ReactNode; className?: string; as?: 'div' | 'section'; id?: string }) {
  const ref = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const restore: (() => void)[] = [];

        const items = gsap.utils.toArray<HTMLElement>('[data-reveal]:not([data-reveal="line"],[data-reveal="split"],[data-reveal="clip"])');
        gsap.set(items, { autoAlpha: 0, y: 34, filter: 'blur(5px)' });
        ScrollTrigger.batch(items, {
          start: ENTER,
          once: true,
          onEnter: (batch) =>
            gsap.to(batch, {
              autoAlpha: 1,
              y: 0,
              filter: 'blur(0px)',
              duration: 1,
              ease: 'power3.out',
              stagger: 0.09,
              overwrite: true,
              clearProps: 'filter', // no lingering filter: keeps text crisp and glass backdrops working
            }),
        });

        gsap.utils.toArray<HTMLElement>('[data-reveal="split"]').forEach((el) => {
          SplitText.create(el, {
            type: 'lines,words',
            mask: 'lines',
            autoSplit: true,
            onSplit: (self) =>
              gsap.from(self.words, {
                yPercent: 115,
                rotate: 2.5,
                autoAlpha: 0,
                duration: 1.05,
                ease: 'expo.out',
                stagger: 0.035,
                scrollTrigger: { trigger: el, start: ENTER, once: true },
              }),
          });
        });

        gsap.utils.toArray<HTMLElement>('[data-reveal="clip"]').forEach((el) => {
          // clip-path is written per frame rather than tweened as a string: browsers normalise inset() endpoints to
          // different shapes and a string tween would pair the wrong numbers (see landing/hero-geometry.ts)
          const radius = getComputedStyle(el).borderTopLeftRadius || '0px';
          const clip = (k: number) => (el.style.clipPath = `inset(${((1 - k) * 100).toFixed(2)}% 0% 0% 0% round ${radius})`);
          const p = { k: 0 };
          clip(0);
          gsap.to(p, {
            k: 1,
            duration: 1.25,
            ease: 'expo.inOut',
            scrollTrigger: { trigger: el, start: 'top 85%', once: true },
            onUpdate: () => clip(p.k),
            onComplete: () => (el.style.clipPath = ''),
          });
          restore.push(() => (el.style.clipPath = ''));
        });

        gsap.utils.toArray<HTMLElement>('[data-count]').forEach((el) => {
          const node = el.firstChild;
          const final = node instanceof Text ? (node.nodeValue ?? '') : '';
          const value = Number(final);
          if (!(node instanceof Text) || final.trim() === '' || !Number.isFinite(value)) return;
          const decimals = final.split('.')[1]?.length ?? 0;
          const s = { v: 0 };
          // starts with its card, which is still transparent at that moment, so the jump to 0 is never seen
          gsap.to(s, {
            v: value,
            duration: 1.5,
            ease: 'power3.out',
            scrollTrigger: { trigger: el.closest('[data-reveal]') ?? el, start: ENTER, once: true },
            onUpdate: () => (node.nodeValue = s.v.toFixed(decimals)),
            onComplete: () => (node.nodeValue = final),
          });
          restore.push(() => (node.nodeValue = final));
        });

        gsap.utils.toArray<HTMLElement>('[data-reveal="line"]').forEach((el) => {
          gsap.fromTo(
            el,
            { scaleX: 0, transformOrigin: '0% 50%' },
            { scaleX: 1, duration: 1.2, ease: 'power3.inOut', scrollTrigger: { trigger: el, start: 'top 90%', once: true } },
          );
        });

        gsap.utils.toArray<HTMLElement>('[data-parallax]').forEach((el) => {
          const amount = Number(el.dataset.parallax) || 10;
          gsap.fromTo(
            el,
            { yPercent: amount },
            { yPercent: -amount, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } },
          );
        });

        return () => restore.forEach((f) => f());
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  return (
    <Tag ref={ref as never} id={id} className={cn(className)}>
      {children}
    </Tag>
  );
}
