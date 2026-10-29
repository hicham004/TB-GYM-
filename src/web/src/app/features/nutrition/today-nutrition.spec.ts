import { HttpErrorResponse } from '@angular/common/http';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import type { FeatureAccessDecision } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { planRecipeView } from '../../../testing/client-recipe-fixtures';
import {
  button,
  chooseOption,
  field,
  fill,
  press,
  query,
  selectField,
  selectShows,
  settle,
} from '../../../testing/dom';
import { fakeClientAccess } from '../../../testing/today-fixtures';
import type { ClientNutritionDayView } from '../../core/api/generated';
import { mapNutritionDay, type NutritionDay, type NutritionSlot } from './nutrition.models';
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
        recipeId: 'plan-recipe-1',
        photoId: null,
        servings: 1,
        calories: 520,
        protein: 38,
        carbohydrate: 62,
        fat: 12,
      },
      {
        id: 'choice-2',
        recipeName: 'Eggs and toast',
        recipeId: null,
        photoId: null,
        servings: 1,
        calories: 480,
        protein: 30,
        carbohydrate: 40,
        fat: 20,
      },
    ],
    selectedChoiceId: null,
    actualServings: null,
    loggedCalories: null,
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
    slots: [slot({ selectedChoiceId: 'choice-2', actualServings: 1.5, loggedCalories: 720 })],
    selectedCalories: 780,
    selectedProtein: 57,
    selectedCarbohydrate: 93,
    selectedFat: 18,
    logVersion: 3,
  });
}

/** A day as the server sends it, which the page maps itself (audit WEB-5). */
function served(view: NutritionDay): ClientNutritionDayView {
  return {
    planId: view.planId,
    planDayId: view.planDayId,
    date: view.date,
    targetCalories: view.targetCalories,
    targetProteinGrams: view.targetProtein,
    targetCarbohydrateGrams: view.targetCarbohydrate,
    targetFatGrams: view.targetFat,
    dailyLogId: view.dailyLogId,
    dailyLogVersion: view.logVersion,
    logStatus: view.logStatus,
    selectedCalories: view.selectedCalories,
    selectedProteinGrams: view.selectedProtein,
    selectedCarbohydrateGrams: view.selectedCarbohydrate,
    selectedFatGrams: view.selectedFat,
    slots: view.slots.map((item) => ({
      id: item.id,
      name: item.name,
      order: item.order,
      selectedChoiceId: item.selectedChoiceId,
      actualServings: item.actualServings,
      loggedCalories: item.loggedCalories,
      choices: item.choices.map((choice) => ({
        id: choice.id,
        recipeName: choice.recipeName,
        recipeId: choice.recipeId,
        recipePhotoMediaAssetId: choice.photoId,
        servings: choice.servings,
        calories: choice.calories,
        proteinGrams: choice.protein,
        carbohydrateGrams: choice.carbohydrate,
        fatGrams: choice.fat,
      })),
    })),
    customFoods: view.customFoods.map((food) => ({
      id: food.id,
      name: food.name,
      amount: food.amount,
      unit: food.unit,
      calories: food.calories,
      proteinGrams: food.protein,
      carbohydrateGrams: food.carbohydrate,
      fatGrams: food.fat,
    })),
    safetyNotice: view.safetyNotice,
  };
}

interface RenderOptions {
  readonly selectedTenantId?: WritableSignal<string | null>;
  readonly csrfRefresh?: () => Promise<void>;
  /** The client's plan as the access answer gives it; every feature open unless said otherwise. */
  readonly access?: ReturnType<typeof fakeClientAccess>;
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
          getMyNutritionDay: vi.fn(() => of(served(today))),
          recordMyNutritionChoice: vi.fn(() => of(served(afterSave()))),
          addMyNutritionCustomFood: vi.fn(() =>
            of(
              served(
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
          ),
          reverseMyNutritionCustomFood: vi.fn(() =>
            of(served(day({ selectedCalories: 0, logVersion: 4, customFoods: [] }))),
          ),
          completeMyNutritionLog: vi.fn(() =>
            of(served(day({ logStatus: 'Completed', logVersion: 4 }))),
          ),
          getMyPlanRecipe: vi.fn(() =>
            of(planRecipeView({ name: 'Oats and whey', photoMediaAssetId: null })),
          ),
          ...api,
        },
      },
      {
        provide: CsrfService,
        useValue: { refresh: vi.fn(options.csrfRefresh ?? (() => Promise.resolve())) },
      },
      { provide: TenantStore, useValue: { selectedTenantId } },
      { provide: ClientAccessStore, useValue: options.access ?? fakeClientAccess() },
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

/** The option rows of a meal card: each row's recipe name, and whether it is the one chosen. */
function rows(card: ParentNode): { name: string; chosen: boolean }[] {
  return Array.from(card.querySelectorAll<HTMLElement>('.option')).map((row) => ({
    name: row.querySelector('strong')?.textContent?.trim() ?? '',
    chosen: row.querySelector<HTMLInputElement>('input[type="radio"]')!.checked,
  }));
}

/** Picks a meal's option the way a tap on its row does: its radio is checked and says so. */
function pick(card: ParentNode, recipeName: string): HTMLInputElement {
  const row = Array.from(card.querySelectorAll<HTMLElement>('.option')).find(
    (candidate) => candidate.querySelector('strong')?.textContent?.trim() === recipeName,
  );
  if (!row) throw new Error(`No option is named "${recipeName}".`);
  const radio = row.querySelector<HTMLInputElement>('input[type="radio"]')!;
  if (radio.disabled) throw new Error(`"${recipeName}" cannot be picked now.`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change'));
  return radio;
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
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('reads a day in the server’s shape into the page’s, the shape every mock here serves', () => {
    expect(mapNutritionDay(served(day()))).toEqual(day());
    expect(mapNutritionDay(served(afterSave()))).toEqual(afterSave());
  });

  it('opens a meal’s recipe in a sheet, from its card or from an option’s row', async () => {
    const lunch = slot({ id: 'slot-2', name: 'Lunch', order: 1, choices: [slot().choices[0]] });
    const { fixture, host, api } = await render({}, day({ slots: [slot(), lunch] }));
    const sheet = () => document.querySelector<HTMLElement>('[role="dialog"]');
    const [breakfast, single] = Array.from(host.querySelectorAll('.meal-card'));

    // Each option's row opens its own recipe; one without a recipe offers none.
    const open = query<HTMLButtonElement>(breakfast, '.option-recipe');
    expect(breakfast.querySelectorAll('.option-recipe')).toHaveLength(1);
    expect(open.textContent?.trim()).toBe('Recipe');
    expect(open.getAttribute('aria-label')).toBe('Recipe for Oats and whey');
    open.click();
    await settle(fixture);
    await settle(fixture);
    expect(api.getMyPlanRecipe).toHaveBeenCalledWith('plan-recipe-1');
    expect(sheet()?.querySelector('h2')?.textContent?.trim()).toBe('Oats and whey');
    expect(sheet()?.querySelectorAll('.ingredients li')).toHaveLength(4);
    // Printing the page while the recipe is open prints the recipe alone.
    expect(sheet()?.closest('.tb-modal-pane--printable')).toBeTruthy();
    sheet()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    await settle(fixture);

    // A meal of one recipe is its card: the whole row opens it.
    const whole = query<HTMLButtonElement>(single, '.recipe-open');
    expect(whole.textContent?.replace(/\s+/g, ' ').trim()).toBe('Oats and whey Recipe');
    whole.click();
    await settle(fixture);
    await settle(fixture);
    expect(api.getMyPlanRecipe).toHaveBeenCalledTimes(2);
  });

  it('lists a meal’s options under “Choose one”, the coach’s option 1 chosen until another is picked (B5a)', async () => {
    const { fixture, host, api } = await render();
    const card = query(host, '.meal-card');

    // The group is named for its meal too, which only a screen reader hears.
    const legend = query(card, 'fieldset.options legend');
    expect(legend.textContent?.replace(/\s+/g, ' ').trim()).toBe('Breakfast: Choose one');
    expect(query(legend, '.tb-visually-hidden').textContent).toBe('Breakfast: ');
    expect(rows(card)).toEqual([
      { name: 'Oats and whey', chosen: true },
      { name: 'Eggs and toast', chosen: false },
    ]);
    expect(
      Array.from(card.querySelectorAll('.option-amount')).map((line) =>
        line.textContent?.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual(['1 serving · 520 kcal planned', '1 serving · 480 kcal planned']);
    // One radio group per meal, so the arrow keys move between its options.
    const names = new Set(
      Array.from(card.querySelectorAll<HTMLInputElement>('input[type="radio"]')).map(
        (radio) => radio.name,
      ),
    );
    expect(names).toEqual(new Set(['meal-slot-1']));
    expect(() => button(host, 'Ate as planned')).toThrow();
    expect(() => button(host, 'Swap or adjust')).toThrow();
    expect(() => selectField(host, 'What did you eat?')).toThrow();

    pick(card, 'Eggs and toast');
    await settle(fixture);
    expect(rows(card).map((row) => row.chosen)).toEqual([false, true]);
    press(host, 'I ate this');
    await settle(fixture);

    expect(api.recordMyNutritionChoice).toHaveBeenCalledWith({
      planDayId: 'plan-day-1',
      planSlotId: 'slot-1',
      choiceId: 'choice-2',
      actualServings: 1,
      dailyLogVersion: 2,
    });
    // Logged: the option eaten stays chosen, with the amount logged, and nothing waits to be saved.
    expect(rows(card)).toEqual([
      { name: 'Oats and whey', chosen: false },
      { name: 'Eggs and toast', chosen: true },
    ]);
    expect(query(card, '[data-logged-amount]').textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '1.5 servings · 720 kcal logged',
    );
    expect(() => button(host, 'I ate this')).toThrow();
    expect(button(host, 'Change servings')).toBeTruthy();
  });

  it('logs a meal again only for another option, and picking back the one logged leaves nothing to save', async () => {
    const { fixture, host, api } = await render({}, afterSave());
    const card = query(host, '.meal-card');

    expect(rows(card).map((row) => row.chosen)).toEqual([false, true]);
    expect(() => button(host, 'I ate this')).toThrow();

    pick(card, 'Oats and whey');
    await settle(fixture);
    expect(button(host, 'I ate this')).toBeTruthy();
    pick(card, 'Eggs and toast');
    await settle(fixture);
    expect(() => button(host, 'I ate this')).toThrow();

    // Nothing was changed, so the day closes without asking to save first.
    press(host, 'Complete day');
    await settle(fixture);
    expect(api.completeMyNutritionLog).toHaveBeenCalledWith('log-1', { version: 3 });
  });

  it('shows each option’s recipe photo on its meal card, granted in one call', async () => {
    const createMediaAccessBatch = vi.fn(() =>
      of({
        items: [
          {
            assetId: 'photo-1',
            kind: 'Image' as const,
            source: 'Upload' as const,
            contentType: 'image/jpeg',
            url: '/api/media/photo-1/content?grant=1',
            thumbnailUrl: '/api/media/photo-1/content/thumbnail?grant=1',
            expiresAtUtc: '2026-08-25T10:00:00Z',
            downloadAllowed: false,
          },
        ],
      }),
    );
    const refresh = vi.fn(() => Promise.resolve());
    const pictured = slot();
    pictured.choices[0].photoId = 'photo-1';
    pictured.choices[1].photoId = 'photo-2';
    const lunch = slot({
      id: 'slot-2',
      name: 'Lunch',
      order: 1,
      choices: [{ ...slot().choices[1], id: 'choice-3' }],
    });
    const { fixture, host } = await render(
      { createMediaAccessBatch },
      day({ slots: [pictured, lunch] }),
      { csrfRefresh: refresh },
    );
    await settle(fixture);

    // Every option's photo is asked for at once, after a fresh antiforgery token; one the server
    // leaves out (photo-2 here) simply has none.
    expect(createMediaAccessBatch).toHaveBeenCalledOnce();
    expect(createMediaAccessBatch).toHaveBeenCalledWith(['photo-1', 'photo-2']);
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(
      createMediaAccessBatch.mock.invocationCallOrder[0],
    );
    const cards = host.querySelectorAll('.meal-card');
    // Each option's row leads with its own photo.
    const options = cards[0].querySelectorAll('.option');
    const photo = options[0].querySelector<HTMLImageElement>('img.option-photo')!;
    expect(photo.getAttribute('src')).toBe('/api/media/photo-1/content/thumbnail?grant=1');
    expect(photo.alt).toBe('');
    expect(options[0].classList).toContain('with-photo');
    expect(options[1].querySelector('img')).toBeNull();
    expect(cards[1].querySelector('img')).toBeNull();

    // A grant that lapsed leaves the row without its photo instead of a broken image.
    photo.dispatchEvent(new Event('error'));
    await settle(fixture);
    expect(cards[0].querySelector('img')).toBeNull();
  });

  it('reads the day without photos when the photos cannot be granted', async () => {
    const pictured = slot();
    pictured.choices[0].photoId = 'photo-1';
    const { fixture, host } = await render(
      { createMediaAccessBatch: vi.fn(() => throwError(() => new Error('offline'))) },
      day({ slots: [pictured] }),
    );
    await settle(fixture);

    expect(host.querySelector('.meal-card img')).toBeNull();
    expect(rows(query(host, '.meal-card')).map((row) => row.name)).toEqual([
      'Oats and whey',
      'Eggs and toast',
    ]);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  /**
   * Recording the concrete meal eaten is the client's primary action here. The controls are
   * one-way `[ngModel]` bindings writing back through `(ngModelChange)` into a draft store, so a
   * control that fails to write would leave Save meal disabled with the choice visibly picked.
   */
  it('records the meal and servings the client chose', async () => {
    const { fixture, host, api } = await render();

    // The planned choice is ready to log in one tap.
    expect(button(host, 'I ate this').disabled).toBe(false);

    // The second choice, deliberately: the draft opens on the first one, so picking that would be
    // indistinguishable from a choice that never reached the draft at all.
    pick(host, 'Eggs and toast');
    await settle(fixture);
    press(host, 'Change servings');
    await settle(fixture);
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
    const twice = slot();
    twice.choices[1].servings = 2;
    const { fixture, host } = await render({}, day({ slots: [twice] }));

    press(host, 'Change servings');
    await settle(fixture);
    expect(field(host, 'Actual servings').value).toBe('1');
    pick(host, 'Eggs and toast');
    await settle(fixture);

    expect(field(host, 'Actual servings').value).toBe('2');
  });

  it('refuses to record a meal with no servings', async () => {
    const { fixture, host, api } = await render();

    pick(host, 'Eggs and toast');
    await settle(fixture);
    press(host, 'Change servings');
    await settle(fixture);
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

    pick(host, 'Eggs and toast');
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

    // Nothing is left to choose: the meal shows the option eaten, or the coach's option 1.
    expect(host.querySelector('input[type="radio"]')).toBeNull();
    expect(() => button(host, 'I ate this')).toThrow();
    expect(() => button(host, 'Change servings')).toThrow();
    expect(() => button(host, 'Complete day')).toThrow();
    expect(query(host, '.meal-body strong').textContent?.trim()).toBe('Oats and whey');
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

  it('says "1 serving" for one and "servings" for any other amount', async () => {
    const { host } = await render(
      {},
      day({
        slots: [
          slot({ id: 'one', choices: [slot().choices[0]] }),
          slot({
            id: 'two',
            order: 1,
            choices: [{ ...slot().choices[0], id: 'choice-3', servings: 1.5 }],
          }),
        ],
      }),
    );

    const lines = Array.from(host.querySelectorAll('.meal-body .meal-amount')).map((item) =>
      item.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(lines[0]).toBe('1 serving · 520 kcal planned');
    expect(lines[1]).toBe('1.5 servings · 520 kcal planned');
  });

  it('says the calories of the amount logged on a logged meal, never the planned serving’s (CLIENT-10)', async () => {
    const one = [slot().choices[0]];
    const { host } = await render(
      {},
      day({
        slots: [
          slot({
            choices: one,
            selectedChoiceId: 'choice-1',
            actualServings: 1.5,
            loggedCalories: 780,
          }),
          slot({ id: 'later', order: 1, choices: one }),
          slot({
            id: 'options',
            order: 2,
            selectedChoiceId: 'choice-2',
            actualServings: 2,
            loggedCalories: 960,
          }),
        ],
        selectedCalories: 1740,
      }),
    );

    const lines = Array.from(host.querySelectorAll('.meal-body .meal-amount')).map((item) =>
      item.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(lines[0]).toBe('1.5 servings · 780 kcal logged');
    expect(lines[1]).toBe('1 serving · 520 kcal planned');
    // A meal with options says it on the option eaten; the others keep their planned amounts.
    const options = Array.from(
      host.querySelectorAll('.meal-card')[2].querySelectorAll('.option-amount'),
    );
    expect(options.map((item) => item.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '1 serving · 520 kcal planned',
      '2 servings · 960 kcal logged',
    ]);
    expect(host.querySelectorAll('[data-logged-amount]')).toHaveLength(2);
  });

  it('lays out three meals, or five or more, in rows of three and two or four in twos', async () => {
    const meals = (count: number) =>
      Array.from({ length: count }, (_, index) => slot({ id: `slot-${index}`, order: index }));
    const layout = async (count: number) => {
      const { host } = await render({}, day({ slots: meals(count) }));
      const three = query(host, '.meal-list').classList.contains('three-up');
      TestBed.resetTestingModule();
      return three;
    };

    expect(await layout(1)).toBe(false);
    expect(await layout(2)).toBe(false);
    expect(await layout(3)).toBe(true);
    expect(await layout(4)).toBe(false);
    expect(await layout(5)).toBe(true);
    expect(await layout(6)).toBe(true);
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
    pick(cards[0], 'Eggs and toast');
    pick(cards[1], 'Eggs and toast');
    await settle(fixture);
    press(cards[1], 'Change servings');
    await settle(fixture);
    fill(cards[1], 'Actual servings', '2');
    await settle(fixture);

    press(cards[0], 'I ate this');
    await settle(fixture);

    expect(api.recordMyNutritionChoice).toHaveBeenCalledTimes(1);
    expect(query(host.querySelectorAll('.meal-card')[0], '[role="alert"]').textContent).toContain(
      'This day was changed elsewhere.',
    );
    // The second meal's untouched edits survive the first meal's failure.
    const second = host.querySelectorAll('.meal-card')[1];
    expect(rows(second).map((row) => row.chosen)).toEqual([false, true]);
    expect(field(second, 'Actual servings').value).toBe('2');
  });

  it('explains a date with no meal plan instead of an empty day', async () => {
    // The API answers "nothing here" with a 200 and null, never a 404 (audit AUTH-12).
    const { host } = await render({ getMyNutritionDay: vi.fn(() => of(null)) });

    expect(host.textContent).toContain("Your coach hasn't set a meal plan for this day yet");
    expect(host.querySelector('.meal-card')).toBeNull();
  });

  it('states a refused access reason separately from an unplanned day', async () => {
    const { host } = await render(
      {
        getMyNutritionDay: vi.fn(() =>
          throwError(
            () =>
              new HttpErrorResponse({
                status: 403,
                error: { accessReason: 'PaymentRequired' },
              }),
          ),
        ),
      },
      day(),
      { access: fakeClientAccess({}, 'failed') },
    );

    expect(host.textContent).toContain('Your plan is waiting for payment');
    expect(host.textContent).not.toContain("Your coach hasn't set a meal plan");
  });

  it('says a closed plan’s reason without asking for a day the client may not see (AUTH-12)', async () => {
    const { host, api } = await render({}, day(), {
      access: fakeClientAccess({ Nutrition: 'MembershipInactive' }),
    });

    expect(api.getMyNutritionDay).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Your coaching has ended, so meals are closed.');
    expect(host.textContent).not.toContain("Your coach hasn't set a meal plan");
  });

  it('waits for the plan’s answer before it asks for the day', async () => {
    const access = fakeClientAccess({}, 'loading');
    const { fixture, host, api } = await render({}, day(), { access });

    expect(api.getMyNutritionDay).not.toHaveBeenCalled();

    access.set({});
    await settle(fixture);
    expect(api.getMyNutritionDay).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('.meal-card').length).toBeGreaterThan(0);
  });

  it('with no answer about the plan, a date with nothing asks it then, so a closed plan still says so', async () => {
    const paused: FeatureAccessDecision = {
      feature: 'Nutrition',
      isAllowed: false,
      reason: 'Paused',
      enrollmentId: 'enrollment-1',
      accessibleFrom: null,
      accessibleUntilExclusive: null,
    };
    const getOwnFeatureAccess = vi.fn(() => of([paused]));
    const { host } = await render(
      { getMyNutritionDay: vi.fn(() => of(null)), getOwnFeatureAccess },
      day(),
      { access: fakeClientAccess({}, 'failed') },
    );

    expect(getOwnFeatureAccess).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Your plan is paused, so meals are closed for now.');
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

    // A meal with options logs the coach's option 1 unless another is picked.
    press(host, 'I ate this');
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

  it('logs a meal of one recipe “as planned”, and offers to change its servings', async () => {
    const { fixture, host, api } = await render(
      {},
      day({ slots: [slot({ choices: [slot().choices[0]] })] }),
    );

    expect(host.querySelector('fieldset.options')).toBeNull();
    expect(button(host, 'Change servings')).toBeTruthy();
    press(host, 'Ate as planned');
    await settle(fixture);

    expect(api.recordMyNutritionChoice).toHaveBeenCalledWith({
      planDayId: 'plan-day-1',
      planSlotId: 'slot-1',
      choiceId: 'choice-1',
      actualServings: 1,
      dailyLogVersion: 2,
    });
  });

  it('logs a client-entered food separately from the planned slot', async () => {
    const { fixture, host, api } = await render();
    press(host, 'Add food');
    await settle(fixture);
    expect(selectShows(host, 'Unit')).toBe('g');
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

  it('logs an extra food in the unit chosen, a serving among them', async () => {
    const { fixture, host, api } = await render();
    press(host, 'Add food');
    await settle(fixture);
    fill(host, 'Food name', 'Protein bar');
    fill(host, 'Amount eaten', '1');
    await chooseOption(fixture, host, 'Unit', 'servings');
    fill(host, 'Calories (kcal)', '200');
    fill(host, 'Protein (g)', '20');
    fill(host, 'Carbs (g)', '22');
    fill(host, 'Fat (g)', '7');
    await settle(fixture);
    press(host, 'Log extra food');
    await settle(fixture);

    expect(api.addMyNutritionCustomFood).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Protein bar', amount: 1, unit: 'Serving' }),
    );
  });

  it('removes a mistaken extra food from the visible day totals', async () => {
    const withExtra = day({
      selectedCalories: 80,
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
    });
    const { fixture, host, api } = await render({}, withExtra);

    press(host, 'Remove');
    await settle(fixture);

    expect(api.reverseMyNutritionCustomFood).toHaveBeenCalledWith('extra-1', {
      dailyLogVersion: 2,
    });
    expect(host.textContent).not.toContain('80 / 2,400 kcal');
    expect(host.textContent).not.toContain('Apple');
    expect(host.textContent).toContain('Extra food removed');
  });

  it('ignores a date-A save that resolves after date B is displayed', async () => {
    const dateA = dateDay('2026-08-25', 'a');
    const dateB = dateDay('2026-08-26', 'b');
    const response = new Subject<ClientNutritionDayView>();
    const record = vi.fn(() => response);
    const getDay = vi.fn((selectedDate?: string) => of(served(selectedDate ? dateB : dateA)));
    const { component, fixture } = await render(
      { getMyNutritionDay: getDay, recordMyNutritionChoice: record as never },
      dateA,
    );

    const pending = beginSave(component);
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    await changeDate(component, fixture, dateB.date);
    response.next(served(dateDay(dateA.date, 'a-saved')));
    response.complete();
    await pending;

    expect(component['day']()?.planDayId).toBe(dateB.planDayId);
    expect(component['notice']()).toBeNull();
    expect(component['draft']('slot-1')?.saving).toBe(false);
  });

  it('ignores a date-A save rejection after date B is displayed', async () => {
    const dateA = dateDay('2026-08-25', 'a');
    const dateB = dateDay('2026-08-26', 'b');
    const response = new Subject<ClientNutritionDayView>();
    const record = vi.fn(() => response);
    const { component, fixture } = await render(
      {
        getMyNutritionDay: vi.fn((selectedDate?: string) =>
          of(served(selectedDate ? dateB : dateA)),
        ),
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
    const response = new Subject<ClientNutritionDayView>();
    const complete = vi.fn(() => response);
    const { component, fixture } = await render(
      {
        getMyNutritionDay: vi.fn((selectedDate?: string) =>
          of(served(selectedDate ? dateB : dateA)),
        ),
        completeMyNutritionLog: complete as never,
      },
      dateA,
    );

    const pending = component['complete']();
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    await changeDate(component, fixture, dateB.date);
    response.next(served(dateDay(dateA.date, 'a-completed')));
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
    const record = vi.fn(() => of(served(dateDay(originalA.date, 'a-saved'))));
    const getDay = vi
      .fn()
      .mockReturnValueOnce(of(served(originalA)))
      .mockReturnValueOnce(of(served(dateB)))
      .mockReturnValueOnce(of(served(currentA)));
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
    const first = new Subject<ClientNutritionDayView>();
    const second = new Subject<ClientNutritionDayView>();
    const record = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const { component, fixture } = await render(
      {
        getMyNutritionDay: vi.fn((selectedDate?: string) =>
          of(served(selectedDate ? dateB : dateA)),
        ),
        recordMyNutritionChoice: record as never,
      },
      dateA,
    );

    const oldSave = beginSave(component);
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    await changeDate(component, fixture, dateB.date);
    const currentSave = beginSave(component);
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(2));

    first.next(served(dateDay(dateA.date, 'a-saved', 'slot-a')));
    first.complete();
    await oldSave;

    expect(component['day']()?.planDayId).toBe(dateB.planDayId);
    expect(component['draft']('slot-b')?.saving).toBe(true);
    expect(component['loading']()).toBe(false);

    second.next(served(dateDay(dateB.date, 'b-saved', 'slot-b')));
    second.complete();
    await currentSave;
  });

  it('invalidates pending date operations during tenant reset', async () => {
    const dateA = dateDay('2026-08-25', 'a');
    const response = new Subject<ClientNutritionDayView>();
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
    response.next(served(dateDay(dateA.date, 'a-saved')));
    response.complete();
    await pending;

    expect(component['day']()).toBeNull();
    expect(component['draft']('slot-1')).toBeUndefined();
    expect(component['notice']()).toBeNull();
    expect(component['loading']()).toBe(false);
  });
});
