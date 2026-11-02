import type { Motion, Stop } from '../../core/motion/motion';

/**
 * Today's first draw (docs/MOTION-PLAN-2026-11.md, W9). Today draws in three steps: the greeting at
 * once, the week and the day's card together once both have answered, and the tiles below once
 * they have too (drawnTogether, audit UIQ-5). Each step rises in as it lands (14 px up and
 * transparent to rest, 450 ms, 50 ms apart, six at most, the prototype's numbers), once per visit
 * and never on a re-read, on the Web Animations API through `Motion` (no GSAP); with reduced
 * motion or the switch on everything is in place at once. The week's rings and the other rings in
 * the app sweep through the stylesheet (`--progress`, registered in `_ui.scss`), not from here.
 */

/** The row of the motion plan this moment belongs to, so `tb-motion-off = W9` turns it off alone. */
export const TODAY_MOMENT = 'W9';

export type TodayStep = 'greeting' | 'core' | 'below';

/** The parts each step rises, in reading order; the renewal's host is inline, so its card moves. */
export const TODAY_PARTS: Record<TodayStep, string> = {
  greeting: '.today-header',
  core: '.today-week, .today-week-failed, .today > .today-card, .today > app-today-renewal > .today-card',
  below:
    '.today-below > app-today-renewal > .today-card, .today-below > app-today-also, .today-below > app-today-coach-message',
};

/** Rises the parts of `steps` in one stagger; call it after the render that drew them. */
export function riseTodaySteps(
  host: HTMLElement,
  steps: readonly TodayStep[],
  motion: Motion,
): Stop {
  const selector = steps.map((step) => TODAY_PARTS[step]).join(', ');
  return motion.rise(host.querySelectorAll(selector), {
    moment: TODAY_MOMENT,
    from: 14,
    duration: 450,
    stagger: 50,
  });
}
