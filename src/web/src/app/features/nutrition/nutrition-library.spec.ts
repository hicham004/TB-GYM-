import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, field, fill, press, query, settle, tick } from '../../../testing/dom';
import { NutritionLibrary } from './nutrition-library';
import type {
  FoodItem,
  MealPlanSummary,
  NutritionSettings,
  RecipeSummary,
} from './nutrition.models';

const FOOD: FoodItem = {
  id: 'food-1',
  name: 'Rolled oats',
  provenance: 'CoachAuthored',
  externalId: null,
  currentRevision: 1,
  versionId: 'food-version-1',
  basisQuantity: 100,
  basisUnit: 'Gram',
  preparationBasis: 'AsSold',
  calories: 379,
  providerCalories: null,
  discrepancy: false,
  protein: 13.2,
  carbohydrate: 67.7,
  fat: 6.5,
  unreportedNutrients: [],
};

// FDC 2646170: USDA reports protein, fat and carbohydrate but not fibre or polyols.
const USDA_CHICKEN: FoodItem = {
  ...FOOD,
  id: 'food-2',
  versionId: 'food-version-2',
  name: 'Chicken, breast, boneless, skinless, raw',
  provenance: 'UsdaFdc',
  externalId: '2646170',
  preparationBasis: 'AsSold',
  calories: 107.506,
  protein: 22.525,
  carbohydrate: 0,
  fat: 1.934,
  unreportedNutrients: ['Fibre', 'Polyols'],
};

// Two foods with the same name, as USDA returns them: canned beans and dry beans.
const CANNED_BEANS: FoodItem = {
  ...FOOD,
  id: 'food-3',
  versionId: 'food-version-3',
  name: 'BLACK BEANS',
  provenance: 'UsdaFdc',
  externalId: '2287095',
  calories: 70.8,
};

const DRY_BEANS: FoodItem = {
  ...CANNED_BEANS,
  id: 'food-4',
  versionId: 'food-version-4',
  externalId: '2404277',
  calories: 342.9,
};

const PUBLISHED_RECIPE: RecipeSummary = {
  id: 'recipe-1',
  versionId: 'recipe-version-1',
  revision: 1,
  name: 'Oats and whey',
  status: 'Published',
  servings: 1,
  calories: 520,
  protein: 38,
  carbohydrate: 62,
  fat: 12,
  allergens: ['Milk'],
};

const DRAFT_RECIPE: RecipeSummary = {
  ...PUBLISHED_RECIPE,
  id: 'recipe-2',
  versionId: 'recipe-version-2',
  name: 'Chicken and rice',
  status: 'Draft',
};

const DRAFT_PLAN: MealPlanSummary = {
  id: 'plan-1',
  versionId: 'plan-version-1',
  revision: 1,
  name: 'Balanced 2400',
  dayCount: 7,
  status: 'Draft',
  targetCalories: 2400,
  slotCount: 4,
};

const SETTINGS: NutritionSettings = {
  energyPolicyKey: 'AtwaterSpecific',
  energyPolicyVersion: 'v1',
  providerCalorieTolerance: 5,
  aiMonthlyRequestLimit: 100,
  aiMonthlyCostLimit: 20,
  aiCostCurrency: 'USD',
  version: 3,
};

async function render(api: Partial<ApiClient> = {}) {
  await TestBed.configureTestingModule({
    imports: [NutritionLibrary],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          listFoods: vi.fn(() => of({ total: 1, items: [FOOD] })),
          listRecipes: vi.fn(() => of({ total: 2, items: [PUBLISHED_RECIPE, DRAFT_RECIPE] })),
          listMealPlans: vi.fn(() => of({ total: 1, items: [DRAFT_PLAN] })),
          getNutritionSettings: vi.fn(() => of(SETTINGS)),
          createFood: vi.fn(() => of(undefined)),
          createRecipe: vi.fn(() => of(undefined)),
          publishRecipe: vi.fn(() => of(undefined)),
          createMealPlan: vi.fn(() => of(undefined)),
          publishMealPlan: vi.fn(() => of(undefined)),
          updateNutritionSettings: vi.fn(() => of({ ...SETTINGS, version: 4 })),
          ...api,
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(NutritionLibrary);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: TestBed.inject(ApiClient) };
}

/**
 * The library stacks five authoring panels on one screen, and several reuse the same captions
 * ("Protein (g)" belongs to both a food and a plan). Each test drives one panel, so it addresses
 * the panel first and the control within it.
 */
const panels = (host: HTMLElement) => Array.from(host.querySelectorAll('form.editor'));
const foodPanel = (host: HTMLElement) => panels(host)[0];
const recipePanel = (host: HTMLElement) => panels(host)[1];
const planPanel = (host: HTMLElement) => panels(host)[2];
const policyPanel = (host: HTMLElement) => panels(host)[3];

const cardLists = (host: HTMLElement) => Array.from(host.querySelectorAll('.cards'));
const recipeCards = (host: HTMLElement) => cardLists(host)[1];
const planCards = (host: HTMLElement) => cardLists(host)[2];

describe('NutritionLibrary', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * A coach-authored food becomes a canonical version that recipes snapshot, so its basis quantity,
   * unit and macros have to be exactly what the coach entered. A control that never wrote back
   * would store the component's defaults under a real food's name.
   */
  it('creates a coach-authored food from the values entered', async () => {
    const { fixture, host, api } = await render();

    const food = foodPanel(host);
    fill(food, 'Name', 'Greek yoghurt 2%');
    fill(food, 'Basis quantity', '170');
    fill(food, 'Protein (g)', '17.3');
    fill(food, 'Carbohydrate (g)', '6.1');
    fill(food, 'Fat (g)', '3.4');
    tick(food, 'Milk');
    await settle(fixture);

    press(host, 'Save canonical food');
    await settle(fixture);

    expect(api.createFood).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Greek yoghurt 2%',
        provenance: 'CoachAuthored',
        version: expect.objectContaining({
          basisQuantity: 170,
          proteinGrams: 17.3,
          carbohydrateGrams: 6.1,
          fatGrams: 3.4,
          declaredAllergens: ['Milk'],
        }),
      }),
    );
    expect(host.textContent).toContain('Coach-authored food saved as a canonical version.');
  });

  /**
   * A recipe is a set of canonical food snapshots, so it cannot be created empty and the ingredient
   * line has to carry the food version the coach picked.
   */
  it('creates a recipe draft from the ingredient lines added', async () => {
    const { fixture, host, api } = await render();

    // No ingredient, no recipe: the action is withheld rather than sending an empty draft.
    expect(button(host, 'Create recipe draft').disabled).toBe(true);

    const recipe = recipePanel(host);
    fill(recipe, 'Recipe name', 'Overnight oats');
    fill(recipe, 'Instructions', 'Combine and refrigerate.');
    fill(recipe, 'Recipe yield (servings)', '2');
    press(host, 'Add ingredient');
    await settle(fixture);

    const quantity = query<HTMLInputElement>(
      recipePanel(host),
      '.line-editor input[type="number"]',
    );
    quantity.value = '80';
    quantity.dispatchEvent(new Event('input'));
    await settle(fixture);

    expect(button(host, 'Create recipe draft').disabled).toBe(false);
    press(host, 'Create recipe draft');
    await settle(fixture);

    expect(api.createRecipe).toHaveBeenCalledWith({
      name: 'Overnight oats',
      instructions: 'Combine and refrigerate.',
      servings: 2,
      ingredients: [
        {
          foodItemVersionId: 'food-version-1',
          quantity: 80,
          unit: 'Gram',
          basis: 'AsSold',
          yieldFactorId: null,
          retentionFactorId: null,
        },
      ],
    });
    expect(host.textContent).toContain('Recipe draft created from canonical food snapshots.');
  });

  /** An added ingredient starts from its own food's basis rather than a shared default. */
  it('starts a new ingredient line at its food’s own basis quantity', async () => {
    const { fixture, host } = await render();

    press(host, 'Add ingredient');
    await settle(fixture);

    expect(
      query<HTMLInputElement>(recipePanel(host), '.line-editor input[type="number"]').value,
    ).toBe('100');
  });

  it('publishes a draft recipe and locks it', async () => {
    const { fixture, host, api } = await render();

    // Only the draft is offered for publication; the published one is already locked.
    expect(recipeCards(host).querySelectorAll('article button')).toHaveLength(1);

    press(recipeCards(host), 'Publish and lock');
    await settle(fixture);

    expect(api.publishRecipe).toHaveBeenCalledWith('recipe-version-2');
    expect(host.textContent).toContain('Recipe version published and locked.');
  });

  /**
   * A meal plan's slots reference published recipe versions, and each slot becomes a choice the
   * client picks between. The targets and slots must be the ones the coach set.
   */
  it('creates a meal-plan draft from the slots added', async () => {
    const { fixture, host, api } = await render();

    expect(button(host, 'Create plan draft').disabled).toBe(true);

    const plan = planPanel(host);
    fill(plan, 'Plan name', 'Balanced 2400');
    fill(plan, 'Days', '7');
    fill(plan, 'Daily calories', '2400');
    fill(plan, 'Protein (g)', '180');
    fill(plan, 'Carbohydrate (g)', '240');
    fill(plan, 'Fat (g)', '70');
    press(host, 'Add meal slot');
    await settle(fixture);

    expect(button(host, 'Create plan draft').disabled).toBe(false);
    press(host, 'Create plan draft');
    await settle(fixture);

    expect(api.createMealPlan).toHaveBeenCalledWith({
      name: 'Balanced 2400',
      dayCount: 7,
      targetCalories: 2400,
      targetProteinGrams: 180,
      targetCarbohydrateGrams: 240,
      targetFatGrams: 70,
      slots: [
        {
          dayOffset: 0,
          order: 0,
          name: 'Meal 1',
          // Only a published recipe version may be referenced.
          choices: [{ recipeVersionId: 'recipe-version-1', servings: 1 }],
        },
      ],
    });
    expect(host.textContent).toContain('Meal-plan draft created');
  });

  /** A draft recipe is not assignable to a client, so a slot may never point at one. */
  it('offers only published recipes as meal-slot choices', async () => {
    const { fixture, host } = await render();

    press(host, 'Add meal slot');
    await settle(fixture);

    const options = Array.from(
      query<HTMLSelectElement>(planPanel(host), '.line-editor select').options,
    ).map((option) => option.value);
    expect(options).toEqual(['recipe-version-1']);
  });

  /** A button that silently did nothing left the coach guessing; it now says what is missing. */
  it('explains that a recipe must be published before it can go into a meal plan', async () => {
    const { host, api } = await render({
      listRecipes: vi.fn(() => of({ total: 1, items: [DRAFT_RECIPE] })),
    });

    expect(button(host, 'Add meal slot').disabled).toBe(true);
    expect(planPanel(host).textContent).toContain('Publish a recipe first.');
    expect(planPanel(host).querySelector('.line-editor')).toBeNull();
    expect(button(host, 'Create plan draft').disabled).toBe(true);
    expect(api.createMealPlan).not.toHaveBeenCalled();
  });

  it('explains that a food is needed before a recipe can use one', async () => {
    const { host } = await render({ listFoods: vi.fn(() => of({ total: 0, items: [] })) });

    expect(button(host, 'Add ingredient').disabled).toBe(true);
    expect(recipePanel(host).textContent).toContain('Add or import a food above first');
  });

  /** Days are shown from 1, the way a coach counts them, and stored from 0. */
  it('counts a meal’s day from 1 and saves it from 0', async () => {
    const { fixture, host, api } = await render();

    const plan = planPanel(host);
    fill(plan, 'Plan name', 'Week');
    fill(plan, 'Days', '7');
    press(host, 'Add meal slot');
    await settle(fixture);

    const day = field(planPanel(host), 'Day');
    expect(day.value).toBe('1');
    fill(planPanel(host), 'Day', '3');
    await settle(fixture);
    press(host, 'Create plan draft');
    await settle(fixture);

    expect(api.createMealPlan).toHaveBeenCalledWith(
      expect.objectContaining({ slots: [expect.objectContaining({ dayOffset: 2 })] }),
    );
  });

  /**
   * The server refuses a recipe without instructions with a developer message, so the page stops
   * the save itself, says what is missing in plain words and marks the empty box.
   */
  it('refuses a recipe without instructions and marks the empty box', async () => {
    const { fixture, host, api } = await render();

    fill(recipePanel(host), 'Recipe name', 'Overnight oats');
    press(host, 'Add ingredient');
    await settle(fixture);
    press(host, 'Create recipe draft');
    await settle(fixture);

    expect(api.createRecipe).not.toHaveBeenCalled();
    expect(query(host, '[role="alert"]').textContent).toContain(
      'Add a few words on how to make it.',
    );
    expect(field(recipePanel(host), 'Instructions').getAttribute('aria-invalid')).toBe('true');
    expect(field(recipePanel(host), 'Recipe name').getAttribute('aria-invalid')).not.toBe('true');
  });

  it('refuses a food without a name', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Save canonical food');
    await settle(fixture);

    expect(api.createFood).not.toHaveBeenCalled();
    expect(query(host, '[role="alert"]').textContent).toContain('Give the food a name');
    expect(field(foodPanel(host), 'Name').getAttribute('aria-invalid')).toBe('true');
  });

  it('names allergens in words and stores their codes', async () => {
    const { fixture, host, api } = await render();

    const food = foodPanel(host);
    expect(food.textContent).toContain('Tree nuts');
    expect(food.textContent).not.toContain('SulphurDioxideAndSulphites');
    fill(food, 'Name', 'Almond butter');
    tick(food, 'Tree nuts');
    tick(food, 'Sulphites');
    await settle(fixture);
    press(host, 'Save canonical food');
    await settle(fixture);

    expect(api.createFood).toHaveBeenCalledWith(
      expect.objectContaining({
        version: expect.objectContaining({
          declaredAllergens: ['TreeNuts', 'SulphurDioxideAndSulphites'],
        }),
      }),
    );
  });

  /** The search box is a real search form, so Enter searches as well as the button does. */
  it('searches USDA when the search form is submitted with Enter', async () => {
    const searchUsdaFoods = vi.fn(() => of({ items: [], failureCode: null, message: null }));
    const { fixture, host } = await render({ searchUsdaFoods });

    fill(host, 'Search USDA foods', 'chicken breast raw');
    query(host, 'form[role="search"]').dispatchEvent(new Event('submit'));
    await settle(fixture);

    expect(searchUsdaFoods).toHaveBeenCalledWith('chicken breast raw');
    expect(host.textContent).toContain('No USDA foods match that search.');
  });

  it('marks a search result that is already in the library as added', async () => {
    const { fixture, host } = await render({
      listFoods: vi.fn(() => of({ total: 1, items: [USDA_CHICKEN] })),
      searchUsdaFoods: vi.fn(() =>
        of({
          items: [
            { externalId: '2646170', name: USDA_CHICKEN.name, dataType: 'Foundation' },
            { externalId: '171077', name: 'Chicken, broilers, breast, raw', dataType: 'SR Legacy' },
          ],
          failureCode: null,
          message: null,
        }),
      ),
    });

    fill(host, 'Search USDA foods', 'chicken breast');
    press(host, 'Search');
    await settle(fixture);

    const rows = Array.from(host.querySelectorAll('.results .list-row'));
    expect(rows[0].textContent).toContain('Added ✓');
    expect(rows[0].querySelector('button')).toBeNull();
    expect(rows[1].querySelector('button')?.textContent?.trim()).toBe('Import');
  });

  it('lets the coach dismiss a message', async () => {
    const { fixture, host } = await render();

    press(host, 'Save canonical food');
    await settle(fixture);
    query<HTMLButtonElement>(host, 'button[aria-label="Dismiss message"]').click();
    await settle(fixture);

    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('publishes a draft meal plan and locks it', async () => {
    const { fixture, host, api } = await render();

    press(planCards(host), 'Publish and lock');
    await settle(fixture);

    expect(api.publishMealPlan).toHaveBeenCalledWith('plan-version-1');
    expect(host.textContent).toContain('Meal-plan version published and locked.');
  });

  /** The policy carries a version, so a concurrent edit conflicts rather than being overwritten. */
  it('saves the workspace calculation policy with its version', async () => {
    const { fixture, host, api } = await render();

    fill(policyPanel(host), 'Provider calorie discrepancy tolerance (kcal)', '8');
    await settle(fixture);
    press(host, 'Save policy');
    await settle(fixture);

    expect(api.updateNutritionSettings).toHaveBeenCalledWith(
      expect.objectContaining({ providerCalorieTolerance: 8, version: 3 }),
    );
    expect(host.textContent).toContain('Nutrition workspace policy saved.');
  });

  it('reports a refused publication instead of showing the version as locked', async () => {
    const refused = new HttpErrorResponse({
      status: 409,
      error: { title: 'That recipe version is already published.' },
    });
    const { fixture, host } = await render({
      publishRecipe: vi.fn(() => throwError(() => refused)),
    });

    press(recipeCards(host), 'Publish and lock');
    await settle(fixture);

    expect(query(host, '[role="alert"]').textContent).toContain(
      'That recipe version is already published.',
    );
    expect(host.textContent).not.toContain('Recipe version published and locked.');
  });

  /**
   * A 0 that USDA never stated must not look like a measured 0, or a coach would trust a fibre or
   * sugar-alcohol figure nobody gave.
   */
  it('says which values USDA did not report on an imported food', async () => {
    const { host } = await render({
      listFoods: vi.fn(() => of({ total: 2, items: [FOOD, USDA_CHICKEN] })),
    });

    const flags = Array.from(host.querySelectorAll('[data-unreported]'));
    expect(flags).toHaveLength(1);
    expect(flags[0].closest('article')?.textContent).toContain(USDA_CHICKEN.name);
    expect(flags[0].textContent).toContain(
      'Not reported by USDA, saved as 0: fibre, sugar alcohols',
    );
  });

  it('explains a refused USDA import in words instead of a code', async () => {
    const { fixture, host } = await render({
      searchUsdaFoods: vi.fn(() =>
        of({
          items: [{ externalId: '9999001', name: 'Incomplete record', dataType: 'Branded' }],
          failureCode: null,
          message: null,
        }),
      ),
      importUsdaFood: vi.fn(() =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 503,
              error: {
                title: 'usda_nutrient_incomplete',
                code: 'usda_nutrient_incomplete',
                message:
                  'USDA FoodData Central did not report Protein for this food, so it was not imported. Choose another result or add the food yourself.',
              },
            }),
        ),
      ),
    });

    fill(host, 'Search USDA foods', 'incomplete');
    press(host, 'Search');
    await settle(fixture);
    press(host, 'Import');
    await settle(fixture);

    const alert = query(host, '[role="alert"]').textContent ?? '';
    expect(alert).toContain('did not report Protein for this food');
    expect(alert).not.toContain('usda_nutrient_incomplete');
  });

  describe('food search box in a recipe', () => {
    async function withIngredientLine() {
      const rendered = await render({
        listFoods: vi.fn(() =>
          of({ total: 4, items: [FOOD, USDA_CHICKEN, CANNED_BEANS, DRY_BEANS] }),
        ),
      });
      press(rendered.host, 'Add ingredient');
      await settle(rendered.fixture);
      const box = field(recipePanel(rendered.host), 'Food');
      return { ...rendered, box };
    }

    const typeInto = (box: HTMLInputElement, text: string) => {
      box.value = text;
      box.dispatchEvent(new Event('input'));
    };
    const key = (box: HTMLInputElement, name: string) => {
      const event = new KeyboardEvent('keydown', { key: name, cancelable: true });
      box.dispatchEvent(event);
      return event;
    };
    const options = (host: HTMLElement) => Array.from(host.querySelectorAll('[role="option"]'));

    /** Typing narrows the list, and each option says enough to tell same-named foods apart. */
    it('narrows the foods as the coach types', async () => {
      const { fixture, host, box } = await withIngredientLine();

      typeInto(box, 'black');
      await settle(fixture);

      const shown = options(host).map((option) => option.textContent ?? '');
      expect(shown).toHaveLength(2);
      expect(shown[0]).toContain('BLACK BEANS');
      expect(shown[0]).toContain('USDA · as sold · 71 kcal per 100 g');
      expect(shown[1]).toContain('343 kcal per 100 g');
      expect(box.getAttribute('aria-expanded')).toBe('true');
    });

    it('matches every typed word in any order', async () => {
      const { fixture, host, box } = await withIngredientLine();

      typeInto(box, 'raw chicken');
      await settle(fixture);

      expect(options(host).map((option) => option.querySelector('.name')?.textContent)).toEqual([
        USDA_CHICKEN.name,
      ]);
    });

    it('picks a food with the arrow keys and Enter, and the recipe uses it', async () => {
      const { fixture, host, box, api } = await withIngredientLine();

      typeInto(box, 'black');
      await settle(fixture);
      key(box, 'ArrowDown');
      await settle(fixture);
      const enter = key(box, 'Enter');
      await settle(fixture);

      // Enter chose the food; it did not submit the recipe form around the box.
      expect(enter.defaultPrevented).toBe(true);
      expect(api.createRecipe).not.toHaveBeenCalled();
      expect(box.value).toBe('BLACK BEANS');
      expect(host.querySelector('[role="listbox"]')).toBeNull();

      fill(recipePanel(host), 'Recipe name', 'Bean bowl');
      fill(recipePanel(host), 'Instructions', 'Soak and cook.');
      await settle(fixture);
      press(host, 'Create recipe draft');
      await settle(fixture);

      expect(api.createRecipe).toHaveBeenCalledWith(
        expect.objectContaining({
          ingredients: [expect.objectContaining({ foodItemVersionId: 'food-version-4' })],
        }),
      );
    });

    it('picks a food with the mouse', async () => {
      const { fixture, host, box } = await withIngredientLine();

      box.dispatchEvent(new MouseEvent('click'));
      await settle(fixture);
      const chicken = options(host).find((option) => option.textContent?.includes('raw'));
      chicken?.dispatchEvent(new MouseEvent('mousedown', { cancelable: true }));
      await settle(fixture);

      expect(box.value).toBe(USDA_CHICKEN.name);
      expect(box.getAttribute('aria-expanded')).toBe('false');
    });

    it('keeps the chosen food when the coach presses Escape', async () => {
      const { fixture, host, box } = await withIngredientLine();

      typeInto(box, 'chick');
      await settle(fixture);
      key(box, 'Escape');
      await settle(fixture);

      expect(box.value).toBe(FOOD.name);
      expect(host.querySelector('[role="listbox"]')).toBeNull();
    });

    it('says when nothing matches', async () => {
      const { fixture, host, box } = await withIngredientLine();

      typeInto(box, 'kibbeh');
      await settle(fixture);

      expect(options(host)).toHaveLength(0);
      expect(recipePanel(host).textContent).toContain('No food matches "kibbeh".');
    });
  });

  it('reports a failed load rather than an empty library', async () => {
    const { host } = await render({
      listFoods: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
    });

    expect(query(host, '[role="alert"]').textContent).toContain(
      'Nutrition library could not be loaded.',
    );
  });
});
