import type { CanDeactivateFn } from '@angular/router';

/** A page that may hold work the server does not have yet. */
export interface HoldsUnsavedWork {
  /** Saves what it can, asks the person when that fails, and says whether the page may go. */
  canLeave(): boolean | Promise<boolean>;
}

/**
 * Asks an editor before the router takes the person away from it, so unsaved work is never dropped
 * silently (plan §9). Typed structurally, so a routes file does not pull a lazy editor in.
 */
export const confirmBeforeLeaving: CanDeactivateFn<HoldsUnsavedWork> = (page) => page.canLeave();
