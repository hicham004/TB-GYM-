import { backOut, linearEasing, type Motion } from '../../core/motion/motion';

/**
 * The barbell's motion (docs/MOTION-PLAN-2026-11.md, W11): the plates load one by one from the
 * collar out, each sliding on from the right, and a plate that leaves slides off before the next
 * one slides on. Everything runs on the Web Animations API through `Motion` (no GSAP); the sheet
 * (plates-sheet.ts) calls these from its own redraws. Entering and leaving are the everyday layer
 * (200 ms a plate), not a celebration: with reduced motion or the switch on the plates are in place
 * at once and the sheet's text line says what changed.
 */

/** The row of the motion plan this moment belongs to, so `tb-motion-off = W11` turns it off alone. */
export const PLATES_MOMENT = 'W11';
/** Milliseconds between one plate's start and the next, from the collar out. */
export const STAGGER_MS = 60;
/** A plate slides on and off over this long. */
export const PLATE_MS = 200;
/** How far out along the sleeve a plate starts and ends, in px. */
export const SLIDE_PX = 48;
/** GSAP's `back.out(1.5)`: a plate lands with a small overshoot against its neighbour. */
export const LOAD_EASE = /* @__PURE__ */ linearEasing(backOut(1.5));
/** GSAP's `power2.in`, for the way off. */
const UNLOAD_EASE = 'cubic-bezier(0.55, 0.085, 0.68, 0.53)';

/**
 * Slides `plates` on from the right, one after another in the order given (the collar out). A plate
 * still holding an earlier slide-off is taken over in the same task, so nothing shows in between.
 * Nothing where motion is not allowed: the plates are in place already.
 */
export function loadPlates(plates: Iterable<Element>, motion: Motion): void {
  if (!motion.allowed(PLATES_MOMENT)) return;
  Array.from(plates).forEach((plate, index) => {
    for (const earlier of plate.getAnimations()) earlier.cancel();
    plate.animate(
      [
        { transform: `translateX(${SLIDE_PX}px)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      // Backwards: a plate stays out of sight through its own delay instead of flashing first.
      { duration: PLATE_MS, delay: index * STAGGER_MS, easing: LOAD_EASE, fill: 'backwards' },
    );
  });
}

/**
 * Slides `plates` off to the right, the outermost first, and resolves once they have gone (at once
 * where motion is not allowed or there is nothing to unload). They hold their end state until the
 * caller redraws the bar, so a plate never reappears before it is replaced.
 */
export function unloadPlates(plates: Iterable<Element>, motion: Motion): Promise<void> {
  const list = Array.from(plates);
  if (list.length === 0 || !motion.allowed(PLATES_MOMENT)) return Promise.resolve();
  const gone = list.map((plate, index) =>
    plate
      .animate(
        [
          { transform: 'none', opacity: 1 },
          { transform: `translateX(${SLIDE_PX}px)`, opacity: 0 },
        ],
        {
          duration: PLATE_MS,
          delay: (list.length - 1 - index) * (STAGGER_MS / 2),
          easing: UNLOAD_EASE,
          fill: 'forwards',
        },
      )
      .finished.then(
        () => undefined,
        () => undefined,
      ),
  );
  return Promise.all(gone).then(() => undefined);
}

/** How many plates two loads share from the collar out: the rest leave or arrive. */
export function sharedFromCollar(drawn: readonly number[], next: readonly number[]): number {
  let shared = 0;
  while (shared < drawn.length && shared < next.length && drawn[shared] === next[shared]) {
    shared++;
  }
  return shared;
}
