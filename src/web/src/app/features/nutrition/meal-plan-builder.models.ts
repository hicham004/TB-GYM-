import { formatDate, formatNumber } from '@angular/common';
import type {
  AllergenCode,
  MealPlanDraftContent,
  MealPlanDraftSummary,
  MealPlanDraftView,
  MealPlanTemplateDetail,
  MealPlanTemplateSummary,
  MealPlanVersionView,
  RecipeSummary,
} from '../../core/api/generated';
import { numeric } from '../training/training-builder.models';

/** Calories and the three macros, for one serving, one option, a meal or a day. */
export interface Macros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** A published recipe as the builder shows and counts it: its totals per one serving. */
export interface PlanRecipe {
  versionId: string;
  /** The library recipe it is a version of; null for one this workspace no longer lists. */
  recipeId: string | null;
  /** That recipe's newest published version, which the builder offers in its place (R4.4d). */
  newestVersionId: string | null;
  name: string;
  isPublished: boolean;
  perServing: Macros;
  allergens: readonly AllergenCode[];
  initials: string;
}

/** One recipe a meal offers, and how many of its servings. */
export interface PlanChoice {
  key: string;
  recipeVersionId: string;
  /** Null while the coach is typing it. */
  servings: number | null;
}

export interface PlanMeal {
  key: string;
  name: string;
  /** Equal options the client chooses between (NUT-005); never one "main" and its swaps. */
  choices: PlanChoice[];
}

export interface PlanDay {
  key: string;
  meals: PlanMeal[];
}

/** The daily targets; null while not set. */
export interface PlanTargets {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

/** The meal plan as the builder holds it: what its draft (NUT-013) and Publish are made from. */
export interface MealPlanModel {
  name: string;
  targets: PlanTargets;
  days: PlanDay[];
}

export interface MealRef {
  dayKey: string;
  mealKey: string;
}

/** A version holds up to 365 days, as the server allows (NUT-013). */
export const MAX_DAYS = 365;
export const MAX_MEALS_PER_DAY = 30;
export const MAX_CHOICES_PER_MEAL = 100;
export const DAYS_PER_WEEK = 7;

const ZERO: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };

let fallbackKey = 0;

function key(): string {
  fallbackKey += 1;
  return globalThis.crypto?.randomUUID?.() ?? `plan-${fallbackKey}`;
}

// ---------- reading what the server sends ----------

/** A recipe summary as the builder counts it: the whole recipe's totals divided by its yield. */
export function planRecipe(summary: RecipeSummary): PlanRecipe {
  const servings = numeric(summary.servings) || 1;
  return {
    versionId: summary.versionId,
    recipeId: summary.id,
    newestVersionId: summary.publishedVersionId ?? null,
    name: summary.name,
    isPublished: summary.status === 'Published',
    perServing: {
      calories: numeric(summary.calories) / servings,
      protein: numeric(summary.proteinGrams) / servings,
      carbs: numeric(summary.carbohydrateGrams) / servings,
      fat: numeric(summary.fatGrams) / servings,
    },
    allergens: summary.declaredAllergens,
    initials: initialsOf(summary.name),
  };
}

export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/[\s&,]+/)
    .filter((word) => word.length > 0);
  return (
    words
      .slice(0, 2)
      .map((word) => [...word][0]?.toLocaleUpperCase() ?? '')
      .join('') || '?'
  );
}

/** A new plan: one empty week to fill, no targets yet. */
export function emptyPlan(): MealPlanModel {
  return {
    name: '',
    targets: { calories: null, protein: null, carbs: null, fat: null },
    days: Array.from({ length: DAYS_PER_WEEK }, () => ({ key: key(), meals: [] })),
  };
}

export function planFromDraft(view: MealPlanDraftView): MealPlanModel {
  const content = view.content;
  return {
    name: content.name ?? '',
    targets: {
      calories: nullableNumber(content.targetCalories),
      protein: nullableNumber(content.targetProteinGrams),
      carbs: nullableNumber(content.targetCarbohydrateGrams),
      fat: nullableNumber(content.targetFatGrams),
    },
    days: (content.days ?? []).map((day) => ({
      key: key(),
      meals: (day.meals ?? []).map((meal) => ({
        key: key(),
        name: meal.name ?? '',
        choices: (meal.choices ?? []).map((choice) => ({
          key: key(),
          recipeVersionId: choice.recipeVersionId,
          servings: nullableNumber(choice.servings),
        })),
      })),
    })),
  };
}

export function planFromVersion(view: MealPlanVersionView, name: string): MealPlanModel {
  const days: PlanDay[] = Array.from({ length: numeric(view.dayCount) }, () => ({
    key: key(),
    meals: [],
  }));
  const slots = [...view.slots].sort(
    (a, b) => numeric(a.dayOffset) - numeric(b.dayOffset) || numeric(a.order) - numeric(b.order),
  );
  for (const slot of slots) {
    days[numeric(slot.dayOffset)]?.meals.push({
      key: key(),
      name: slot.name,
      choices: slot.choices.map((choice) => ({
        key: key(),
        recipeVersionId: choice.recipeVersionId,
        servings: numeric(choice.servings),
      })),
    });
  }
  return {
    name,
    targets: {
      calories: numeric(view.targetCalories),
      protein: numeric(view.targetProteinGrams),
      carbs: numeric(view.targetCarbohydrateGrams),
      fat: numeric(view.targetFatGrams),
    },
    days,
  };
}

/**
 * The recipes a version names. A choice keeps the macros it was saved with, so a recipe this
 * workspace no longer lists is still counted, per serving, from the choice itself.
 */
export function versionRecipes(view: MealPlanVersionView): PlanRecipe[] {
  const recipes = new Map(view.recipes.map((summary) => [summary.versionId, planRecipe(summary)]));
  for (const choice of view.slots.flatMap((slot) => slot.choices)) {
    if (recipes.has(choice.recipeVersionId)) continue;
    const servings = numeric(choice.servings) || 1;
    recipes.set(choice.recipeVersionId, {
      versionId: choice.recipeVersionId,
      recipeId: null,
      newestVersionId: null,
      name: choice.recipeName,
      isPublished: true,
      perServing: {
        calories: numeric(choice.calories) / servings,
        protein: numeric(choice.proteinGrams) / servings,
        carbs: numeric(choice.carbohydrateGrams) / servings,
        fat: numeric(choice.fatGrams) / servings,
      },
      allergens: [],
      initials: initialsOf(choice.recipeName),
    });
  }
  return [...recipes.values()];
}

/** What a save sends: the plan as it stands, values unchecked (NUT-013). */
export function toDraftContent(plan: MealPlanModel): MealPlanDraftContent {
  return {
    name: plan.name,
    targetCalories: plan.targets.calories,
    targetProteinGrams: plan.targets.protein,
    targetCarbohydrateGrams: plan.targets.carbs,
    targetFatGrams: plan.targets.fat,
    days: plan.days.map((day) => ({
      meals: day.meals.map((meal) => ({
        name: meal.name,
        choices: meal.choices.map((choice) => ({
          recipeVersionId: choice.recipeVersionId,
          servings: choice.servings ?? 0,
        })),
      })),
    })),
  };
}

function nullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = numeric(value);
  return Number.isFinite(number) ? number : null;
}

// ---------- counting ----------

export type RecipeBook = ReadonlyMap<string, PlanRecipe>;

export function recipeBook(...lists: readonly (readonly PlanRecipe[])[]): RecipeBook {
  const book = new Map<string, PlanRecipe>();
  for (const recipe of lists.flat()) book.set(recipe.versionId, recipe);
  return book;
}

/** One option's macros: the recipe's per-serving values times its servings. */
export function choiceMacros(choice: PlanChoice, book: RecipeBook): Macros | null {
  const recipe = book.get(choice.recipeVersionId);
  if (!recipe || choice.servings === null || !(choice.servings > 0)) return null;
  return scale(recipe.perServing, choice.servings);
}

export interface MealTotal {
  macros: Macros;
  /** True when the meal offers options: its total is their average, for planning only (NUT-005). */
  isAverage: boolean;
}

/** A meal's macros: its one option's, or the average of its options. */
export function mealTotal(meal: PlanMeal, book: RecipeBook): MealTotal {
  const counted = meal.choices
    .map((choice) => choiceMacros(choice, book))
    .filter((macros): macros is Macros => macros !== null);
  if (counted.length === 0) return { macros: ZERO, isAverage: false };
  const sum = counted.reduce(add, ZERO);
  return { macros: scale(sum, 1 / counted.length), isAverage: counted.length > 1 };
}

export interface DayTotal {
  macros: Macros;
  isAverage: boolean;
  mealCount: number;
}

export function dayTotal(day: PlanDay, book: RecipeBook): DayTotal {
  const meals = day.meals.map((meal) => mealTotal(meal, book));
  return {
    macros: meals.reduce((sum, meal) => add(sum, meal.macros), ZERO),
    isAverage: meals.some((meal) => meal.isAverage),
    mealCount: day.meals.length,
  };
}

function add(a: Macros, b: Macros): Macros {
  return {
    calories: a.calories + b.calories,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
  };
}

function scale(macros: Macros, factor: number): Macros {
  return {
    calories: macros.calories * factor,
    protein: macros.protein * factor,
    carbs: macros.carbs * factor,
    fat: macros.fat * factor,
  };
}

/** How the day compares with the target: "On target", "120 kcal under", "250 kcal over". */
export type TargetStanding = 'unset' | 'empty' | 'under' | 'on' | 'over';

/** Within 5% of the target counts as on target; a coach plans in round portions. */
export function standing(total: DayTotal, target: number | null): TargetStanding {
  if (target === null || !(target > 0)) return 'unset';
  if (total.mealCount === 0) return 'empty';
  const ratio = total.macros.calories / target;
  return ratio < 0.95 ? 'under' : ratio > 1.05 ? 'over' : 'on';
}

export interface MacroSplit {
  /** Each macro's share of the calories it brings, in percent, rounded. */
  protein: number;
  carbs: number;
  fat: number;
  /** The calories protein, carbs and fat add up to (4/4/9). */
  calories: number;
}

/** The targets' macros as shares of their own calories (4/4/9); null until all three are set. */
export function macroSplit(targets: PlanTargets): MacroSplit | null {
  const { protein, carbs, fat } = targets;
  if (protein === null || carbs === null || fat === null) return null;
  const calories = protein * 4 + carbs * 4 + fat * 9;
  if (!(calories > 0)) return null;
  return {
    protein: Math.round((protein * 400) / calories),
    carbs: Math.round((carbs * 400) / calories),
    fat: Math.round((fat * 900) / calories),
    calories,
  };
}

// ---------- changing the plan ----------

function mapDay(
  plan: MealPlanModel,
  dayKey: string,
  change: (day: PlanDay) => PlanDay,
): MealPlanModel {
  return { ...plan, days: plan.days.map((day) => (day.key === dayKey ? change(day) : day)) };
}

function mapMeal(
  plan: MealPlanModel,
  ref: MealRef,
  change: (meal: PlanMeal) => PlanMeal,
): MealPlanModel {
  return mapDay(plan, ref.dayKey, (day) => ({
    ...day,
    meals: day.meals.map((meal) => (meal.key === ref.mealKey ? change(meal) : meal)),
  }));
}

export function findMeal(plan: MealPlanModel, ref: MealRef): PlanMeal | undefined {
  return plan.days
    .find((day) => day.key === ref.dayKey)
    ?.meals.find((meal) => meal.key === ref.mealKey);
}

function copyDay(day: PlanDay): PlanDay {
  return {
    key: key(),
    meals: day.meals.map((meal) => ({
      key: key(),
      name: meal.name,
      choices: meal.choices.map((choice) => ({ ...choice, key: key() })),
    })),
  };
}

/** One more day at the end: a copy of the last, so a plan grows from what is already planned. */
export function addDay(plan: MealPlanModel): MealPlanModel {
  if (plan.days.length >= MAX_DAYS) return plan;
  const last = plan.days.at(-1);
  return { ...plan, days: [...plan.days, last ? copyDay(last) : { key: key(), meals: [] }] };
}

/**
 * Another week at the end: a copy of the last seven days, as long as the plan has room. A plan
 * runs as many days as it holds once assigned, so a month is four weeks of days.
 */
export function addWeek(plan: MealPlanModel): MealPlanModel {
  const room = MAX_DAYS - plan.days.length;
  if (room <= 0) return plan;
  const source = plan.days.slice(-DAYS_PER_WEEK);
  const copies =
    source.length === 0
      ? Array.from({ length: DAYS_PER_WEEK }, () => ({ key: key(), meals: [] as PlanMeal[] }))
      : Array.from({ length: DAYS_PER_WEEK }, (_, index) =>
          copyDay(source[index % source.length]!),
        );
  return { ...plan, days: [...plan.days, ...copies.slice(0, room)] };
}

/** A copy of the day straight after it; the days after move one along. */
export function duplicateDay(plan: MealPlanModel, dayKey: string): MealPlanModel {
  const index = plan.days.findIndex((day) => day.key === dayKey);
  if (index < 0 || plan.days.length >= MAX_DAYS) return plan;
  const days = [...plan.days];
  days.splice(index + 1, 0, copyDay(plan.days[index]!));
  return { ...plan, days };
}

/** The day's meals replace every other day's: "Use this day for every day". */
export function copyDayToAll(plan: MealPlanModel, dayKey: string): MealPlanModel {
  const source = plan.days.find((day) => day.key === dayKey);
  if (!source) return plan;
  return {
    ...plan,
    days: plan.days.map((day) => (day.key === dayKey ? day : { ...copyDay(source), key: day.key })),
  };
}

export function clearDay(plan: MealPlanModel, dayKey: string): MealPlanModel {
  return mapDay(plan, dayKey, (day) => ({ ...day, meals: [] }));
}

/** A plan keeps at least one day. */
export function removeDay(plan: MealPlanModel, dayKey: string): MealPlanModel {
  if (plan.days.length <= 1) return plan;
  return { ...plan, days: plan.days.filter((day) => day.key !== dayKey) };
}

/** The usual name for a new meal: the first of breakfast, lunch and dinner the day lacks, then snack. */
export function defaultMealName(day: PlanDay): string {
  const taken = new Set(day.meals.map((meal) => meal.name.trim().toLocaleLowerCase()));
  const usual = [$localize`Breakfast`, $localize`Lunch`, $localize`Dinner`];
  return usual.find((name) => !taken.has(name.toLocaleLowerCase())) ?? $localize`Snack`;
}

/** A new meal with one recipe, one serving, at a position of the day (the end by default). */
export function addMeal(
  plan: MealPlanModel,
  dayKey: string,
  recipe: PlanRecipe,
  index = Number.MAX_SAFE_INTEGER,
): { plan: MealPlanModel; mealKey: string | null } {
  const day = plan.days.find((item) => item.key === dayKey);
  if (!day || day.meals.length >= MAX_MEALS_PER_DAY) return { plan, mealKey: null };
  const meal: PlanMeal = {
    key: key(),
    name: defaultMealName(day),
    choices: [{ key: key(), recipeVersionId: recipe.versionId, servings: 1 }],
  };
  const meals = [...day.meals];
  meals.splice(Math.min(Math.max(index, 0), meals.length), 0, meal);
  return { plan: mapDay(plan, dayKey, (item) => ({ ...item, meals })), mealKey: meal.key };
}

/** Another option for a meal, one serving; a recipe the meal already offers is not added twice. */
export function addChoice(plan: MealPlanModel, ref: MealRef, recipe: PlanRecipe): MealPlanModel {
  const meal = findMeal(plan, ref);
  if (
    !meal ||
    meal.choices.length >= MAX_CHOICES_PER_MEAL ||
    meal.choices.some((choice) => choice.recipeVersionId === recipe.versionId)
  ) {
    return plan;
  }
  return mapMeal(plan, ref, (item) => ({
    ...item,
    choices: [...item.choices, { key: key(), recipeVersionId: recipe.versionId, servings: 1 }],
  }));
}

/** A recipe the plan holds at an older version than the one published since (R4.4d). */
export interface NewerRecipe {
  recipeId: string;
  /** The versions the plan holds, as they read now. */
  current: PlanRecipe[];
  newest: PlanRecipe;
}

/** Each recipe the plan holds that was published again since, once, in the plan's order. */
export function newerRecipes(plan: MealPlanModel, book: RecipeBook): NewerRecipe[] {
  const found = new Map<string, NewerRecipe>();
  for (const choice of plan.days.flatMap((day) => day.meals).flatMap((meal) => meal.choices)) {
    const current = book.get(choice.recipeVersionId);
    const newest = current?.newestVersionId ? book.get(current.newestVersionId) : undefined;
    if (!current?.recipeId || !newest || newest.versionId === current.versionId) continue;
    const entry = found.get(current.recipeId) ?? {
      recipeId: current.recipeId,
      current: [],
      newest,
    };
    if (!entry.current.includes(current)) entry.current.push(current);
    found.set(current.recipeId, entry);
  }
  return [...found.values()];
}

/**
 * Every option of the recipe at an older version moves to its newest, with the same servings. A meal
 * that already offers the newest keeps that one option, since a meal offers a recipe once.
 */
export function useNewestVersion(plan: MealPlanModel, update: NewerRecipe): MealPlanModel {
  const older = new Set(update.current.map((recipe) => recipe.versionId));
  const newest = update.newest.versionId;
  return {
    ...plan,
    days: plan.days.map((day) => ({
      ...day,
      meals: day.meals.map((meal) => {
        if (!meal.choices.some((choice) => older.has(choice.recipeVersionId))) return meal;
        let offered = meal.choices.some((choice) => choice.recipeVersionId === newest);
        const choices: PlanChoice[] = [];
        for (const choice of meal.choices) {
          if (!older.has(choice.recipeVersionId)) choices.push(choice);
          else if (!offered) {
            choices.push({ ...choice, recipeVersionId: newest });
            offered = true;
          }
        }
        return { ...meal, choices };
      }),
    })),
  };
}

export function removeChoice(plan: MealPlanModel, ref: MealRef, choiceKey: string): MealPlanModel {
  return mapMeal(plan, ref, (meal) => ({
    ...meal,
    choices: meal.choices.filter((choice) => choice.key !== choiceKey),
  }));
}

export function removeMeal(plan: MealPlanModel, ref: MealRef): MealPlanModel {
  return mapDay(plan, ref.dayKey, (day) => ({
    ...day,
    meals: day.meals.filter((meal) => meal.key !== ref.mealKey),
  }));
}

/** A meal moved to a position of a day, the same day or another. */
export function moveMeal(
  plan: MealPlanModel,
  ref: MealRef,
  toDayKey: string,
  index: number,
): MealPlanModel {
  const meal = findMeal(plan, ref);
  const target = plan.days.find((day) => day.key === toDayKey);
  if (!meal || !target) return plan;
  if (ref.dayKey !== toDayKey && target.meals.length >= MAX_MEALS_PER_DAY) return plan;
  const without = removeMeal(plan, ref);
  return mapDay(without, toDayKey, (day) => {
    const meals = [...day.meals];
    meals.splice(Math.min(Math.max(index, 0), meals.length), 0, meal);
    return { ...day, meals };
  });
}

/** A meal one place earlier or later within its day. */
export function shiftMeal(plan: MealPlanModel, ref: MealRef, step: -1 | 1): MealPlanModel {
  const day = plan.days.find((item) => item.key === ref.dayKey);
  const index = day?.meals.findIndex((meal) => meal.key === ref.mealKey) ?? -1;
  if (!day || index < 0) return plan;
  const to = index + step;
  if (to < 0 || to >= day.meals.length) return plan;
  return moveMeal(plan, ref, ref.dayKey, to);
}

// ---------- drag and drop ----------

/** What is dragged: a recipe from the panel, or a meal on the grid. */
export type PlanDragItem = { kind: 'recipe'; recipe: PlanRecipe } | { kind: 'meal'; ref: MealRef };

/**
 * Where it can land: a day's list of meals (meals only), the strip under a day that starts a new
 * meal (recipes only), or a meal's options (recipes only). Each takes one kind of thing, so a drop
 * over a meal inside a day is never read as a drop on the day.
 */
export type PlanDropTarget =
  | { kind: 'meals'; dayKey: string }
  | { kind: 'new-meal'; dayKey: string }
  | { kind: 'options'; ref: MealRef };

export function acceptsDrop(item: PlanDragItem, target: PlanDropTarget): boolean {
  return target.kind === 'meals' ? item.kind === 'meal' : item.kind === 'recipe';
}

export function applyPlanDrop(
  plan: MealPlanModel,
  item: PlanDragItem,
  target: PlanDropTarget,
  index: number,
): MealPlanModel {
  if (!acceptsDrop(item, target)) return plan;
  if (target.kind === 'meals' && item.kind === 'meal') {
    return moveMeal(plan, item.ref, target.dayKey, index);
  }
  if (item.kind !== 'recipe') return plan;
  return target.kind === 'options'
    ? addChoice(plan, target.ref, item.recipe)
    : addMeal(plan, target.dayKey, item.recipe).plan;
}

// ---------- before publishing ----------

export interface PlanProblem {
  message: string;
  /** Where to send the coach: the name, the targets, a day, or a meal. */
  focus: 'name' | 'targets' | 'day' | 'meal';
  dayKey?: string;
  mealKey?: string;
}

/**
 * What would stop Publish, said as the server says it (NUT-013) and checked first so the coach is
 * taken straight to it. The server still checks everything.
 */
export function planProblem(plan: MealPlanModel, book: RecipeBook): PlanProblem | null {
  if (!plan.name.trim()) {
    return { message: $localize`Give the meal plan a name before publishing it.`, focus: 'name' };
  }
  const { calories, protein, carbs, fat } = plan.targets;
  if (calories === null || !(calories > 0) || calories > 100_000) {
    return {
      message: $localize`Set the daily calories before publishing: more than 0 and at most 100,000.`,
      focus: 'targets',
    };
  }
  if ([protein, carbs, fat].some((value) => value === null || !(value >= 0))) {
    return {
      message: $localize`Set the daily protein, carbs and fat before publishing: 0 or more grams each.`,
      focus: 'targets',
    };
  }
  for (const [index, day] of plan.days.entries()) {
    const number = index + 1;
    if (day.meals.length === 0) {
      return {
        message: $localize`Day ${number}:day: has no meals yet. Add one, or delete the day.`,
        focus: 'day',
        dayKey: day.key,
      };
    }
    for (const [position, meal] of day.meals.entries()) {
      const at = { focus: 'meal' as const, dayKey: day.key, mealKey: meal.key };
      const name = meal.name.trim();
      if (!name) {
        return {
          message: $localize`Day ${number}:day:, meal ${position + 1}:meal: needs a name.`,
          ...at,
        };
      }
      if (meal.choices.length === 0) {
        return { message: $localize`Day ${number}:day:, ${name}:meal: has no recipe yet.`, ...at };
      }
      if (
        meal.choices.some(
          (choice) => choice.servings === null || !(choice.servings > 0) || choice.servings > 1000,
        )
      ) {
        return {
          message: $localize`Servings in ${name}:meal: on day ${number}:day: must be more than 0 and at most 1,000.`,
          ...at,
        };
      }
      if (meal.choices.some((choice) => !book.get(choice.recipeVersionId)?.isPublished)) {
        return {
          message: $localize`Day ${number}:day:, ${name}:meal: uses a recipe that is not published.`,
          ...at,
        };
      }
    }
  }
  return null;
}

// ---------- the grid ----------

export interface WeekOfDays {
  key: string;
  number: number;
  /** The plan's day numbers in this week, counted from 1. */
  days: { day: PlanDay; number: number }[];
}

/** The plan's days in weeks of seven; the last week may be shorter. */
export function weeksOf(plan: MealPlanModel): WeekOfDays[] {
  const weeks: WeekOfDays[] = [];
  plan.days.forEach((day, index) => {
    const week = Math.floor(index / DAYS_PER_WEEK);
    weeks[week] ??= { key: `week-${week + 1}`, number: week + 1, days: [] };
    weeks[week].days.push({ day, number: index + 1 });
  });
  return weeks;
}

export function filterRecipes(recipes: readonly PlanRecipe[], search: string): PlanRecipe[] {
  const words = fold(search)
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return [...recipes];
  return recipes.filter((recipe) => {
    const name = fold(recipe.name);
    return words.every((word) => name.includes(word));
  });
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

// ---------- words and numbers ----------

export function kcalText(calories: number, locale: string): string {
  return $localize`${formatNumber(Math.round(calories), locale, '1.0-0')}:calories: kcal`;
}

/** "P 140 · C 210 · F 60", grams, for the small lines under a day or an option. */
export function macroLine(macros: Macros, locale: string): string {
  const grams = (value: number) => formatNumber(Math.round(value), locale, '1.0-0');
  return $localize`P ${grams(macros.protein)}:protein: · C ${grams(macros.carbs)}:carbs: · F ${grams(macros.fat)}:fat:`;
}

/** "1 serving", "1.5 servings". */
export function servingsText(servings: number, locale: string): string {
  return servings === 1
    ? $localize`1 serving`
    : $localize`${formatNumber(servings, locale, '1.0-2')}:servings: servings`;
}

export function daysText(count: number): string {
  return count === 1 ? $localize`1 day` : $localize`${count}:count: days`;
}

/** A plan on the meal-plans list. */
export interface PlanCard {
  id: string;
  name: string;
  link: string[];
  query: Record<string, string> | null;
  status: string;
  tone: 'success' | 'neutral';
  days: string;
  target: string | null;
  /** The target's macro shares, for the card's bar; null when not known. */
  split: MacroSplit | null;
  note: string | null;
  changed: string;
}

export function planCard(plan: MealPlanTemplateSummary, locale: string): PlanCard {
  const draft = plan.draft ?? null;
  const published = plan.status === 'Published';
  const meals = numeric(plan.slotCount);
  const days = numeric(plan.dayCount);
  const perDay = days > 0 ? Math.round((meals / days) * 10) / 10 : 0;
  const changedAt = draft?.updatedAtUtc ?? plan.changedAtUtc ?? null;
  return {
    id: plan.id,
    name: plan.name,
    link: ['/nutrition/plans', plan.id],
    query: null,
    status: published ? $localize`Ready to assign` : $localize`Not published`,
    tone: published ? 'success' : 'neutral',
    days: `${daysText(draft ? numeric(draft.dayCount) : days)} · ${
      perDay === 1
        ? $localize`1 meal a day`
        : $localize`${formatNumber(perDay, locale, '1.0-1')}:count: meals a day`
    }`,
    target: kcalText(numeric(plan.targetCalories), locale),
    split: macroSplit({
      calories: numeric(plan.targetCalories),
      protein: numeric(plan.targetProteinGrams ?? 0),
      carbs: numeric(plan.targetCarbohydrateGrams ?? 0),
      fat: numeric(plan.targetFatGrams ?? 0),
    }),
    note: draft ? $localize`Your changes are not published yet` : null,
    changed: changedAt
      ? $localize`Changed ${formatDate(changedAt, 'EEE d MMM', locale)}:date:`
      : '',
  };
}

/** A new plan kept as its coach's draft (NUT-013): theirs alone until it is published. */
export function draftPlanCard(draft: MealPlanDraftSummary, locale: string): PlanCard {
  return {
    id: draft.id,
    name: draft.name.trim() || $localize`Untitled meal plan`,
    link: ['/nutrition/plans', 'new'],
    query: { draft: draft.id },
    status: $localize`Draft`,
    tone: 'neutral',
    days: daysText(numeric(draft.dayCount)),
    target: null,
    split: null,
    note: $localize`Only you can see it until you publish it`,
    changed: $localize`Changed ${formatDate(draft.updatedAtUtc, 'EEE d MMM', locale)}:date:`,
  };
}

export interface PlanVersionRow {
  id: string;
  title: string;
  openLabel: string;
  state: string;
  isPublished: boolean;
  date: string;
  isOpen: boolean;
}

/** The Versions sheet: every saved version, newest first. */
export function planVersionRows(
  plan: MealPlanTemplateDetail,
  openVersionId: string | null,
  locale: string,
): PlanVersionRow[] {
  return plan.versions.map((version) => ({
    id: version.id,
    title: $localize`Version ${numeric(version.revision)}:number:`,
    openLabel: $localize`Open version ${numeric(version.revision)}:number:`,
    state: version.status === 'Published' ? $localize`Published` : $localize`Not published`,
    isPublished: version.status === 'Published',
    date: formatDate(version.publishedAtUtc ?? version.createdAtUtc, 'EEE d MMM, HH:mm', locale),
    isOpen: version.id === openVersionId,
  }));
}

/** The version a plan opens on: the newest, unless the address names an older one. */
export function planVersionToOpen(
  plan: MealPlanTemplateDetail,
  requested: string | null,
): string | null {
  const named = requested && plan.versions.find((version) => version.id === requested);
  return named ? named.id : (plan.versions[0]?.id ?? null);
}
