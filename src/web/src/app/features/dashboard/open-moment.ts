import { afterNextRender, InjectionToken, type Injector } from '@angular/core';
import type { Motion } from '../../core/motion/motion';

/**
 * The card opens into the player (docs/MOTION-PLAN-2026-11.md, W7). Today's links to the player are
 * `RouterLink` anchors whose own listener navigates, so Today listens for the click in the capture
 * phase and takes only a plain left click on one of them when the browser has view transitions and
 * motion is allowed: it navigates inside `document.startViewTransition` and the new page is revealed
 * from the card's rectangle (`clip-path`, 500 ms, the prototype's `power3.inOut`), the CSS living in
 * `styles/_ui.scss` under `.tb-player-reveal`, since component styles cannot reach
 * `::view-transition-*` on `<html>`. Every other click reaches `RouterLink` untouched, so a modifier
 * click still opens a tab and a browser without the feature still gets the plain navigation. The
 * update (the navigation, the client guard, the lazy chunks, the first render) is capped at 300 ms:
 * past it the transition is skipped and the page cuts over, so the screen never freezes on a slow
 * load. The player's two chunks preload on idle once Today's reads have settled, or on the card's
 * first press, so the tap never waits for a download.
 */

/** The row of the motion plan this moment belongs to, so `tb-motion-off = W7` turns it off alone. */
export const OPEN_MOMENT = 'W7';
/** On `<html>` while the reveal runs; `styles/_ui.scss` animates the new page's clip under it. */
export const REVEAL_CLASS = 'tb-player-reveal';
/** How long the new page may take to draw before the reveal is given up for a plain cut. */
export const REVEAL_CAP_MS = 300;
/** The card's rectangle, as the stylesheet reads it. */
const REVEAL_PROPERTIES = [
  '--tb-open-top',
  '--tb-open-right',
  '--tb-open-bottom',
  '--tb-open-left',
  '--tb-open-radius',
] as const;

let newestReveal = 0;

/**
 * The card's link to the player that `event` is a plain left click on, when the reveal can run;
 * null when the click is anything else (a modifier, another button, another element, no view
 * transitions in this browser, or motion not allowed), which `RouterLink` then handles as before.
 */
export function revealTarget(
  event: MouseEvent,
  document: Document,
  motion: Motion,
): HTMLAnchorElement | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return null;
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest<HTMLAnchorElement>('.today-card a.today-action[href]') ?? null;
  if (!link || !link.closest('.today-card')) return null;
  if (typeof document.startViewTransition !== 'function' || !motion.allowed(OPEN_MOMENT)) {
    return null;
  }
  return link;
}

/**
 * Navigates inside a view transition that reveals the new page from `card`'s rectangle. `navigate`
 * resolves when the router has finished (false when it did not go); `injector` is one that outlives
 * Today, so the new page's first render can be awaited after Today is gone. Returns the transition
 * for a test to settle.
 */
export function revealInto(
  card: Element,
  navigate: () => Promise<boolean>,
  document: Document,
  injector: Injector,
): ViewTransition {
  const root = document.documentElement;
  const view = document.defaultView as Window;
  const box = card.getBoundingClientRect();
  const radius = view.getComputedStyle(card).borderTopLeftRadius || '16px';
  // The visible part of the card: a card half under the fold grows from what shows of it.
  const inset = {
    '--tb-open-top': `${Math.max(0, box.top)}px`,
    '--tb-open-right': `${Math.max(0, view.innerWidth - box.right)}px`,
    '--tb-open-bottom': `${Math.max(0, view.innerHeight - box.bottom)}px`,
    '--tb-open-left': `${Math.max(0, box.left)}px`,
    '--tb-open-radius': radius,
  };
  for (const property of REVEAL_PROPERTIES) root.style.setProperty(property, inset[property]);
  root.classList.add(REVEAL_CLASS);
  const reveal = ++newestReveal;
  const tidy = () => {
    if (reveal !== newestReveal) return;
    root.classList.remove(REVEAL_CLASS);
    for (const property of REVEAL_PROPERTIES) root.style.removeProperty(property);
  };
  let capped = false;
  const transition = document.startViewTransition(async () => {
    const went = await navigate();
    if (!went) {
      transition.skipTransition();
      return;
    }
    if (!capped) await drawn(injector);
  });
  // Past the cap the frozen screen is let go: the page cuts over as soon as it is ready.
  const cap = setTimeout(() => {
    capped = true;
    transition.skipTransition();
  }, REVEAL_CAP_MS);
  const uncap = () => clearTimeout(cap);
  transition.ready.then(uncap, uncap);
  // A second press, or the cap, skips this one, which rejects `ready`; nothing else to do.
  transition.updateCallbackDone.catch(() => undefined);
  transition.finished.then(tidy, tidy);
  return transition;
}

/** The player's chunks, loaded once; the promise never rejects (a failed preload costs nothing). */
let preloaded: Promise<unknown> | null = null;

/**
 * Loads the training routes and the player ahead of the tap: the same modules the router loads
 * lazily, so they share its chunks and the navigation finds them in the module cache.
 */
export function preloadPlayer(): Promise<unknown> {
  preloaded ??= Promise.all([
    import('../training/training.routes'),
    import('../training/today-training'),
  ]).catch(() => {
    preloaded = null;
  });
  return preloaded;
}

/** How Today asks for the preload; a test provides a counter in its place. */
export const PLAYER_PRELOAD = new InjectionToken<() => Promise<unknown>>('PLAYER_PRELOAD', {
  providedIn: 'root',
  factory: () => preloadPlayer,
});

/** Runs `work` when the browser is idle (or after a moment where it cannot say); returns a cancel. */
export function whenIdle(view: Window, work: () => void): () => void {
  if (typeof view.requestIdleCallback === 'function') {
    const handle = view.requestIdleCallback(() => work(), { timeout: 2000 });
    return () => view.cancelIdleCallback(handle);
  }
  const handle = view.setTimeout(work, 200);
  return () => view.clearTimeout(handle);
}

/** Resolves once Angular has drawn the new page, so the transition captures it; 100 ms at most. */
function drawn(injector: Injector): Promise<void> {
  return new Promise((resolve) => {
    afterNextRender({ read: () => resolve() }, { injector });
    setTimeout(resolve, 100);
  });
}
