import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { type Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser, TenantMembership } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WebsiteAnalytics } from '../../core/website/website-analytics';
import { WebsiteSettingsStore } from '../../core/website/website-settings';
import { press, query, settle } from '../../../testing/dom';
import { Train } from './train';
import { TrainApi } from './train-api';
import { CLOSED_SIGN_UP, type TrainSignUp } from './train.models';

// Monday 16 November 2026, 11:00 in Beirut, which is on GMT+2 then.
const NOW = new Date('2026-11-16T09:00:00Z');

/** TB Gym's own space while sign-up is open, as the status read names it; the name is made up. */
const OPEN: TrainSignUp = {
  status: 'Open',
  workspaceName: 'Juniper Yard',
  timeZoneId: 'Asia/Beirut',
  minimumAge: 19,
  opensAgainOn: null,
  formStamp: 'stamp-1',
  caller: null,
};

const FULL: TrainSignUp = { ...OPEN, status: 'Full', opensAgainOn: '2026-11-23', formStamp: null };

const MEMBER = {
  id: 'user-1',
  email: 'member@example.test',
  displayName: 'Nour Sample',
} as CurrentUser;

const membership = (tenantId: string, tenantName: string): TenantMembership => ({
  tenantId,
  tenantName,
  tenantSlug: tenantId,
  role: 'Client',
});

/** A coach's space the person is a client of, and the house, as the memberships read names them. */
const COACHED = membership('space-coach', 'Northside Coaching');
const HOUSE = membership('space-house', 'Juniper Yard');

/**
 * The page as someone opens it: the status read answers `answer` (each read, unless a function says
 * otherwise), `user` is who is signed in, and the device's clock is `device` (the house's own unless said).
 * `memberships` are the person's spaces as the page finds them, `selected` the one chosen, and `after`
 * what reading them again gives.
 */
async function render(
  answer: TrainSignUp | (() => Observable<TrainSignUp>) = OPEN,
  visit: {
    user?: CurrentUser | null;
    ended?: boolean;
    device?: string;
    memberships?: TenantMembership[];
    selected?: string | null;
    after?: TenantMembership[] | 'fails';
  } = {},
) {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone: visit.device ?? 'Asia/Beirut',
  } as Intl.ResolvedDateTimeFormatOptions);
  const status = vi.fn(typeof answer === 'function' ? answer : () => of(answer));
  const analytics = { start: vi.fn(), pageview: vi.fn() };
  const settings = { load: vi.fn(() => Promise.resolve()) };
  const memberships = signal<TenantMembership[]>(visit.memberships ?? []);
  const selected = signal<string | null>(visit.selected ?? null);
  const tenants = {
    memberships,
    selectedTenantId: selected,
    load: vi.fn(() => {
      if (visit.after === 'fails') return Promise.reject(new HttpErrorResponse({ status: 0 }));
      if (visit.after) memberships.set(visit.after);
      return Promise.resolve();
    }),
    select: vi.fn((tenantId: string | null) => selected.set(tenantId)),
  };
  await TestBed.configureTestingModule({
    imports: [Train],
    providers: [
      provideRouter([]),
      { provide: TrainApi, useValue: { status, register: vi.fn() } },
      {
        provide: AuthStore,
        useValue: { user: signal(visit.user ?? null), ended: signal(visit.ended ?? false) },
      },
      { provide: TenantStore, useValue: tenants },
      { provide: WebsiteAnalytics, useValue: analytics },
      { provide: WebsiteSettingsStore, useValue: settings },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(Train);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    status,
    analytics,
    settings,
    tenants,
    router: TestBed.inject(Router),
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The page's own links, each by its words and where it leads; the frame's wordmark is not one. */
const links = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('.auth__content a')).map((link) => [
    textOf(link),
    link.getAttribute('href'),
  ]);

/** The robots tags in the document, which say whether search engines may list the page. */
const robots = () => Array.from(document.head.querySelectorAll('meta[name="robots"]'));

/** A click on a link as the browser sends it: a plain left click unless `init` says otherwise. */
const click = (init: MouseEventInit = {}) =>
  new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });

/** The Joined state's "Open Today". */
function openToday(host: HTMLElement): HTMLAnchorElement {
  const found = Array.from(host.querySelectorAll<HTMLAnchorElement>('.auth__content a')).find(
    (link) => textOf(link) === 'Open Today',
  );
  if (!found) throw new Error('No link reads "Open Today".');
  return found;
}

describe('Train', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: NOW }));

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
    for (const tag of robots()) tag.remove();
  });

  it('while sign-up is closed, says so and names no house, with sign-in for a visitor', async () => {
    // Even an answer that named the house would not be repeated while closed.
    const { host } = await render({ ...CLOSED_SIGN_UP, workspaceName: 'Juniper Yard' });

    expect(textOf(host.querySelector('.auth-eyebrow'))).toBe('TB Gym');
    expect(textOf(host.querySelector('h1'))).toBe('Train with TB Gym.');
    const closed = query(host, '[data-closed]');
    expect(textOf(closed.querySelector('.auth-message'))).toBe('Sign-up is closed right now.');
    expect(closed.textContent).toContain(
      'If a coach invited you, open the link in their email instead.',
    );
    // The flex gap sets the two apart on screen.
    expect(textOf(closed.querySelector('.auth-alt span'))).toBe('Already have an account?');
    expect(links(host)).toEqual([['Sign in', '/auth/sign-in']]);
    expect(host.textContent).not.toContain('Juniper Yard');
    expect(host.textContent).not.toContain('Creating an account is free.');
    expect(host.querySelector('[data-clock]')).toBeNull();
  });

  it('while closed, offers someone signed in nothing to sign into, inside the app’s shell', async () => {
    const { host } = await render(CLOSED_SIGN_UP, { user: MEMBER });

    expect(textOf(query(host, '[data-closed] .auth-message'))).toBe('Sign-up is closed right now.');
    expect(links(host)).toEqual([]);
    expect(host.querySelector('.auth--embedded')).not.toBeNull();
    expect(host.querySelector('.auth__header')).toBeNull();
  });

  it('while open, offers a visitor the form and a sign-in that comes back here, under the house’s name and clock', async () => {
    const { host } = await render(OPEN);

    expect(textOf(host.querySelector('.auth-eyebrow'))).toBe('Juniper Yard');
    expect(textOf(host.querySelector('h1'))).toBe('Train with TB Gym.');
    expect(textOf(host.querySelector('.auth-lead'))).toBe(
      'Train on your own, with no coach. Pick exercises, log your workouts and keep your history.',
    );
    expect(query(host, '[data-status]').getAttribute('data-status')).toBe('Open');
    expect(links(host)).toEqual([
      ['Create your account', '/train/sign-up'],
      ['Sign in', '/auth/sign-in?returnUrl=%2Ftrain'],
    ]);
    expect(textOf(host.querySelector('[data-clock]'))).toBe('Training days follow Beirut time.');
    expect(host.querySelector('[data-abroad]')).toBeNull();
    expect(host.textContent).toContain('Creating an account is free.');
    // A visitor's page: the signed-out frame with its wordmark.
    expect(host.querySelector('.auth__header')).not.toBeNull();
    expect(host.querySelector('.auth--embedded')).toBeNull();
  });

  it('tells a device on another clock the hour a new training day starts on it', async () => {
    const { host } = await render(OPEN, { device: 'UTC' });

    expect(textOf(host.querySelector('[data-clock]'))).toBe('Training days follow Beirut time.');
    // Angular's en-US time puts a narrow no-break space before PM.
    expect(query(host, '[data-abroad]').textContent?.trim()).toBe(
      'On your device’s clock, a new training day starts at 10:00 PM.',
    );
  });

  it('offers someone signed in the sign-up with the account they have, and no sign-in', async () => {
    const { host } = await render(OPEN, { user: MEMBER });

    expect(links(host)).toEqual([['Sign up with this account', '/train/sign-up']]);
    expect(host.textContent).not.toContain('Create your account');
    // They create no account: the line is a visitor's alone.
    expect(host.textContent).not.toContain('Creating an account is free.');
    expect(host.querySelector('.auth--embedded')).not.toBeNull();
  });

  it('treats a session that ended by itself as a visitor, as the server does', async () => {
    const { host } = await render(OPEN, { user: MEMBER, ended: true });

    expect(links(host)).toEqual([
      ['Create your account', '/train/sign-up'],
      ['Sign in', '/auth/sign-in?returnUrl=%2Ftrain'],
    ]);
    expect(host.querySelector('.auth--embedded')).toBeNull();
  });

  it('tells a trainee already in the house so, with Today, whether the week is open or full', async () => {
    for (const answer of [OPEN, FULL]) {
      const { host } = await render({ ...answer, caller: 'Joined' }, { user: MEMBER });

      expect(textOf(host.querySelector('.auth-message'))).toBe(
        'You’re already training with TB Gym.',
      );
      expect(links(host)).toEqual([['Open Today', '/']]);
      expect(host.querySelector('[data-full]')).toBeNull();
      TestBed.resetTestingModule();
    }
  });

  // A coach's client may have joined the house with their account (decision 34): '/' opens Today in
  // whichever space is selected, so Open Today selects the house first.
  describe('Open Today, for someone already training in the house', () => {
    const JOINED: TrainSignUp = { ...OPEN, caller: 'Joined' };

    it('selects the house, then opens Today, though a coach’s space is the one selected', async () => {
      const { fixture, host, tenants, router } = await render(JOINED, {
        user: MEMBER,
        memberships: [COACHED, HOUSE],
        selected: 'space-coach',
      });
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      const plain = click();

      openToday(host).dispatchEvent(plain);
      await settle(fixture);

      // The page opens Today itself, so the browser does not follow the link too.
      expect(plain.defaultPrevented).toBe(true);
      expect(tenants.load).not.toHaveBeenCalled();
      expect(tenants.select).toHaveBeenCalledTimes(1);
      expect(tenants.select).toHaveBeenCalledWith('space-house');
      expect(tenants.selectedTenantId()).toBe('space-house');
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith('/');
      expect(tenants.select.mock.invocationCallOrder[0]).toBeLessThan(
        navigate.mock.invocationCallOrder[0],
      );
    });

    it('reads the memberships once when the list does not hold the house yet, then selects it', async () => {
      // Joined in another tab: this one's list was read before.
      const { fixture, host, tenants, router } = await render(JOINED, {
        user: MEMBER,
        memberships: [COACHED],
        selected: 'space-coach',
        after: [COACHED, HOUSE],
      });
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

      openToday(host).dispatchEvent(click());
      await settle(fixture);

      expect(tenants.load).toHaveBeenCalledTimes(1);
      expect(tenants.select).toHaveBeenCalledTimes(1);
      expect(tenants.select).toHaveBeenCalledWith('space-house');
      expect(navigate).toHaveBeenCalledWith('/');
      expect(tenants.load.mock.invocationCallOrder[0]).toBeLessThan(
        tenants.select.mock.invocationCallOrder[0],
      );
      expect(tenants.select.mock.invocationCallOrder[0]).toBeLessThan(
        navigate.mock.invocationCallOrder[0],
      );
    });

    it('still opens Today, in the space already chosen, when the memberships cannot be read', async () => {
      const { fixture, host, tenants, router } = await render(JOINED, {
        user: MEMBER,
        memberships: [COACHED],
        selected: 'space-coach',
        after: 'fails',
      });
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

      openToday(host).dispatchEvent(click());
      await settle(fixture);

      expect(tenants.load).toHaveBeenCalledTimes(1);
      expect(tenants.select).not.toHaveBeenCalled();
      expect(tenants.selectedTenantId()).toBe('space-coach');
      expect(navigate).toHaveBeenCalledWith('/');
    });

    it('leaves a click meant for another tab or window to the browser', async () => {
      const { fixture, host, tenants, router } = await render(JOINED, {
        user: MEMBER,
        memberships: [COACHED, HOUSE],
        selected: 'space-coach',
      });
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      const leftToBrowser: boolean[] = [];
      // Heard after the page's own listener; jsdom would otherwise try to follow the link itself.
      host.addEventListener('click', (event) => {
        leftToBrowser.push(!event.defaultPrevented);
        event.preventDefault();
      });

      for (const modifier of [
        { ctrlKey: true },
        { metaKey: true },
        { shiftKey: true },
        { altKey: true },
      ]) {
        openToday(host).dispatchEvent(click(modifier));
      }
      await settle(fixture);

      expect(leftToBrowser).toEqual([true, true, true, true]);
      expect(tenants.load).not.toHaveBeenCalled();
      expect(tenants.select).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  it('while full, says when sign-up opens again by the house’s weekday and offers no form', async () => {
    const { host } = await render(FULL, { device: 'UTC' });

    expect(textOf(host.querySelector('.auth-eyebrow'))).toBe('Juniper Yard');
    expect(query(host, '[data-status]').getAttribute('data-status')).toBe('Full');
    expect(textOf(query(host, '[data-full]'))).toBe(
      'Sign-up is full for this week. It opens again on Monday.',
    );
    // No form to open; a visitor who joined already can still sign in and come back here.
    expect(links(host)).toEqual([['Sign in', '/auth/sign-in?returnUrl=%2Ftrain']]);
    expect(host.querySelector('[data-waiting]')).toBeNull();
    // The clock still says when the week turns.
    expect(textOf(host.querySelector('[data-clock]'))).toBe('Training days follow Beirut time.');
    expect(host.querySelector('[data-abroad]')).not.toBeNull();
    expect(host.textContent).toContain('Creating an account is free.');
  });

  it('while full, offers someone signed in who has not signed up neither a sign-in nor a form', async () => {
    const { host } = await render(FULL, { user: MEMBER });

    expect(textOf(query(host, '[data-full]'))).toBe(
      'Sign-up is full for this week. It opens again on Monday.',
    );
    expect(links(host)).toEqual([]);
    expect(host.querySelector('.auth-alt')).toBeNull();
    expect(host.querySelector('[data-waiting]')).toBeNull();
    // They would create no account: the line is a visitor's alone.
    expect(host.textContent).not.toContain('Creating an account is free.');
    expect(host.querySelector('.auth--embedded')).not.toBeNull();
  });

  it('tells someone confirmed while the week is full that their sign-up waits for a place', async () => {
    const { host } = await render({ ...FULL, caller: 'Waiting' }, { user: MEMBER });

    expect(textOf(query(host, '[data-full]'))).toBe(
      'Sign-up is full for this week. It opens again on Monday.',
    );
    expect(textOf(query(host, '[data-waiting]'))).toBe(
      'Your email is confirmed and your sign-up is waiting for a place. Come back then to finish it.',
    );
    expect(links(host)).toEqual([]);
  });

  it('offers someone confirmed and waiting the end of their sign-up once a place is open', async () => {
    const { host } = await render({ ...OPEN, caller: 'Waiting' }, { user: MEMBER });

    expect(textOf(query(host, '[data-waiting]'))).toBe(
      'Your email is confirmed, and a place is open now.',
    );
    expect(links(host)).toEqual([['Finish signing up', '/train/sign-up']]);
    expect(host.textContent).not.toContain('Sign up with this account');
  });

  it('says it is checking while the status is on its way', async () => {
    const answer = new Subject<TrainSignUp>();
    const { fixture, host } = await render(() => answer);

    expect(textOf(query(host, '[role="status"]'))).toBe('Checking sign-up…');
    expect(host.querySelector('h1')).toBeNull();

    answer.next(OPEN);
    answer.complete();
    await settle(fixture);
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(links(host)[0]).toEqual(['Create your account', '/train/sign-up']);
  });

  it('says so when the status cannot be read, and reads it again on Try again', async () => {
    const reads = [
      () => throwError(() => new HttpErrorResponse({ status: 0 })),
      () => throwError(() => new HttpErrorResponse({ status: 503 })),
      () => of(OPEN),
    ];
    let read = 0;
    const { fixture, host, status } = await render(() => reads[read++]());

    expect(textOf(host.querySelector('.auth-eyebrow'))).toBe('TB Gym');
    expect(textOf(host.querySelector('h1'))).toBe('Train with TB Gym.');
    expect(textOf(query(host, '[role="alert"]'))).toBe(
      'This page couldn’t load. Check your connection and try again.',
    );
    expect(links(host)).toEqual([]);

    // A retry that fails too keeps the failure on screen.
    press(host, 'Try again');
    await settle(fixture);
    expect(status).toHaveBeenCalledTimes(2);
    expect(textOf(query(host, '[role="alert"]'))).toBe(
      'This page couldn’t load. Check your connection and try again.',
    );

    press(host, 'Try again');
    await settle(fixture);
    expect(status).toHaveBeenCalledTimes(3);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(links(host)[0]).toEqual(['Create your account', '/train/sign-up']);
  });

  it('asks search engines to leave the page out while sign-up is closed, and takes the tag away with the page', async () => {
    const { fixture } = await render(CLOSED_SIGN_UP);

    expect(robots().map((tag) => tag.getAttribute('content'))).toEqual(['noindex']);

    fixture.destroy();
    expect(robots()).toHaveLength(0);
  });

  it('asks the same when the status cannot be read, once however often it is retried', async () => {
    const { fixture, host } = await render(() =>
      throwError(() => new HttpErrorResponse({ status: 0 })),
    );

    expect(robots().map((tag) => tag.getAttribute('content'))).toEqual(['noindex']);
    press(host, 'Try again');
    await settle(fixture);
    expect(robots()).toHaveLength(1);

    fixture.destroy();
    expect(robots()).toHaveLength(0);
  });

  it('takes back its own tag when Try again finds sign-up open', async () => {
    const answers = [
      throwError(() => new HttpErrorResponse({ status: 0 })),
      of(OPEN),
    ] as Observable<TrainSignUp>[];
    const { fixture, host } = await render(() => answers.shift() ?? of(OPEN));
    expect(robots().map((tag) => tag.getAttribute('content'))).toEqual(['noindex']);

    press(host, 'Try again');
    await settle(fixture);

    expect(textOf(query(host, '[data-clock]'))).toBe('Training days follow Beirut time.');
    expect(robots()).toHaveLength(0);
  });

  it('lets search engines list the page while sign-up is open or full', async () => {
    for (const answer of [OPEN, FULL, { ...OPEN, caller: 'Joined' as const }]) {
      await render(answer);
      expect(robots()).toHaveLength(0);
      TestBed.resetTestingModule();
    }
  });

  it('leaves a robots tag the document already has: no second one, and it stays when the page goes', async () => {
    const own = document.createElement('meta');
    own.setAttribute('name', 'robots');
    own.setAttribute('content', 'noindex, nofollow');
    document.head.append(own);
    const { fixture } = await render(CLOSED_SIGN_UP);

    expect(robots()).toEqual([own]);

    fixture.destroy();
    expect(robots()).toEqual([own]);
  });

  it('counts no visit: it never reads the website’s settings or starts its analytics', async () => {
    for (const answer of [OPEN, FULL, CLOSED_SIGN_UP]) {
      const { analytics, settings } = await render(answer);

      expect(settings.load).not.toHaveBeenCalled();
      expect(analytics.start).not.toHaveBeenCalled();
      expect(analytics.pageview).not.toHaveBeenCalled();
      TestBed.resetTestingModule();
    }
    expect(document.head.querySelector('script[data-analytics]')).toBeNull();
  });
});
