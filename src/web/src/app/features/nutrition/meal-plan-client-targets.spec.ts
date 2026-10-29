import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientTargetsItem, ClientTargetsList } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { fill, settle } from '../../../testing/dom';
import type { ClientTargetsPick } from './daily-target.models';
import { MealPlanApi } from './meal-plan-api';
import { MealPlanClientTargets } from './meal-plan-client-targets';

function item(overrides: Partial<ClientTargetsItem> = {}): ClientTargetsItem {
  return {
    clientProfileId: 'client-maya',
    firstName: 'Maya',
    lastName: 'Fakhoury',
    coachUserId: 'user-karim',
    coachName: 'Karim Haddad',
    calculationId: 'calculation-maya',
    calculatedAtUtc: '2026-10-26T09:30:00Z',
    calorieTarget: 2150,
    proteinGrams: 120,
    carbohydrateGrams: 248,
    fatGrams: 60,
    fatPercentage: 25,
    bodyweightKilograms: 62,
    isEnergyDeficit: true,
    warnings: [],
    ...overrides,
  };
}

const list = (items: ClientTargetsItem[], total = items.length): ClientTargetsList => ({
  items,
  total,
  limit: 500,
});

async function render(answer: () => Observable<ClientTargetsList>) {
  const api = { listClientTargets: vi.fn(answer) };
  TestBed.configureTestingModule({
    providers: [
      { provide: MealPlanApi, useValue: api },
      { provide: AuthStore, useValue: { user: signal({ id: 'user-karim' }) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      {
        provide: WorkspaceCalendar,
        useValue: {
          today: signal('2026-10-29'),
          timeZone: signal('Asia/Beirut'),
          resolveToday: () => Promise.resolve('2026-10-29'),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(MealPlanClientTargets);
  const picked: ClientTargetsPick[] = [];
  fixture.componentInstance.picked.subscribe((pick) => picked.push(pick));
  await settle(fixture);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, picked };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLButtonElement>('.row'));

describe('Start from a client’s targets (critique B5c2)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists each client with their latest targets, and whose client a team coach’s is', async () => {
    const { host } = await render(() =>
      of(
        list([
          item(),
          item({
            clientProfileId: 'client-rami',
            firstName: 'Rami',
            lastName: 'Saad',
            coachUserId: 'user-lea',
            coachName: 'Lea Khoury',
            fatPercentage: null,
            calculatedAtUtc: '2026-10-29T07:00:00Z',
          }),
        ]),
      ),
    );

    const [maya, rami] = rows(host);
    expect(textOf(maya.querySelector('.name'))).toBe('Maya Fakhoury');
    expect(Array.from(maya.querySelectorAll('.line')).map(textOf)).toEqual([
      '2,150 kcal · protein 120 g · carbs 248 g · fat 60 g',
      'Worked out Mon 26 Oct',
    ]);
    expect(Array.from(rami.querySelectorAll('.line')).map(textOf)).toEqual([
      '2,150 kcal · protein 120 g · carbs 248 g · fat 60 g',
      'Your macros, set today · Coached by Lea Khoury',
    ]);
    // A screen reader hears the lines once, through the button's name.
    expect(textOf(rami.querySelector('.tb-visually-hidden'))).toBe(
      ', 2,150 kcal · protein 120 g · carbs 248 g · fat 60 g, Your macros, set today, Coached by Lea Khoury',
    );
    expect(host.querySelector('input[type="search"]')).toBeNull();
  });

  it('hands the client’s targets back when one is chosen', async () => {
    const { host, fixture, picked } = await render(() => of(list([item()])));

    rows(host)[0].click();
    await settle(fixture);

    expect(picked).toEqual([
      {
        name: 'Maya Fakhoury',
        calories: 2150,
        protein: 120,
        carbs: 248,
        fat: 60,
        share: 25,
        weight: 62,
        isEnergyDeficit: true,
        warnings: [],
        on: 'Mon 26 Oct',
      },
    ]);
  });

  it('finds a client by name once the list is long', async () => {
    const names = ['Maya', 'Rami', 'Sara', 'Lina', 'Nour', 'Karl', 'Zoé'];
    const { host, fixture } = await render(() =>
      of(
        list(
          names.map((firstName, index) =>
            item({ clientProfileId: `client-${index}`, firstName, lastName: 'Haddad' }),
          ),
        ),
      ),
    );
    expect(rows(host)).toHaveLength(7);

    fill(host, 'Find a client', 'zoe');
    await settle(fixture);
    expect(rows(host).map((row) => textOf(row.querySelector('.name')))).toEqual(['Zoé Haddad']);

    fill(host, 'Find a client', 'Tarek');
    await settle(fixture);
    expect(rows(host)).toHaveLength(0);
    expect(textOf(host.querySelector('.empty'))).toBe('No client called “Tarek”.');
  });

  it('says when no client has targets yet, and when more are listed than shown', async () => {
    const empty = await render(() => of(list([])));
    expect(textOf(empty.host.querySelector('[data-empty]'))).toBe(
      'None of your clients with Nutrition in their plan has targets yet. Work them out on a client’s Nutrition tab.',
    );
    TestBed.resetTestingModule();

    const capped = await render(() => of(list([item()], 501)));
    expect(textOf(capped.host.querySelectorAll('.muted')[1])).toBe(
      'The first 1 of 501 clients, by name.',
    );
  });

  it('tries again after a failed read', async () => {
    let calls = 0;
    const { host, fixture, api } = await render(() =>
      ++calls === 1 ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(list([item()])),
    );
    expect(textOf(host.querySelector('[role="alert"]'))).toBe(
      'Your clients’ targets could not be loaded.',
    );

    Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => textOf(button) === 'Try again')!
      .click();
    await settle(fixture);
    await settle(fixture);

    expect(api.listClientTargets).toHaveBeenCalledTimes(2);
    expect(rows(host)).toHaveLength(1);
  });
});
