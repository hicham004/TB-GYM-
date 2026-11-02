import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import type { ClientTrainingDayResult } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { MessagingRealtimeService } from '../../core/messaging/messaging-realtime.service';
import { NotificationStore } from '../../core/notifications/notification.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceBrandStore } from '../../core/theme/workspace-brand.store';
import type { UpcomingTraining } from '../training/training-read.models';
import type { RenewalStatus } from './renewal.models';
import { press, settle } from '../../../testing/dom';
import { fakeMotion, provideFakeMotion } from '../../../testing/motion-fake';
import { day, fakeClientAccess, TODAY, upcoming, workout } from '../../../testing/today-fixtures';
import { ClientToday } from './client-today';
import { PLAYER_PRELOAD, REVEAL_CLASS } from './open-moment';

const running: RenewalStatus = {
  planEnded: false,
  endedOn: null,
  endsOn: null,
  planId: null,
  coachName: null,
  lastRequest: null,
  canAsk: false,
};
const ended: RenewalStatus = {
  planEnded: true,
  endedOn: '2026-10-04',
  endsOn: null,
  planId: 'plan-1',
  coachName: 'Hicham Haddad',
  lastRequest: null,
  canAsk: true,
};
const preload = vi.fn(() => Promise.resolve());
const asked: RenewalStatus = {
  ...ended,
  lastRequest: { id: 'request-1', requestedOn: '2026-10-05', askAgainFrom: '2026-10-12' },
  canAsk: false,
};

async function render(
  options: {
    day?: ClientTrainingDayResult;
    upcoming?: UpcomingTraining;
    access?: ReturnType<typeof fakeClientAccess>;
    api?: Record<string, unknown>;
    unread?: number;
    logoUrl?: string | null;
    providers?: unknown[];
  } = {},
) {
  const brand = { logoUrl: signal(options.logoUrl ?? null), logoFailed: vi.fn() };
  const tenant = signal<string | null>('tenant-1');
  const api = {
    getMyTrainingToday: vi.fn(() => of(options.day ?? day([workout()]))),
    getMyTrainingWeek: vi.fn(() =>
      of({
        isAllowed: true,
        accessReason: 'Granted',
        localDate: '2026-09-21',
        weekStart: '2026-09-21',
        days: [0, 1, 2, 3, 4, 5, 6].map((offset) => ({
          date: `2026-09-${21 + offset}`,
          scheduled: offset === 0 ? 1 : 0,
          completed: 0,
        })),
      }),
    ),
    getOwnCoach: vi.fn(() => of({ name: 'Hicham Haddad' })),
    getMyUpcomingTraining: vi.fn(() => of(options.upcoming ?? upcoming())),
    getWorkspace: vi.fn(() => of({ currentDate: '2026-09-21' })),
    // No meal plan: "nothing here", a 200 with null (audit AUTH-12).
    getMyNutritionDay: vi.fn(() => of(null)),
    getOwnPlans: vi.fn(() => of({ today: '2026-09-21', plans: [], coachName: null })),
    listOwnCheckInAssignments: vi.fn(() => of({ clientProfileId: 'c', total: 0, items: [] })),
    listConversations: vi.fn(() =>
      of({
        items: [],
        hasMore: false,
        nextBeforeActivityAtUtc: null,
        nextBeforeConversationId: null,
      }),
    ),
    getOwnRenewalStatus: vi.fn(() => of(running)),
    requestRenewal: vi.fn(() => of(asked)),
    ...options.api,
  };
  await TestBed.configureTestingModule({
    imports: [ClientToday],
    providers: [
      provideRouter([]),
      { provide: TenantStore, useValue: { selectedTenantId: tenant } },
      { provide: WorkspaceBrandStore, useValue: brand },
      { provide: ApiClient, useValue: api },
      { provide: ClientAccessStore, useValue: options.access ?? fakeClientAccess() },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      {
        provide: AuthStore,
        useValue: {
          user: signal({ id: 'maya', displayName: 'Maya Rahman', email: 'maya@example.test' }),
        },
      },
      {
        provide: NotificationStore,
        useValue: { unread: signal(options.unread ?? 0), isAvailable: signal(true) },
      },
      { provide: MessagingRealtimeService, useValue: { listRefreshRequests: signal(0) } },
      // The player's chunks are not loaded into these tests; the asks for them are counted (W7).
      { provide: PLAYER_PRELOAD, useValue: preload },
      ...((options.providers ?? []) as never[]),
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ClientToday);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return { fixture, host, api, tenant, read: () => (host.textContent ?? '').replace(/\s+/g, ' ') };
}

describe('ClientToday', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('heads the page with the workspace date, Today, Notifications and Me', async () => {
    const { host, read } = await render({ unread: 2 });

    expect(read()).toContain('Sunday 20 September');
    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Today, Maya.');
    // A greeting is a moment: the interface's face, with the name in the serif (plan §3, A14a).
    expect(host.querySelector('h1 .serif')?.textContent?.trim()).toBe('Maya.');
    // The name is isolated in its own direction and the full stop is not, so a name written right to
    // left keeps the stop at the end of the line.
    expect(host.querySelector('h1 [dir="auto"]')?.textContent).toBe('Maya');
    expect(host.querySelector('.today-coach')?.textContent).toContain('Hicham Haddad');
    expect(host.querySelectorAll('.today-week-days li')).toHaveLength(7);
    expect(read()).toContain('0 of 1 sessions done');
    expect(read()).not.toMatch(/Good (morning|afternoon|evening)/);
    const bell = host.querySelector('a[href="/notifications"]');
    expect(bell?.textContent).toContain('Notifications, 2 unread');
    expect(bell?.querySelector('.today-count')?.textContent?.trim()).toBe('2');
    const me = host.querySelector('a[href="/me"]');
    expect(me?.textContent).toContain('Me: Maya Rahman');
    expect(me?.querySelector('app-avatar')?.textContent?.trim()).toBe('MR');
  });

  it('shows the coach’s logo where their initials were, and asks again when it breaks', async () => {
    const { host } = await render({ logoUrl: '/api/media/logo-1/content' });

    const coach = host.querySelector('.today-coach');
    expect(coach?.querySelector('app-avatar')).toBeNull();
    const logo = coach?.querySelector<HTMLImageElement>('.today-logo img');
    expect(logo?.getAttribute('src')).toBe('/api/media/logo-1/content');
    expect(logo?.getAttribute('alt')).toBe('');
    expect(coach?.textContent).toContain('Hicham Haddad');

    logo?.dispatchEvent(new Event('error'));
    expect(TestBed.inject(WorkspaceBrandStore).logoFailed).toHaveBeenCalledTimes(1);
  });

  it('shows the scheduled session with one dominant action that records nothing', async () => {
    const { host, read } = await render();

    expect(read()).toContain('Week 4 of 8 · Today');
    expect(host.querySelector('#today-training-heading')?.textContent?.trim()).toBe(
      'Upper Body — Strength B',
    );
    expect(read()).toContain('3 exercises · 10 sets');
    expect(read()).toContain('Coach’s note: Top set first.');
    const open = host.querySelector<HTMLAnchorElement>('a.today-action');
    expect(open?.textContent?.trim()).toBe('Open workout');
    expect(open?.getAttribute('href')).toBe('/training/today?sessionId=session-b');
    expect(read()).toContain('Nothing is recorded until you start the workout.');
    expect(host.querySelectorAll('.today-card a.today-action')).toHaveLength(1);
  });

  it('says 1 exercise and 1 set, never "1 exercises"', async () => {
    const single = workout({
      coachNotes: null,
      exercises: [{ sets: [{ isCompleted: false }] }] as never,
    });
    const { host, read } = await render({ day: day([single]) });

    expect(read()).toContain('1 exercise · 1 set');
    expect(host.querySelector('.note')).toBeNull();
  });

  it('continues an earlier workout first and links the one scheduled today', async () => {
    const earlier = workout({
      sessionId: 'session-a',
      name: 'Lower A',
      status: 'InProgress',
      workoutExecutionId: 'x',
    });
    const { host, read } = await render({
      upcoming: upcoming({
        unfinishedWorkouts: [{ date: '2026-09-19', workout: earlier, hasMoreNotes: false }],
      }),
    });

    expect(read()).toContain('Started Sat 19 Sep');
    expect(host.querySelector('a.today-action')?.textContent?.trim()).toBe('Continue workout');
    const also = host.querySelector('a[href="/training/today?sessionId=session-b"].text-link');
    expect(also?.textContent?.replace(/\s+/g, ' ')).toContain(
      'Also scheduled today: Upper Body — Strength B',
    );
  });

  it('says a missed session started late was planned for its day and started today', async () => {
    const late = workout({
      sessionId: 'session-a',
      name: 'Lower A',
      status: 'InProgress',
      workoutExecutionId: 'x',
      // 09:00 in Beirut on the workspace's today, Sun 20 Sep.
      startedAtUtc: '2026-09-20T06:00:00.000Z',
    });
    const { read } = await render({
      day: day([]),
      upcoming: upcoming({
        timeZoneId: 'Asia/Beirut',
        unfinishedWorkouts: [{ date: '2026-09-17', workout: late, hasMoreNotes: false }],
      }),
    });

    expect(read()).toContain('Planned for Thu 17 Sep · started today');
    expect(read()).not.toContain('Started Thu 17 Sep');
  });

  it('says Scheduled today when no program week covers today', async () => {
    const { read } = await render({ upcoming: upcoming({ todayCoverage: null }) });
    expect(read()).toContain('Scheduled today');
    expect(read()).not.toContain('Week 4 of 8');
  });

  it('counts the logged sets of a session in progress today', async () => {
    const started = workout({
      status: 'InProgress',
      workoutExecutionId: 'execution-1',
      exercises: [{ sets: [{ isCompleted: true }, { isCompleted: false }] }] as never,
    });
    const { read } = await render({ day: day([started]) });

    expect(read()).toContain('In progress · 1 of 2 sets logged');
    expect(read()).toContain('Continue workout');
  });

  it('offers the completed workout outlined, with no filled action', async () => {
    const { host, read } = await render({
      day: day([workout({ status: 'Completed', workoutExecutionId: 'execution-1' })]),
    });

    expect(read()).toContain('Week 4 of 8 · Completed today');
    const view = host.querySelector('a.today-action');
    expect(view?.textContent?.trim()).toBe('View workout');
    expect(view?.classList).toContain('tb-button--outlined');
  });

  it('links the other sessions of a busy day', async () => {
    const { read } = await render({
      day: day([
        workout({ sessionId: 'a' }),
        workout({ sessionId: 'b' }),
        workout({ sessionId: 'c' }),
      ]),
    });

    expect(read()).toContain('2 more sessions today');
  });

  it('calls a shared week with no session a rest day and names the next one', async () => {
    const { host, read } = await render({
      day: day(),
      upcoming: upcoming({ nextSession: { sessionId: 'n', date: '2026-09-22', name: 'Lower B' } }),
    });

    expect(read()).toContain('Rest day');
    expect(read()).toContain('No workout is scheduled today.');
    expect(read()).toContain('Next: Tue 22 Sep · Lower B');
    expect(host.querySelector('a.today-action')).toBeNull();
  });

  it('never blames the coach for a week that is not shared yet', async () => {
    const coverage = upcoming().todayCoverage!;
    const { host, read } = await render({
      day: day(),
      upcoming: upcoming({
        todayCoverage: {
          ...coverage,
          activeBlock: { ...coverage.activeBlock!, isCurrentWeekPublished: false },
        },
      }),
    });

    expect(read()).toContain('This week’s plan is on its way.');
    expect(read()).toContain('Check back soon.');
    expect(read()).not.toContain('Rest day');
    expect(read()).not.toMatch(/coach (hasn’t|has not|didn’t)/i);
    expect(host.querySelector('a.today-action')).toBeNull();
  });

  it('gives the next program’s start between programs', async () => {
    const { read } = await render({
      day: day(),
      upcoming: upcoming({
        todayCoverage: { activeBlock: null, nextBlockStartDate: '2026-10-05' },
      }),
    });

    expect(read()).toContain('Your next program starts Mon 5 Oct');
    expect(read()).not.toContain('Rest day');
  });

  it('says nothing is assigned, offering a message only while messaging is open', async () => {
    const none = upcoming({ todayCoverage: { activeBlock: null, nextBlockStartDate: null } });
    const open = await render({ day: day(), upcoming: none });
    expect(open.read()).toContain('Nothing assigned yet');
    expect(open.host.querySelector('a[href="/messages"].text-link')).not.toBeNull();
    TestBed.resetTestingModule();

    const closed = await render({
      day: day(),
      upcoming: none,
      access: fakeClientAccess({ Messaging: 'Paused' }),
    });
    expect(closed.host.querySelector('a[href="/messages"].text-link')).toBeNull();
  });

  it('explains closed training access without a filled action', async () => {
    const { host, read } = await render({ day: day([], false, 'Paused') });

    expect(read()).toContain('Training is not available');
    expect(read()).toContain('Your coaching plan is paused.');
    expect(host.querySelector('a.today-action')).toBeNull();
  });

  it('leaves training out for a client whose plan has no training but has nutrition', async () => {
    const { host, read } = await render({
      day: day([], false, 'NoEntitlement'),
      access: fakeClientAccess({ Training: 'NoEntitlement' }),
    });

    expect(host.querySelector('.today-card')).toBeNull();
    expect(read()).not.toContain('Nothing assigned yet');
  });

  it('tells a client on sessions alone nothing is missing from their plan (critique B10c)', async () => {
    const { host, read } = await render({
      day: day([], false, 'NoEntitlement'),
      access: fakeClientAccess({
        Training: 'NoEntitlement',
        Nutrition: 'NoEntitlement',
        CheckIns: 'NoEntitlement',
        Messaging: 'NoEntitlement',
        Sessions: 'Granted',
      }),
    });

    expect(host.querySelector('.today-card')).toBeNull();
    expect(read()).not.toContain('Nothing assigned yet');
  });

  it('never renders a rest day while loading and ignores a late reply from another workspace', async () => {
    const delayed = new Subject<ClientTrainingDayResult>();
    const { fixture, host, tenant, read } = await render({
      day: day(),
      api: { getMyTrainingToday: vi.fn().mockReturnValueOnce(delayed).mockReturnValue(of(day())) },
    });
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Loading your workout');
    expect(read()).not.toContain('Rest day');

    tenant.set('tenant-2');
    await settle(fixture);
    delayed.next(day([], false, 'Expired'));
    delayed.complete();
    await settle(fixture);

    expect(read()).toContain('Rest day');
    expect(read()).not.toContain('not available');
  });

  it('reports a failed training read, takes the date from the workspace and retries', async () => {
    const { fixture, host, api, read } = await render({
      api: {
        getMyTrainingToday: vi
          .fn()
          .mockReturnValueOnce(throwError(() => new Error()))
          .mockReturnValue(of(day([workout()]))),
      },
    });

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t load today');
    expect(read()).toContain('Monday 21 September');
    // The other sections are unaffected by the training failure.
    expect(read()).toContain('Also today');

    press(host, 'Retry');
    await settle(fixture);
    expect(api.getMyTrainingToday).toHaveBeenCalledTimes(2);
    expect(read()).toContain('Week 4 of 8 · Today');
    expect(read()).toContain('Sunday 20 September');
  });

  it('shows no date at all rather than guessing one from the browser clock', async () => {
    const { host } = await render({
      api: {
        getMyTrainingToday: vi.fn(() => throwError(() => new Error())),
        getWorkspace: vi.fn(() => throwError(() => new Error())),
      },
    });

    // The date's line stays, empty, so the heading never moves (audit UIQ-5).
    expect(host.querySelector('.today-date')?.textContent?.trim()).toBe('');
    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Today, Maya.');
  });

  it('keeps using the workspace date that came with the training read', async () => {
    const { api, read } = await render();
    expect(read()).toContain('Sunday 20 September');
    expect(api.getWorkspace).not.toHaveBeenCalled();
    expect(TODAY).toBe('2026-09-20');
  });
  describe('drawn without parts pushing each other (audit UIQ-5)', () => {
    const WEEK = {
      isAllowed: true,
      accessReason: 'Granted',
      localDate: '2026-09-21',
      weekStart: '2026-09-21',
      days: [0, 1, 2, 3, 4, 5, 6].map((offset) => ({
        date: `2026-09-${21 + offset}`,
        scheduled: offset === 0 ? 1 : 0,
        completed: 0,
      })),
    };

    it('keeps the coach’s place while their name is read, so the heading beside it does not rewrap', async () => {
      const coach = new Subject<{ name: string }>();
      const { fixture, host } = await render({ api: { getOwnCoach: vi.fn(() => coach) } });

      expect(host.querySelector('.today-coach--waiting')?.getAttribute('aria-hidden')).toBe('true');
      expect(host.querySelector('.today-coach:not(.today-coach--waiting)')).toBeNull();

      coach.next({ name: 'Hicham Haddad' });
      coach.complete();
      await settle(fixture);

      expect(host.querySelector('.today-coach--waiting')).toBeNull();
      expect(host.querySelector('.today-coach')?.textContent).toContain('Hicham Haddad');
    });

    it('draws the week and the day’s card together, once both have answered', async () => {
      const week = new Subject<typeof WEEK>();
      const { fixture, host } = await render({ api: { getMyTrainingWeek: vi.fn(() => week) } });

      const waiting = host.querySelector('.today-waiting');
      expect(waiting?.getAttribute('role')).toBe('status');
      expect(waiting?.textContent).toContain('Loading your workout…');
      expect(host.querySelector('section.today-week')).toBeNull();
      expect(host.querySelector('#today-training-heading')).toBeNull();

      week.next(WEEK);
      week.complete();
      await settle(fixture);

      expect(host.querySelector('.today-waiting')).toBeNull();
      expect(host.querySelector('section.today-week')).not.toBeNull();
      expect(host.querySelector('#today-training-heading')).not.toBeNull();
    });

    it('holds Also today and the coach’s message until they have answered too', async () => {
      const latest = new Subject<unknown>();
      const { fixture, host } = await render({ api: { listConversations: vi.fn(() => latest) } });

      expect(host.querySelector('#today-training-heading')).not.toBeNull();
      expect(host.querySelector('.today-below')?.classList).toContain('today-below--waiting');

      latest.next({
        items: [],
        hasMore: false,
        nextBeforeActivityAtUtc: null,
        nextBeforeConversationId: null,
      });
      latest.complete();
      await settle(fixture);

      expect(host.querySelector('.today-below')?.classList).not.toContain('today-below--waiting');
    });

    it('keeps the page drawn while a Retry reads the day again', async () => {
      const today = vi
        .fn()
        .mockReturnValueOnce(throwError(() => new Error()))
        .mockReturnValueOnce(new Subject());
      const { fixture, host } = await render({ api: { getMyTrainingToday: today } });
      expect(host.querySelector('section.today-week')).not.toBeNull();

      press(host, 'Retry');
      await settle(fixture);

      // Only the card says it is loading; the week stays where it was.
      expect(host.querySelector('.today-waiting')).toBeNull();
      expect(host.querySelector('section.today-week')).not.toBeNull();
      expect(host.querySelector('.today-card .today-skeleton')).not.toBeNull();
    });
  });

  describe('in a plan’s last days (critique B14)', () => {
    const endsSoon: RenewalStatus = {
      ...running,
      endsOn: '2026-09-24',
      planId: 'plan-1',
      coachName: 'Hicham Haddad',
      canAsk: true,
    };

    it('keeps the workout and offers to ask under it', async () => {
      const { host, read } = await render({
        api: { getOwnRenewalStatus: vi.fn(() => of(endsSoon)) },
      });

      expect(
        host.querySelector('#today-renewal-heading')?.textContent?.replace(/\s+/g, ' ').trim(),
      ).toBe('Your coaching plan with Hicham ends on Thu 24 Sep.');
      const hero = host.querySelector('.today-card--hero');
      expect(hero).not.toBeNull();
      const card = host.querySelector('app-today-renewal');
      expect(hero!.compareDocumentPosition(card!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(read()).toContain('Ask to renew');
    });

    it('leaves the coach out when they have no name', async () => {
      const { host } = await render({
        api: { getOwnRenewalStatus: vi.fn(() => of({ ...endsSoon, coachName: null })) },
      });

      expect(
        host.querySelector('#today-renewal-heading')?.textContent?.replace(/\s+/g, ' ').trim(),
      ).toBe('Your coaching plan ends on Thu 24 Sep.');
    });

    it('asks once, says so, and the workout stays', async () => {
      const sent: RenewalStatus = {
        ...endsSoon,
        canAsk: false,
        lastRequest: asked.lastRequest,
      };
      const { fixture, host, api } = await render({
        api: {
          getOwnRenewalStatus: vi.fn(() => of(endsSoon)),
          requestRenewal: vi.fn(() => of(sent)),
        },
      });

      host.querySelector<HTMLButtonElement>('app-today-renewal button')!.click();
      await settle(fixture);

      expect(api.requestRenewal).toHaveBeenCalledTimes(1);
      expect(
        host
          .querySelector('app-today-renewal [role="status"]')
          ?.textContent?.replace(/\s+/g, ' ')
          .trim(),
      ).toBe('Renewal request sent on Mon 5 Oct. You can ask again from Mon 12 Oct.');
      expect(host.querySelector('app-today-renewal button')).toBeNull();
      expect(host.querySelector('.today-card--hero')).not.toBeNull();
    });

    it('holds what sits under the workout until the answer is in', async () => {
      const pending = new Subject<RenewalStatus>();
      const { fixture, host } = await render({
        api: { getOwnRenewalStatus: vi.fn(() => pending) },
      });

      expect(host.querySelector('.today-below')?.classList).toContain('today-below--waiting');
      expect(host.querySelector('.today-card--hero')).not.toBeNull();

      pending.next(endsSoon);
      pending.complete();
      await settle(fixture);

      expect(host.querySelector('.today-below')?.classList).not.toContain('today-below--waiting');
      expect(host.querySelector('app-today-renewal')).not.toBeNull();
    });

    it('shows no card for a plan that is not ending', async () => {
      const { host } = await render();

      expect(host.querySelector('app-today-renewal')).toBeNull();
    });
  });

  describe('when the whole plan has run out', () => {
    const expired = () => day([], false, 'Expired');
    const statusText = (host: HTMLElement) =>
      host
        .querySelector('app-today-renewal [role="status"]')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim();

    it('names the coach and the last day, and offers to ask for a renewal', async () => {
      const { host, read } = await render({
        day: expired(),
        api: { getOwnRenewalStatus: vi.fn(() => of(ended)) },
      });

      expect(
        host.querySelector('#today-renewal-heading')?.textContent?.replace(/\s+/g, ' ').trim(),
      ).toBe('Your coaching plan with Hicham Haddad ended on Sun 4 Oct.');
      expect(read()).not.toContain('Training is not available');
      expect(read()).not.toMatch(/\b(he|she|his|her|him)\b/i);
      const ask = host.querySelector<HTMLButtonElement>('app-today-renewal button');
      expect(ask?.textContent?.trim()).toBe('Ask to renew');
      expect(ask?.classList).toContain('tb-button--filled');
      expect(host.querySelector('a[href="/messages"]')).toBeNull();
    });

    it('offers it beside a pack that runs on, and Messaging stays closed (SES-010)', async () => {
      const { host } = await render({
        day: expired(),
        access: fakeClientAccess({
          Training: 'Expired',
          Nutrition: 'Expired',
          CheckIns: 'Expired',
          Messaging: 'Expired',
          Sessions: 'Granted',
        }),
        api: { getOwnRenewalStatus: vi.fn(() => of(ended)) },
      });

      expect(host.querySelector('app-today-renewal button')?.textContent?.trim()).toBe(
        'Ask to renew',
      );
      expect(host.querySelector('a[href="/messages"]')).toBeNull();
    });

    it('asks once and then says when it was sent and when the client can ask again', async () => {
      const { fixture, host, api, read } = await render({
        day: expired(),
        api: { getOwnRenewalStatus: vi.fn(() => of(ended)) },
      });

      press(host, 'Ask to renew');
      await settle(fixture);

      expect(api.requestRenewal).toHaveBeenCalledTimes(1);
      expect(TestBed.inject(CsrfService).refresh).toHaveBeenCalled();
      expect(statusText(host)).toBe(
        'Renewal request sent on Mon 5 Oct. You can ask again from Mon 12 Oct.',
      );
      expect(host.querySelector('app-today-renewal button')).toBeNull();
      expect(read()).toContain('Your coaching plan with Hicham Haddad ended on Sun 4 Oct.');
    });

    it('shows a request already sent in this window, with no button', async () => {
      const { host } = await render({
        day: expired(),
        api: { getOwnRenewalStatus: vi.fn(() => of(asked)) },
      });

      expect(host.querySelector('app-today-renewal button')).toBeNull();
      expect(statusText(host)).toContain('You can ask again from Mon 12 Oct.');
    });

    it('shows the plan as it is when it turned out not to have ended', async () => {
      const getOwnRenewalStatus = vi
        .fn()
        .mockReturnValueOnce(of(ended))
        .mockReturnValue(of(running));
      const { fixture, host, read } = await render({
        day: expired(),
        api: {
          getOwnRenewalStatus,
          requestRenewal: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 409 }))),
        },
      });

      press(host, 'Ask to renew');
      await settle(fixture);

      expect(getOwnRenewalStatus).toHaveBeenCalledTimes(2);
      expect(host.querySelector('app-today-renewal')).toBeNull();
      expect(read()).toContain('Training is not available');
    });

    it('reports a failed request and keeps the button', async () => {
      const { fixture, host } = await render({
        day: expired(),
        api: {
          getOwnRenewalStatus: vi.fn(() => of(ended)),
          requestRenewal: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
        },
      });

      press(host, 'Ask to renew');
      await settle(fixture);

      expect(host.querySelector('app-today-renewal [role="alert"]')?.textContent).toContain(
        'Couldn’t send your request. Try again.',
      );
      expect(host.querySelector('app-today-renewal button')).not.toBeNull();
    });

    it('never flashes the closed-access card while the renewal answer is on its way', async () => {
      const pending = new Subject<RenewalStatus>();
      const { fixture, host, read } = await render({
        day: expired(),
        api: { getOwnRenewalStatus: vi.fn(() => pending) },
      });
      expect(host.querySelector('[role="status"]')?.textContent).toContain('Loading your workout');
      expect(read()).not.toContain('Training is not available');

      pending.next(ended);
      pending.complete();
      await settle(fixture);
      expect(host.querySelector('app-today-renewal')).not.toBeNull();
    });

    it('keeps the plain closed card when the renewal answer cannot be read', async () => {
      const { read } = await render({
        day: expired(),
        api: { getOwnRenewalStatus: vi.fn(() => throwError(() => new Error())) },
      });

      expect(read()).toContain('Training is not available');
      expect(read()).toContain('Your coaching plan has ended');
    });
  });
});

describe('ClientToday, the card opens into the player (W7)', () => {
  const html = () => document.documentElement;

  /** A `ViewTransition` for jsdom: the update runs on a microtask, the end is settled by hand. */
  function fakeViewTransition() {
    let settleReady!: () => void;
    let failReady!: (reason: unknown) => void;
    let settleFinished!: () => void;
    const ready = new Promise<void>((resolve, reject) => {
      settleReady = resolve;
      failReady = reject;
    });
    const finished = new Promise<void>((resolve) => {
      settleFinished = resolve;
    });
    const updateCallbackDone = Promise.resolve();
    const transition = {
      ready,
      finished,
      updateCallbackDone,
      types: new Set<string>(),
      skipTransition: vi.fn(() => failReady(new DOMException('skipped', 'AbortError'))),
    };
    const start = vi.fn((update: () => Promise<void> | void) => {
      Promise.resolve()
        .then(update)
        .then(() => settleReady());
      return transition as unknown as ViewTransition;
    });
    return { transition, start, finish: () => settleFinished() };
  }

  function withViewTransitions(start: unknown): void {
    Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true });
  }

  beforeEach(() => preload.mockClear());
  afterEach(() => {
    TestBed.resetTestingModule();
    html().classList.remove(REVEAL_CLASS);
    delete (document as { startViewTransition?: unknown }).startViewTransition;
  });

  it('grows the card into the player: a plain click on Open workout navigates once, inside a view transition', async () => {
    const { start, finish } = fakeViewTransition();
    withViewTransitions(start);
    const { host } = await render({
      providers: [provideFakeMotion(fakeMotion({ allowed: true }))],
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const card = host.querySelector<HTMLElement>('.today-card')!;
    card.getBoundingClientRect = () =>
      ({ top: 300, left: 16, right: 374, bottom: 640, width: 358, height: 340 }) as DOMRect;
    const link = host.querySelector<HTMLAnchorElement>('.today-card a.today-action')!;
    expect(link.textContent?.trim()).toBe('Open workout');

    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));

    expect(start).toHaveBeenCalledTimes(1);
    expect(html().classList.contains(REVEAL_CLASS)).toBe(true);
    expect(html().style.getPropertyValue('--tb-open-top')).toBe('300px');
    expect(html().style.getPropertyValue('--tb-open-left')).toBe('16px');
    await new Promise((resolve) => setTimeout(resolve, 120));
    // Once, inside the transition: RouterLink's own navigation was stopped in the capture phase.
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(link.getAttribute('href'));
    expect(link.getAttribute('href')).toMatch(/^\/training\/today\?sessionId=/);

    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(html().classList.contains(REVEAL_CLASS)).toBe(false);
  });

  it('leaves a modifier click, and a plain click without motion, to RouterLink as before', async () => {
    const { start } = fakeViewTransition();
    withViewTransitions(start);
    const motion = fakeMotion({ allowed: true });
    const { host } = await render({ providers: [provideFakeMotion(motion)] });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const link = host.querySelector<HTMLAnchorElement>('.today-card a.today-action')!;
    // jsdom would try to follow the link the browser is left to open; nothing else listens here.
    host.addEventListener('click', (event) => event.preventDefault());

    link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }),
    );
    expect(start).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();

    motion.allowed.mockReturnValue(false);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(start).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(html().classList.contains(REVEAL_CLASS)).toBe(false);
  });

  it('preloads the player’s chunks when the browser is idle once the reads have settled', async () => {
    await render();

    expect(preload).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it('preloads at once on a press on the card, and not again when idle', async () => {
    const { host } = await render();

    host
      .querySelector('.today-card a.today-action')!
      .dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(preload).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(preload).toHaveBeenCalledTimes(1);
  });
});
