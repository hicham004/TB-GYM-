import { computed, effect, signal, type Signal } from '@angular/core';

/** How long the parts still out may hold the rest back, once the first has answered. */
export const DRAWN_TOGETHER_PATIENCE_MS = 1500;

/**
 * Whether a page's parts may be drawn (audit UIQ-5): once every one has answered, so they arrive in
 * one frame instead of pushing each other down as each lands, or once `started` has held for
 * `patienceMs` while something is still out, so one slow read never holds the page for long; the
 * part still out then shows its own skeleton. Once drawn they stay drawn, whatever reads again,
 * until `started` goes false, such as on a workspace switch. Both functions are read as signals.
 * Call it in an injection context: it owns an effect.
 *
 * `started` is that the first part has answered; `ready` that all have.
 */
export function drawnTogether(
  started: () => boolean,
  ready: () => boolean,
  patienceMs = DRAWN_TOGETHER_PATIENCE_MS,
): Signal<boolean> {
  const outOfPatience = signal(false);
  const drawnOnce = signal(false);
  const drawn = computed(() => started() && (drawnOnce() || ready() || outOfPatience()));
  effect((onCleanup) => {
    if (!started()) {
      outOfPatience.set(false);
      drawnOnce.set(false);
      return;
    }
    if (drawn()) {
      drawnOnce.set(true);
      return;
    }
    const timer = setTimeout(() => outOfPatience.set(true), patienceMs);
    onCleanup(() => clearTimeout(timer));
  });
  return drawn;
}
