import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import type { ClientTrainingDayResult } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { NotificationStore } from '../../core/notifications/notification.store';
import { TenantStore } from '../../core/tenancy/tenant.store';
import type { UpcomingTraining } from '../training/training-read.models';
import { press, settle } from '../../../testing/dom';
import { day, fakeClientAccess, TODAY, upcoming, workout } from '../../../testing/today-fixtures';
import { ClientToday } from './client-today';

const notFound = () => throwError(() => new HttpErrorResponse({ status: 404 }));

async function render(
  options: {
    day?: ClientTrainingDayResult;
    upcoming?: UpcomingTraining;
    access?: ReturnType<typeof fakeClientAccess>;
    api?: Record<string, unknown>;
    unread?: number;
  } = {},
) {
  const tenant = signal<string | null>('tenant-1');
  const api = {
    getMyTrainingToday: vi.fn(() => of(options.day ?? day([workout()]))),
    getMyUpcomingTraining: vi.fn(() => of(options.upcoming ?? upcoming())),
    getWorkspace: vi.fn(() => of({ currentDate: '2026-09-21' })),
    getMyNutritionDay: vi.fn(notFound),
    listOwnCheckInAssignments: vi.fn(() => of({ clientProfileId: 'c', total: 0, items: [] })),
    listConversations: vi.fn(() =>
      of({
        items: [],
        hasMore: false,
        nextBeforeActivityAtUtc: null,
        nextBeforeConversationId: null,
      }),
    ),
    ...options.api,
  };
  await TestBed.configureTestingModule({
    imports: [ClientToday],
    providers: [
      provideRouter([]),
      { provide: TenantStore, useValue: { selectedTenantId: tenant } },
      { provide: ApiClient, useValue: api },
      { provide: ClientAccessStore, useValue: options.access ?? fakeClientAccess() },
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
    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Today');
    expect(read()).not.toMatch(/Good (morning|afternoon|evening)/);
    const bell = host.querySelector('a[href="/notifications"]');
    expect(bell?.textContent).toContain('Notifications, 2 unread');
    expect(bell?.querySelector('.today-count')?.textContent?.trim()).toBe('2');
    const me = host.querySelector('a[href="/me"]');
    expect(me?.textContent).toContain('Me: Maya Rahman');
    expect(me?.querySelector('app-avatar')?.textContent?.trim()).toBe('MR');
  });

  it('shows the scheduled session with one dominant action that records nothing', async () => {
    const { host, read } = await render();

    expect(read()).toContain('Scheduled today');
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

    expect(read()).toContain('Completed today');
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
    expect(read()).toContain('Scheduled today');
    expect(read()).toContain('Sunday 20 September');
  });

  it('shows no date at all rather than guessing one from the browser clock', async () => {
    const { host } = await render({
      api: {
        getMyTrainingToday: vi.fn(() => throwError(() => new Error())),
        getWorkspace: vi.fn(() => throwError(() => new Error())),
      },
    });

    expect(host.querySelector('.today-date')).toBeNull();
    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Today');
  });

  it('keeps using the workspace date that came with the training read', async () => {
    const { api, read } = await render();
    expect(read()).toContain('Sunday 20 September');
    expect(api.getWorkspace).not.toHaveBeenCalled();
    expect(TODAY).toBe('2026-09-20');
  });
});
