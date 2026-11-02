import type { Motion, Stop } from '../../core/motion/motion';

/**
 * The player's entrance (docs/MOTION-PLAN-2026-11.md, W7). The player's first render is a skeleton,
 * which does not animate; once the workout read has filled it, its parts rise in one after another
 * (14 px up and transparent to rest, 450 ms each, 40 ms apart, the prototype's numbers): the title
 * block of the top bar (the × and the clock stay put, so a tap on × lands at once), the workout
 * picker, the segment bars and the workout's blocks above the exercise, and the exercise panel as
 * one. On the Web Animations API through `Motion` (no GSAP); with reduced motion or the switch on
 * everything is in place at once. `rise` moves six parts at most; anything below is in place when
 * the eye reaches it.
 */

/** The row of the motion plan this moment belongs to, so `tb-motion-off = W7` turns it off alone. */
export const PLAYER_MOMENT = 'W7';

/** The parts that rise, in reading order. */
export const PLAYER_PARTS =
  '.player-top > div, .workout-picker, .workout > :not(.player-body), .workout-exercise';

/** Rises the filled player's parts in; call it after the render that replaced the skeleton. */
export function playPlayerMoment(host: HTMLElement, motion: Motion): Stop {
  return motion.rise(host.querySelectorAll(PLAYER_PARTS), {
    moment: PLAYER_MOMENT,
    from: 14,
    duration: 450,
    stagger: 40,
  });
}
