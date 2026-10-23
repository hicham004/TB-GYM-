import { formatNumber } from '@angular/common';
import type {
  ClientPlanRecipeView,
  FoodQuantityUnit,
  PreparationBasis,
} from '../../core/api/generated';
import { numeric, type NutritionChoice } from './nutrition.models';

/**
 * Which amounts the recipe sheet lists: the client's own portion, which they cook, or the whole
 * recipe, which the coach's method is written for.
 */
export type RecipeAmounts = 'portion' | 'whole';

/** A recipe as the client's plan copied it (R4.4d), ready to read in a sheet. */
export interface ClientRecipe {
  id: string;
  name: string;
  photoId: string | null;
  /** Prep, cook and yield, each a short fact; a time the coach left out is not shown. */
  facts: string[];
  /** What the client's plan gives them of it: their servings and that portion's numbers. */
  portion: string;
  portionMacros: string;
  /**
   * Whether the client's portion is not the whole recipe, so the sheet offers both amounts. When it
   * is, the two are the same and the whole recipe's are listed.
   */
  scaled: boolean;
  /** Says which amounts are listed, and that the method is for the whole recipe. */
  notes: Record<RecipeAmounts, string>;
  ingredients: ClientRecipeLine[];
  /** The method a line a step; a single step reads as a paragraph. */
  steps: string[];
}

export interface ClientRecipeLine {
  name: string;
  /** The coach's amount for the whole recipe, and that amount scaled to the client's portion. */
  amounts: Record<RecipeAmounts, string>;
  /**
   * "raw" or "cooked" when the amount is weighed that way, said after it; null otherwise, or when
   * the food's name already says so ("Cooked rice").
   */
  basis: string | null;
}

export function clientRecipe(
  view: ClientPlanRecipeView,
  choice: NutritionChoice,
  locale: string,
): ClientRecipe {
  const servings = numeric(view.servings);
  const scaled = Math.abs(choice.servings - servings) > 1e-9;
  const whole =
    servings === 1
      ? $localize`For the whole recipe, one serving.`
      : $localize`For the whole recipe, ${formatNumber(servings, locale, '1.0-2')}:servings: servings.`;
  const facts: string[] = [];
  if (view.prepMinutes !== null && view.prepMinutes !== undefined) {
    facts.push($localize`Prep ${minutesLabel(numeric(view.prepMinutes), locale)}:time:`);
  }
  if (view.cookMinutes !== null && view.cookMinutes !== undefined) {
    const cook = numeric(view.cookMinutes);
    facts.push(
      cook === 0 ? $localize`No cooking` : $localize`Cook ${minutesLabel(cook, locale)}:time:`,
    );
  }
  facts.push(servingsLabel(servings, locale, 'makes'));
  return {
    id: view.id,
    name: view.name,
    photoId: view.photoMediaAssetId ?? null,
    facts,
    portion: $localize`Your plan: ${servingsLabel(choice.servings, locale, 'count')}:servings: · ${formatNumber(choice.calories, locale, '1.0-0')}:calories: kcal`,
    portionMacros: $localize`${grams(choice.protein, locale)}:protein: protein · ${grams(choice.carbohydrate, locale)}:carbs: carbs · ${grams(choice.fat, locale)}:fat: fat`,
    scaled,
    notes: {
      whole,
      portion: scaled
        ? $localize`For your ${servingsLabel(choice.servings, locale, 'count')}:servings:. The method is for the whole recipe.`
        : whole,
    },
    ingredients: view.ingredients.map((line) => {
      const basis = basisLabel(line.basis);
      const quantity = numeric(line.quantity);
      const wholeAmount = amountLabel(quantity, line.unit, locale, '1.0-1');
      const portion = portionQuantity(quantity, choice.servings, servings);
      return {
        name: line.foodName,
        amounts: {
          whole: wholeAmount,
          portion: scaled
            ? amountLabel(portion, line.unit, locale, portionDigits(portion, line.unit))
            : wholeAmount,
        },
        basis: basis && !namesBasis(line.foodName, basis, locale) ? basis : null,
      };
    }),
    steps: methodSteps(view.instructions),
  };
}

/**
 * Whether the food's name already says how the amount is weighed, as a word of its own: "Cooked rice"
 * does, while "Quinoa, uncooked" weighed cooked (audit A16b) does not, so its client still reads "cooked".
 */
function namesBasis(name: string, basis: string, locale: string): boolean {
  return name
    .toLocaleLowerCase(locale)
    .split(/[^\p{L}\p{N}]+/u)
    .includes(basis);
}

/**
 * A recipe line's amount for the client's portion: the coach's amount for the whole recipe times the
 * portion's share of what the recipe makes (their servings over its servings). It only changes what
 * the sheet lists; the portion's calories and macros are the plan's own (NUT-006).
 */
export function portionQuantity(
  quantity: number,
  portionServings: number,
  recipeServings: number,
): number {
  return (quantity * portionServings) / recipeServings;
}

/**
 * How finely a scaled amount is shown, so a kitchen scale can follow it: whole grams or millilitres
 * from 10, one decimal from 1 ("2.5 g" of salt), two below; a count of servings keeps two ("0.5").
 */
export function portionDigits(quantity: number, unit: FoodQuantityUnit): string {
  if (unit !== 'Gram' && unit !== 'Millilitre') return '1.0-2';
  if (quantity >= 10) return '1.0-0';
  return quantity >= 1 ? '1.0-1' : '1.0-2';
}

/** "10 min", "1 h", "1 h 30 min" or "8 h". */
export function minutesLabel(minutes: number, locale: string): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return $localize`${formatNumber(rest, locale, '1.0-0')}:minutes: min`;
  if (rest === 0) return $localize`${formatNumber(hours, locale, '1.0-0')}:hours: h`;
  return $localize`${formatNumber(hours, locale, '1.0-0')}:hours: h ${formatNumber(rest, locale, '1.0-0')}:minutes: min`;
}

/**
 * The coach's method split into steps, one per line. Steps lose the numbers or bullets a coach may
 * have typed, since the sheet numbers them itself; a method on one line is kept as written.
 */
export function methodSteps(instructions: string): string[] {
  const lines = instructions
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.length > 1
    ? lines.map((line) => line.replace(/^(\d+[.)]|[-•*])\s+/, '')).filter((line) => line.length > 0)
    : lines;
}

function amountLabel(
  quantity: number,
  unit: FoodQuantityUnit,
  locale: string,
  digits: string,
): string {
  const amount = formatNumber(quantity, locale, digits);
  switch (unit) {
    case 'Gram':
      return $localize`${amount}:amount: g`;
    case 'Millilitre':
      return $localize`${amount}:amount: ml`;
    default:
      return servingsLabel(quantity, locale, 'count');
  }
}

function basisLabel(basis: PreparationBasis): string | null {
  switch (basis) {
    case 'Raw':
      return $localize`raw`;
    case 'Cooked':
      return $localize`cooked`;
    default:
      return null;
  }
}

function servingsLabel(servings: number, locale: string, form: 'makes' | 'count'): string {
  const amount = formatNumber(servings, locale, '1.0-2');
  if (form === 'makes') {
    return servings === 1
      ? $localize`Makes 1 serving`
      : $localize`Makes ${amount}:servings: servings`;
  }
  return servings === 1 ? $localize`1 serving` : $localize`${amount}:servings: servings`;
}

function grams(value: number, locale: string): string {
  return $localize`${formatNumber(value, locale, '1.0-0')}:grams: g`;
}
