import { EASE, type Motion, type Stop } from '../../core/motion/motion';

/**
 * The rest timer's motion (docs/MOTION-PLAN-2026-11.md, W5): the card slides in from below and out
 * again, the ring drains in one continuous sweep to the end time instead of stepping once a second,
 * and the card pulses through the last three seconds. Everything runs on the Web Animations API
 * through `Motion` (no GSAP). The timer's clock stays the source of truth: the sweep is one
 * animation over the remaining milliseconds, restarted from the clock whenever it drifts from it
 * (the document's timeline stops while a phone is locked), and the template's per-second
 * `stroke-dashoffset` binding stays as what the ring shows with reduced motion, the switch on or no
 * `Element.animate` (jsdom). The timer (rest-timer.ts) calls these from its own state changes.
 */

/** The row of the motion plan this moment belongs to, so `tb-motion-off = W5` turns it off alone. */
export const REST_MOMENT = 'W5';
/** The ring's circumference (2π × 25), the `stroke-dasharray` in the timer's styles. */
export const RING = 157;
/** A sweep this far from the clock, in ms, is restarted from the clock. */
export const DRIFT_MS = 250;
/** The card pulses once a second through the last three seconds. */
export const PULSE_FROM_MS = 3000;
/** How far below its place the card starts and ends, in px (the prototype's 140). */
const SLIDE_PX = 140;
/** GSAP's `power2.in`, for the way out. */
const EASE_IN = 'cubic-bezier(0.55, 0.085, 0.68, 0.53)';

/** The ring's `stroke-dashoffset` with `remaining` of `total` left: 0 draws the whole ring, RING none. */
export function ringOffset(remaining: number, total: number): number {
  return RING * (1 - remaining / (total || 1));
}

/** Slides the card in from below (500 ms, power3.out); where motion is not allowed it is in place. */
export function slideIn(card: Element | undefined, motion: Motion): void {
  if (!card || !motion.allowed(REST_MOMENT)) return;
  card.animate(
    [
      { opacity: 0, transform: `translateY(${SLIDE_PX}px)` },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 500, easing: EASE.outStrong },
  );
}

/**
 * Slides the card out (350 ms, power2.in) and calls `done` once it has gone, so the state that
 * removes the card flips only then; at once where motion is not allowed or there is no card. The
 * card holds its end state until the flip. The returned function ends the slide early without
 * calling `done` (a rest started meanwhile keeps the card).
 */
export function slideOut(card: Element | undefined, motion: Motion, done: () => void): Stop {
  if (!card || !motion.allowed(REST_MOMENT)) {
    done();
    return noop;
  }
  const animation = card.animate(
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: `translateY(${SLIDE_PX}px)` },
    ],
    { duration: 350, easing: EASE_IN, fill: 'forwards' },
  );
  animation.finished.then(
    () => done(),
    () => undefined,
  );
  return () => animation.cancel();
}

/** One continuous sweep of the ring, from the clock's fraction to empty over the remaining ms. */
export interface Sweep {
  /** How far the sweep's own clock sits behind the wall clock at `now`, in ms (negative: ahead). */
  drift(now: number): number;
  cancel(): void;
}

/**
 * Starts the sweep: one animation of `stroke-dashoffset` from where the clock says the ring is to
 * empty, over the milliseconds left, which overrides the template's per-second binding while it
 * runs. Null where motion is not allowed, so the ring steps as before.
 */
export function sweepRing(
  circle: Element | undefined,
  motion: Motion,
  remainingMs: number,
  totalMs: number,
  now: number,
): Sweep | null {
  if (!circle || !(remainingMs > 0) || !(totalMs > 0) || !motion.allowed(REST_MOMENT)) return null;
  const animation = circle.animate(
    [{ strokeDashoffset: ringOffset(remainingMs, totalMs) }, { strokeDashoffset: RING }],
    { duration: remainingMs, easing: 'linear', fill: 'forwards' },
  );
  return {
    drift: (at) => at - now - Number(animation.currentTime ?? 0),
    cancel: () => animation.cancel(),
  };
}

/**
 * The card's pulse through the last seconds: three gentle beats of a second each (scale 1.025),
 * added over any slide still running so neither replaces the other. Null where motion is not
 * allowed.
 */
export function pulseCard(card: Element | undefined, motion: Motion): Stop | null {
  if (!card || !motion.allowed(REST_MOMENT)) return null;
  const animation = card.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.025)', offset: 0.5 },
      { transform: 'scale(1)' },
    ],
    { duration: 1000, iterations: 3, easing: 'ease-in-out', composite: 'add' },
  );
  return () => animation.cancel();
}

function noop(): void {
  // Nothing to end: the final state was set at once.
}
