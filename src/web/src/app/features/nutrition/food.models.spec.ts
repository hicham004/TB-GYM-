import { describe, expect, it } from 'vitest';
import {
  CHICKEN_FOOD,
  CHOBANI_RESULT,
  OATS_FOOD,
  usdaResult,
  YOGURT_FOOD,
} from '../../../testing/food-fixtures';
import { food } from '../../../testing/recipe-fixtures';
import {
  brandName,
  createFoodRequest,
  draftFromFood,
  editFoodRequest,
  emptyFoodDraft,
  estimatedCalories,
  type FoodDraft,
  foodFacts,
  foodProblems,
  foodRow,
  usdaRow,
} from './food.models';

const filled = (overrides: Partial<FoodDraft> = {}): FoodDraft => ({
  ...emptyFoodDraft(),
  name: 'Labneh',
  protein: 6,
  carbs: 4,
  fat: 10,
  ...overrides,
});

describe('food rows', () => {
  it('reads a food of the coach’s own with its measure, calories, macros and allergens', () => {
    const row = foodRow(OATS_FOOD, 'en-US');
    expect(row).toMatchObject({
      name: 'Rolled oats',
      own: true,
      meta: 'Your food · as sold · per 100 g',
      kcal: '380 kcal',
      macros: 'P 13 g · C 68 g · F 7 g',
      allergens: 'Contains gluten',
      flag: null,
      externalId: null,
    });
    expect(row.split).toEqual({ protein: 13, carbs: 70, fat: 16 });
  });

  it('marks a USDA copy, and names what USDA left out that is worth a look', () => {
    const row = foodRow(CHICKEN_FOOD, 'en-US');
    expect(row.own).toBe(false);
    expect(row.meta).toBe('USDA · raw · per 100 g');
    // USDA almost never reports sugar alcohols, and alcohol only for drinks, so only fibre is flagged (NCM-9).
    expect(row.flag).toBe('Check fibre');
    expect(row.externalId).toBe('2646170');
  });

  it('flags nothing when USDA left out only what it never reports (NCM-9)', () => {
    const usual = food({
      provenance: 'UsdaFdc',
      externalId: '171705',
      versionOverrides: { unreportedNutrients: ['Polyols', 'Ethanol'] },
    });
    expect(foodRow(usual, 'en-US').flag).toBeNull();
    // The details still say what USDA did not report, in a list with "or".
    expect(foodFacts(usual, null, 'en-US').unreported).toBe(
      'USDA didn’t report sugar alcohols or alcohol, so they were saved as 0.',
    );
    expect(
      foodFacts(
        food({
          provenance: 'UsdaFdc',
          externalId: '1',
          versionOverrides: { unreportedNutrients: ['Ethanol'] },
        }),
        null,
        'en-US',
      ).unreported,
    ).toBe('USDA didn’t report alcohol, so it was saved as 0.');
  });

  it('flags label calories that disagree with the macros before anything USDA left out', () => {
    const flagged = food({
      versionOverrides: { hasCalorieDiscrepancy: true, unreportedNutrients: ['Fibre'] },
    });
    expect(foodRow(flagged, 'en-US').flag).toBe('Label calories differ');
  });

  it('says one serving as a serving', () => {
    const bar = food({ versionOverrides: { basisQuantity: 1, basisUnit: 'Serving' } });
    expect(foodRow(bar, 'en-US').meta).toBe('Your food · as sold · per serving');
  });
});

describe('USDA matches', () => {
  it('shows what USDA states per 100 g, and keeps the database codes for the details switch', () => {
    expect(usdaRow(usdaResult(), 'en-US')).toMatchObject({
      fdcId: '2646170',
      brand: null,
      kcal: '106 kcal per 100 g',
      macros: 'P 22.5 g · C 0 g · F 1.9 g',
      database: 'FoodData Central 2646170 · Foundation',
    });
  });

  it('names a packaged product by its brand, in ordinary case', () => {
    expect(usdaRow(CHOBANI_RESULT, 'en-US').brand).toBe('Chobani');
    expect(brandName("TRADER JOE'S")).toBe("Trader Joe's");
    expect(brandName('Al Wadi Al Akhdar')).toBe('Al Wadi Al Akhdar');
    expect(brandName('BEN & JERRY')).toBe('Ben & Jerry');
  });

  it('leaves out the numbers USDA did not give, and never shows carbs below zero', () => {
    const bare = usdaRow(usdaResult({ calories: null, proteinGrams: null }), 'en-US');
    expect(bare).toMatchObject({ kcal: null, macros: null, split: null });
    expect(usdaRow(usdaResult({ carbohydrateGrams: -0.43 }), 'en-US').macros).toBe(
      'P 22.5 g · C 0 g · F 1.9 g',
    );
  });
});

describe('the details sheet', () => {
  it('lists the nutrients with fibre under the carbs, and the allergens', () => {
    const facts = foodFacts(OATS_FOOD, 25, 'en-US');
    expect(facts.rows).toEqual([
      { label: 'Protein', value: '13 g' },
      { label: 'Carbs', value: '68 g' },
      { label: 'of which fibre', value: '10 g', indent: true },
      { label: 'Fat', value: '7 g' },
    ]);
    expect(facts).toMatchObject({
      own: true,
      source: 'Your food · as sold',
      per: 'per 100 g',
      kcal: '380 kcal',
      label: null,
      allergens: 'Contains gluten',
      database: null,
    });
  });

  it('explains a label that disagrees, against the workspace’s tolerance', () => {
    const flagged = food({
      versionOverrides: { providerCalories: 420, hasCalorieDiscrepancy: true },
    });
    const facts = foodFacts(flagged, 25, 'en-US');
    expect(facts.label).toBe('The label says 420 kcal.');
    expect(facts.discrepancy).toBe(
      'That is more than 25 kcal from what the macros add up to, so check the numbers.',
    );
  });

  it('says what USDA left out and keeps its database codes behind the switch', () => {
    const facts = foodFacts(CHICKEN_FOOD, null, 'en-US');
    expect(facts.own).toBe(false);
    expect(facts.source).toBe('Copied from USDA · raw');
    expect(facts.unreported).toBe(
      'USDA didn’t report fibre, sugar alcohols or alcohol, so they were saved as 0.',
    );
    expect(facts.allergens).toBe('No allergens declared.');
    expect(facts.database).toBe('FoodData Central 2646170 · Foundation');
  });
});

describe('the food sheet', () => {
  it('starts a new food at 100 g as sold, with the macros still to type', () => {
    expect(foodProblems(emptyFoodDraft()).map((problem) => problem.field)).toEqual([
      'name',
      'protein',
      'carbs',
      'fat',
    ]);
    expect(foodProblems(filled())).toEqual([]);
  });

  it('opens a saved food with its optional nutrients only when it has them', () => {
    expect(draftFromFood(YOGURT_FOOD)).toMatchObject({
      name: 'Greek yogurt',
      amount: 100,
      unit: 'Gram',
      protein: 10,
      fibre: 10,
      polyols: null,
      alcohol: null,
      labelCalories: null,
      allergens: ['Milk'],
    });
  });

  it('refuses an amount of 0, negative numbers, and fibre beyond the carbs', () => {
    expect(foodProblems(filled({ amount: 0 }))[0].field).toBe('amount');
    expect(foodProblems(filled({ fat: -1 }))[0].field).toBe('fat');
    expect(foodProblems(filled({ fibre: -2 }))[0].message).toBe(
      'Other nutrients can’t be below 0.',
    );
    expect(foodProblems(filled({ carbs: 4, fibre: 3, polyols: 2 }))[0]).toEqual({
      field: 'more',
      message:
        'Fibre and sugar alcohols are part of the carbs, so together they can’t be more than the carbs.',
    });
  });

  it('refuses nutrients heavier than the amount they are for, except per serving', () => {
    expect(foodProblems(filled({ amount: 15 }))[0].field).toBe('amount');
    expect(foodProblems(filled({ amount: 1, unit: 'Serving' }))).toEqual([]);
  });

  it('adds up the calories as the server will, under either policy', () => {
    const draft = filled({ protein: 10, carbs: 20, fat: 5, fibre: 4, polyols: 2, alcohol: 1 });
    // US-style (Atwater v2): total carbs at 4, alcohol at 7 (C7).
    expect(estimatedCalories(draft, 'Atwater')).toBe(172);
    expect(estimatedCalories(draft, null)).toBe(172);
    // Red wine, per 100 g as USDA lists it: about 85 kcal, not the 11 its protein and carbs give.
    const wine = filled({ amount: 100, protein: 0.1, carbs: 2.6, fat: 0, alcohol: 10.6 });
    expect(estimatedCalories(wine, 'Atwater')).toBeCloseTo(0.4 + 10.4 + 74.2, 6);
    // EU: the carbs are typed as an EU label prints them, without the 4 g of fibre (C6), so 16 g
    // is the same food; available carbs 14 g at 4, fibre at 2, sugar alcohols at 2.4, alcohol at 7.
    expect(estimatedCalories({ ...draft, carbs: 16 }, 'Eu1169')).toBeCloseTo(
      40 + 56 + 45 + 4.8 + 7 + 8,
      6,
    );
    expect(estimatedCalories(filled({ fat: null }), 'Atwater')).toBeNull();
  });

  it('sends a new food as the coach’s own, allergens in their usual order', () => {
    const request = createFoodRequest(
      filled({ name: '  Labneh ', allergens: ['Sesame', 'Milk'], labelCalories: 130 }),
    );
    expect(request).toMatchObject({
      name: 'Labneh',
      provenance: 'CoachAuthored',
      externalId: null,
      version: {
        basisQuantity: 100,
        basisUnit: 'Gram',
        preparationBasis: 'AsSold',
        proteinGrams: 6,
        fibreGrams: 0,
        providerCalories: 130,
        sourceAttribution: 'Coach-authored food',
        declaredAllergens: ['Milk', 'Sesame'],
      },
    });
  });

  it('sends an edit as the next version, renamed, from the revision the sheet opened', () => {
    const request = editFoodRequest(filled({ name: 'Labneh balls' }), 3);
    expect(request).toMatchObject({ name: 'Labneh balls', baseRevision: 3, proteinGrams: 6 });
  });
});
