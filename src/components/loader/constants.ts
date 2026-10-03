/** sessionStorage flag set once the first-visit intro has been shown in this browser session. */
export const INTRO_SESSION_KEY = 'cq_intro_seen';

/** DOM id of the intro overlay. `data-active` = covering the page; `data-reveal` = handing off to the hero. */
export const INTRO_ID = 'cq-intro';

/** Window event fired once the intro has handed the page back (scroll unlocked). */
export const INTRO_DONE_EVENT = 'cq:intro-done';
