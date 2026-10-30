import { formatNumber } from '@angular/common';
import type { EnergyPreviewView, GoalRate, PreviewEnergyRequest } from '../../core/api/generated';
import {
  chosenPalOf,
  GOAL_PICKS,
  type TargetsField,
  type TargetsValues,
} from './client-nutrition.models';

/**
 * What the targets sheet says as the coach types, under energy version 2 (critique B8b): the server's
 * words beside the multiplier, what the steps are worth inside it, and each goal's rate and share. The
 * server works every number out (`POST /api/nutrition/energy-preview`, recorded nowhere); this file only
 * says what to ask and keeps the answer's words as the server wrote them.
 */

/** One goal's rate and share, as the server said it. */
export interface GoalLine {
  /** "−500 a day ≈ 0.5 kg a week, 84% of what they burn". */
  readonly words: string;
  /** The pick's short line: "≈ 0.5 kg a week". */
  readonly pace: string;
  /** Its share of what they burn, a whole percent; null until that is known. */
  readonly share: number | null;
}

export interface EnergyPreview {
  /** "Counts as low active: × 1.68 (…)", once the work, the steps and the workouts are in. */
  readonly activity: string | null;
  /** "Their 5,000 steps are inside that, …", once the steps and the weight are in. */
  readonly walking: string | null;
  /** Each goal asked about, by its calories a day. */
  readonly goals: ReadonlyMap<number, GoalLine>;
}

/**
 * The preview's question for what the sheet holds: every number the sheet would refuse is left out, so
 * the server answers only with what it can work out, and a multiplier of the coach's own still being
 * typed asks for no multiplier rather than the table's. The goals are the picks and the one in the box.
 */
export function previewRequest(
  values: TargetsValues,
  issues: Readonly<Record<TargetsField, readonly string[]>>,
): PreviewEnergyRequest {
  const clean = (field: TargetsField, value: number | null) =>
    issues[field].length === 0 ? value : null;
  const ownPal = issues.pal.length === 0;
  const goals = GOAL_PICKS.map((pick) => pick.kcal);
  const typed = clean('goal', values.goal);
  if (typed !== null && !goals.includes(typed)) goals.push(typed);
  return {
    bmrMethodKey: values.formula,
    weightKilograms: clean('weight', values.weight),
    heightCentimeters: clean('height', values.height),
    ageYears: clean('age', values.age),
    sex: values.sex,
    bodyFatPercentage: values.formula === 'KatchMcArdle' ? clean('bodyFat', values.bodyFat) : null,
    occupationType: ownPal ? values.work : null,
    averageDailySteps: clean('steps', values.steps),
    workoutsPerWeek: clean('workouts', values.workouts),
    chosenPal: ownPal ? chosenPalOf(values) : null,
    goalAdjustments: goals,
  };
}

export function mapPreview(view: EnergyPreviewView, locale: string): EnergyPreview {
  return {
    activity: view.activity?.words ?? null,
    walking: view.walking?.words ?? null,
    goals: new Map(
      view.goals.map((rate) => [Number(rate.goalAdjustment), goalLine(rate, locale)] as const),
    ),
  };
}

/** A goal pick's own line, from the server's figures: "≈ 0.5 kg a week", "no change". */
export function goalLine(rate: GoalRate, locale: string): GoalLine {
  const perWeek = Math.abs(Number(rate.kilogramsPerWeek));
  const share = rate.shareOfMaintenance === null ? null : Number(rate.shareOfMaintenance);
  const pace =
    Number(rate.goalAdjustment) === 0
      ? $localize`no change`
      : perWeek === 0
        ? $localize`under 0.1 kg a week`
        : $localize`≈ ${formatNumber(perWeek, locale, '1.1-1')}:kilograms: kg a week`;
  return { words: rate.words, pace, share };
}

/** "Little movement, no exercise.": a pick's words as a sentence under its multiplier. */
export function pickSentence(words: string): string {
  const trimmed = words.trim();
  if (!trimmed) return '';
  const first = trimmed.charAt(0).toLocaleUpperCase('en');
  return `${first}${trimmed.slice(1)}${/[.!?]$/.test(trimmed) ? '' : '.'}`;
}
