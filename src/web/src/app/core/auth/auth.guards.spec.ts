import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  Router,
  UrlTree,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authGuard, signedOutGuard } from './auth.guards';
import { AuthStore } from './auth.store';

function configure(state: { signedIn: boolean; ended?: boolean }) {
  const auth = {
    user: signal(state.signedIn ? { id: 'user-maya' } : null),
    ended: signal(Boolean(state.ended)),
    initialize: vi.fn(() => Promise.resolve()),
    expire: vi.fn(),
  };
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: AuthStore, useValue: auth }],
  });
  return auth;
}

async function run(guard: typeof authGuard, url = '/clients/42'): Promise<unknown> {
  return TestBed.runInInjectionContext(() =>
    guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
  );
}

function serialized(result: unknown): string {
  expect(result).toBeInstanceOf(UrlTree);
  return TestBed.inject(Router).serializeUrl(result as UrlTree);
}

describe('auth guards', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('lets a signed-in person through', async () => {
    configure({ signedIn: true });

    expect(await run(authGuard)).toBe(true);
  });

  it('sends a signed-out visitor to sign-in with the page to come back to, and no sentence', async () => {
    configure({ signedIn: false });

    expect(serialized(await run(authGuard))).toBe('/auth/sign-in?returnUrl=%2Fclients%2F42');
  });

  /** The session the app shows has ended (WEB-1): sign-in says why the person is there. */
  it('sends an ended session to sign-in with the reason, though the app still shows someone', async () => {
    configure({ signedIn: true, ended: true });

    expect(serialized(await run(authGuard))).toBe(
      '/auth/sign-in?returnUrl=%2Fclients%2F42&reason=session-ended',
    );
  });

  it('keeps a signed-in person off the sign-in pages', async () => {
    const auth = configure({ signedIn: true });

    expect(serialized(await run(signedOutGuard, '/auth/sign-in'))).toBe('/');
    expect(auth.expire).not.toHaveBeenCalled();
  });

  it('clears an ended session on the way into sign-in, and lets the person in', async () => {
    const auth = configure({ signedIn: true, ended: true });

    expect(await run(signedOutGuard, '/auth/sign-in')).toBe(true);
    expect(auth.expire).toHaveBeenCalledTimes(1);
  });

  it('lets a signed-out visitor into the sign-in pages', async () => {
    configure({ signedIn: false });

    expect(await run(signedOutGuard, '/auth/sign-in')).toBe(true);
  });
});
