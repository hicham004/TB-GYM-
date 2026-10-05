import { Injectable } from '@angular/core';
import type { HoldsUnsavedWork } from './leave-guard';

/**
 * The editors open right now, asked before a workspace switch or a sign-out. Both change the
 * session before any route changes, so a route's leave guard alone would run too late: the page
 * would already have dropped its work with the old workspace.
 */
@Injectable({ providedIn: 'root' })
export class UnsavedWork {
  private readonly pages = new Set<HoldsUnsavedWork>();

  /** Registers an editor while it is on screen; the returned function removes it. */
  register(page: HoldsUnsavedWork): () => void {
    this.pages.add(page);
    return () => this.pages.delete(page);
  }

  /** True when every open editor has saved its work or the person chose to leave it. */
  async confirmLeave(): Promise<boolean> {
    for (const page of [...this.pages]) {
      if (!(await page.canLeave())) return false;
    }
    return true;
  }
}
