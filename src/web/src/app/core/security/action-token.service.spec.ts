import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, NavigationExtras, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTION_TOKEN_QUERY_PARAMS, ActionTokenScrubber } from './action-token.service';

interface Navigation {
  commands: unknown[];
  extras: NavigationExtras;
}

function route(params: Record<string, string>) {
  return { snapshot: { queryParamMap: convertToParamMap(params) } };
}

/**
 * Runs the scrubber against a fake route and records what it asked the router to do.
 *
 * The navigation is captured through a typed callback rather than read back off the mock's call
 * tuple, so the assertions read `extras.replaceUrl` as the property it is instead of indexing into
 * an untyped record.
 */
async function scrub(
  params: Record<string, string>,
  result: Promise<boolean> = Promise.resolve(true),
) {
  const navigations: Navigation[] = [];
  const navigate = vi.fn((commands: unknown[], extras: NavigationExtras) => {
    navigations.push({ commands, extras });
    return result;
  });

  await TestBed.configureTestingModule({
    providers: [
      { provide: Router, useValue: { navigate } },
      { provide: ActivatedRoute, useValue: route(params) },
    ],
  }).compileComponents();

  const scrubber = TestBed.inject(ActionTokenScrubber);
  await scrubber.scrub(TestBed.inject(ActivatedRoute));
  return navigations;
}

describe('ActionTokenScrubber', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * The credential has to leave the address bar *and* the back stack. `replaceUrl` is what makes the
   * second half true: a normal navigation would push a new entry and leave the token one Back press
   * away, which is not meaningfully better than leaving it visible.
   */
  it('replaces the current history entry rather than pushing a new one', async () => {
    const navigations = await scrub({ userId: 'user-1', code: 'reset-token' });

    expect(navigations).toHaveLength(1);
    expect(navigations[0].commands).toEqual([]);
    expect(navigations[0].extras.replaceUrl).toBe(true);
    expect(navigations[0].extras.queryParams).toEqual({ code: null });
    expect(navigations[0].extras.queryParamsHandling).toBe('merge');
  });

  it('clears an invitation token too, and leaves everything else alone', async () => {
    const navigations = await scrub({ token: 'invite-token', returnUrl: '/profile' });

    expect(navigations[0].extras.queryParams).toEqual({ token: null });
  });

  it('does nothing when the URL carries no credential', async () => {
    const navigations = await scrub({ userId: 'user-1' });

    expect(navigations).toHaveLength(0);
  });

  /**
   * Scrubbing runs after the exchange has already succeeded or failed. A navigation that cannot
   * complete must not turn a finished action into an error the person sees.
   */
  it('swallows a navigation failure rather than surfacing it', async () => {
    await expect(
      scrub({ code: 'reset-token' }, Promise.reject(new Error('outlet is gone'))),
    ).resolves.toHaveLength(1);
  });

  it('names every credential-bearing parameter the action routes use', () => {
    expect([...ACTION_TOKEN_QUERY_PARAMS]).toEqual(['code', 'token']);
  });
});

/**
 * The other half of the rule, and the half a later convenience feature is most likely to break: a
 * token may be read from the URL and handed to one API call, and must never be written anywhere that
 * outlives the page.
 *
 * Asserted by spying on the real storage prototype rather than by reading the source, so it stays
 * true of whatever the components actually do.
 */
describe('action tokens and browser storage', () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem');

  beforeEach(() => {
    setItem.mockClear();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('writes nothing to local or session storage while scrubbing a token', async () => {
    await scrub({ userId: 'user-1', code: 'reset-token', token: 'invite-token' });

    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
