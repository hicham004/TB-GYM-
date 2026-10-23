import { describe, expect, it } from 'vitest';
import {
  CHICKEN_GRILLED,
  cookedRiceLine,
  RAW_RICE,
  RAW_RICE_FOOD,
  RICE_BOILED,
} from '../../../testing/cooking-fixtures';
import {
  OATS_FOOD,
  recipeDetail,
  recipeSummary,
  YOGURT_FOOD,
} from '../../../testing/recipe-fixtures';
import {
  allergenText,
  draftFromDetail,
  draftSignature,
  emptyDraft,
  energySplit,
  foodFromView,
  ingredientRequests,
  keepsAmount,
  lineForFood,
  lineMacros,
  linesFromSuggestion,
  matchLine,
  perServing,
  readSuggestion,
  recipeAllergens,
  recipeCard,
  recipeProblem,
  recipeTotal,
  useNewerFood,
  weighable,
  weighCooked,
  weighedThrough,
  weighRaw,
} from './recipe.models';

const OATS = foodFromView(OATS_FOOD);
const YOGURT = foodFromView(YOGURT_FOOD);

describe('recipe totals as typed', () => {
  it('scales a food from its own measure to the amount typed', () => {
    const line = { ...lineForFood(OATS), quantity: 50 };
    expect(lineMacros(line)).toEqual({ calories: 190, protein: 6.5, carbs: 34, fat: 3.5 });
  });

  it('counts nothing for a line with no food or no usable amount', () => {
    expect(lineMacros({ ...lineForFood(OATS), quantity: null })).toBeNull();
    expect(lineMacros({ ...lineForFood(OATS), quantity: 0 })).toBeNull();
    expect(
      lineMacros(
        linesFromSuggestion([{ name: 'oats', quantity: 80, unit: 'g', uncertain: false }])[0],
      ),
    ).toBeNull();
  });

  it('adds the lines up and divides by the servings', () => {
    const lines = [
      { ...lineForFood(OATS), quantity: 80 },
      { ...lineForFood(YOGURT), quantity: 200 },
    ];
    const total = recipeTotal(lines);
    expect(total.calories).toBeCloseTo(444);
    expect(total.protein).toBeCloseTo(30.4);
    expect(perServing(total, 2)?.calories).toBeCloseTo(222);
    expect(perServing(total, null)).toBeNull();
    expect(perServing(total, 0)).toBeNull();
  });

  it('starts an existing recipe from its saved lines, each its own measure', () => {
    const draft = draftFromDetail(recipeDetail());
    expect(draft.lines.map((line) => [line.food?.name, line.quantity])).toEqual([
      ['Rolled oats', 80],
      ['Greek yogurt', 200],
    ]);
    // Doubling the oats doubles what the saved oats line held.
    const doubled = { ...draft.lines[0], quantity: 160 };
    expect(lineMacros(doubled)?.calories).toBeCloseTo(608);
    expect(draft.photoId).toBe('photo-1');
    expect([draft.prepMinutes, draft.cookMinutes]).toEqual([null, null]);
    const timed = recipeDetail();
    timed.latest = { ...timed.latest, prepMinutes: 10, cookMinutes: 0 };
    expect([draftFromDetail(timed).prepMinutes, draftFromDetail(timed).cookMinutes]).toEqual([
      10, 0,
    ]);
  });

  it('offers a food edited since, and takes its numbers into the line on request', () => {
    const detail = recipeDetail();
    const [oats, yogurt] = detail.latest.ingredients;
    const edited = {
      ...YOGURT_FOOD,
      currentVersion: { ...YOGURT_FOOD.currentVersion, id: 'yogurt-food-v2', proteinGrams: 11 },
    };
    const perServing = {
      ...YOGURT_FOOD,
      currentVersion: { ...edited.currentVersion, basisQuantity: 1, basisUnit: 'Serving' as const },
    };
    const draft = draftFromDetail({
      ...detail,
      latest: {
        ...detail.latest,
        ingredients: [oats, { ...yogurt, newerFood: edited }],
      },
    });

    // Only a line whose food was edited since it was saved is offered new numbers.
    expect(draft.lines.map((line) => line.newer?.versionId ?? null)).toEqual([
      null,
      'yogurt-food-v2',
    ]);
    const taken = useNewerFood(draft.lines[1]);
    expect([taken.food?.versionId, taken.quantity, taken.newer]).toEqual([
      'yogurt-food-v2',
      200,
      null,
    ]);
    expect(lineMacros(taken)?.protein).toBeCloseTo(22);
    expect(draftSignature({ ...draft, lines: [draft.lines[0], taken] })).not.toBe(
      draftSignature(draft),
    );

    // Measured in another unit now: the amount is typed again, never converted.
    const remeasured = useNewerFood({ ...draft.lines[1], newer: foodFromView(perServing) });
    expect(remeasured.quantity).toBeNull();
  });

  it('gives each macro its share of the calories it brings', () => {
    expect(energySplit({ calories: 400, protein: 30, carbs: 50, fat: 9 })).toEqual({
      protein: 30,
      carbs: 50,
      fat: 20,
    });
    expect(energySplit({ calories: 0, protein: 0, carbs: 0, fat: 0 })).toBeNull();
  });

  it('names every allergen the chosen foods declare, once and in the usual order', () => {
    const lines = [lineForFood(YOGURT), lineForFood(OATS), lineForFood(YOGURT)];
    expect(recipeAllergens(lines)).toEqual(['GlutenCereals', 'Milk']);
    expect(allergenText(recipeAllergens(lines))).toBe('Contains gluten, milk');
    expect(allergenText([])).toBe('');
  });
});

describe('a raw food weighed cooked (INV-6)', () => {
  it('offers only a raw food measured in grams', () => {
    expect(weighable(RAW_RICE)).toBe(true);
    expect(weighable(OATS)).toBe(false);
    expect(weighable({ ...RAW_RICE, basis: 'Cooked' })).toBe(false);
    expect(weighable({ ...RAW_RICE, unit: 'Serving', basisQuantity: 1 })).toBe(false);
    expect(weighable(null)).toBe(false);
  });

  it('turns the raw amount into the cooked weight of the same rice, counting what cooking keeps', () => {
    const raw = lineForFood(RAW_RICE);
    const cooked = weighCooked(raw, RICE_BOILED);
    expect([cooked.quantity, cooked.cooked]).toEqual([290, RICE_BOILED]);
    // All of it kept: the same rice holds the same numbers.
    expect(lineMacros(cooked)).toEqual(lineMacros(raw));

    // Chicken's numbers on the same 100 g: 75 g cooked, 95% kept.
    const lossy = weighCooked(raw, CHICKEN_GRILLED);
    expect(lossy.quantity).toBe(75);
    expect(lineMacros(lossy)?.calories).toBeCloseTo(353 * 0.95);
    expect(lineMacros(lossy)?.protein).toBeCloseTo(7 * 0.95);
    // Typed in cooked grams from there: 150 g cooked is 200 g raw.
    expect(lineMacros({ ...lossy, quantity: 150 })?.carbs).toBeCloseTo(80 * 2 * 0.95);
  });

  it('changes conversion and weighs raw again from the raw weight, to a kitchen scale’s decimal', () => {
    const cooked = weighCooked({ ...lineForFood(RAW_RICE), quantity: 33 }, RICE_BOILED);
    expect(cooked.quantity).toBe(95.7);
    expect(weighRaw(cooked)).toMatchObject({ quantity: 33, cooked: null });
    const forty = weighCooked({ ...lineForFood(RAW_RICE), quantity: 40 }, RICE_BOILED);
    expect(weighCooked(forty, CHICKEN_GRILLED)).toMatchObject({
      quantity: 30,
      cooked: CHICKEN_GRILLED,
    });

    // An empty box stays empty, and a line weighed raw is left as it is.
    expect(weighCooked({ ...cooked, quantity: null }, CHICKEN_GRILLED).quantity).toBeNull();
    const raw = lineForFood(RAW_RICE);
    expect(weighRaw(raw)).toBe(raw);
  });

  it('weighs back to the very raw amount it came from while the cooked one is as converted', () => {
    // 33 g raw through a 0.75 yield is 24.75 g, 24.8 g on a kitchen scale.
    const cooked = weighCooked({ ...lineForFood(RAW_RICE), quantity: 33 }, CHICKEN_GRILLED);
    expect(cooked.quantity).toBe(24.8);
    expect(weighRaw(cooked).quantity).toBe(33);
    expect(weighCooked(cooked, RICE_BOILED).quantity).toBe(95.7);
    expect(weighedThrough(cooked, CHICKEN_GRILLED)).toBe(true);
    expect(weighedThrough(cooked, RICE_BOILED)).toBe(false);
    // Typed again, the amount is the coach's own: 30 g cooked is 40 g raw.
    expect(weighRaw({ ...cooked, quantity: 30 }).quantity).toBe(40);
    expect(weighedThrough(lineForFood(RAW_RICE), RICE_BOILED)).toBe(false);
  });

  it('opens a line saved cooked as its raw food, weighed through its conversion', () => {
    const detail = recipeDetail();
    detail.latest = {
      ...detail.latest,
      ingredients: [
        cookedRiceLine({
          newerFood: {
            ...RAW_RICE_FOOD,
            currentVersion: { ...RAW_RICE_FOOD.currentVersion, id: 'rice-v2' },
          },
        }),
      ],
    };
    const draft = draftFromDetail(detail);
    const [line] = draft.lines;

    expect(line.cooked).toEqual({
      ...RICE_BOILED,
      yieldId: 'y-rice-weighed',
      retentionId: 'r-rice-weighed',
      yield: 2.5,
      retention: 0.9,
      source: 'Weighed in my kitchen',
    });
    expect([line.food?.basis, line.food?.basisQuantity, line.quantity]).toEqual(['Raw', 60, 150]);
    expect(weighable(line.food)).toBe(true);
    // The editor works a line weighed cooked out itself, so a food edited since is offered too.
    expect(line.newer?.versionId).toBe('rice-v2');
    // As saved, it holds what the server worked out; doubled, twice that.
    expect(lineMacros(line)?.calories).toBeCloseTo(190.62);
    expect(lineMacros({ ...line, quantity: 300 })?.protein).toBeCloseTo(7.56);

    // Weighed raw again: the 60 g it came from, whole, as nothing says it was cooked.
    const raw = weighRaw(line);
    expect(raw.quantity).toBe(60);
    expect(lineMacros(raw)?.protein).toBeCloseTo(4.2);

    // Sent as weighed: cooked through its two factors, or raw with none.
    expect(ingredientRequests([line, raw])).toEqual([
      {
        foodItemVersionId: 'rice-v1',
        quantity: 150,
        unit: 'Gram',
        basis: 'Cooked',
        yieldFactorId: 'y-rice-weighed',
        retentionFactorId: 'r-rice-weighed',
      },
      {
        foodItemVersionId: 'rice-v1',
        quantity: 60,
        unit: 'Gram',
        basis: 'Raw',
        yieldFactorId: null,
        retentionFactorId: null,
      },
    ]);
    // Another conversion at the same amount is a change to save.
    const other = {
      ...line,
      cooked: { ...line.cooked!, yieldId: 'y-other', retentionId: 'r-other' },
    };
    expect(draftSignature({ ...draft, lines: [other] })).not.toBe(draftSignature(draft));
  });

  it('keeps a line weighed cooked while its food’s new numbers are still a raw food in grams', () => {
    const line = weighCooked(lineForFood(RAW_RICE), RICE_BOILED);
    const newer = { ...RAW_RICE, versionId: 'rice-v2', protein: 7.5 };
    expect(keepsAmount({ ...line, newer })).toBe(true);
    expect(useNewerFood({ ...line, newer })).toMatchObject({
      food: newer,
      quantity: 290,
      cooked: RICE_BOILED,
      newer: null,
    });

    // Now sold as it is, it is no longer weighed through the conversion, and the amount is typed again.
    const asSold = { ...newer, basis: 'AsSold' as const };
    expect(keepsAmount({ ...line, newer: asSold })).toBe(false);
    expect(useNewerFood({ ...line, newer: asSold })).toMatchObject({
      quantity: null,
      cooked: null,
    });
  });
});

describe('an AI suggestion', () => {
  const json = JSON.stringify({
    name: 'Oat bowl',
    ingredients: [
      { name: 'oats', quantity: 80, unit: 'g', uncertain: false },
      { name: 'milk', quantity: 1, unit: 'serving', uncertain: true },
    ],
  });

  it('reads the checked suggestion, and nothing from anything else', () => {
    expect(readSuggestion(json)?.ingredients.map((item) => item.name)).toEqual(['oats', 'milk']);
    expect(readSuggestion('{"unexpected":true}')).toBeNull();
    expect(readSuggestion('not json')).toBeNull();
    expect(readSuggestion(null)).toBeNull();
  });

  it('carries a suggested amount over only when it is in the chosen food’s unit', () => {
    const [oats, milk] = linesFromSuggestion(readSuggestion(json)!.ingredients);
    expect(matchLine(oats, OATS).quantity).toBe(80);
    // A serving of milk is not grams of yogurt: the food's own measure stands until the coach types.
    expect(matchLine(milk, YOGURT).quantity).toBe(100);
    expect(matchLine(milk, YOGURT).suggestion?.uncertain).toBe(true);
  });
});

describe('what stops a save', () => {
  const ready = () => ({
    ...emptyDraft(),
    name: 'Overnight oats',
    servings: 2,
    instructions: 'Stir and chill.',
    lines: [{ ...lineForFood(OATS), quantity: 80 }],
  });

  it('finds nothing in a complete recipe', () => {
    expect(recipeProblem(ready())).toBeNull();
  });

  it('reads the editor top to bottom: name, servings, ingredients, method', () => {
    expect(recipeProblem({ ...ready(), name: '  ' })?.field).toBe('name');
    expect(recipeProblem({ ...ready(), servings: 0 })?.field).toBe('servings');
    expect(recipeProblem({ ...ready(), servings: null })?.field).toBe('servings');
    expect(recipeProblem({ ...ready(), lines: [] })?.message).toBe('Add at least one ingredient.');
    expect(recipeProblem({ ...ready(), instructions: ' ' })?.field).toBe('instructions');
    expect(recipeProblem({ ...ready(), prepMinutes: -1 })?.field).toBe('prep');
    expect(recipeProblem({ ...ready(), cookMinutes: 12.5 })?.message).toBe(
      'Give the time in whole minutes, up to 2880 (two days).',
    );
    expect(recipeProblem({ ...ready(), cookMinutes: 2_881 })?.field).toBe('cook');
    expect(recipeProblem({ ...ready(), prepMinutes: 0, cookMinutes: 2_880 })).toBeNull();
  });

  it('names the ingredient at fault', () => {
    const suggested = linesFromSuggestion([
      { name: 'tahini', quantity: 15, unit: 'g', uncertain: false },
    ])[0];
    const unmatched = recipeProblem({ ...ready(), lines: [...ready().lines, suggested] });
    expect(unmatched).toEqual({
      field: 'lines',
      lineKey: suggested.key,
      message: 'Choose a food for “tahini”, or remove it.',
    });
    const empty = { ...lineForFood(YOGURT), quantity: null };
    expect(recipeProblem({ ...ready(), lines: [empty] })?.message).toBe(
      'Give “Greek yogurt” an amount above 0.',
    );
  });

  it('sends each line as its food version, amount, unit and basis', () => {
    expect(ingredientRequests(ready().lines)).toEqual([
      {
        foodItemVersionId: 'oats-food-v1',
        quantity: 80,
        unit: 'Gram',
        basis: 'AsSold',
        yieldFactorId: null,
        retentionFactorId: null,
      },
    ]);
  });

  it('sees a change only when something saved would change', () => {
    const draft = ready();
    expect(draftSignature({ ...draft, name: ' Overnight oats ' })).toBe(draftSignature(draft));
    expect(draftSignature({ ...draft, photoId: 'photo-2' })).not.toBe(draftSignature(draft));
    expect(draftSignature({ ...draft, prepMinutes: 5 })).not.toBe(draftSignature(draft));
    expect(draftSignature({ ...draft, cookMinutes: 0 })).not.toBe(draftSignature(draft));
  });
});

describe('a recipe card', () => {
  it('shows one serving, its macros and shares, servings and allergens', () => {
    const card = recipeCard(recipeSummary(), 'en-US');
    expect(card.kcal).toBe('222 kcal a serving');
    expect(card.macros).toBe('P 15.2 g · C 31.2 g · F 4.8 g');
    expect(card.servings).toBe('2 servings');
    expect(card.allergens).toBe('Contains gluten, milk');
    expect(card.status).toBeNull();
    expect(card.photoId).toBe('photo-1');
  });

  it('marks a draft, and a published recipe with changes not published', () => {
    expect(
      recipeCard(recipeSummary({ status: 'Draft', publishedVersionId: null }), 'en-US').status,
    ).toEqual({
      label: 'Draft',
      tone: 'neutral',
    });
    expect(recipeCard(recipeSummary({ status: 'Draft' }), 'en-US').status).toEqual({
      label: 'Changes not published',
      tone: 'warm',
    });
  });
});
