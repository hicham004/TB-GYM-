import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { press, settle, tick } from '../../../testing/dom';
import { BillingAccessApi } from '../billing/billing-access';
import { FoundingBadgeApi } from '../billing/founding-api';
import type { FoundingBadge } from '../billing/founding.models';
import { AccountFounding } from './account-founding';

const NEVER = /\b(verified|certified|qualified|licensed|approved)\b/i;

const badge = (overrides: Partial<FoundingBadge> = {}): FoundingBadge => ({
  state: 'Earned',
  foundingSince: '2026-09-15',
  clientsWithActivePlan: null,
  clientsNeeded: 10,
  monthsSinceStart: null,
  monthsNeeded: 2,
  termsVersion: 1,
  earnedOn: '2026-10-03',
  endedOn: null,
  hidden: false,
  ...overrides,
});

const waiting = badge({
  state: 'Waiting',
  clientsWithActivePlan: 7,
  monthsSinceStart: 1,
  earnedOn: null,
});

interface Options {
  role?: 'Owner' | 'Coach' | 'Client';
  getBadge?: () => Observable<FoundingBadge>;
  setHidden?: (hidden: boolean) => Observable<FoundingBadge>;
}

async function render(options: Options = {}) {
  const api = {
    getBadge: vi.fn(options.getBadge ?? (() => of(badge()))),
    setHidden: vi.fn(options.setHidden ?? ((hidden: boolean) => of(badge({ hidden })))),
  };
  const csrf = { refresh: vi.fn(() => Promise.resolve()) };
  TestBed.configureTestingModule({
    imports: [AccountFounding],
    providers: [
      provideRouter([]),
      { provide: FoundingBadgeApi, useValue: api },
      { provide: CsrfService, useValue: csrf },
      {
        provide: BillingAccessApi,
        useValue: {
          getAccess: () =>
            of({
              isReadOnly: false,
              hasOverdueInvoice: false,
              readOnlyFrom: null,
              foundingCoach: 'Earned',
            }),
        },
      },
      {
        provide: TenantStore,
        useValue: {
          selectedTenantId: signal('tenant-1'),
          selectedMembership: signal({ tenantId: 'tenant-1', role: options.role ?? 'Owner' }),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(AccountFounding);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, csrf };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const body = (host: HTMLElement) => host.querySelector('.body')!;
const box = (host: HTMLElement) => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

describe('Settings › Founding coach (notes plan N3b)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('shows an earned badge with its line and its day, and the switch ticked', async () => {
    const { host } = await render();

    expect(textOf(host.querySelector('h1'))).toBe('Founding coach');
    const earned = host.querySelector('[data-founding-earned]')!;
    const pill = earned.querySelector('app-status-pill')!;
    expect(textOf(pill)).toBe('Founding coach');
    expect(pill.classList).toContain('success');
    expect(textOf(earned.querySelector('.line'))).toBe(
      'One of the first coaches on TB Gym. Not a check of qualifications',
    );
    expect(textOf(earned)).toContain('Earned Oct 3, 2026');
    expect(box(host).checked).toBe(true);
    expect(textOf(host.querySelector('label[for]'))).toBe('Show the badge to your clients');
    expect(textOf(host.querySelector(`#${box(host).getAttribute('aria-describedby')}`))).toBe(
      'They see it under Your coach on their Me page. You can hide it any time.',
    );
    expect(textOf(body(host))).not.toMatch(NEVER);
  });

  it('leaves the switch unticked while the owner hides the badge', async () => {
    const { host } = await render({ getBadge: () => of(badge({ hidden: true })) });

    expect(box(host).checked).toBe(false);
  });

  it('says where a waiting badge stands, every number the server’s, with no switch yet', async () => {
    const { host } = await render({ getBadge: () => of(waiting) });

    const panel = host.querySelector('[data-founding-waiting]')!;
    expect(Array.from(panel.querySelectorAll('p'), textOf)).toEqual([
      'Your coaching space is one of the first on TB Gym, founding since Sep 15, 2026.',
      'The badge is earned once 10 of your clients have an active plan and your space is 2 months old. So far: 7 of 10 clients, 1 of 2 months.',
    ]);
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    expect(host.querySelector('app-status-pill')).toBeNull();
    expect(textOf(body(host))).not.toMatch(NEVER);
  });

  it('says nothing is here once the status ended or for a space never marked', async () => {
    for (const state of ['Ended', 'NotFounding'] as const) {
      const { host } = await render({ getBadge: () => of(badge({ state, earnedOn: null })) });
      const nothing = host.querySelector('[data-founding-nothing]')!;
      expect(textOf(nothing.querySelector('h2'))).toBe('Nothing here');
      const back = nothing.querySelector('a')!;
      expect(textOf(back)).toBe('Back to Settings');
      expect(back.getAttribute('href')).toBe('/workspace');
      TestBed.resetTestingModule();
    }
  });

  it('asks the server nothing for a coach or a client, who find nothing here', async () => {
    const coach = await render({ role: 'Coach' });
    expect(coach.api.getBadge).not.toHaveBeenCalled();
    expect(textOf(coach.host.querySelector('[data-founding-nothing] h2'))).toBe('Nothing here');
    expect(coach.host.querySelector('[data-founding-nothing] a')!.getAttribute('href')).toBe(
      '/notifications/settings',
    );
    TestBed.resetTestingModule();

    const client = await render({ role: 'Client' });
    expect(client.api.getBadge).not.toHaveBeenCalled();
    const back = client.host.querySelector('[data-founding-nothing] a')!;
    expect(textOf(back)).toBe('Back to Me');
    expect(back.getAttribute('href')).toBe('/me');
  });

  it('treats a refusal as nothing here, and anything else as worth another try', async () => {
    const refused = await render({
      getBadge: () => throwError(() => new HttpErrorResponse({ status: 403 })),
    });
    expect(refused.host.querySelector('[data-founding-nothing]')).not.toBeNull();
    TestBed.resetTestingModule();

    let failing = true;
    const view = await render({
      getBadge: () =>
        failing ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(badge()),
    });
    expect(textOf(view.host.querySelector('[role="alert"]'))).toBe(
      'Your founding status couldn’t be loaded.',
    );
    failing = false;
    press(view.host, 'Try again');
    await settle(view.fixture);
    expect(view.host.querySelector('[data-founding-earned]')).not.toBeNull();
  });

  it('hides the badge at once after reading the security token, and shows what the server answers', async () => {
    const answer = new Subject<FoundingBadge>();
    const view = await render({ setHidden: () => answer });

    tick(view.host, 'Show the badge to your clients', false);
    await settle(view.fixture);
    expect(view.api.setHidden).toHaveBeenCalledWith(true);
    expect(view.csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      view.api.setHidden.mock.invocationCallOrder[0],
    );
    expect(textOf(view.host.querySelector('[role="status"]'))).toBe('Saving your choice…');
    // The box stays enabled, so focus stays on it; a press meanwhile is put back and not sent.
    expect(box(view.host).disabled).toBe(false);
    tick(view.host, 'Show the badge to your clients', true);
    expect(box(view.host).checked).toBe(false);
    expect(view.api.setHidden).toHaveBeenCalledTimes(1);

    answer.next(badge({ hidden: true }));
    answer.complete();
    await settle(view.fixture);
    expect(view.host.querySelector('[role="status"]')).toBeNull();
    expect(box(view.host).checked).toBe(false);

    view.api.setHidden.mockImplementation((hidden: boolean) => of(badge({ hidden })));
    tick(view.host, 'Show the badge to your clients', true);
    await settle(view.fixture);
    expect(view.api.setHidden).toHaveBeenLastCalledWith(false);
    expect(box(view.host).checked).toBe(true);
  });

  it('puts the box back when the save is refused, says so, and reads the badge again', async () => {
    const view = await render({
      setHidden: () => throwError(() => new HttpErrorResponse({ status: 500 })),
    });

    tick(view.host, 'Show the badge to your clients', false);
    await settle(view.fixture);

    expect(box(view.host).checked).toBe(true);
    expect(textOf(view.host.querySelector('[role="alert"]'))).toBe(
      'Couldn’t save your choice. Try again.',
    );
    expect(view.api.getBadge).toHaveBeenCalledTimes(2);
  });

  it('draws what the server answers even when it differs from the press', async () => {
    // Shown again from another device between the write and its read-back.
    const view = await render({ setHidden: () => of(badge({ hidden: false })) });

    tick(view.host, 'Show the badge to your clients', false);
    await settle(view.fixture);

    expect(box(view.host).checked).toBe(true);
  });

  it('puts a press during the re-read after a refusal back to what the server holds', async () => {
    const reread = new Subject<FoundingBadge>();
    let reads = 0;
    const view = await render({
      getBadge: () => (++reads === 1 ? of(badge()) : reread),
      setHidden: () => throwError(() => new HttpErrorResponse({ status: 500 })),
    });

    tick(view.host, 'Show the badge to your clients', false);
    await settle(view.fixture);
    expect(box(view.host).checked).toBe(true);
    tick(view.host, 'Show the badge to your clients', false);
    expect(box(view.host).checked).toBe(true);
    expect(view.api.setHidden).toHaveBeenCalledTimes(1);

    reread.next(badge());
    reread.complete();
    await settle(view.fixture);
    expect(box(view.host).checked).toBe(true);
  });

  it('says where a waiting badge stands under terms other than the first', async () => {
    const { host } = await render({
      getBadge: () =>
        of(
          badge({
            state: 'Waiting',
            clientsWithActivePlan: 5,
            clientsNeeded: 12,
            monthsSinceStart: 1,
            monthsNeeded: 3,
            termsVersion: 2,
            earnedOn: null,
          }),
        ),
    });

    expect(textOf(host.querySelector('[data-founding-progress]'))).toBe(
      'The badge is earned once 12 of your clients have an active plan and your space is 3 months old. So far: 5 of 12 clients, 1 of 3 months.',
    );
  });

  it('leaves focus where the owner moved it while a refused save was read again', async () => {
    let state: FoundingBadge['state'] = 'Earned';
    const view = await render({
      getBadge: () => of(badge({ state })),
      setHidden: () => throwError(() => new HttpErrorResponse({ status: 404 })),
    });
    const security = Array.from(view.host.querySelectorAll<HTMLAnchorElement>('nav a')).find(
      (link) => link.textContent?.trim() === 'Password and security',
    )!;

    state = 'Ended';
    tick(view.host, 'Show the badge to your clients', false);
    security.focus();
    await settle(view.fixture);

    expect(view.host.querySelector('[data-founding-nothing]')).not.toBeNull();
    expect(document.activeElement).toBe(security);
  });

  it('finds nothing here when TB Gym ended the status while the page was open', async () => {
    let state: FoundingBadge['state'] = 'Earned';
    const view = await render({
      getBadge: () => of(badge({ state })),
      setHidden: () => throwError(() => new HttpErrorResponse({ status: 404 })),
    });

    const accountRows = () =>
      Array.from(
        view.host.querySelectorAll('[aria-labelledby="settings-group-account"] a'),
        (link) => link.textContent?.trim(),
      );
    expect(accountRows()).toContain('Founding coach');

    state = 'Ended';
    box(view.host).focus();
    tick(view.host, 'Show the badge to your clients', false);
    await settle(view.fixture);

    const nothing = view.host.querySelector('[data-founding-nothing]');
    expect(nothing).not.toBeNull();
    // The row goes with the page, and focus lands on what the page now says.
    expect(accountRows()).not.toContain('Founding coach');
    expect(document.activeElement).toBe(nothing!.querySelector('h2'));
  });
});
