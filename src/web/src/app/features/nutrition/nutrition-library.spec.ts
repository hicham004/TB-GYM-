import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, fill, press, query, settle, tick } from '../../../testing/dom';
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

  it('adds no meal slot at all when no recipe has been published', async () => {
    const { fixture, host, api } = await render({
      listRecipes: vi.fn(() => of({ total: 1, items: [DRAFT_RECIPE] })),
    });

    press(host, 'Add meal slot');
    await settle(fixture);

    expect(planPanel(host).querySelector('.line-editor')).toBeNull();
    expect(button(host, 'Create plan draft').disabled).toBe(true);
    expect(api.createMealPlan).not.toHaveBeenCalled();
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

  it('reports a failed load rather than an empty library', async () => {
    const { host } = await render({
      listFoods: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
    });

    expect(query(host, '[role="alert"]').textContent).toContain(
      'Nutrition library could not be loaded.',
    );
  });
});
