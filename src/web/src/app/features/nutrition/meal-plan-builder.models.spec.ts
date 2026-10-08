import { describe, expect, it } from 'vitest';
import {
  CHICKEN,
  draftSummary,
  draftView,
  LENTILS,
  OATS,
  planDetail,
  planSummary,
  recipe,
  versionView,
} from '../../../testing/meal-plan-fixtures';
import {
  acceptsDrop,
  addChoice,
  addDay,
  addMeal,
  addWeek,
  applyPlanDrop,
  clearDay,
  copyDayToAll,
  dayTotal,
  draftPlanCard,
  duplicateDay,
  emptyPlan,
  filterRecipes,
  macroSplit,
  MAX_DAYS,
  MAX_MEALS_PER_DAY,
  type MealPlanModel,
  mealTotal,
  moveMeal,
  newerRecipes,
  planCard,
  planFromDraft,
  planFromVersion,
  planProblem,
  planRecipe,
  planVersionRows,
  planVersionToOpen,
  recipeBook,
  removeDay,
  shiftMeal,
  standing,
  toDraftContent,
  useNewestVersion,
  versionRecipes,
  weeksOf,
} from './meal-plan-builder.models';

const oats = planRecipe(OATS);
const chicken = planRecipe(CHICKEN);
const lentils = planRecipe(LENTILS);
const book = recipeBook([oats, chicken, lentils]);

/** The fixture's published version, as the builder opens it. */
function opened(): MealPlanModel {
  return planFromVersion(versionView(), 'Lean bulk');
}

const mealNames = (plan: MealPlanModel, day: number) =>
  plan.days[day].meals.map((meal) => meal.name);

describe('meal-plan builder models', () => {
  describe('reading what the server sends', () => {
    it('counts a recipe per serving: a batch of four is divided by four', () => {
      expect(lentils.perServing).toEqual({ calories: 300, protein: 18, carbs: 40, fat: 6 });
      expect(oats.perServing.calories).toBe(400);
      expect(lentils.initials).toBe('LS');
      expect(planRecipe({ ...CHICKEN, name: 'Chicken & rice' }).initials).toBe('CR');
    });

    it('opens a version with its days in order, each meal in its place, and its targets', () => {
      const plan = opened();

      expect(plan.name).toBe('Lean bulk');
      expect(plan.days).toHaveLength(2);
      expect(mealNames(plan, 0)).toEqual(['Breakfast', 'Lunch']);
      expect(mealNames(plan, 1)).toEqual(['Breakfast']);
      expect(
        plan.days[0].meals[1].choices.map((choice) => [choice.recipeVersionId, choice.servings]),
      ).toEqual([
        ['chicken-v1', 1],
        ['lentils-v1', 2],
      ]);
      expect(plan.targets).toEqual({ calories: 2000, protein: 150, carbs: 200, fat: 67 });
    });

    it('still counts a choice whose recipe the library no longer lists, from what it was saved with', () => {
      const recipes = versionRecipes(versionView({ recipes: [OATS] }));
      const missing = recipes.find((recipe) => recipe.versionId === 'lentils-v1');

      expect(missing?.name).toBe('Lentil soup');
      expect(missing?.perServing.calories).toBe(300);
    });

    it('sends the plan as it stands and reads it back the same, half-typed values included', () => {
      const plan = opened();
      plan.name = '  ';
      plan.targets.fat = null;
      plan.days[1].meals[0].choices[0].servings = null;

      const content = toDraftContent(plan);
      expect(content.targetFatGrams).toBeNull();
      expect(content.days?.[1].meals?.[0].choices?.[0].servings).toBe(0);

      const back = planFromDraft(draftView({ content }));
      expect(back.name).toBe('  ');
      expect(back.targets.fat).toBeNull();
      expect(mealNames(back, 0)).toEqual(['Breakfast', 'Lunch']);
      expect(back.days[0].meals[1].choices.map((choice) => choice.servings)).toEqual([1, 2]);
    });

    it('opens a version only it names, or else the newest', () => {
      expect(planVersionToOpen(planDetail(), 'plan-v1')).toBe('plan-v1');
      expect(planVersionToOpen(planDetail(), 'elsewhere')).toBe('plan-v2');
      expect(planVersionToOpen(planDetail({ versions: [] }), null)).toBeNull();
    });
  });

  describe('counting', () => {
    it('counts a meal with options as their average, for planning only', () => {
      const plan = opened();
      const lunch = mealTotal(plan.days[0].meals[1], book);

      expect(lunch.isAverage).toBe(true);
      expect(lunch.macros).toEqual({ calories: 600, protein: 43, carbs: 75, fat: 12 });

      const day = dayTotal(plan.days[0], book);
      expect(day.macros).toEqual({ calories: 1000, protein: 73, carbs: 125, fat: 21 });
      expect(day.isAverage).toBe(true);
      expect(dayTotal(plan.days[1], book)).toEqual({
        macros: { calories: 600, protein: 45, carbs: 75, fat: 13.5 },
        isAverage: false,
        mealCount: 1,
      });
    });

    it('leaves out an option whose servings are not typed yet', () => {
      const plan = opened();
      plan.days[0].meals[1].choices[1].servings = null;

      expect(mealTotal(plan.days[0].meals[1], book)).toEqual({
        macros: { calories: 600, protein: 50, carbs: 70, fat: 12 },
        isAverage: false,
      });
    });

    it('calls a day on target within 5%, and says when it is under, over, empty or has no target', () => {
      const total = (calories: number, mealCount = 1) => ({
        macros: { calories, protein: 0, carbs: 0, fat: 0 },
        isAverage: false,
        mealCount,
      });

      expect(standing(total(1900), 2000)).toBe('on');
      expect(standing(total(2100), 2000)).toBe('on');
      expect(standing(total(1899), 2000)).toBe('under');
      expect(standing(total(2101), 2000)).toBe('over');
      expect(standing(total(0, 0), 2000)).toBe('empty');
      expect(standing(total(1500), null)).toBe('unset');
    });

    it('shares the target between protein, carbs and fat by the calories each brings (4/4/9)', () => {
      expect(macroSplit({ calories: 2000, protein: 150, carbs: 200, fat: 67 })).toEqual({
        protein: 30,
        carbs: 40,
        fat: 30,
        calories: 2003,
      });
      expect(macroSplit({ calories: 2000, protein: 150, carbs: null, fat: 67 })).toBeNull();
      expect(macroSplit({ calories: null, protein: 0, carbs: 0, fat: 0 })).toBeNull();
    });
  });

  describe('changing the plan', () => {
    it('starts a new plan as one empty week with no targets', () => {
      const plan = emptyPlan();

      expect(plan.days).toHaveLength(7);
      expect(plan.days.every((day) => day.meals.length === 0)).toBe(true);
      expect(plan.targets).toEqual({ calories: null, protein: null, carbs: null, fat: null });
    });

    it('grows a plan by a copy of its last day, or of its last week', () => {
      const plan = opened();
      const longer = addDay(plan);
      expect(longer.days).toHaveLength(3);
      expect(mealNames(longer, 2)).toEqual(['Breakfast']);
      expect(longer.days[2].meals[0].key).not.toBe(plan.days[1].meals[0].key);

      const weeks = addWeek(plan);
      expect(weeks.days).toHaveLength(9);
      expect(weeks.days.slice(2).map((day) => day.meals.length)).toEqual([2, 1, 2, 1, 2, 1, 2]);
    });

    it('never grows past a year of days', () => {
      let plan: MealPlanModel = { ...emptyPlan(), days: emptyPlan().days.slice(0, 1) };
      for (let index = 0; index < 60; index++) plan = addWeek(plan);
      expect(plan.days).toHaveLength(MAX_DAYS);
      expect(addWeek(plan)).toBe(plan);
      expect(addDay(plan)).toBe(plan);
      expect(duplicateDay(plan, plan.days[0].key)).toBe(plan);
    });

    it('duplicates a day straight after it, uses a day for every day, clears and deletes days', () => {
      const plan = opened();
      const [first, second] = plan.days;

      const duplicated = duplicateDay(plan, first.key);
      expect(duplicated.days.map((day) => day.meals.length)).toEqual([2, 2, 1]);

      const everyday = copyDayToAll(plan, first.key);
      expect(mealNames(everyday, 1)).toEqual(['Breakfast', 'Lunch']);
      expect(everyday.days[1].key).toBe(second.key);
      expect(everyday.days[1].meals[0].key).not.toBe(first.meals[0].key);

      expect(clearDay(plan, first.key).days[0].meals).toEqual([]);
      expect(removeDay(plan, first.key).days.map((day) => day.key)).toEqual([second.key]);
      const single = removeDay(plan, first.key);
      expect(removeDay(single, second.key)).toBe(single);
    });

    it('names a new meal after the first of breakfast, lunch and dinner the day lacks, then snack', () => {
      let plan = emptyPlan();
      const day = plan.days[0].key;
      for (let count = 0; count < 4; count++) plan = addMeal(plan, day, oats).plan;

      expect(mealNames(plan, 0)).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snack']);
      expect(plan.days[0].meals[0].choices).toEqual([
        expect.objectContaining({ recipeVersionId: 'oats-v1', servings: 1 }),
      ]);

      const atStart = addMeal(plan, day, chicken, 0);
      expect(atStart.mealKey).toBe(atStart.plan.days[0].meals[0].key);
    });

    it('holds at most thirty meals a day', () => {
      let plan = emptyPlan();
      const day = plan.days[0].key;
      for (let count = 0; count < MAX_MEALS_PER_DAY; count++) plan = addMeal(plan, day, oats).plan;

      expect(addMeal(plan, day, oats)).toEqual({ plan, mealKey: null });
    });

    it('adds a recipe as another option once, however often it is dropped', () => {
      const plan = opened();
      const ref = { dayKey: plan.days[1].key, mealKey: plan.days[1].meals[0].key };

      const twice = addChoice(addChoice(plan, ref, chicken), ref, chicken);
      expect(twice.days[1].meals[0].choices.map((choice) => choice.recipeVersionId)).toEqual([
        'oats-v1',
        'chicken-v1',
      ]);
      expect(addChoice(plan, ref, oats)).toBe(plan);
    });

    it('moves a meal within its day and to another day', () => {
      const plan = opened();
      const lunch = { dayKey: plan.days[0].key, mealKey: plan.days[0].meals[1].key };

      expect(mealNames(shiftMeal(plan, lunch, -1), 0)).toEqual(['Lunch', 'Breakfast']);
      expect(shiftMeal(plan, lunch, 1)).toBe(plan);

      const moved = moveMeal(plan, lunch, plan.days[1].key, 99);
      expect(mealNames(moved, 0)).toEqual(['Breakfast']);
      expect(mealNames(moved, 1)).toEqual(['Breakfast', 'Lunch']);
    });
  });

  describe('drag and drop', () => {
    it('takes meals only into a day’s meals, and recipes only onto a meal or under a day', () => {
      const plan = opened();
      const ref = { dayKey: plan.days[0].key, mealKey: plan.days[0].meals[0].key };
      const meal = { kind: 'meal', ref } as const;
      const recipe = { kind: 'recipe', recipe: chicken } as const;

      expect(acceptsDrop(meal, { kind: 'meals', dayKey: plan.days[1].key })).toBe(true);
      expect(acceptsDrop(meal, { kind: 'new-meal', dayKey: plan.days[1].key })).toBe(false);
      expect(acceptsDrop(meal, { kind: 'options', ref })).toBe(false);
      expect(acceptsDrop(recipe, { kind: 'meals', dayKey: plan.days[1].key })).toBe(false);
      expect(acceptsDrop(recipe, { kind: 'new-meal', dayKey: plan.days[1].key })).toBe(true);
      expect(acceptsDrop(recipe, { kind: 'options', ref })).toBe(true);
    });

    it('starts a meal from a recipe dropped under a day, and adds an option dropped onto a meal', () => {
      const plan = opened();
      const day = plan.days[1].key;
      const recipe = { kind: 'recipe', recipe: chicken } as const;

      const started = applyPlanDrop(plan, recipe, { kind: 'new-meal', dayKey: day }, 0);
      expect(mealNames(started, 1)).toEqual(['Breakfast', 'Lunch']);

      const ref = { dayKey: day, mealKey: plan.days[1].meals[0].key };
      const offered = applyPlanDrop(plan, recipe, { kind: 'options', ref }, 0);
      expect(offered.days[1].meals[0].choices).toHaveLength(2);

      expect(applyPlanDrop(plan, recipe, { kind: 'meals', dayKey: day }, 0)).toBe(plan);
    });
  });

  describe('before publishing', () => {
    it('finds nothing to fix in a whole plan', () => {
      expect(planProblem(opened(), book)).toBeNull();
    });

    it('names what stops Publish, first the name, then the targets, then each day and meal', () => {
      const plan = opened();
      plan.name = ' ';
      expect(planProblem(plan, book)).toEqual(expect.objectContaining({ focus: 'name' }));

      plan.name = 'Lean bulk';
      plan.targets.calories = 0;
      expect(planProblem(plan, book)?.focus).toBe('targets');
      plan.targets.calories = 2000;
      plan.targets.carbs = null;
      expect(planProblem(plan, book)?.message).toContain('protein, carbs and fat');
      plan.targets.carbs = 200;

      const emptyDay = addDay(clearDay(plan, plan.days[1].key));
      expect(planProblem(clearDay(plan, plan.days[1].key), book)).toEqual({
        message: 'Day 2 has no meals yet. Add one, or delete the day.',
        focus: 'day',
        dayKey: plan.days[1].key,
      });
      expect(emptyDay.days).toHaveLength(3);

      const meal = plan.days[0].meals[1];
      meal.name = '';
      expect(planProblem(plan, book)).toEqual({
        message: 'Day 1, meal 2 needs a name.',
        focus: 'meal',
        dayKey: plan.days[0].key,
        mealKey: meal.key,
      });
      meal.name = 'Lunch';
      meal.choices[0].servings = 0;
      expect(planProblem(plan, book)?.message).toBe(
        'Servings in Lunch on day 1 must be more than 0 and at most 1,000.',
      );
      meal.choices[0].servings = 1;
      meal.choices = [];
      expect(planProblem(plan, book)?.message).toBe('Day 1, Lunch has no recipe yet.');
    });

    it('refuses a recipe that is not published, or no longer in the library', () => {
      const plan = opened();
      const draftOnly = recipeBook([oats, chicken, { ...lentils, isPublished: false }]);

      expect(planProblem(plan, draftOnly)?.message).toBe(
        'Day 1, Lunch uses a recipe that is not published.',
      );
      expect(planProblem(plan, recipeBook([oats, chicken]))?.focus).toBe('meal');
    });
  });

  describe('the grid and the library', () => {
    it('groups the days in weeks of seven, the last one shorter', () => {
      const plan = addWeek(opened());
      const weeks = weeksOf(plan);

      expect(weeks.map((week) => week.days.map((day) => day.number))).toEqual([
        [1, 2, 3, 4, 5, 6, 7],
        [8, 9],
      ]);
      expect(weeks.map((week) => week.key)).toEqual(['week-1', 'week-2']);
    });

    it('finds recipes by every word typed, in any order, accents aside', () => {
      const recipes = [oats, chicken, { ...lentils, name: 'Soupe de lentilles épicée' }];

      expect(filterRecipes(recipes, 'rice chicken').map((recipe) => recipe.name)).toEqual([
        'Chicken & rice',
      ]);
      expect(filterRecipes(recipes, 'EPICEE').map((recipe) => recipe.versionId)).toEqual([
        'lentils-v1',
      ]);
      expect(filterRecipes(recipes, '  ')).toHaveLength(3);
    });
  });

  describe('words on the list', () => {
    it('says how long a plan runs, its meals a day, its target and its macro shares', () => {
      const card = planCard(planSummary(), 'en-US');

      expect(card).toEqual(
        expect.objectContaining({
          name: 'Lean bulk',
          link: ['/nutrition/plans', 'plan-1'],
          status: 'Ready to assign',
          tone: 'success',
          days: '7 days · 4 meals a day',
          target: '2,000 kcal',
          split: { protein: 30, carbs: 40, fat: 30, calories: 2003 },
          note: null,
          changed: 'Changed Mon 5 Oct',
        }),
      );
    });

    it('notes the coach’s unpublished changes, and lists a new plan as theirs alone', () => {
      const changed = planCard(planSummary({ draft: draftSummary({ dayCount: 14 }) }), 'en-US');
      expect(changed.note).toBe('Your changes are not published yet');
      expect(changed.days.startsWith('14 days')).toBe(true);

      const fresh = draftPlanCard(draftSummary({ mealPlanTemplateId: null, name: ' ' }), 'en-US');
      expect(fresh).toEqual(
        expect.objectContaining({
          name: 'Untitled meal plan',
          link: ['/nutrition/plans', 'new'],
          query: { draft: 'draft-1' },
          status: 'Draft',
          note: 'Only you can see it until you publish it',
        }),
      );
    });

    it('lists every version, newest first, and marks the one open', () => {
      const rows = planVersionRows(planDetail(), 'plan-v1', 'en-US');

      expect(rows.map((row) => [row.title, row.state, row.isOpen])).toEqual([
        ['Version 2', 'Published', false],
        ['Version 1', 'Published', true],
      ]);
      expect(rows[1].openLabel).toBe('Open version 1');
    });
  });
});

describe('a recipe published again since the plan took it (R4.4d)', () => {
  const oatsV1 = planRecipe({ ...OATS, publishedVersionId: 'oats-v2' });
  const oatsV2 = planRecipe(
    recipe({ versionId: 'oats-v2', revision: 2, calories: 420, publishedVersionId: 'oats-v2' }),
  );
  const current = recipeBook([oatsV1, oatsV2, chicken, lentils]);

  /** Day 1 offers the old oats beside the new ones; day 2 offers the old oats twice over. */
  function mixed(): MealPlanModel {
    const choice = (key: string, recipeVersionId: string, servings: number) => ({
      key,
      recipeVersionId,
      servings,
    });
    return {
      name: 'Lean bulk',
      targets: { calories: 2000, protein: 150, carbs: 200, fat: 67 },
      days: [
        {
          key: 'd1',
          meals: [
            {
              key: 'm1',
              name: 'Breakfast',
              choices: [choice('c1', 'oats-v1', 1.5), choice('c2', 'oats-v2', 1)],
            },
          ],
        },
        {
          key: 'd2',
          meals: [
            {
              key: 'm2',
              name: 'Breakfast',
              choices: [choice('c3', 'chicken-v1', 1), choice('c4', 'oats-v1', 2)],
            },
            { key: 'm3', name: 'Snack', choices: [choice('c5', 'oats-v1', 0.5)] },
          ],
        },
      ],
    };
  }

  it('is offered once per recipe, from the version the plan holds to the newest published one', () => {
    const updates = newerRecipes(mixed(), current);
    expect(
      updates.map((update) => [
        update.recipeId,
        update.current.map((item) => item.versionId),
        update.newest.versionId,
      ]),
    ).toEqual([['recipe-oats', ['oats-v1'], 'oats-v2']]);
    expect(newerRecipes(opened(), book)).toEqual([]);
  });

  it('moves each option to the newest version with its servings, and a meal offers it once', () => {
    const plan = mixed();
    const next = useNewestVersion(plan, newerRecipes(plan, current)[0]);
    const options = next.days.map((day) =>
      day.meals.map((meal) =>
        meal.choices.map((item) => `${item.recipeVersionId}×${item.servings}`),
      ),
    );
    expect(options).toEqual([[['oats-v2×1']], [['chicken-v1×1', 'oats-v2×2'], ['oats-v2×0.5']]]);
    expect(newerRecipes(next, current)).toEqual([]);
    expect(plan.days[1].meals[1].choices[0].recipeVersionId).toBe('oats-v1');
  });
});
