import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MealPlanDraftSummary, MealPlanTemplatePage } from '../../core/api/generated';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { press, settle } from '../../../testing/dom';
import { draftSummary, planSummary } from '../../../testing/meal-plan-fixtures';
import { MealPlanApi } from './meal-plan-api';
import { MealPlanList } from './meal-plan-list';

async function render(
  list: () => Observable<MealPlanTemplatePage>,
  drafts: MealPlanDraftSummary[] = [],
) {
  const api = { listPlans: vi.fn(list), listDrafts: vi.fn(() => of(drafts)) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'nutrition/plans', component: MealPlanList }]),
      { provide: MealPlanApi, useValue: api },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/nutrition/plans', MealPlanList);
  await settle(harness.fixture);
  return { harness, host: harness.routeNativeElement as HTMLElement, api };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const cardParts = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('.card')).map((card) =>
    [
      'app-status-pill',
      '.days',
      '.card-name',
      '.kcal',
      '.note',
      '.card-meta > span:last-child',
    ].map((part) => textOf(card.querySelector(part))),
  );

const page = (items: MealPlanTemplatePage['items']): MealPlanTemplatePage => ({
  items,
  total: items.length,
  skip: 0,
  take: 100,
});

describe('Meal plans', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows each plan as a card with its days, target and macro shares, opening it in the builder', async () => {
    const unpublished = planSummary({
      id: 'plan-2',
      name: 'Cut, phase 1',
      status: 'Draft',
      dayCount: 1,
      slotCount: 3,
      targetCalories: 1650,
    });
    const { host } = await render(() => of(page([planSummary(), unpublished])));

    expect(textOf(host.querySelector('h1'))).toBe('Meal plans');
    expect(textOf(host.querySelector('.lede'))).toBe('2 meal plans, 1 ready to assign');
    expect(cardParts(host)).toEqual([
      [
        'Ready to assign',
        '7 days · 4 meals a day',
        'Lean bulk',
        '2,000 kcal',
        '',
        'Changed Mon 5 Oct',
      ],
      [
        'Not published',
        '1 day · 3 meals a day',
        'Cut, phase 1',
        '1,650 kcal',
        '',
        'Changed Mon 5 Oct',
      ],
    ]);
    expect(textOf(host.querySelector('.split-text'))).toBe('Protein 30% · Carbs 40% · Fat 30%');
    expect(host.querySelector('.card a')?.getAttribute('href')).toBe('/nutrition/plans/plan-1');
    expect(host.querySelector('a[href="/nutrition/plans/new"]')).not.toBeNull();
    expect(host.querySelector('nav a[href="/nutrition/library"]')).not.toBeNull();
  });

  it('puts the coach’s own new plans first, and marks a plan with changes not published', async () => {
    const { host } = await render(
      () => of(page([planSummary({ draft: draftSummary({ dayCount: 14 }) })])),
      [
        draftSummary({ id: 'draft-new', mealPlanTemplateId: null, name: '  ', dayCount: 7 }),
        draftSummary(),
      ],
    );

    expect(cardParts(host)).toEqual([
      [
        'Draft',
        '7 days',
        'Untitled meal plan',
        '',
        'Only you can see it until you publish it',
        'Changed Tue 6 Oct',
      ],
      [
        'Ready to assign',
        '14 days · 4 meals a day',
        'Lean bulk',
        '2,000 kcal',
        'Your changes are not published yet',
        'Changed Tue 6 Oct',
      ],
    ]);
    expect(
      Array.from(host.querySelectorAll('.card a')).map((link) => link.getAttribute('href')),
    ).toEqual(['/nutrition/plans/new?draft=draft-new', '/nutrition/plans/plan-1']);
  });

  it('invites a coach with no plan to build the first one', async () => {
    const { host } = await render(() => of(page([])));

    expect(textOf(host.querySelector('app-empty-state h2'))).toBe('No meal plans yet');
    expect(textOf(host.querySelector('app-empty-state a'))).toBe('Build your first meal plan');
  });

  it('says when the plans could not be read, and tries again', async () => {
    let calls = 0;
    const { host, harness, api } = await render(() =>
      ++calls === 1
        ? throwError(() => new HttpErrorResponse({ status: 500 }))
        : of(page([planSummary()])),
    );

    expect(textOf(host.querySelector('[role="alert"]'))).toBe(
      'Your meal plans could not be loaded.',
    );
    press(host, 'Try again');
    await settle(harness.fixture);
    expect(api.listPlans).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll('.card')).toHaveLength(1);
  });
});
