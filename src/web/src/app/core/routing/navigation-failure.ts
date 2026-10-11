import { DOCUMENT, Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, InjectionToken, Injector } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, NavigationError, Router } from '@angular/router';
import { filter } from 'rxjs';
import type { ToastHandle } from '../../ui/toast';
import { AuthStore } from '../auth/auth.store';

/**
 * The kit's toast and the overlay under it are about 90 kB that the first download does without, so
 * they are fetched once someone is signed in. A page that later fails to load, offline in a gym or
 * after a release renamed its files, can then still say so.
 */
const loadToast = () => import('../../ui/toast').then((module) => module.UiToast);

/** Loads an address in full, the one way to pick up a new release's files. A seam for tests. */
export const LOAD_PAGE = new InjectionToken<(url: string) => void>('load a page in full', {
  providedIn: 'root',
  factory: () => {
    const document = inject(DOCUMENT);
    return (url: string) => document.location.assign(url);
  },
});

/** A page's code file that could not be fetched, as Chromium, Firefox and Safari word it. */
const PAGE_FILE_FAILURE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

export function isPageFileFailure(error: unknown): boolean {
  return error instanceof Error && PAGE_FILE_FAILURE.test(error.message);
}

/** A file or a request that never reached the server: offline, or the connection dropped. */
function isConnectionFailure(error: unknown): boolean {
  return isPageFileFailure(error) || (error instanceof HttpErrorResponse && error.status === 0);
}

/**
 * A navigation that fails says so in the kit toast, instead of leaving the person where they were
 * with nothing on screen (D5, R5.4b). A page whose file could not be fetched offers Reload, which
 * also picks up a release's renamed files; anything else offers Try again. A leave guard's refusal
 * cancels its navigation and is not an error, so it never reaches here.
 */
@Injectable({ providedIn: 'root' })
export class NavigationFailure {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthStore);
  private readonly loadPage = inject(LOAD_PAGE);
  private toast: ToastHandle | null = null;
  /** Bumped by every failure and every page that opens, so a late toast never covers a newer state. */
  private attempt = 0;
  private warmed = false;

  constructor() {
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        // A page that opened makes an earlier failure old news.
        this.dismiss();
        if (!this.warmed && this.auth.user()) this.warm();
      });
  }

  /** The router's navigation error handler. It returns nothing, so the router's own handling stays. */
  report(failure: NavigationError): void {
    void this.show(failure.url, failure.error);
  }

  private async show(url: string, error: unknown): Promise<void> {
    const attempt = ++this.attempt;
    // Null when the toast's own file could not be fetched either: then there is nothing to show.
    const toasts = await loadToast()
      .then((type) => this.injector.get(type))
      .catch(() => null);
    if (!toasts || attempt !== this.attempt) return;
    this.toast?.dismiss();
    const reload = isPageFileFailure(error);
    this.toast = toasts.show(
      isConnectionFailure(error)
        ? $localize`That page couldn’t be opened. Check your connection and try again.`
        : $localize`That page couldn’t be opened. Try again.`,
      {
        tone: 'error',
        action: reload
          ? { label: $localize`Reload`, run: () => this.reload(url, error) }
          : { label: $localize`Try again`, run: () => void this.router.navigateByUrl(url) },
      },
    );
  }

  private reload(url: string, error: unknown): void {
    // Still offline: say so again rather than swap the app for the browser's offline page.
    if (this.document.defaultView?.navigator.onLine === false) {
      void this.show(url, error);
      return;
    }
    this.loadPage(this.location.prepareExternalUrl(url));
  }

  private dismiss(): void {
    this.attempt++;
    this.toast?.dismiss();
    this.toast = null;
  }

  private warm(): void {
    this.warmed = true;
    const view = this.document.defaultView;
    const fetchToast = () =>
      void loadToast().catch(() => {
        this.warmed = false;
      });
    if (view?.requestIdleCallback) view.requestIdleCallback(fetchToast);
    else view?.setTimeout(fetchToast, 2000);
  }
}

/** For `withNavigationErrorHandler`: the router runs it in an injection context. */
export function reportNavigationFailure(failure: NavigationError): void {
  inject(NavigationFailure).report(failure);
}
