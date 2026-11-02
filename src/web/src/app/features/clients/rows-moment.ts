import { afterNextRender, type Injector } from '@angular/core';
import type { Motion } from '../../core/motion/motion';

/**
 * Clients' chips crossfade the rows (docs/MOTION-PLAN-2026-11.md, W14). A chip's change runs
 * inside `document.startViewTransition` when the browser has it and motion is allowed, so the list
 * fades from one set of rows to the next (200 ms) instead of swapping; the rest of the page, the
 * pressed chip included, cuts over at once. Scoped as W7 scopes its reveal: a class on `<html>`
 * while the transition runs, under which `styles/_ui.scss` names the list's panel and sets the
 * durations, since component styles cannot reach `::view-transition-*`. Without the feature, with
 * reduced motion or the switch, the change is made at once.
 */

/** The row of the motion plan this moment belongs to, so `tb-motion-off = W14` turns it off alone. */
export const ROWS_MOMENT = 'W14';
/** On `<html>` while the rows crossfade; `styles/_ui.scss` scopes the transition's rules under it. */
export const ROWS_SWAP_CLASS = 'tb-rows-swap';
/** On the panel the rows live in (and the empty state that takes its place), named under the class. */
export const ROWS_CLASS = 'tb-client-rows';

/**
 * Makes `change` inside a view transition that crossfades the rows, or at once where none can run.
 * `injector` lets the new rows' render be awaited before the new state is captured.
 */
export function swapRows(
  change: () => void,
  document: Document,
  motion: Motion,
  injector: Injector,
): void {
  if (typeof document.startViewTransition !== 'function' || !motion.allowed(ROWS_MOMENT)) {
    change();
    return;
  }
  const root = document.documentElement;
  root.classList.add(ROWS_SWAP_CLASS);
  const transition = document.startViewTransition(async () => {
    change();
    await drawn(injector);
  });
  const tidy = () => root.classList.remove(ROWS_SWAP_CLASS);
  transition.finished.then(tidy, tidy);
}

/** Resolves once Angular has drawn the change, so the transition captures it; 100 ms at most. */
function drawn(injector: Injector): Promise<void> {
  return new Promise((resolve) => {
    afterNextRender({ read: () => resolve() }, { injector });
    setTimeout(resolve, 100);
  });
}
