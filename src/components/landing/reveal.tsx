'use client';

import { useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { cn } from '@/lib/utils';

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * Scroll-storytelling reveals (GSAP). Children marked `data-reveal` rise and fade in as they enter the viewport,
 * batched so siblings stagger together; `data-reveal="line"` draws a horizontal rule; `data-parallax="<n>"` drifts
 * an element by n% of its height while the section scrolls. Content is fully visible without JavaScript and under
 * reduced motion (no initial hidden state is server-rendered). Never put Motion animations on the same elements.
 */
export function Reveal({ children, className, as: Tag = 'div', id }: { children: ReactNode; className?: string; as?: 'div' | 'section'; id?: string }) {
  const ref = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const items = gsap.utils.toArray<HTMLElement>('[data-reveal]:not([data-reveal="line"])');
        gsap.set(items, { autoAlpha: 0, y: 34 });
        ScrollTrigger.batch(items, {
          start: 'top 88%',
          once: true,
          onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.08, overwrite: true }),
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
