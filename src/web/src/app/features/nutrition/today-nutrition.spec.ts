import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, field, fill, press, query, settle } from '../../../testing/dom';
import type { NutritionDay, NutritionSlot } from './nutrition.models';
import { TodayNutrition } from './today-nutrition';

function slot(overrides: Partial<NutritionSlot> = {}): NutritionSlot {
  return {
    id: 'slot-1',
    name: 'Breakfast',
    order: 0,
    choices: [
      {
        id: 'choice-1',
        recipeName: 'Oats and whey',
        servings: 1,
        calories: 520,
        protein: 38,
        carbohydrate: 62,
        fat: 12,
      },
      {
        id: 'choice-2',
        recipeName: 'Eggs and toast',
        servings: 1,
        calories: 480,
        protein: 30,
        carbohydrate: 40,
        fat: 20,
      },
    ],
    selectedChoiceId: null,
    actualServings: null,
    ...overrides,
  };
}

function day(overrides: Partial<NutritionDay> = {}): NutritionDay {
  return {
    planId: 'plan-1',
    planDayId: 'plan-day-1',
    date: '2026-08-25',
    targetCalories: 2400,
    targetProtein: 180,
    targetCarbohydrate: 240,
    targetFat: 70,
    dailyLogId: 'log-1',
    logStatus: 'InProgress',
    selectedCalories: 0,
    selectedProtein: 0,
    selectedCarbohydrate: 0,
    selectedFat: 0,
    slots: [slot()],
    safetyNotice: 'This plan is guidance, not medical advice.',
    logVersion: 2,
    ...overrides,
  };
}

/** The day as the server returns it after one meal has been recorded. */
function afterSave(): NutritionDay {
  return day({
    slots: [slot({ selectedChoiceId: 'choice-2', actualServings: 1.5 })],
    selectedCalories: 780,
    selectedProtein: 57,
    selectedCarbohydrate: 93,
    selectedFat: 18,
    logVersion: 3,
  });
}

async function render(api: Partial<ApiClient> = {}, today: NutritionDay = day()) {
  await TestBed.configureTestingModule({
    imports: [TodayNutrition],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          getMyNutritionDay: vi.fn(() => of(today)),
          recordMyNutritionChoice: vi.fn(() => of(afterSave())),
          completeMyNutritionLog: vi.fn(() => of(day({ logStatus: 'Completed', logVersion: 4 }))),
          ...api,
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(TodayNutrition);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: TestBed.inject(ApiClient) };
}

describe('TodayNutrition', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * Recording the concrete meal eaten is the client's primary action here. The controls are
   * one-way `[ngModel]` bindings writing back through `(ngModelChange)` into a draft store, so a
   * control that fails to write would leave Save meal disabled with the choice visibly picked.
   */
  it('records the meal and servings the client chose', async () => {
    const { fixture, host, api } = await render();

    // Nothing to save until something is chosen.
    expect(button(host, 'Save meal').disabled).toBe(true);

    // The second choice, deliberately: the draft opens on the first one, so picking that would be
    // indistinguishable from a select whose change never reached the draft at all.
    fill(host, 'What did you eat?', 'choice-2');
    fill(host, 'Actual servings', '1.5');
    await settle(fixture);

    expect(button(host, 'Save meal').disabled).toBe(false);
    press(host, 'Save meal');
    await settle(fixture);

    expect(api.recordMyNutritionChoice).toHaveBeenCalledWith({
      planDayId: 'plan-day-1',
      planSlotId: 'slot-1',
      choiceId: 'choice-2',
      actualServings: 1.5,
      // The log version the row was rendered at, so a stale write conflicts.
      dailyLogVersion: 2,
    });
    expect(host.textContent).toContain('Meal saved.');
    expect(host.textContent).toContain('Saved');
  });

  /** Picking a meal offers its own prescribed servings rather than leaving the client to guess. */
  it('offers the chosen meal’s prescribed servings', async () => {
    const { fixture, host } = await render();

    fill(host, 'What did you eat?', 'choice-2');
    await settle(fixture);

    expect(field(host, 'Actual servings').value).toBe('1');
  });

  it('refuses to record a meal with no servings', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'What did you eat?', 'choice-2');
    fill(host, 'Actual servings', '0');
    await settle(fixture);
    press(host, 'Save meal');
    await settle(fixture);

    expect(api.recordMyNutritionChoice).not.toHaveBeenCalled();
    expect(query(host, '[role="alert"]').textContent).toContain(
      'Choose a meal and enter positive servings.',
    );
  });

  /** Completing the day is the second commit action, and it closes the log for good. */
  it('completes the nutrition day once every meal is saved', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Complete nutrition day');
    await settle(fixture);

    expect(api.completeMyNutritionLog).toHaveBeenCalledWith('log-1', { version: 2 });
    expect(host.textContent).toContain('Nutrition day completed.');
    expect(host.textContent).toContain('Day completed');
  });

  /** An edited meal that was never saved must not be dropped by closing the day around it. */
  it('refuses to complete the day while a meal is still unsaved', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'What did you eat?', 'choice-2');
    await settle(fixture);
    press(host, 'Complete nutrition day');
    await settle(fixture);

    expect(api.completeMyNutritionLog).not.toHaveBeenCalled();
    expect(query(host, '[role="alert"]').textContent).toContain(
      'Save every edited meal before completing the day.',
    );
  });

  it('renders a completed day read-only', async () => {
    const { host } = await render({}, day({ logStatus: 'Completed' }));

    expect(field<HTMLSelectElement>(host, 'What did you eat?').disabled).toBe(true);
    expect(field(host, 'Actual servings').disabled).toBe(true);
    expect(() => button(host, 'Complete nutrition day')).toThrow();
    expect(host.textContent).toContain('Day completed');
  });

  /**
   * The plan states targets and the log states what was eaten. Reporting one as the other would
   * make an alternative's average look like consumption, which this screen exists not to do.
   */
  it('keeps the prescribed target and the concrete selection apart', async () => {
    const { host } = await render({}, afterSave());

    expect(host.textContent).toContain('2,400 kcal');
    expect(host.textContent).toContain('780 kcal');
    expect(host.textContent).toContain('This plan is guidance, not medical advice.');
  });

  /** One meal failing must not discard the other meals the client has already edited. */
  it('reports a rejected meal against that meal and keeps the rest', async () => {
    const twoSlots = day({
      slots: [slot(), slot({ id: 'slot-2', name: 'Lunch', order: 1 })],
    });
    const conflict = new HttpErrorResponse({
      status: 409,
      error: { title: 'This day was changed elsewhere.' },
    });
    const { fixture, host, api } = await render(
      { recordMyNutritionChoice: vi.fn(() => throwError(() => conflict)) },
      twoSlots,
    );

    const cards = host.querySelectorAll('.meal-card');
    fill(cards[0], 'What did you eat?', 'choice-2');
    fill(cards[1], 'What did you eat?', 'choice-2');
    fill(cards[1], 'Actual servings', '2');
    await settle(fixture);

    press(cards[0], 'Save meal');
    await settle(fixture);

    expect(api.recordMyNutritionChoice).toHaveBeenCalledTimes(1);
    expect(query(host.querySelectorAll('.meal-card')[0], '[role="alert"]').textContent).toContain(
      'This day was changed elsewhere.',
    );
    // The second meal's untouched edits survive the first meal's failure.
    const second = host.querySelectorAll('.meal-card')[1];
    expect(field<HTMLSelectElement>(second, 'What did you eat?').value).toBe('choice-2');
    expect(field(second, 'Actual servings').value).toBe('2');
  });

  it('reports a date with no authorized plan instead of an empty day', async () => {
    const { host } = await render({
      getMyNutritionDay: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 403 }))),
    });

    expect(query(host, '[role="alert"]').textContent).toContain(
      'No authorized nutrition plan was found for this date.',
    );
    expect(host.querySelector('.meal-card')).toBeNull();
  });

  it('reloads the plan for a different date', async () => {
    const { fixture, host, api } = await render();

    const date = query<HTMLInputElement>(host, 'input[type="date"]');
    date.value = '2026-08-20';
    date.dispatchEvent(new Event('input'));
    date.dispatchEvent(new Event('change'));
    await settle(fixture);

    expect(api.getMyNutritionDay).toHaveBeenLastCalledWith('2026-08-20');
  });
});
