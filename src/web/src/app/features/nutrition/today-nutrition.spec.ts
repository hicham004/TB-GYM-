import { HttpErrorResponse } from '@angular/common/http';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantContext } from '../../core/tenancy/tenant-context';
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
    customFoods: [],
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

interface RenderOptions {
  readonly selectedTenantId?: WritableSignal<string | null>;
  readonly csrfRefresh?: () => Promise<void>;
}

async function render(
  api: Partial<ApiClient> = {},
  today: NutritionDay = day(),
  options: RenderOptions = {},
) {
  const selectedTenantId = options.selectedTenantId ?? signal<string | null>('tenant-1');
  await TestBed.configureTestingModule({
    imports: [TodayNutrition],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          getMyNutritionDay: vi.fn(() => of(today)),
          recordMyNutritionChoice: vi.fn(() => of(afterSave())),
          addMyNutritionCustomFood: vi.fn(() =>
            of(
              day({
                selectedCalories: 80,
                selectedCarbohydrate: 21,
                logVersion: 3,
                customFoods: [
                  {
                    id: 'extra-1',
                    name: 'Apple',
                    amount: 150,
                    unit: 'Gram',
                    calories: 80,
                    protein: 0,
                    carbohydrate: 21,
                    fat: 0,
                  },
                ],
              }),
            ),
          ),
          completeMyNutritionLog: vi.fn(() => of(day({ logStatus: 'Completed', logVersion: 4 }))),
          ...api,
        },
      },
      {
        provide: CsrfService,
        useValue: { refresh: vi.fn(options.csrfRefresh ?? (() => Promise.resolve())) },
      },
      { provide: TenantStore, useValue: { selectedTenantId } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(TodayNutrition);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    component: fixture.componentInstance,
    api: TestBed.inject(ApiClient),
    selectedTenantId,
  };
}

function dateDay(date: string, suffix: string, slotId = 'slot-1'): NutritionDay {
  return day({
    date,
    planDayId: `plan-day-${suffix}`,
    dailyLogId: `log-${suffix}`,
    slots: [slot({ id: slotId })],
  });
}

function beginSave(component: TodayNutrition): Promise<void> {
  const current = component['day']()!;
  const currentSlot = current.slots[0];
  component['updateChoice'](currentSlot.id, 'choice-2');
  component['updateServings'](currentSlot.id, '1.5');
  return component['save'](currentSlot);
}

async function changeDate(
  component: TodayNutrition,
  fixture: ReturnType<typeof TestBed.createComponent<TodayNutrition>>,
  selectedDate: string,
): Promise<void> {
  await component['changeDate'](selectedDate);
  fixture.detectChanges();
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

    // The planned choice is ready to log in one tap.
    expect(button(host, 'Ate as planned').disabled).toBe(false);

    // The second choice, deliberately: the draft opens on the first one, so picking that would be
    // indistinguishable from a select whose change never reached the draft at all.
    press(host, 'Swap or adjust');
    await settle(fixture);
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
    expect(host.textContent).toContain('Meal logged.');
    expect(host.textContent).toContain('Logged');
  });

  /** Picking a meal offers its own prescribed servings rather than leaving the client to guess. */
  it('offers the chosen meal’s prescribed servings', async () => {
    const { fixture, host } = await render();

    press(host, 'Swap or adjust');
    await settle(fixture);
    fill(host, 'What did you eat?', 'choice-2');
    await settle(fixture);

    expect(field(host, 'Actual servings').value).toBe('1');
  });

  it('refuses to record a meal with no servings', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Swap or adjust');
    await settle(fixture);
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

    press(host, 'Complete day');
    await settle(fixture);

    expect(api.completeMyNutritionLog).toHaveBeenCalledWith('log-1', { version: 2 });
    expect(host.textContent).toContain('Nutrition day completed.');
    expect(host.textContent).toContain('Day completed');
  });

  /** An edited meal that was never saved must not be dropped by closing the day around it. */
  it('refuses to complete the day while a meal is still unsaved', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Swap or adjust');
    await settle(fixture);
    fill(host, 'What did you eat?', 'choice-2');
    await settle(fixture);
    press(host, 'Complete day');
    await settle(fixture);

    expect(api.completeMyNutritionLog).not.toHaveBeenCalled();
    expect(query(host, '[role="alert"]').textContent).toContain(
      'Save edited meals and extra food before completing the day.',
    );
  });

  it('renders a completed day read-only', async () => {
    const { host } = await render({}, day({ logStatus: 'Completed' }));

    expect(() => field<HTMLSelectElement>(host, 'What did you eat?')).toThrow();
    expect(() => button(host, 'Ate as planned')).toThrow();
    expect(() => button(host, 'Complete day')).toThrow();
    expect(host.textContent).toContain('Day completed');
  });

  /**
   * The plan states targets and the log states what was eaten. Reporting one as the other would
   * make an alternative's average look like consumption, which this screen exists not to do.
   */
  it('keeps the prescribed target and the concrete selection apart', async () => {
    const { host } = await render({}, afterSave());

    expect(host.textContent).toContain('2,400 kcal');
    expect(host.textContent).toContain('780 / 2,400 kcal');
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
    press(cards[0], 'Swap or adjust');
    await settle(fixture);
    press(cards[1], 'Swap or adjust');
    await settle(fixture);
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

  it('explains a date with no meal plan instead of an empty day', async () => {
    const { host } = await render({
      getMyNutritionDay: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 404 }))),
    });

    expect(host.textContent).toContain("Your coach hasn't set a meal plan for this day yet");
    expect(host.querySelector('.meal-card')).toBeNull();
  });

  it('states a refused access reason separately from an unplanned day', async () => {
    const { host } = await render({
      getMyNutritionDay: vi.fn(() =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 403,
              error: { accessReason: 'PaymentRequired' },
            }),
        ),
      ),
    });

    expect(host.textContent).toContain('Your plan is waiting for payment');
    expect(host.textContent).not.toContain("Your coach hasn't set a meal plan");
  });

  it('reloads the plan for a different date', async () => {
    const { fixture, host, api } = await render();

    query<HTMLButtonElement>(host, '[aria-label="Previous week"]').click();
    await settle(fixture);
    query<HTMLButtonElement>(host, '[aria-label="Thursday, August 20, 2026"]').click();
    await settle(fixture);

    expect(api.getMyNutritionDay).toHaveBeenLastCalledWith('2026-08-20');
  });

  it('logs the planned meal in one tap without opening the editor', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Ate as planned');
    await settle(fixture);

    expect(api.recordMyNutritionChoice).toHaveBeenCalledWith({
      planDayId: 'plan-day-1',
      planSlotId: 'slot-1',
      choiceId: 'choice-1',
      actualServings: 1,
      dailyLogVersion: 2,
    });
    expect(host.textContent).toContain('Meal logged.');
  });

  it('logs a client-entered food separately from the planned slot', async () => {
    const { fixture, host, api } = await render();
    press(host, 'Add food');
    await settle(fixture);
    fill(host, 'Food name', 'Apple');
    fill(host, 'Amount eaten', '150');
    fill(host, 'Calories (kcal)', '80');
    fill(host, 'Protein (g)', '0');
    fill(host, 'Carbs (g)', '21');
    fill(host, 'Fat (g)', '0');
    await settle(fixture);
    press(host, 'Log extra food');
    await settle(fixture);

    expect(api.addMyNutritionCustomFood).toHaveBeenCalledWith({
      planDayId: 'plan-day-1',
      name: 'Apple',
      amount: 150,
      unit: 'Gram',
      calories: 80,
      proteinGrams: 0,
      carbohydrateGrams: 21,
      fatGrams: 0,
      dailyLogVersion: 2,
    });
    expect(host.textContent).toContain('Apple');
    expect(host.textContent).toContain('0 of 1 planned meals logged');
    expect(host.textContent).toContain('80 / 2,400 kcal');
  });

  it('ignores a date-A save that resolves after date B is displayed', async () => {
    const dateA = dateDay('2026-08-25', 'a');
    const dateB = dateDay('2026-08-26', 'b');
    const response = new Subject<NutritionDay>();
    const record = vi.fn(() => response);
    const getDay = vi.fn((selectedDate?: string) => of(selectedDate ? dateB : dateA));
    const { component, fixture } = await render(
      { getMyNutritionDay: getDay, recordMyNutritionChoice: record as never },
      dateA,
    );

    const pending = beginSave(component);
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    await changeDate(component, fixture, dateB.date);
    response.next(dateDay(dateA.date, 'a-saved'));
    response.complete();
    await pending;

    expect(component['day']()?.planDayId).toBe(dateB.planDayId);
    expect(component['notice']()).toBeNull();
    expect(component['draft']('slot-1')?.saving).toBe(false);
  });

  it('ignores a date-A save rejection after date B is displayed', async () => {
    const dateA = dateDay('2026-08-25', 'a');
    const dateB = dateDay('2026-08-26', 'b');
    const response = new Subject<NutritionDay>();
    const record = vi.fn(() => response);
    const { component, fixture } = await render(
      {
        getMyNutritionDay: vi.fn((selectedDate?: string) => of(selectedDate ? dateB : dateA)),
        recordMyNutritionChoice: record as never,
      },
      dateA,
    );

    const pending = beginSave(component);
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    await changeDate(component, fixture, dateB.date);
    response.error(new HttpErrorResponse({ status: 409, error: { title: 'Old conflict' } }));
    await pending;

    expect(component['day']()?.planDayId).toBe(dateB.planDayId);
    expect(component['error']()).toBeNull();
    expect(component['draft']('slot-1')?.error).toBeNull();
  });

  it('ignores a date-A completion that resolves after date B is displayed', async () => {
    const dateA = dateDay('2026-08-25', 'a');
    const dateB = dateDay('2026-08-26', 'b');
    const response = new Subject<NutritionDay>();
    const complete = vi.fn(() => response);
    const { component, fixture } = await render(
      {
        getMyNutritionDay: vi.fn((selectedDate?: string) => of(selectedDate ? dateB : dateA)),
        completeMyNutritionLog: complete as never,
      },
      dateA,
    );

    const pending = component['complete']();
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    await changeDate(component, fixture, dateB.date);
    response.next(dateDay(dateA.date, 'a-completed'));
    response.complete();
    await pending;

    expect(component['day']()?.planDayId).toBe(dateB.planDayId);
    expect(component['notice']()).toBeNull();
    expect(component['completing']()).toBe(false);
  });

  it('does not revive an original A operation after A to B to A', async () => {
    let releaseCsrf!: () => void;
    const csrf = new Promise<void>((resolve) => {
      releaseCsrf = resolve;
    });
    const originalA = dateDay('2026-08-25', 'a-original');
    const dateB = dateDay('2026-08-26', 'b');
    const currentA = dateDay('2026-08-25', 'a-current');
    const record = vi.fn(() => of(dateDay(originalA.date, 'a-saved')));
    const getDay = vi
      .fn()
      .mockReturnValueOnce(of(originalA))
      .mockReturnValueOnce(of(dateB))
      .mockReturnValueOnce(of(currentA));
    const { component, fixture } = await render(
      { getMyNutritionDay: getDay, recordMyNutritionChoice: record as never },
      originalA,
      { csrfRefresh: () => csrf },
    );

    const pending = beginSave(component);
    await changeDate(component, fixture, dateB.date);
    await changeDate(component, fixture, currentA.date);
    releaseCsrf();
    await pending;

    expect(record).not.toHaveBeenCalled();
    expect(component['day']()?.planDayId).toBe(currentA.planDayId);
  });

  it('does not let stale cleanup alter the current date save or loading state', async () => {
    const dateA = dateDay('2026-08-25', 'a', 'slot-a');
    const dateB = dateDay('2026-08-26', 'b', 'slot-b');
    const first = new Subject<NutritionDay>();
    const second = new Subject<NutritionDay>();
    const record = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const { component, fixture } = await render(
      {
        getMyNutritionDay: vi.fn((selectedDate?: string) => of(selectedDate ? dateB : dateA)),
        recordMyNutritionChoice: record as never,
      },
      dateA,
    );

    const oldSave = beginSave(component);
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    await changeDate(component, fixture, dateB.date);
    const currentSave = beginSave(component);
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(2));

    first.next(dateDay(dateA.date, 'a-saved', 'slot-a'));
    first.complete();
    await oldSave;

    expect(component['day']()?.planDayId).toBe(dateB.planDayId);
    expect(component['draft']('slot-b')?.saving).toBe(true);
    expect(component['loading']()).toBe(false);

    second.next(dateDay(dateB.date, 'b-saved', 'slot-b'));
    second.complete();
    await currentSave;
  });

  it('invalidates pending date operations during tenant reset', async () => {
    const dateA = dateDay('2026-08-25', 'a');
    const response = new Subject<NutritionDay>();
    const record = vi.fn(() => response);
    const selectedTenantId = signal<string | null>('tenant-1');
    const { component, fixture } = await render(
      { recordMyNutritionChoice: record as never },
      dateA,
      { selectedTenantId },
    );

    const pending = beginSave(component);
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    selectedTenantId.set(null);
    TestBed.inject(TenantContext).invalidate();
    fixture.detectChanges();
    response.next(dateDay(dateA.date, 'a-saved'));
    response.complete();
    await pending;

    expect(component['day']()).toBeNull();
    expect(component['draft']('slot-1')).toBeUndefined();
    expect(component['notice']()).toBeNull();
    expect(component['loading']()).toBe(false);
  });
});
