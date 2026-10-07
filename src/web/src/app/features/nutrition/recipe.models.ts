import { formatNumber } from '@angular/common';
import type {
  AllergenCode,
  FoodItemView,
  FoodQuantityUnit,
  PreparationBasis,
  RecipeDetail,
  RecipeIngredientRequest,
  RecipeSummary,
} from '../../core/api/generated';
import { numeric } from '../training/training-builder.models';
import { initialsOf, type Macros } from './meal-plan-builder.models';
import { ALLERGEN_LABELS } from './nutrition.models';

/**
 * The recipe pages' own logic (C7, R4.4b), kept out of the components so it is tested on its own:
 * recipe cards, the editor's lines and live totals, its checks and the requests it sends.
 *
 * Totals as typed scale each line's food in proportion to its amount, the same arithmetic the meal
 * plans use for servings. The server works every saved line out again under the workspace's energy
 * policy, and what it saves is what the card shows (NUT-002).
 */

export const MAX_RECIPE_NAME = 300;
export const MAX_INSTRUCTIONS = 20_000;
export const MAX_SERVINGS = 10_000;
export const MAX_LINES = 500;
export const MAX_QUANTITY = 1_000_000;

export type FoodSource = 'UsdaFdc' | 'CoachAuthored' | 'LabelTranscribed';

/** A food version as an ingredient line knows it: what `basisQuantity` of it holds. */
export interface RecipeFood {
  foodId: string;
  versionId: string;
  name: string;
  source: FoodSource;
  basisQuantity: number;
  unit: FoodQuantityUnit;
  basis: PreparationBasis;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  allergens: readonly AllergenCode[];
}

/** What an AI suggestion said of an ingredient, kept beside the line until the coach matches it. */
export interface SuggestedIngredient {
  name: string;
  quantity: number;
  unit: string;
  uncertain: boolean;
}

export interface EditorLine {
  key: string;
  /** Null while an AI-suggested ingredient waits for the coach to choose a food. */
  food: RecipeFood | null;
  /** In the food's own unit; null while the box is empty. */
  quantity: number | null;
  suggestion: SuggestedIngredient | null;
  /** A saved line's cooking factors, sent back unchanged. */
  yieldFactorId: string | null;
  retentionFactorId: string | null;
}

export interface RecipeDraft {
  name: string;
  servings: number | null;
  instructions: string;
  lines: EditorLine[];
  photoId: string | null;
}

let nextLineKey = 0;

export function lineKey(): string {
  return `line-${++nextLineKey}`;
}

/** A food from the library, as the search lists it. */
export function foodFromView(view: FoodItemView): RecipeFood {
  const version = view.currentVersion;
  return {
    foodId: view.id,
    versionId: version.id,
    name: view.name,
    source: view.provenance,
    basisQuantity: numeric(version.basisQuantity),
    unit: version.basisUnit,
    basis: version.preparationBasis,
    calories: numeric(version.computedCalories),
    protein: numeric(version.proteinGrams),
    carbs: numeric(version.carbohydrateGrams),
    fat: numeric(version.fatGrams),
    allergens: version.declaredAllergens,
  };
}

/** The editor's starting point for a saved recipe: its newest version, line by line. */
export function draftFromDetail(detail: RecipeDetail): RecipeDraft {
  const latest = detail.latest;
  return {
    name: detail.name,
    servings: numeric(latest.servings),
    instructions: latest.instructions,
    photoId: latest.photoMediaAssetId,
    lines: latest.ingredients.map((line) => ({
      key: lineKey(),
      // A saved line is its own measure: what its amount held, scaled from there as it changes.
      food: {
        foodId: line.foodItemId,
        versionId: line.foodItemVersionId,
        name: line.foodName,
        source: line.foodProvenance,
        basisQuantity: numeric(line.quantity),
        unit: line.unit,
        basis: line.basis,
        calories: numeric(line.calories),
        protein: numeric(line.proteinGrams),
        carbs: numeric(line.carbohydrateGrams),
        fat: numeric(line.fatGrams),
        allergens: line.declaredAllergens,
      },
      quantity: numeric(line.quantity),
      suggestion: null,
      yieldFactorId: line.yieldFactorId,
      retentionFactorId: line.retentionFactorId,
    })),
  };
}

export function emptyDraft(): RecipeDraft {
  return { name: '', servings: 1, instructions: '', lines: [], photoId: null };
}

/** A new line for a chosen food, at the food's own measure (100 g, say) until the coach types. */
export function lineForFood(food: RecipeFood): EditorLine {
  return {
    key: lineKey(),
    food,
    quantity: food.basisQuantity,
    suggestion: null,
    yieldFactorId: null,
    retentionFactorId: null,
  };
}

const AI_UNITS: Record<string, FoodQuantityUnit> = {
  g: 'Gram',
  ml: 'Millilitre',
  serving: 'Serving',
};

/**
 * Matches a suggested ingredient to the food the coach chose. The suggested amount carries over
 * when it is in the food's own unit; otherwise the coach types it, since no unit is converted.
 */
export function matchLine(line: EditorLine, food: RecipeFood): EditorLine {
  const suggested = line.suggestion;
  const carried = suggested && AI_UNITS[suggested.unit] === food.unit ? suggested.quantity : null;
  return {
    ...line,
    food,
    quantity: carried ?? line.quantity ?? food.basisQuantity,
    yieldFactorId: null,
    retentionFactorId: null,
  };
}

/** The lines an AI suggestion starts the editor with, each waiting for a food. */
export function linesFromSuggestion(ingredients: readonly SuggestedIngredient[]): EditorLine[] {
  return ingredients.map((suggestion) => ({
    key: lineKey(),
    food: null,
    quantity: null,
    suggestion,
    yieldFactorId: null,
    retentionFactorId: null,
  }));
}

/** Reads the checked suggestion the server stored; null when it is not one. */
export function readSuggestion(
  json: string | null | undefined,
): { name: string; ingredients: SuggestedIngredient[] } | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { name?: unknown; ingredients?: unknown };
    if (typeof parsed.name !== 'string' || !Array.isArray(parsed.ingredients)) return null;
    const ingredients = parsed.ingredients.flatMap((item: unknown) => {
      const value = item as Partial<SuggestedIngredient> | null;
      return value && typeof value.name === 'string' && typeof value.quantity === 'number'
        ? [
            {
              name: value.name,
              quantity: value.quantity,
              unit: typeof value.unit === 'string' ? value.unit : '',
              uncertain: value.uncertain === true,
            },
          ]
        : [];
    });
    return { name: parsed.name, ingredients };
  } catch {
    return null;
  }
}

// ---------- totals ----------

const ZERO: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };

/** What a line's amount holds, or null while it has no food or no usable amount. */
export function lineMacros(line: EditorLine): Macros | null {
  const food = line.food;
  const quantity = line.quantity;
  if (!food || quantity === null || !(quantity > 0) || !(food.basisQuantity > 0)) return null;
  const share = quantity / food.basisQuantity;
  return {
    calories: food.calories * share,
    protein: food.protein * share,
    carbs: food.carbs * share,
    fat: food.fat * share,
  };
}

export function recipeTotal(lines: readonly EditorLine[]): Macros {
  return lines.reduce((total, line) => {
    const macros = lineMacros(line);
    return macros
      ? {
          calories: total.calories + macros.calories,
          protein: total.protein + macros.protein,
          carbs: total.carbs + macros.carbs,
          fat: total.fat + macros.fat,
        }
      : total;
  }, ZERO);
}

/** One serving of the whole recipe; null until the servings are a usable number. */
export function perServing(total: Macros, servings: number | null): Macros | null {
  if (servings === null || !(servings > 0)) return null;
  return {
    calories: total.calories / servings,
    protein: total.protein / servings,
    carbs: total.carbs / servings,
    fat: total.fat / servings,
  };
}

/** Each macro's share of the calories it brings, in whole percent; null when there are none. */
export function energySplit(
  macros: Macros,
): { protein: number; carbs: number; fat: number } | null {
  const calories = macros.protein * 4 + macros.carbs * 4 + macros.fat * 9;
  if (!(calories > 0)) return null;
  return {
    protein: Math.round((macros.protein * 400) / calories),
    carbs: Math.round((macros.carbs * 400) / calories),
    fat: Math.round((macros.fat * 900) / calories),
  };
}

/** Every allergen the chosen foods declare, in the order the coach is used to reading them. */
export function recipeAllergens(lines: readonly EditorLine[]): AllergenCode[] {
  const codes = new Set(lines.flatMap((line) => line.food?.allergens ?? []));
  return ALLERGEN_LABELS.map((item) => item.code).filter((code) => codes.has(code));
}

export function allergenText(codes: readonly string[]): string {
  const names = ALLERGEN_LABELS.filter((item) => codes.includes(item.code)).map((item) =>
    item.label.replace(/ \(.*\)$/, '').toLowerCase(),
  );
  return names.length ? $localize`Contains ${names.join(', ')}:allergens:` : '';
}

// ---------- checks ----------

export type RecipeField = 'name' | 'servings' | 'lines' | 'instructions';

export interface RecipeProblem {
  field: RecipeField;
  /** The line at fault, for a problem with one ingredient. */
  lineKey?: string;
  message: string;
}

/** The first thing that stops a save, in the order the editor reads top to bottom. */
export function recipeProblem(draft: RecipeDraft): RecipeProblem | null {
  if (!draft.name.trim()) {
    return { field: 'name', message: $localize`Give the recipe a name.` };
  }
  if (draft.name.trim().length > MAX_RECIPE_NAME) {
    return {
      field: 'name',
      message: $localize`Keep the name under ${MAX_RECIPE_NAME}:max: characters.`,
    };
  }
  const servings = draft.servings;
  if (servings === null || !(servings > 0) || servings > MAX_SERVINGS) {
    return {
      field: 'servings',
      message: $localize`Say how many servings the recipe makes, from 1 up.`,
    };
  }
  if (draft.lines.length === 0) {
    return { field: 'lines', message: $localize`Add at least one ingredient.` };
  }
  if (draft.lines.length > MAX_LINES) {
    return {
      field: 'lines',
      message: $localize`A recipe holds up to ${MAX_LINES}:max: ingredients.`,
    };
  }
  for (const line of draft.lines) {
    if (!line.food) {
      return {
        field: 'lines',
        lineKey: line.key,
        message: $localize`Choose a food for “${line.suggestion?.name ?? ''}:ingredient:”, or remove it.`,
      };
    }
    const quantity = line.quantity;
    if (quantity === null || !(quantity > 0) || quantity > MAX_QUANTITY) {
      return {
        field: 'lines',
        lineKey: line.key,
        message: $localize`Give “${line.food.name}:food:” an amount above 0.`,
      };
    }
  }
  if (!draft.instructions.trim()) {
    return {
      field: 'instructions',
      message: $localize`Add a few words on how to make it.`,
    };
  }
  if (draft.instructions.length > MAX_INSTRUCTIONS) {
    return {
      field: 'instructions',
      message: $localize`Keep the method under ${MAX_INSTRUCTIONS}:max: characters.`,
    };
  }
  return null;
}

/** The lines as the server takes them; only call once `recipeProblem` found nothing. */
export function ingredientRequests(lines: readonly EditorLine[]): RecipeIngredientRequest[] {
  return lines.flatMap((line) =>
    line.food && line.quantity !== null
      ? [
          {
            foodItemVersionId: line.food.versionId,
            quantity: line.quantity,
            unit: line.food.unit,
            basis: line.food.basis,
            yieldFactorId: line.yieldFactorId,
            retentionFactorId: line.retentionFactorId,
          },
        ]
      : [],
  );
}

/** What the editor compares to know whether anything changed since it opened or saved. */
export function draftSignature(draft: RecipeDraft): string {
  return JSON.stringify({
    name: draft.name.trim(),
    servings: draft.servings,
    instructions: draft.instructions.trim(),
    photo: draft.photoId,
    lines: draft.lines.map((line) => [
      line.food?.versionId ?? null,
      line.quantity,
      line.suggestion?.name ?? null,
    ]),
  });
}

// ---------- words ----------

export function kcal(calories: number, locale: string): string {
  return $localize`${formatNumber(Math.round(calories), locale, '1.0-0')}:calories: kcal`;
}

export function grams(value: number, locale: string): string {
  return $localize`${formatNumber(value, locale, '1.0-1')}:grams: g`;
}

export function servingsLabel(servings: number, locale: string): string {
  return servings === 1
    ? $localize`1 serving`
    : $localize`${formatNumber(servings, locale, '1.0-2')}:servings: servings`;
}

const UNIT_WORDS: Record<FoodQuantityUnit, string> = {
  Gram: $localize`g`,
  Millilitre: $localize`ml`,
  Serving: $localize`serving`,
};

export function unitWord(unit: FoodQuantityUnit): string {
  return UNIT_WORDS[unit];
}

const SOURCE_WORDS: Record<FoodSource, string> = {
  UsdaFdc: $localize`USDA`,
  CoachAuthored: $localize`Your food`,
  LabelTranscribed: $localize`From a label`,
};

export function sourceWord(source: FoodSource): string {
  return SOURCE_WORDS[source];
}

/** "380 kcal per 100 g" for a food in the search. */
export function foodMeasure(food: RecipeFood, locale: string): string {
  return $localize`${kcal(food.calories, locale)}:calories: per ${formatNumber(food.basisQuantity, locale, '1.0-2')}:quantity: ${unitWord(food.unit)}:unit:`;
}

// ---------- cards ----------

export interface RecipeCard {
  id: string;
  name: string;
  initials: string;
  photoId: string | null;
  /** Calories in one serving, as the card's headline. */
  kcal: string;
  macros: string;
  split: { protein: number; carbs: number; fat: number } | null;
  servings: string;
  allergens: string;
  status: { label: string; tone: 'neutral' | 'warm' } | null;
}

export function recipeCard(recipe: RecipeSummary, locale: string): RecipeCard {
  const servings = numeric(recipe.servings) || 1;
  const serving: Macros = {
    calories: numeric(recipe.calories) / servings,
    protein: numeric(recipe.proteinGrams) / servings,
    carbs: numeric(recipe.carbohydrateGrams) / servings,
    fat: numeric(recipe.fatGrams) / servings,
  };
  const published = recipe.publishedVersionId ?? null;
  return {
    id: recipe.id,
    name: recipe.name,
    initials: initialsOf(recipe.name),
    photoId: recipe.photoMediaAssetId ?? null,
    kcal: $localize`${kcal(serving.calories, locale)}:calories: a serving`,
    macros: $localize`P ${grams(serving.protein, locale)}:protein: · C ${grams(serving.carbs, locale)}:carbs: · F ${grams(serving.fat, locale)}:fat:`,
    split: energySplit(serving),
    servings: servingsLabel(servings, locale),
    allergens: allergenText(recipe.declaredAllergens),
    status:
      recipe.status === 'Published'
        ? null
        : published
          ? { label: $localize`Changes not published`, tone: 'warm' }
          : { label: $localize`Draft`, tone: 'neutral' },
  };
}
