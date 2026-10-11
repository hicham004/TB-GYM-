import { DOCUMENT } from '@angular/common';
import { afterNextRender, DestroyRef, inject, Injectable, Injector } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/** A fallback for route headings, including pages whose heading arrives with their data (§9). */
@Injectable({ providedIn: 'root' })
export class RouteHeadingFocus {
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private stopWatching: (() => void) | null = null;
  private path: string | null = null;
  private navigation = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopWatching?.());
    inject(Router)
      .events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        const path = event.urlAfterRedirects.split(/[?#]/)[0];
        // Filters and anchor links keep the person's focus where they are working.
        if (path === this.path) return;
        this.path = path;
        const navigation = ++this.navigation;
        this.stopWatching?.();
        afterNextRender(
          () => {
            if (navigation === this.navigation && !event.urlAfterRedirects.includes('#'))
              this.focusWhenReady();
          },
          { injector: this.injector },
        );
      });
  }

  private focusWhenReady(): void {
    const main = this.document.getElementById('main-content');
    if (!main) return;
    const focus = (): boolean => {
      const active = this.document.activeElement;
      // Screens that focus a field, a question or a dialog deliberately keep that decision.
      if (
        active?.closest('[role="dialog"], dialog') ||
        (active && main.contains(active) && active !== main && active.tagName !== 'A')
      )
        return true;
      const heading = main.querySelector<HTMLElement>('h1, h2');
      if (!heading) return false;
      heading.tabIndex = -1;
      heading.dataset['routeHeading'] = '';
      heading.focus({ preventScroll: true });
      return true;
    };
    if (focus()) return;
    const observer = new MutationObserver(() => {
      if (focus()) stop();
    });
    const stop = () => {
      observer.disconnect();
      this.document.removeEventListener('pointerdown', stop, true);
      this.document.removeEventListener('keydown', stop, true);
      if (this.stopWatching === stop) this.stopWatching = null;
    };
    this.stopWatching = stop;
    observer.observe(main, { childList: true, subtree: true });
    // Late data must not steal focus after the person has already started interacting.
    this.document.addEventListener('pointerdown', stop, true);
    this.document.addEventListener('keydown', stop, true);
  }
}
