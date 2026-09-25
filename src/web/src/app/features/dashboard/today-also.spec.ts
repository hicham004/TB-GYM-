import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import type { CheckInAssignmentListItem } from '../../core/api/generated';
import { TenantStore } from '../../core/tenancy/tenant.store';
import type { NutritionDay } from '../nutrition/nutrition.models';
import { press, settle } from '../../../testing/dom';
import { fakeClientAccess, TODAY } from '../../../testing/today-fixtures';
import { TodayAlso } from './today-also';

const meals = (logStatus: NutritionDay['logStatus'], selected: (string | null)[]) =>
  ({
    logStatus,
    slots: selected.map((selectedChoiceId, order) => ({ id: `${order}`, selectedChoiceId })),
  }) as NutritionDay;
const assignment = (dueDate: string, response: CheckInAssignmentListItem['response'] = null) =>
  ({
    assignment: { formTitle: 'Weekly check-in', dueDate },
    response,
  }) as CheckInAssignmentListItem;
const list = (...items: CheckInAssignmentListItem[]) =>
  of({ clientProfileId: 'c', total: items.length, items });
const status = (code: number) => throwError(() => new HttpErrorResponse({ status: code }));

async function render(
  api: Record<string, unknown>,
  access: ReturnType<typeof fakeClientAccess> = fakeClientAccess(),
) {
  const client = {
    getMyNutritionDay: vi.fn(() => of(meals('InProgress', ['a', 'b', null, null]))),
    listOwnCheckInAssignments: vi.fn(() =>
      list(
        assignment(TODAY, {
          status: 'Submitted',
          submittedDate: TODAY,
        } as CheckInAssignmentListItem['response']),
      ),
    ),
    ...api,
  };
  await TestBed.configureTestingModule({
    imports: [TodayAlso],
    providers: [
      provideRouter([]),
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      { provide: ApiClient, useValue: client },
      { provide: ClientAccessStore, useValue: access },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(TodayAlso);
  fixture.componentRef.setInput('today', TODAY);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  const row = (href: string) =>
    host.querySelector(`a[href="${href}"]`)?.textContent?.replace(/\s+/g, ' ').trim();
  return { fixture, host, client, row, read: () => (host.textContent ?? '').replace(/\s+/g, ' ') };
}

describe('TodayAlso', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists nutrition, then the check-in, each linking to its page', async () => {
    const { host, row } = await render({});

    expect(host.querySelector('h2')?.textContent?.trim()).toBe('Also today');
    expect(row('/nutrition/today')).toBe('Nutrition, 2 of 4 meals logged');
    expect(row('/checkins/me')).toBe('Weekly check-in, Submitted today · awaiting coach review');
    const links = [...host.querySelectorAll('li a')].map((link) => link.getAttribute('href'));
    expect(links).toEqual(['/nutrition/today', '/checkins/me']);
  });

  it('words every nutrition state, with plurals', async () => {
    const planned = await render({ getMyNutritionDay: vi.fn(() => of(meals(null, [null]))) });
    expect(planned.row('/nutrition/today')).toBe('Nutrition, 1 meal planned · nothing logged yet');
    TestBed.resetTestingModule();

    const done = await render({
      getMyNutritionDay: vi.fn(() => of(meals('Completed', ['a', 'b', 'c']))),
    });
    expect(done.row('/nutrition/today')).toBe('Nutrition, Day completed · 3 of 3 meals');
    TestBed.resetTestingModule();

    const none = await render({ getMyNutritionDay: vi.fn(() => status(404)) });
    expect(none.row('/nutrition/today')).toBe('Nutrition, No meal plan for today');
  });

  it('says why nutrition is closed, and leaves it out when it is not in the plan', async () => {
    const paused = await render(
      { getMyNutritionDay: vi.fn(() => status(404)) },
      fakeClientAccess({ Nutrition: 'Paused' }),
    );
    expect(paused.row('/nutrition/today')).toBe('Nutrition, Your coaching plan is paused');
    TestBed.resetTestingModule();

    const outside = await render(
      { getMyNutritionDay: vi.fn(() => status(404)) },
      fakeClientAccess({ Nutrition: 'NoEntitlement' }),
    );
    expect(outside.host.querySelector('a[href="/nutrition/today"]')).toBeNull();
    expect(outside.host.querySelector('a[href="/checkins/me"]')).not.toBeNull();
  });

  it('words every check-in state', async () => {
    const draft = { status: 'Draft' } as CheckInAssignmentListItem['response'];
    const cases: [CheckInAssignmentListItem[], string][] = [
      [[assignment(TODAY)], 'Weekly check-in, Due today'],
      [[assignment('2026-09-22', draft)], 'Weekly check-in, Due Tue 22 Sep · draft saved'],
      [[assignment('2026-09-18')], 'Weekly check-in, Overdue since Fri 18 Sep'],
      [
        [
          assignment(TODAY, {
            status: 'Reviewed',
            submittedDate: TODAY,
          } as CheckInAssignmentListItem['response']),
        ],
        'Weekly check-in, Reviewed by your coach',
      ],
      [[], 'Check-ins, Nothing due'],
    ];
    for (const [items, expected] of cases) {
      const { row } = await render({ listOwnCheckInAssignments: vi.fn(() => list(...items)) });
      expect(row('/checkins/me')).toBe(expected);
      TestBed.resetTestingModule();
    }
  });

  it('marks an overdue check-in in words, with colour only as a supplement', async () => {
    const { host } = await render({
      listOwnCheckInAssignments: vi.fn(() => list(assignment('2026-09-18'))),
    });
    expect(host.querySelector('.overdue')?.textContent).toContain('Overdue since');
  });

  it('fails one row on its own and retries it without touching the other', async () => {
    const getMyNutritionDay = vi
      .fn()
      .mockReturnValueOnce(status(500))
      .mockReturnValue(of(meals('InProgress', ['a', null])));
    const { fixture, host, client, row } = await render({ getMyNutritionDay });

    expect(host.textContent).toContain('Couldn’t load nutrition');
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      'Couldn’t load nutrition.',
    );
    expect(row('/checkins/me')).toContain('Submitted today');

    press(host, 'Retry nutrition');
    await settle(fixture);
    expect(row('/nutrition/today')).toBe('Nutrition, 1 of 2 meals logged');
    expect(client.listOwnCheckInAssignments).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="status"]')?.textContent?.trim()).toBe('');
  });

  it('never asks for a feature outside the plan', async () => {
    const { client } = await render(
      {},
      fakeClientAccess({ Nutrition: 'NoEntitlement', CheckIns: 'NoEntitlement' }),
    );

    expect(client.getMyNutritionDay).not.toHaveBeenCalled();
    expect(client.listOwnCheckInAssignments).not.toHaveBeenCalled();
  });

  it('waits for the access answer before reading, then reads only what is in the plan', async () => {
    const access = fakeClientAccess({}, 'loading');
    const { fixture, client, row } = await render({}, access);
    expect(client.getMyNutritionDay).not.toHaveBeenCalled();
    expect(client.listOwnCheckInAssignments).not.toHaveBeenCalled();

    access.set({ CheckIns: 'NoEntitlement' });
    await settle(fixture);

    expect(client.getMyNutritionDay).toHaveBeenCalledTimes(1);
    expect(client.listOwnCheckInAssignments).not.toHaveBeenCalled();
    expect(row('/nutrition/today')).toBe('Nutrition, 2 of 4 meals logged');
  });

  it('never asks for a feature the plan has closed, and says why instead', async () => {
    const { client, row } = await render(
      {},
      fakeClientAccess({ Nutrition: 'Expired', CheckIns: 'Paused' }),
    );

    expect(client.getMyNutritionDay).not.toHaveBeenCalled();
    expect(client.listOwnCheckInAssignments).not.toHaveBeenCalled();
    expect(row('/nutrition/today')).toBe('Nutrition, Your coaching plan has ended');
    expect(row('/checkins/me')).toBe('Check-ins, Your coaching plan is paused');
  });

  it('reads both rows when the access answer could not be read', async () => {
    const { client } = await render({}, fakeClientAccess({}, 'failed'));

    expect(client.getMyNutritionDay).toHaveBeenCalledTimes(1);
    expect(client.listOwnCheckInAssignments).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when neither feature is in the plan', async () => {
    const { host } = await render(
      {
        getMyNutritionDay: vi.fn(() => status(404)),
        listOwnCheckInAssignments: vi.fn(() => status(403)),
      },
      fakeClientAccess({ Nutrition: 'NoEntitlement', CheckIns: 'NoEntitlement' }),
    );
    expect(host.querySelector('section')).toBeNull();
  });
});
