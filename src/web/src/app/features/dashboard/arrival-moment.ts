import { EASE, type Motion, type Stop } from '../../core/motion/motion';
import type { ActivityRow } from './coach-today.models';

/**
 * Coach Today hears the phone (docs/MOTION-PLAN-2026-11.md, W6): the beats of the quiet re-read,
 * which finished workouts count as just arrived, and the moves an arrival makes, on the Web
 * Animations API through `Motion` (no GSAP). Coach Today (coach-today.ts) calls these from its own
 * state changes; where motion is not allowed every move lands on its final state at once. The strip
 * and the feed row are grids of one row, so a slide is `grid-template-rows` from 0fr to 1fr with
 * the inner box clipped, never a height.
 */

/** The row of the motion plan this moment belongs to, so `tb-motion-off = W6` turns it off alone. */
export const ARRIVAL_MOMENT = 'W6';
/** The re-read's beat while the tab is in view and the coach is around. */
export const POLL_MS = 4000;
/** The beat after fifteen minutes without input or a message: this is the heaviest overview read. */
export const IDLE_POLL_MS = 60_000;
/** The beat after a read failed, so a server that is down is not hammered. */
export const FAILED_POLL_MS = 15_000;
/** How long without input or a realtime bump counts as idle. */
export const IDLE_AFTER_MS = 15 * 60_000;
/** The strip stays this long unless it is clicked or dismissed. */
export const STRIP_MS = 60_000;
/** A workout older than this when first seen is not "just now" (a newly assigned client's week). */
export const JUST_NOW_MS = 2 * 60_000;
/** GSAP's `power2.in`, for the way out. */
const EASE_IN = 'cubic-bezier(0.55, 0.085, 0.68, 0.53)';

/** What the strip under the greeting says about the workout that just landed. */
export interface Arrival {
  readonly key: string;
  readonly initials: string;
  /** The feed row's own sentence: "Maya Fakhoury finished Lower A in 42 min". */
  readonly sentence: string;
  /** "1 record", "3 records", or empty. */
  readonly records: string;
  readonly link: string;
}

/**
 * The finished workouts in `rows` that are new against the keys of the previous full list and
 * happened within the last two minutes, in the feed's order (newest first). None before the first
 * read (`known` null), so a reload animates nothing; none for a client newly assigned to the coach,
 * whose older workouts arrive as new keys but not as "just now".
 */
export function newArrivals(
  known: ReadonlySet<string> | null,
  rows: readonly ActivityRow[],
  now: number,
): ActivityRow[] {
  if (known === null) return [];
  return rows.filter(
    (row) =>
      row.kind === 'WorkoutCompleted' &&
      !known.has(row.key) &&
      Math.abs(now - Date.parse(row.occurredAt)) < JUST_NOW_MS,
  );
}

/** The strip's words for a feed row. */
export function arrivalOf(row: ActivityRow): Arrival {
  const records = row.records.length + row.moreRecords;
  return {
    key: row.key,
    initials: row.initials,
    sentence: row.sentence,
    records:
      records === 0
        ? ''
        : records === 1
          ? $localize`1 record`
          : $localize`${records}:count: records`,
    link: row.link,
  };
}

/** Slides the strip open from nothing (grid rows 0fr to 1fr, 500 ms, power3.out). */
export function openStrip(strip: Element | undefined, motion: Motion): void {
  if (!strip || !motion.allowed(ARRIVAL_MOMENT)) return;
  strip.animate(
    [
      { gridTemplateRows: '0fr', opacity: 0 },
      { gridTemplateRows: '1fr', opacity: 1 },
    ],
    { duration: 500, easing: EASE.outStrong },
  );
}

/**
 * Slides the strip closed (350 ms, power2.in) and calls `done` once it has gone, so the state that
 * removes it flips only then; at once where motion is not allowed or there is no strip. The
 * returned function ends the slide early without calling `done`.
 */
export function closeStrip(strip: Element | undefined, motion: Motion, done: () => void): Stop {
  if (!strip || !motion.allowed(ARRIVAL_MOMENT)) {
    done();
    return noop;
  }
  const animation = strip.animate(
    [
      { gridTemplateRows: '1fr', opacity: 1 },
      { gridTemplateRows: '0fr', opacity: 0 },
    ],
    { duration: 350, easing: EASE_IN, fill: 'forwards' },
  );
  animation.finished.then(
    () => done(),
    () => undefined,
  );
  return () => animation.cancel();
}

/** The lime ring around the client's initials pulses twice (900 ms each), then rests unseen. */
export function pulseRing(ring: Element | undefined, motion: Motion): void {
  if (!ring || !motion.allowed(ARRIVAL_MOMENT)) return;
  ring.animate(
    [
      { transform: 'scale(1)', opacity: 0.9 },
      { transform: 'scale(1.6)', opacity: 0 },
    ],
    { duration: 900, iterations: 2, easing: EASE.out },
  );
}

/**
 * The feed row the workout became slides in (grid rows 0fr to 1fr, 500 ms, power3.out) and its
 * record badges pop from half size. The lime highlight that fades over 2 s is the row's `arrived`
 * class (coach-today-live.scss), which stays with reduced motion, where the row is in place at once.
 */
export function arriveRow(row: Element | undefined, motion: Motion): void {
  if (!row) return;
  row.classList.add('arrived');
  if (!motion.allowed(ARRIVAL_MOMENT)) return;
  row.animate(
    [
      { gridTemplateRows: '0fr', opacity: 0 },
      { gridTemplateRows: '1fr', opacity: 1 },
    ],
    { duration: 500, easing: EASE.outStrong },
  );
  for (const badge of row.querySelectorAll('.pr')) motion.pop(badge, { moment: ARRIVAL_MOMENT });
}

/**
 * A Needs-you row that was resolved leaves: it slides out to the side (30 px, 250 ms, power2.in)
 * and its space collapses (grid rows 1fr to 0fr, 250 ms), then `done` is called so the state that
 * removes it flips only then; at once where motion is not allowed or there is no row. The returned
 * function ends the leave early without calling `done`.
 */
export function leaveRow(row: Element | undefined, motion: Motion, done: () => void): Stop {
  if (!row || !motion.allowed(ARRIVAL_MOMENT)) {
    done();
    return noop;
  }
  const rtl = row.ownerDocument.defaultView?.getComputedStyle(row).direction === 'rtl';
  const slide = row.animate(
    [
      { transform: 'none', opacity: 1 },
      { transform: `translateX(${rtl ? -30 : 30}px)`, opacity: 0 },
    ],
    { duration: 250, easing: EASE_IN, fill: 'forwards' },
  );
  let collapse: Animation | null = null;
  let ended = false;
  slide.finished.then(
    () => {
      if (ended) return;
      collapse = row.animate([{ gridTemplateRows: '1fr' }, { gridTemplateRows: '0fr' }], {
        duration: 250,
        easing: EASE.inOut,
        fill: 'forwards',
      });
      collapse.finished.then(
        () => {
          if (!ended) done();
        },
        () => undefined,
      );
    },
    () => undefined,
  );
  return () => {
    ended = true;
    slide.cancel();
    collapse?.cancel();
  };
}

function noop(): void {
  // Nothing to end: the final state was set at once.
}
