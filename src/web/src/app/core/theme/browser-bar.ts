import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';

/** index.html's two `theme-color` values: the app's light page and its dark one. */
export const LIGHT_BAR_COLOR = '#f5f3ea';
export const DARK_BAR_COLOR = '#0f1513';

/**
 * The colour of the browser's own bar (`theme-color`). It follows the device's scheme, as index.html
 * sets it, except while a signed-out page is on screen: those stay light like the homepage whatever
 * the scheme, and the bar takes their cream too, so a dark bar never sits over a light page (audit
 * UIQ-9, the lead's call). Each light-only page holds the bar light and lets go when it leaves;
 * counting the holds lets the next page arrive before the last one goes.
 */
@Injectable({ providedIn: 'root' })
export class BrowserBar {
  private readonly document = inject(DOCUMENT);
  private lightPages = 0;

  /** A page that is always light is on screen; the function returned says it has gone. */
  holdLight(): () => void {
    this.lightPages++;
    this.apply();
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.lightPages--;
      this.apply();
    };
  }

  private apply(): void {
    this.document
      .querySelector('meta[name="theme-color"][media*="dark"]')
      ?.setAttribute('content', this.lightPages > 0 ? LIGHT_BAR_COLOR : DARK_BAR_COLOR);
  }
}
