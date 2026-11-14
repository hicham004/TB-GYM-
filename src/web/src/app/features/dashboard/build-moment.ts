import { EASE, type Motion, type Stop } from '../../core/motion/motion';

/**
 * Coach Today builds itself (docs/MOTION-PLAN-2026-11.md, W12). On the first successful read per
 * app load the panels rise in reading order (18 px up and transparent to rest, 320 ms, 40 ms apart,
 * six at most: the prototype's coach screen, shortened as the plan says), on the Web Animations API
 * through `Motion` (no GSAP). The rows ride inside their panel, the greeting never moves (it is
 * drawn before the read answers, audit UIQ-5) and nothing counts: the figures are built strings and
 * a plural. A re-read, a second view of Today and a workspace reset within the same app load replay
 * nothing, since the flag below lives in the lazy Dashboard chunk and lasts the app load. With
 * reduced motion or the switch on, the page is as it was.
 */

/** The row of the motion plan this moment belongs to, so `tb-motion-off = W12` turns it off alone. */
export const BUILD_MOMENT = 'W12';

/**
 * The parts that rise, in reading order: the owner's clients waiting for a coach while anybody waits
 * (notes plan N9d2), Needs you, the feed's fold on a phone, This month, the plans ending soon, the
 * plans ended and the feed on a wider screen; or the first client's card. Six with the waiting list
 * either way, the cap.
 */
export const BUILD_PARTS =
  '.coach-today > .waiting, .coach-today > .columns > .panel, .coach-today > .columns > .feed-fold, .coach-today > .plans > .panel, .coach-today > .feed, .coach-today > .first-client';

let built = false;

/** True once per app load: the first time Coach Today has a read to draw. */
export function claimFirstBuild(): boolean {
  if (built) return false;
  built = true;
  return true;
}

/** For tests: the next read builds again. */
export function resetBuildMoment(): void {
  built = false;
}

/** Rises the panels of `host` in turn; call it after the render that drew them. */
export function buildCoachToday(host: HTMLElement, motion: Motion): Stop {
  return motion.rise(host.querySelectorAll(BUILD_PARTS), {
    moment: BUILD_MOMENT,
    from: 18,
    duration: 320,
    stagger: 40,
    easing: EASE.outStrong,
  });
}
