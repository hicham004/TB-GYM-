import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { field, fill, press, query, settle, tick } from '../../../testing/dom';
import { NutritionLibrary } from './nutrition-library';
import type { FoodItem, NutritionSettings } from './nutrition.models';

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
          getNutritionSettings: vi.fn(() => of(SETTINGS)),
          createFood: vi.fn(() => of(undefined)),
          updateNutritionSettings: vi.fn(() => of({ ...SETTINGS, version: 4 })),
          ...api,
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      provideRouter([]),
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(NutritionLibrary);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: TestBed.inject(ApiClient) };
}

/**
 * The library stacks two authoring panels on one screen, and they reuse some captions. Each
 * test drives one panel, so it addresses the panel first and the control within it.
 */
const panels = (host: HTMLElement) => Array.from(host.querySelectorAll('form.editor'));
const foodPanel = (host: HTMLElement) => panels(host)[0];
const policyPanel = (host: HTMLElement) => panels(host)[1];

describe('NutritionLibrary', () => {
  /** Meal plans moved to their own builder (R4.4a); the library says where, and makes none itself. */
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

    press(host, 'Save food');
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
    expect(host.textContent).toContain('Food saved.');
  });

  /**
   * A recipe is a set of canonical food snapshots, so it cannot be created empty and the ingredient
   * line has to carry the food version the coach picked.
   */
  /** An added ingredient starts from its own food's basis rather than a shared default. */
  /**
   * The server refuses a recipe without instructions with a developer message, so the page stops
   * the save itself, says what is missing in plain words and marks the empty box.
   */
  it('refuses a food without a name', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Save food');
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
    press(host, 'Save food');
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

    press(host, 'Save food');
    await settle(fixture);
    query<HTMLButtonElement>(host, 'button[aria-label="Dismiss message"]').click();
    await settle(fixture);

    expect(host.querySelector('[role="alert"]')).toBeNull();
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
    expect(host.textContent).toContain('Calculation defaults saved.');
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

  it('reports a failed load rather than an empty library', async () => {
    const { host } = await render({
      listFoods: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
    });

    expect(query(host, '[role="alert"]').textContent).toContain(
      'Nutrition library could not be loaded.',
    );
  });
});
