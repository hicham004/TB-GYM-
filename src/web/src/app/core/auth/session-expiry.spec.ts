import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type CanDeactivateFn } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UiToast } from '../../ui/toast';
import type { CurrentUser } from '../api/api.models';
import { authGuard, signedOutGuard } from './auth.guards';
import { AuthStore } from './auth.store';
import { RECHECK_AFTER_HIDDEN_MS, SessionExpiry } from './session-expiry';

@Component({ template: '' })
class Blank {}

const maya: CurrentUser = {
  id: 'user-maya',
  email: 'maya@example.test',
  displayName: 'Maya Rahman',
  preferredCulture: 'en-LB',
  preferredThemeMode: 'system',
  preferredWeightUnit: 'Kilogram',
  emailConfirmed: true,
  roles: [],
};

/** What the editor's leave guard answers: false is a person who chose to keep their typed work. */
let mayLeave = true;
/** A save in flight: like Account security, the editor lets its person leave while one is. */
let saving = false;
const editorLeaveGuard: CanDeactivateFn<unknown> = () => saving || mayLeave;

/** The auth store's session state, behaving as the real one does for these calls. */
function fakeAuth() {
  const user = signal<CurrentUser | null>(maya);
  const ended = signal(false);
  return {
    user,
    ended,
    initialize: vi.fn(() => Promise.resolve()),
    markEnded: vi.fn(() => {
      if (user() !== null) ended.set(true);
    }),
    expire: vi.fn(() => {
      ended.set(false);
      user.set(null);
    }),
    stillSignedIn: vi.fn((): Promise<boolean | null> => Promise.resolve(true)),
  };
}

function configure() {
  const auth = fakeAuth();
  const notice = { dismiss: vi.fn() };
  const toast = {
    show: vi.fn<(message: string, options?: unknown) => typeof notice>(() => notice),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'clients', component: Blank, canActivate: [authGuard] },
        {
          path: 'editor',
          component: Blank,
          canActivate: [authGuard],
          canDeactivate: [editorLeaveGuard],
        },
        { path: 'invite/accept', component: Blank },
        {
          path: 'auth',
          canActivateChild: [signedOutGuard],
          children: [{ path: 'sign-in', component: Blank }],
        },
      ]),
      { provide: AuthStore, useValue: auth },
      { provide: UiToast, useValue: toast },
    ],
  });
  const router = TestBed.inject(Router);
  return { auth, notice, toast, router, expiry: TestBed.inject(SessionExpiry) };
}

/** The path and the query of the page on screen. */
function where(router: Router) {
  const url = router.parseUrl(router.url);
  return {
    path: '/' + (url.root.children['primary']?.segments.map((part) => part.path).join('/') ?? ''),
    query: url.queryParams,
  };
}

describe('SessionExpiry', () => {
  beforeEach(() => {
    mayLeave = true;
    saving = false;
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * An ended session used to leave the shell up while every screen failed in its own wrong words;
   * only a full reload reached sign-in (audit WEB-1).
   */
  it('takes the person to sign-in with the page to come back to, and clears the session there', async () => {
    const { auth, router, expiry } = configure();
    await router.navigateByUrl('/clients?filter=active');

    await expiry.ended();

    expect(where(router)).toEqual({
      path: '/auth/sign-in',
      query: { returnUrl: '/clients?filter=active', reason: 'session-ended' },
    });
    expect(auth.markEnded).toHaveBeenCalledTimes(1);
    expect(auth.expire).toHaveBeenCalledTimes(1);
    expect(auth.user()).toBeNull();
  });

  it('goes to sign-in once for a burst of refused requests', async () => {
    const { router, expiry } = configure();
    await router.navigateByUrl('/clients');
    const navigate = vi.spyOn(router, 'navigateByUrl');

    await Promise.all([expiry.ended(), expiry.ended(), expiry.ended()]);

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  /**
   * The route change passes the leave guards like any other, so a sheet with typed work asks first.
   * A person who keeps it stays with it, is told why the question came, and is asked nothing more
   * until they move on; wherever they go next is sign-in.
   */
  it('lets a person keep their typed work, says why, and sends their next move to sign-in', async () => {
    const { auth, notice, toast, router, expiry } = configure();
    await router.navigateByUrl('/editor');
    mayLeave = false;

    await expiry.ended();

    expect(router.url).toBe('/editor');
    expect(auth.user()).not.toBeNull();
    expect(auth.expire).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith(
      'You were signed out. Copy anything you want to keep, then sign in again.',
      { durationMs: 0, action: { label: 'Sign in', run: expect.any(Function) } },
    );

    await expiry.ended();
    expect(toast.show).toHaveBeenCalledTimes(1);

    mayLeave = true;
    await router.navigateByUrl('/clients');
    expect(where(router)).toEqual({
      path: '/auth/sign-in',
      query: { returnUrl: '/clients', reason: 'session-ended' },
    });
    expect(auth.expire).toHaveBeenCalledTimes(1);
    TestBed.tick();
    expect(notice.dismiss).toHaveBeenCalled();
  });

  /**
   * On a phone the notice covers the top bar's menu, so it carries the way on itself. Taking it asks
   * about the typed work again; keeping the work again brings the notice back.
   */
  it('offers Sign in on the notice, which asks again and brings the notice back if they stay', async () => {
    const { auth, toast, router, expiry } = configure();
    await router.navigateByUrl('/editor');
    mayLeave = false;
    await expiry.ended();
    const signIn = () => {
      const options = toast.show.mock.lastCall?.[1] as { action: { run: () => void } };
      options.action.run();
    };

    signIn();
    await vi.waitFor(() => expect(toast.show).toHaveBeenCalledTimes(2));
    expect(router.url).toBe('/editor');

    mayLeave = true;
    signIn();
    await vi.waitFor(() => expect(where(router).path).toBe('/auth/sign-in'));
    expect(where(router).query).toEqual({ returnUrl: '/editor', reason: 'session-ended' });
    expect(auth.expire).toHaveBeenCalledTimes(1);
  });

  /**
   * The 401 usually answers the person's own save. Its handlers settle in the same task, so the
   * editor knows the save failed before the leave guards ask: the typed work is not let go as if
   * it were being saved.
   */
  it('lets the refused save settle before the leave guards ask', async () => {
    const { router, expiry } = configure();
    await router.navigateByUrl('/editor');
    saving = true;
    mayLeave = false;

    const ending = expiry.ended();
    // The editor's own catch and finally, a few promise hops behind the refusal in the same task.
    void Array.from({ length: 10 })
      .reduce<Promise<void>>((hop) => hop.then(() => undefined), Promise.resolve())
      .then(() => (saving = false));
    await ending;

    expect(router.url).toBe('/editor');
  });

  it('does nothing while nobody is shown as signed in', async () => {
    const { auth, router, expiry } = configure();
    await router.navigateByUrl('/auth/sign-in');
    auth.user.set(null);
    const navigate = vi.spyOn(router, 'navigateByUrl');

    await expiry.ended();

    expect(navigate).not.toHaveBeenCalled();
    expect(auth.markEnded).not.toHaveBeenCalled();
  });

  it('keeps an invitation out of the sign-in address (WEB-10)', async () => {
    const { router, expiry } = configure();
    await router.navigateByUrl('/invite/accept?token=secret-token');

    await expiry.ended();

    expect(where(router)).toEqual({ path: '/auth/sign-in', query: { reason: 'session-ended' } });
  });
});

/**
 * The guards trust the session the app first found, so a phone left in a pocket overnight showed
 * yesterday's screens until something failed (WEB-1).
 */
describe('SessionExpiry when a tab comes back', () => {
  let visibility: DocumentVisibilityState;

  beforeEach(() => {
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
  });

  afterEach(() => {
    delete (document as { visibilityState?: unknown }).visibilityState;
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  function hideFor(ms: number): void {
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    clock.mockReturnValue(start + ms);
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    clock.mockRestore();
  }

  it('asks the API again after five minutes away, and takes an ended session to sign-in', async () => {
    const { auth, router } = configure();
    auth.stillSignedIn.mockResolvedValue(false);
    await router.navigateByUrl('/clients');

    hideFor(RECHECK_AFTER_HIDDEN_MS);

    await vi.waitFor(() => expect(where(router).path).toBe('/auth/sign-in'));
    expect(auth.stillSignedIn).toHaveBeenCalledTimes(1);
    expect(where(router).query).toEqual({ returnUrl: '/clients', reason: 'session-ended' });
  });

  it('asks nothing after a short look away', async () => {
    const { auth, router } = configure();
    await router.navigateByUrl('/clients');

    hideFor(RECHECK_AFTER_HIDDEN_MS - 1000);

    expect(auth.stillSignedIn).not.toHaveBeenCalled();
  });

  it('stays put when the session is still there or the API cannot be reached', async () => {
    const { auth, router } = configure();
    await router.navigateByUrl('/clients');

    hideFor(RECHECK_AFTER_HIDDEN_MS);
    await vi.waitFor(() => expect(auth.stillSignedIn).toHaveBeenCalledTimes(1));
    auth.stillSignedIn.mockResolvedValue(null);
    hideFor(RECHECK_AFTER_HIDDEN_MS * 3);
    await vi.waitFor(() => expect(auth.stillSignedIn).toHaveBeenCalledTimes(2));
    await Promise.resolve();

    expect(router.url).toBe('/clients');
    expect(auth.markEnded).not.toHaveBeenCalled();
  });
});
