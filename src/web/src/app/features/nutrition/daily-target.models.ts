import { formatNumber } from '@angular/common';
import type { ClientTargetsItem, MacroSplitView } from '../../core/api/generated';
import { initialsOf } from '../../shell/initials';
import { numeric } from '../training/training-builder.models';
import { warningWords, workedOutOn } from './client-nutrition.models';

/**
 * The meal-plan builder's daily target (critique B5c2): "Fill in fat and carbs" and "Start from a
 * client's targets". The server works the split out (NUT-008); nothing here works a gram out, it only
 * reads and words what the server sent.
 */

/** What the fill sheet holds as typed: a missing number is null. */
export interface FillValues {
  calories: number | null;
  protein: number | null;
  /** The share of the calories that comes from fat, in percent. */
  fat: number | null;
}

export type FillField = keyof FillValues;

/** The daily calories a version takes (NUT-013). */
export const DAILY_CALORIES = { min: 0, max: 100_000 } as const;

/** Each box's messages, with the server's own limits. Protein and fat beyond the calories is the server's to say. */
export function fillErrors(values: FillValues): Record<FillField, string[]> {
  const errors: Record<FillField, string[]> = { calories: [], protein: [], fat: [] };
  if (!isNumber(values.calories)) {
    errors.calories.push($localize`Enter the calories a day.`);
  } else if (values.calories <= DAILY_CALORIES.min || values.calories > DAILY_CALORIES.max) {
    errors.calories.push($localize`Calories have to be more than 0 and at most 100,000.`);
  }
  if (!isNumber(values.protein)) {
    errors.protein.push($localize`Enter the grams of protein a day.`);
  } else if (values.protein < 0) {
    errors.protein.push($localize`Protein can’t be below 0 grams.`);
  }
  if (!isNumber(values.fat)) {
    errors.fat.push($localize`Enter the share of calories that comes from fat.`);
  } else if (values.fat < 0 || values.fat > 100) {
    errors.fat.push($localize`Fat has to be between 0 and 100 percent of calories.`);
  }
  return errors;
}

function isNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/** A split as the builder takes it: the four targets, the share they came from, and its warnings in words. */
export interface FilledSplit {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  share: number;
  warnings: readonly string[];
}

export function mapSplit(view: MacroSplitView): FilledSplit {
  return {
    calories: numeric(view.calorieTarget),
    protein: numeric(view.proteinGrams),
    carbs: numeric(view.carbohydrateGrams),
    fat: numeric(view.fatGrams),
    share: numeric(view.fatPercentage),
    warnings: view.warnings.map(warningWords),
  };
}

/**
 * The arithmetic in one sentence, from the grams the server worked out: "Fat is 25% of the calories,
 * 56 g, and carbs are the rest, 238 g."
 */
export function fillSentence(share: number, fat: number, carbs: number, locale: string): string {
  const percent = formatNumber(share, locale, '1.0-2');
  const fatGrams = formatNumber(fat, locale, '1.0-0');
  const carbGrams = formatNumber(carbs, locale, '1.0-0');
  return $localize`Fat is ${percent}:share:% of the calories, ${fatGrams}:fat: g, and carbs are the rest, ${carbGrams}:carbs: g.`;
}

/** Where the rows' words come from: the workspace's own day and zone, and who is reading. */
export interface ClientTargetsContext {
  today: string;
  timeZone: string;
  locale: string;
  /** The signed-in coach: their own client does not name its coach. */
  userId: string | null;
}

/** A client in "Start from a client's targets". */
export interface ClientTargetsRow {
  id: string;
  name: string;
  initials: string;
  /** "2,150 kcal · protein 160 g · carbs 230 g · fat 70 g" */
  macros: string;
  /** "Worked out Mon 26 Oct", or "Your macros, set today" for a coach's own. */
  when: string;
  /** "Coached by Lea Khoury" on an owner's team coach's client; null on the reader's own. */
  coach: string | null;
  /** What the row's button says after the name, as one sentence for a screen reader. */
  spoken: string;
  /** The name in lower case without accents, for the search. */
  searchText: string;
  /** What choosing the row puts in the plan. */
  pick: ClientTargetsPick;
}

/** A client's targets, as the builder takes them. */
export interface ClientTargetsPick {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** The share the split worked the fat out at; null for a coach's own macros. */
  share: number | null;
  /** Their weight, for the fill's warnings; null when it could not be read back. */
  weight: number | null;
  isEnergyDeficit: boolean;
  warnings: readonly string[];
  /** The day they were worked out on: "today" or "Mon 26 Oct". */
  on: string;
}

/** "From Maya Fakhoury’s targets, worked out Mon 26 Oct.", or "…: your macros, set today." */
export function fromClientLine(pick: ClientTargetsPick): string {
  return pick.share === null
    ? $localize`From ${pick.name}:name:’s targets: your macros, set ${pick.on}:day:.`
    : $localize`From ${pick.name}:name:’s targets, worked out ${pick.on}:day:.`;
}

export function clientTargetsRow(
  item: ClientTargetsItem,
  context: ClientTargetsContext,
): ClientTargetsRow {
  const name = `${item.firstName} ${item.lastName}`.trim();
  const calories = numeric(item.calorieTarget);
  const protein = numeric(item.proteinGrams);
  const carbs = numeric(item.carbohydrateGrams);
  const fat = numeric(item.fatGrams);
  const share = item.fatPercentage === null ? null : numeric(item.fatPercentage);
  const day = workedOutOn(item.calculatedAtUtc, context.timeZone, context.today, context.locale);
  const when =
    share === null ? $localize`Your macros, set ${day}:day:` : $localize`Worked out ${day}:day:`;
  const grams = (value: number) => formatNumber(value, context.locale, '1.0-0');
  const macros = $localize`${grams(calories)}:calories: kcal · protein ${grams(protein)}:protein: g · carbs ${grams(carbs)}:carbs: g · fat ${grams(fat)}:fat: g`;
  const coach =
    context.userId !== null && item.coachUserId !== context.userId
      ? $localize`Coached by ${item.coachName}:coach:`
      : null;
  return {
    id: item.clientProfileId,
    name,
    initials: initialsOf(name),
    macros,
    when,
    coach,
    spoken: [macros, when, coach].filter(Boolean).join(', '),
    searchText: searchable(name),
    pick: {
      name,
      calories,
      protein,
      carbs,
      fat,
      share,
      weight: item.bodyweightKilograms === null ? null : numeric(item.bodyweightKilograms),
      isEnergyDeficit: item.isEnergyDeficit,
      warnings: item.warnings.map(warningWords),
      on: day,
    },
  };
}

/** Whether every word typed in the search box is in the client's name. */
export function matchesClient(row: ClientTargetsRow, search: string): boolean {
  const words = searchable(search).split(/\s+/).filter(Boolean);
  return words.every((word) => row.searchText.includes(word));
}

function searchable(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}
