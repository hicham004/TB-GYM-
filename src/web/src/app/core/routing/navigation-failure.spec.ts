import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withNavigationErrorHandler } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../auth/auth.store';
import {
  isPageFileFailure,
  LOAD_PAGE,
  NavigationFailure,
  reportNavigationFailure,
} from './navigation-failure';

@Component({ template: 'page' })
class Page {}

const PAGE_FILE_ERROR =
  'Failed to fetch dynamically imported module: http://localhost/chunk-A3X2.js';

function setup(options: { signedIn?: boolean; leave?: () => boolean } = {}) {
  const loadPage = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        [
          { path: '', component: Page },
          { path: 'editor', component: Page, canDeactivate: [() => options.leave?.() ?? true] },
          // A lazy page whose file cannot be fetched, as offline or after a release.
          {
            path: 'nutrition',
            loadComponent: () => Promise.reject(new TypeError(PAGE_FILE_ERROR)),
          },
          {
            path: 'unreachable',
            canActivate: [
              () => {
                throw new HttpErrorResponse({ status: 0, url: '/api/thing' });
              },
            ],
            component: Page,
          },
          {
            path: 'broken',
            canActivate: [
              () => {
                throw new Error('boom');
              },
            ],
            component: Page,
          },
        ],
        withNavigationErrorHandler(reportNavigationFailure),
      ),
      {
        provide: AuthStore,
        useValue: { user: signal(options.signedIn === false ? null : { id: 'user-1' }) },
      },
      { provide: LOAD_PAGE, useValue: loadPage },
    ],
  });
  TestBed.inject(NavigationFailure);
  return { router: TestBed.inject(Router), loadPage };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for the toast, whose code is fetched on demand, and for the change detection after it. */
async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    TestBed.tick();
    if (check()) return;
    await delay(10);
  }
  throw new Error('The expected state never came.');
}

function toasts(): { message: string; actions: string[] }[] {
  return Array.from(document.querySelectorAll('.tb-toast')).map((toast) => ({
    message: toast.querySelector('.tb-toast__message')?.textContent?.trim() ?? '',
    actions: Array.from(toast.querySelectorAll('button:not([aria-label])')).map(
      (button) => button.textContent?.trim() ?? '',
    ),
  }));
}

function pressToastAction(label: string): void {
  const action = Array.from(document.querySelectorAll<HTMLButtonElement>('.tb-toast button')).find(
    (button) => button.textContent?.trim() === label,
  );
  if (!action) throw new Error(`No toast action is labelled "${label}".`);
  action.click();
}

const CONNECTION = 'That page couldn’t be opened. Check your connection and try again.';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NavigationFailure', () => {
  it('says a page whose file could not be fetched did not open, and Reload loads it in full', async () => {
    const { router, loadPage } = setup();
    await router.navigateByUrl('/editor');

    await expect(router.navigateByUrl('/nutrition')).rejects.toThrow(PAGE_FILE_ERROR);
    await until(() => toasts().length === 1);

    expect(toasts()).toEqual([{ message: CONNECTION, actions: ['Reload'] }]);
    // An error is announced at once; the person stays where they were.
    expect(document.querySelector('.tb-toast__message')?.getAttribute('role')).toBe('alert');
    expect(router.url).toBe('/editor');

    pressToastAction('Reload');
    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(loadPage).toHaveBeenCalledWith('/nutrition');
    await until(() => toasts().length === 0);
  });

  it('offline, Reload says it again instead of loading the browser’s offline page', async () => {
    const { router, loadPage } = setup();
    await router.navigateByUrl('/nutrition').catch(() => undefined);
    await until(() => toasts().length === 1);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const first = document.querySelector('.tb-toast');

    pressToastAction('Reload');
    await until(() => {
      const now = document.querySelector('.tb-toast');
      return now !== null && now !== first;
    });

    expect(loadPage).not.toHaveBeenCalled();
    expect(toasts()).toEqual([{ message: CONNECTION, actions: ['Reload'] }]);
  });

  it('names the connection when a request never reached the server, and Try again goes again', async () => {
    const { router } = setup();
    await router.navigateByUrl('/unreachable').catch(() => undefined);
    await until(() => toasts().length === 1);

    expect(toasts()).toEqual([{ message: CONNECTION, actions: ['Try again'] }]);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    pressToastAction('Try again');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/unreachable');
  });

  it('says any other failure plainly, with Try again', async () => {
    const { router } = setup();
    await router.navigateByUrl('/broken').catch(() => undefined);
    await until(() => toasts().length === 1);

    expect(toasts()).toEqual([
      { message: 'That page couldn’t be opened. Try again.', actions: ['Try again'] },
    ]);
  });

  it('shows one toast for repeated failures, and closes it when a page opens', async () => {
    const { router } = setup();
    await router.navigateByUrl('/nutrition').catch(() => undefined);
    await until(() => toasts().length === 1);
    await router.navigateByUrl('/broken').catch(() => undefined);
    await until(() => toasts()[0]?.message === 'That page couldn’t be opened. Try again.');
    expect(toasts()).toHaveLength(1);

    await router.navigateByUrl('/editor');
    await until(() => toasts().length === 0);
  });

  it('leaves a refused leave alone: a cancelled navigation is not an error', async () => {
    let allowLeave = true;
    const { router } = setup({ leave: () => allowLeave });
    await router.navigateByUrl('/editor');
    allowLeave = false;

    await expect(router.navigateByUrl('/')).resolves.toBe(false);
    await delay(50);
    TestBed.tick();

    expect(router.url).toBe('/editor');
    expect(toasts()).toEqual([]);
  });

  it('fetches the toast ahead once, when someone signed in has opened a page', async () => {
    const idle = vi.fn();
    vi.stubGlobal('requestIdleCallback', idle);
    try {
      const { router } = setup();
      await router.navigateByUrl('/');
      await router.navigateByUrl('/editor');
      expect(idle).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not fetch it ahead for a visitor who is not signed in', async () => {
    const idle = vi.fn();
    vi.stubGlobal('requestIdleCallback', idle);
    try {
      const { router } = setup({ signedIn: false });
      await router.navigateByUrl('/editor');
      expect(idle).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('isPageFileFailure', () => {
  it('knows how Chromium, Firefox and Safari report a module file that could not be fetched', () => {
    expect(isPageFileFailure(new TypeError(PAGE_FILE_ERROR))).toBe(true);
    expect(
      isPageFileFailure(
        new TypeError('error loading dynamically imported module: http://localhost/chunk-A3X2.js'),
      ),
    ).toBe(true);
    expect(isPageFileFailure(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isPageFileFailure(new Error('boom'))).toBe(false);
    expect(isPageFileFailure(new HttpErrorResponse({ status: 0 }))).toBe(false);
    expect(isPageFileFailure('Failed to fetch dynamically imported module')).toBe(false);
  });
});
