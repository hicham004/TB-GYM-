import { inject } from '@angular/core';
import type { CanDeactivateFn } from '@angular/router';
import { UnsavedWork } from './unsaved-work';

/** A page that may hold work the server does not have yet. */
export interface HoldsUnsavedWork {
  /** Saves what it can, asks the person when that fails, and says whether the page may go. */
  canLeave(): boolean | Promise<boolean>;
}

/**
 * Asks an editor before the router takes the person away from it, so unsaved work is never dropped
 * silently (plan §9). Typed structurally, so a routes file does not pull a lazy editor in.
 */
export const confirmSheetLeave: CanDeactivateFn<unknown> = () =>
  inject(UnsavedWork).confirmSheets();

export const confirmBeforeLeaving: CanDeactivateFn<HoldsUnsavedWork> = async (page) => {
  const work = inject(UnsavedWork);
  return (await work.confirmSheets()) && (await page.canLeave());
};
