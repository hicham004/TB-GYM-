import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { query, settle } from '../../../testing/dom';
import { AuthStore } from '../../core/auth/auth.store';
import { WebsiteAnalytics } from '../../core/website/website-analytics';
import { WebsiteSettingsStore } from '../../core/website/website-settings';
import { Changelog } from './changelog';

/**
 * The page with its session's answer: `user` is who is known when the page opens, and the check
 * resolves at once unless the test holds it until `session.answer`.
 */
async function render(user: object | null, options: { holdTheCheck?: boolean } = {}) {
  const userState = signal<object | null>(user);
  let answer: () => void = () => undefined;
  const check = options.holdTheCheck
    ? new Promise<void>((resolve) => (answer = resolve))
    : Promise.resolve();
  const auth = { user: userState, initialize: vi.fn(() => check) };
  const settings = { load: vi.fn(() => Promise.resolve()) };
  const analytics = { pageview: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthStore, useValue: auth },
      { provide: WebsiteSettingsStore, useValue: settings },
      { provide: WebsiteAnalytics, useValue: analytics },
    ],
  });
  const fixture = TestBed.createComponent(Changelog);
  await settle(fixture);
  const session = {
    answer: async (who: object | null) => {
      userState.set(who);
      answer();
      await check;
      if (fixture.componentRef.hostView.destroyed)
        await new Promise((resolve) => setTimeout(resolve));
      else await settle(fixture);
    },
  };
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    auth,
    settings,
    analytics,
    session,
  };
}

describe('Changelog', () => {
  it('lists every release from the file, newest first, with the date in words', async () => {
    const { host } = await render(null);
    expect(query(host, 'h1').textContent).toBe('What changed');
    const releases = Array.from(host.querySelectorAll('.release'));
    expect(releases.length).toBeGreaterThan(3);
    const dates = releases.map((release) =>
      release.querySelector('time')?.getAttribute('datetime'),
    );
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(dates[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(query(host, '.release__date').textContent).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
    expect(query(host, '.changelog__lead').textContent).toContain('Last change');
    expect(releases[0].querySelectorAll('li').length).toBeGreaterThan(0);
    // A visitor gets the website's header and foot around it.
    expect(host.querySelector('app-home-header')).not.toBeNull();
    expect(host.querySelector('.changelog__foot')).not.toBeNull();
  });

  it('inside the app of a signed-in person it keeps just the releases', async () => {
    const { host } = await render({ id: 'me' });
    expect(host.querySelector('app-home-header')).toBeNull();
    expect(host.querySelector('.changelog__foot')).toBeNull();
    expect(query(host, '.changelog').classList).toContain('changelog--embedded');
    expect(host.querySelectorAll('.release').length).toBeGreaterThan(0);
  });

  it("for a visitor, reads the website's settings and counts the visit once, after the session check", async () => {
    const { fixture, auth, settings, analytics } = await render(null);

    expect(auth.initialize).toHaveBeenCalledTimes(1);
    expect(settings.load).toHaveBeenCalledTimes(1);
    expect(analytics.pageview).toHaveBeenCalledTimes(1);
    await settle(fixture);
    expect(analytics.pageview).toHaveBeenCalledTimes(1);
  });

  it('for a signed-in person, reads no settings and counts nothing', async () => {
    const { settings, analytics } = await render({ id: 'me' });

    expect(settings.load).not.toHaveBeenCalled();
    expect(analytics.pageview).not.toHaveBeenCalled();
  });

  it('waits for the session’s answer: someone it signs in is not counted, a visitor is', async () => {
    // After a full load the page is drawn while the check is still on its way, with nobody known.
    const signedIn = await render(null, { holdTheCheck: true });
    expect(signedIn.settings.load).not.toHaveBeenCalled();
    expect(signedIn.analytics.pageview).not.toHaveBeenCalled();
    await signedIn.session.answer({ id: 'me' });
    expect(signedIn.settings.load).not.toHaveBeenCalled();
    expect(signedIn.analytics.pageview).not.toHaveBeenCalled();
    TestBed.resetTestingModule();

    const visitor = await render(null, { holdTheCheck: true });
    expect(visitor.analytics.pageview).not.toHaveBeenCalled();
    await visitor.session.answer(null);
    expect(visitor.settings.load).toHaveBeenCalledTimes(1);
    expect(visitor.analytics.pageview).toHaveBeenCalledTimes(1);
  });

  it('counts nothing when the page closed before the session answered', async () => {
    const { fixture, settings, analytics, session } = await render(null, { holdTheCheck: true });

    fixture.destroy();
    await session.answer(null);

    expect(settings.load).not.toHaveBeenCalled();
    expect(analytics.pageview).not.toHaveBeenCalled();
  });
});
