import { cn } from '@/lib/utils';
import { IntroLoaderClient } from './intro-loader-client';
import { INTRO_ID, INTRO_SESSION_KEY } from './constants';
import styles from './loader.module.css';

/**
 * First-visit brand intro (once per browser session).
 *
 * The markup is server-rendered but hidden; a tiny inline script that runs before first paint marks it active only
 * when `sessionStorage` has no "seen" flag — so returning visitors never see a flash of it, and first-time visitors
 * never see a flash of the page behind it. It also stays off for reduced-motion users and for deep links to a
 * section (`/#overview`). If JavaScript never hydrates, a CSS fail-safe fades it out after 7 s.
 */
export function IntroLoader() {
  const gate =
    `(function(){try{if(window.sessionStorage.getItem(${JSON.stringify(INTRO_SESSION_KEY)})||location.hash||` +
    `matchMedia('(prefers-reduced-motion: reduce)').matches)return;` +
    `var e=document.getElementById(${JSON.stringify(INTRO_ID)});if(e)e.setAttribute('data-active','');}catch(_){}})();`;
  return (
    <>
      <div id={INTRO_ID} className={cn(styles.intro, styles.failsafe, 'fixed inset-0 z-[100]')} suppressHydrationWarning>
        <IntroLoaderClient failsafeClass={styles.failsafe} />
      </div>
      <script dangerouslySetInnerHTML={{ __html: gate }} />
    </>
  );
}
