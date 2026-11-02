import type { Motion } from '../../core/motion/motion';

/**
 * Messages that move (docs/MOTION-PLAN-2026-11.md, W8): the moves a message makes when it lands
 * live, on the Web Animations API through `Motion` (no GSAP). Messages (messages.ts) calls these
 * for the bubbles merged in after the thread's first render and for the inbox row whose last
 * message changed on a live refresh; Today's coach card (today-coach-message.ts) calls `replyLands`
 * when a quiet read brings a newer message from the coach. Where motion is not allowed every move
 * lands on its final state at once, which is the state the template already drew.
 */

/** The row of the motion plan this moment belongs to, so `tb-motion-off = W8` turns it off alone. */
export const MESSAGE_MOMENT = 'W8';
/** The kit's `--tb-ease`. */
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** A bubble's and a row's way in, as section 2 sizes them. */
const LAND_MS = 200;
const LAND_PX = 12;
/** The coach card's rise. */
const REPLY_MS = 320;
const REPLY_PX = 8;

/**
 * A bubble that just landed: the caller's own rises from the composer (12 px up and transparent to
 * rest, 200 ms), the other person's slides in from its own side (12 px from the start edge, which
 * `dir` decides). Nothing where motion is not allowed or there is no row.
 */
export function landBubble(row: Element | undefined, mine: boolean, motion: Motion): void {
  if (!row || !motion.allowed(MESSAGE_MOMENT)) return;
  const from = mine ? `translateY(${LAND_PX}px)` : `translateX(${LAND_PX * startSign(row)}px)`;
  row.animate(
    [
      { opacity: 0, transform: from },
      { opacity: 1, transform: 'none' },
    ],
    {
      duration: LAND_MS,
      easing: EASE,
    },
  );
}

/** The inbox row whose last message just changed rises into place (12 px, 200 ms). */
export function riseRow(row: Element | undefined, motion: Motion): void {
  if (!row || !motion.allowed(MESSAGE_MOMENT)) return;
  row.animate(
    [
      { opacity: 0, transform: `translateY(${LAND_PX}px)` },
      { opacity: 1, transform: 'none' },
    ],
    { duration: LAND_MS, easing: EASE },
  );
}

/**
 * The coach's reply landed on Today with nobody touching it: the card rises 8 px with a fade over
 * 320 ms and its Unread dot pulses twice, then everything rests as drawn.
 */
export function replyLands(card: Element | undefined, motion: Motion): void {
  if (!card || !motion.allowed(MESSAGE_MOMENT)) return;
  card.animate(
    [
      { opacity: 0, transform: `translateY(${REPLY_PX}px)` },
      { opacity: 1, transform: 'none' },
    ],
    { duration: REPLY_MS, easing: EASE },
  );
  const dot = card.querySelector('.dot');
  dot?.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.6)', offset: 0.5 },
      { transform: 'scale(1)' },
    ],
    { duration: 500, iterations: 2, delay: REPLY_MS, easing: 'ease-in-out' },
  );
}

/** -1 where the start edge is on the left (the slide comes from the left), +1 in right-to-left. */
function startSign(row: Element): number {
  const direction = row.ownerDocument.defaultView?.getComputedStyle(row).direction;
  return direction === 'rtl' ? 1 : -1;
}
