import { formatDate } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import type {
  AllergenCode,
  CalculateNutritionTargetsRequest,
  ClientEnrollmentView,
  ClientNutritionPlanSummary,
  FeatureAccessReason,
  FormulaSex,
  NutritionCalculationRecord,
  OccupationActivityType,
} from '../../core/api/generated';
import { HEIGHT_CM, WEIGHT_KG } from '../../core/units/body-units';
import { dayWords } from '../progress/progress-entries.models';
import { ALLERGEN_LABELS } from './nutrition.models';

/**
 * What the coach's Nutrition tab for one client shows and asks (R5.3d): the targets worked out, the
 * meal plan running, the allergens declared, and the three sheets that change them. Every number is
 * worked out by the server (NUT-007, NUT-008); this file only turns a typed value into a request,
 * checks it against the server's own limits in words, and turns an answer into sentences.
 */

export type FormulaKey = 'MifflinStJeor' | 'KatchMcArdle' | 'HarrisBenedictRevised';

const toNumber = (value: number | string): number => Number(value);

// ------------------------------------------------------------------------------------------------
// What the coach picks from
// ------------------------------------------------------------------------------------------------

export const AGE_YEARS = { min: 18, max: 120 } as const;
export const STEPS_PER_DAY = { min: 0, max: 100_000 } as const;
/** The server's range for a body-fat percentage in the Katch-McArdle formula. */
export const FORMULA_BODY_FAT = { min: 1, max: 70 } as const;
/** A typed goal stays within what a coach could mean; the server only needs a positive target. */
export const GOAL_KCAL = { min: -2000, max: 2000 } as const;
export const PROTEIN_GRAMS = { min: 0, max: 600 } as const;
export const FAT_PERCENT = { min: 0, max: 100 } as const;

export interface GoalPick {
  readonly kcal: number;
  readonly label: string;
}

/** Common adjustments from what the person burns; none of them is a rule, and a number can be typed. */
export const GOAL_PICKS: readonly GoalPick[] = [
  { kcal: -500, label: $localize`Lose faster` },
  { kcal: -300, label: $localize`Lose steadily` },
  { kcal: 0, label: $localize`Hold weight` },
  { kcal: 250, label: $localize`Gain slowly` },
  { kcal: 400, label: $localize`Gain` },
];

/** Protein in grams for each kilogram of body weight, as coaches usually think of it. */
export const PROTEIN_PER_KG: readonly number[] = [1.6, 1.8, 2, 2.2];

export const FAT_PICKS: readonly number[] = [20, 25, 30, 35];

export interface WorkKind {
  readonly value: OccupationActivityType;
  readonly label: string;
  readonly hint: string;
}

export const WORK_KINDS: readonly WorkKind[] = [
  { value: 'Seated', label: $localize`Seated`, hint: $localize`Mostly sitting: a desk, driving.` },
  {
    value: 'Mixed',
    label: $localize`Mixed`,
    hint: $localize`Up and about for part of the day.`,
  },
  {
    value: 'Physical',
    label: $localize`Physical`,
    hint: $localize`On their feet or lifting for most of it.`,
  },
];

export interface FormulaChoice {
  readonly value: FormulaKey;
  readonly label: string;
  readonly hint: string;
}

export const FORMULAS: readonly FormulaChoice[] = [
  {
    value: 'MifflinStJeor',
    label: $localize`Mifflin-St Jeor`,
    hint: $localize`The usual choice. Needs weight, height, age and sex.`,
  },
  {
    value: 'KatchMcArdle',
    label: $localize`Katch-McArdle`,
    hint: $localize`Starts from lean mass, so it needs their body fat.`,
  },
  {
    value: 'HarrisBenedictRevised',
    label: $localize`Harris-Benedict (revised)`,
    hint: $localize`An older formula some coaches still prefer.`,
  },
];

export function formulaName(key: string): string {
  return FORMULAS.find((item) => item.value === key)?.label ?? key;
}

export function workWords(kind: OccupationActivityType): string {
  return WORK_KINDS.find((item) => item.value === kind)?.label.toLowerCase() ?? kind;
}

// ------------------------------------------------------------------------------------------------
// The sheet that works targets out
// ------------------------------------------------------------------------------------------------

/** What the coach types, as the sheet holds it: a missing number is null. */
export interface TargetsValues {
  weight: number | null;
  height: number | null;
  age: number | null;
  sex: FormulaSex | null;
  work: OccupationActivityType | null;
  steps: number | null;
  /** Kilocalories a day above (plus) or below (minus) what they burn. */
  goal: number | null;
  protein: number | null;
  /** Percent of the calorie target that comes from fat. */
  fat: number | null;
  formula: FormulaKey;
  bodyFat: number | null;
}

export type TargetsField = Exclude<keyof TargetsValues, 'formula'>;

/** Where a prefilled number came from, so a coach knows what they are checking. */
export interface Starting {
  readonly weight: { value: number; on: string } | null;
  readonly height: number | null;
  readonly age: number | null;
  readonly steps: number | null;
}

export function emptyTargets(): TargetsValues {
  return {
    weight: null,
    height: null,
    age: null,
    sex: null,
    work: null,
    steps: null,
    goal: 0,
    protein: null,
    fat: 25,
    formula: 'MifflinStJeor',
    bodyFat: null,
  };
}

/** The values a sheet opens with: what the record already knows, and what the last calculation chose. */
export function startingTargets(starting: Starting, last: WorkedOut | null): TargetsValues {
  const values = emptyTargets();
  // Weight, height, age and steps are today's facts about them: a missing one is left to be typed,
  // never filled from an old calculation.
  values.weight = starting.weight?.value ?? null;
  values.height = starting.height;
  values.age = starting.age;
  values.steps = starting.steps;
  if (last?.inputs) {
    // The choices that were the coach's own carry over; a new calculation starts from them.
    values.sex = last.inputs.sex;
    values.work = last.inputs.work;
    values.goal = last.goalAdjustment;
    values.fat = last.inputs.fatPercent;
    values.formula = last.inputs.formula;
    values.bodyFat = last.inputs.bodyFat;
    values.protein =
      values.weight !== null && last.inputs.weight > 0
        ? Math.round((last.protein / last.inputs.weight) * values.weight)
        : last.protein;
  }
  return values;
}

/** Whole years on a day, from a birth date; null when there is no date to count from. */
export function ageOn(birthDate: string | null | undefined, today: string): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const years = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
  // A birthday not yet reached this year has not added its year.
  const reached = today.slice(5) >= birthDate.slice(5) ? years : years - 1;
  return reached >= 0 ? reached : null;
}

/** Grams of protein for a body weight at a number of grams for each kilogram. */
export function proteinFor(weightKg: number, perKg: number): number {
  return Math.round(weightKg * perKg);
}

/** Grams for each kilogram, to one decimal, for the line under the protein box. */
export function perKilogram(grams: number, weightKg: number): number | null {
  if (!(weightKg > 0)) return null;
  return Math.round((grams / weightKg) * 10) / 10;
}

function rangeWords(min: number, max: number): string {
  const format = new Intl.NumberFormat('en');
  return `${format.format(min)} and ${format.format(max)}`;
}

/** Each box's messages, in words and in the units shown, using the server's own limits. */
export function targetErrors(values: TargetsValues): Record<TargetsField, string[]> {
  const errors: Record<TargetsField, string[]> = {
    weight: [],
    height: [],
    age: [],
    sex: [],
    work: [],
    steps: [],
    goal: [],
    protein: [],
    fat: [],
    bodyFat: [],
  };
  if (!isNumber(values.weight)) {
    errors.weight.push($localize`Enter their weight.`);
  } else if (values.weight < WEIGHT_KG.min || values.weight > WEIGHT_KG.max) {
    errors.weight.push(
      $localize`Weight has to be between ${rangeWords(WEIGHT_KG.min, WEIGHT_KG.max)}:range: kg.`,
    );
  }
  if (!isNumber(values.height)) {
    errors.height.push($localize`Enter their height.`);
  } else if (values.height < HEIGHT_CM.min || values.height > HEIGHT_CM.max) {
    errors.height.push(
      $localize`Height has to be between ${rangeWords(HEIGHT_CM.min, HEIGHT_CM.max)}:range: cm.`,
    );
  }
  if (!isNumber(values.age) || !Number.isInteger(values.age)) {
    errors.age.push($localize`Enter their age in whole years.`);
  } else if (values.age < AGE_YEARS.min || values.age > AGE_YEARS.max) {
    errors.age.push(
      $localize`Age has to be between ${rangeWords(AGE_YEARS.min, AGE_YEARS.max)}:range:. The formulas are for adults.`,
    );
  }
  if (values.sex === null) {
    errors.sex.push($localize`Choose female or male: the formulas ask for one.`);
  }
  if (values.work === null) {
    errors.work.push($localize`Choose the kind of work they do.`);
  }
  if (!isNumber(values.steps) || !Number.isInteger(values.steps)) {
    errors.steps.push($localize`Enter their steps a day. A rough number is fine.`);
  } else if (values.steps < STEPS_PER_DAY.min || values.steps > STEPS_PER_DAY.max) {
    errors.steps.push(
      $localize`Steps a day have to be between ${rangeWords(STEPS_PER_DAY.min, STEPS_PER_DAY.max)}:range:.`,
    );
  }
  if (!isNumber(values.goal) || !Number.isInteger(values.goal)) {
    errors.goal.push($localize`Enter the calories a day above or below what they burn.`);
  } else if (values.goal < GOAL_KCAL.min || values.goal > GOAL_KCAL.max) {
    errors.goal.push(
      $localize`Between −${Math.abs(GOAL_KCAL.min).toLocaleString('en')}:low: and +${GOAL_KCAL.max.toLocaleString('en')}:high: calories a day.`,
    );
  }
  if (!isNumber(values.protein) || !Number.isInteger(values.protein)) {
    errors.protein.push($localize`Enter the grams of protein a day.`);
  } else if (values.protein < PROTEIN_GRAMS.min || values.protein > PROTEIN_GRAMS.max) {
    errors.protein.push(
      $localize`Protein has to be between ${PROTEIN_GRAMS.min}:low: and ${PROTEIN_GRAMS.max}:high: grams.`,
    );
  }
  if (!isNumber(values.fat)) {
    errors.fat.push($localize`Enter the share of calories that comes from fat.`);
  } else if (values.fat < FAT_PERCENT.min || values.fat > FAT_PERCENT.max) {
    errors.fat.push($localize`Fat has to be between 0 and 100 percent of calories.`);
  }
  if (values.formula === 'KatchMcArdle') {
    if (!isNumber(values.bodyFat)) {
      errors.bodyFat.push($localize`This formula needs their body fat.`);
    } else if (values.bodyFat < FORMULA_BODY_FAT.min || values.bodyFat > FORMULA_BODY_FAT.max) {
      errors.bodyFat.push(
        $localize`Body fat has to be between ${FORMULA_BODY_FAT.min}:low: and ${FORMULA_BODY_FAT.max}:high: percent.`,
      );
    }
  }
  return errors;
}

function isNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export function problemCount(errors: Record<TargetsField, readonly string[]>): number {
  return Object.values(errors).reduce((total, messages) => total + messages.length, 0);
}

/** The request for values that passed `targetErrors`. Eating below what they burn is how it is told apart. */
export function calculationRequest(values: TargetsValues): CalculateNutritionTargetsRequest {
  return {
    bmrMethodKey: values.formula,
    weightKilograms: values.weight!,
    heightCentimeters: values.height!,
    ageYears: values.age!,
    sex: values.sex!,
    bodyFatPercentage: values.formula === 'KatchMcArdle' ? values.bodyFat : null,
    occupationType: values.work!,
    averageDailySteps: values.steps!,
    coachGoalAdjustment: values.goal!,
    calorieTarget: null,
    proteinGrams: values.protein!,
    fatPercentage: values.fat!,
    // The wider protein review range applies while eating below what they burn (NUT-008).
    isEnergyDeficit: values.goal! < 0,
  };
}

// ------------------------------------------------------------------------------------------------
// What was worked out
// ------------------------------------------------------------------------------------------------

export interface CalculationInputs {
  readonly formula: FormulaKey;
  readonly weight: number;
  readonly height: number;
  readonly age: number;
  readonly sex: FormulaSex;
  readonly bodyFat: number | null;
  readonly work: OccupationActivityType;
  readonly steps: number;
  readonly fatPercent: number;
}

/** One worked-out set of targets, as the page shows it. */
export interface WorkedOut {
  readonly id: string;
  readonly calculatedAtUtc: string;
  readonly calories: number;
  readonly protein: number;
  readonly carbohydrate: number;
  readonly fat: number;
  /** What the body burns at rest, and the multiple for how active they are, then both together. */
  readonly restingNeed: number;
  readonly activity: number;
  readonly maintenance: number;
  readonly goalAdjustment: number;
  readonly formula: string;
  readonly warnings: readonly string[];
  /** Null when an older record's numbers could not be read back. */
  readonly inputs: CalculationInputs | null;
}

export function mapWorkedOut(record: NutritionCalculationRecord): WorkedOut {
  const result = record.result;
  const given = record.inputs;
  return {
    id: result.id,
    calculatedAtUtc: record.calculatedAtUtc,
    calories: toNumber(result.calorieTarget),
    protein: toNumber(result.proteinGrams),
    carbohydrate: toNumber(result.carbohydrateGrams),
    fat: toNumber(result.fatGrams),
    restingNeed: toNumber(result.bmrEstimate),
    activity: toNumber(result.activityModelPal),
    maintenance: toNumber(result.tdeeEstimate),
    goalAdjustment: toNumber(result.coachGoalAdjustment),
    formula: result.bmrMethodKey,
    warnings: result.warnings,
    inputs: given
      ? {
          formula: given.bmrMethodKey as FormulaKey,
          weight: toNumber(given.weightKilograms),
          height: toNumber(given.heightCentimeters),
          age: toNumber(given.ageYears),
          sex: given.sex,
          bodyFat: given.bodyFatPercentage === null ? null : toNumber(given.bodyFatPercentage),
          work: given.occupationType,
          steps: toNumber(given.averageDailySteps),
          fatPercent: toNumber(given.fatPercentage),
        }
      : null,
  };
}

export interface MacroShares {
  readonly protein: number;
  readonly carbohydrate: number;
  readonly fat: number;
}

/**
 * Each macro's share of the calories, in whole percents that add up to 100. Protein and carbohydrate
 * are 4 kcal a gram and fat 9 (NUT-008); the rounding hands the leftover to the largest remainder.
 */
export function macroShares(numbers: {
  protein: number;
  carbohydrate: number;
  fat: number;
}): MacroShares {
  const kcal = [numbers.protein * 4, numbers.carbohydrate * 4, numbers.fat * 9];
  const total = kcal.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return { protein: 0, carbohydrate: 0, fat: 0 };
  const raw = kcal.map((value) => (value / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((total, value) => total + value, 0);
  const order = raw
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index] += 1;
    left -= 1;
  }
  return { protein: floors[0], carbohydrate: floors[1], fat: floors[2] };
}

/**
 * The server's protein warning in a coach's words. It keeps the server's numbers (the range is its
 * rule, not ours), and anything it says that is not the known sentence is shown as it came.
 */
export function warningWords(warning: string): string {
  const match =
    /^Protein is ([\d.]+) g\/kg\/day, outside the [^.]*? range of ([\d.]+)-([\d.]+) g\/kg\/day\./.exec(
      warning,
    );
  if (!match) return warning;
  const [, actual, low, high] = match;
  return $localize`Protein works out at ${actual}:actual: g for each kilogram a day, outside the usual ${low}:low: to ${high}:high: range. This is a flag for you to look at, not a rule.`;
}

/** The workspace's calendar day of an instant. */
export function dayInZone(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function signedKcal(value: number): string {
  const rounded = Math.round(value);
  const digits = new Intl.NumberFormat('en').format(Math.abs(rounded));
  return rounded < 0 ? `−${digits}` : rounded > 0 ? `+${digits}` : '0';
}

/** "70 kg, 168 cm, 29 years, female, seated work, 8,000 steps a day". */
export function inputsLine(inputs: CalculationInputs): string {
  const steps = new Intl.NumberFormat('en').format(inputs.steps);
  const sex = inputs.sex === 'Female' ? $localize`female` : $localize`male`;
  const fat =
    inputs.formula === 'KatchMcArdle' && inputs.bodyFat !== null
      ? $localize`, ${inputs.bodyFat}:fat: percent body fat`
      : '';
  return $localize`${inputs.weight}:weight: kg, ${inputs.height}:height: cm, ${inputs.age}:age: years, ${sex}:sex:, ${workWords(inputs.work)}:work: work, ${steps}:steps: steps a day${fat}:fat:`;
}

// ------------------------------------------------------------------------------------------------
// Meal plans
// ------------------------------------------------------------------------------------------------

export type PlanState = 'running' | 'coming' | 'ended' | 'stopped';

export interface PlanRow {
  readonly id: string;
  readonly name: string;
  readonly start: string;
  readonly endExclusive: string;
  readonly lastDay: string;
  readonly days: number;
  readonly state: PlanState;
  readonly version: number;
  readonly calories: number;
  readonly protein: number;
  readonly carbohydrate: number;
  readonly fat: number;
  readonly calculationId: string;
}

export function addDaysIso(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return moved.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export function mapPlan(plan: ClientNutritionPlanSummary, today: string): PlanRow {
  const start = plan.startDate;
  const endExclusive = plan.endDateExclusive;
  const state: PlanState =
    plan.status === 'Cancelled'
      ? 'stopped'
      : endExclusive <= today
        ? 'ended'
        : start > today
          ? 'coming'
          : 'running';
  return {
    id: plan.id,
    name: plan.mealPlanName,
    start,
    endExclusive,
    lastDay: addDaysIso(endExclusive, -1),
    days: daysBetween(start, endExclusive),
    state,
    version: toNumber(plan.version),
    calories: toNumber(plan.calorieTarget),
    protein: toNumber(plan.proteinGrams),
    carbohydrate: toNumber(plan.carbohydrateGrams),
    fat: toNumber(plan.fatGrams),
    calculationId: plan.calculationSnapshotId,
  };
}

/**
 * The plan the client is on, or the next one coming, with every other plan newest first. A plan the
 * coach stopped is kept in the list with its state, never hidden: it was assigned.
 */
export function splitPlans(plans: readonly PlanRow[]): {
  current: PlanRow | null;
  others: PlanRow[];
} {
  const live = plans.filter((plan) => plan.state === 'running' || plan.state === 'coming');
  const current =
    live.find((plan) => plan.state === 'running') ??
    [...live].sort((a, b) => a.start.localeCompare(b.start))[0] ??
    null;
  const others = plans
    .filter((plan) => plan !== current)
    .sort((a, b) => b.start.localeCompare(a.start));
  return { current, others };
}

export function planStateWords(plan: PlanRow, today: string, locale: string): string {
  switch (plan.state) {
    case 'running':
      return $localize`Day ${daysBetween(plan.start, today) + 1}:day: of ${plan.days}:days:`;
    case 'coming':
      return $localize`Starts ${dayWords(plan.start, today, locale)}:day:`;
    case 'ended':
      return $localize`Ended`;
    case 'stopped':
      return $localize`Stopped`;
  }
}

export function planDates(plan: PlanRow, today: string, locale: string): string {
  return `${dayWords(plan.start, today, locale)} – ${dayWords(plan.lastDay, today, locale)}`;
}

/** A plan of this many days from a start day, as "Runs Sat 10 Oct – Fri 23 Oct". */
export function runsWords(start: string, days: number, today: string, locale: string): string {
  const last = addDaysIso(start, days - 1);
  return $localize`Runs ${dayWords(start, today, locale)}:start: – ${dayWords(last, today, locale)}:end:`;
}

export interface NutritionCover {
  readonly id: string;
  readonly label: string;
  readonly start: string;
  /** The last day it covers. */
  readonly last: string;
}

/** The plans a meal plan may sit under: those with Nutrition that have not ended or been cancelled. */
export function nutritionCovers(enrollments: readonly ClientEnrollmentView[]): NutritionCover[] {
  return enrollments
    .filter(
      (item) =>
        item.features.includes('Nutrition') &&
        item.storedStatus !== 'Cancelled' &&
        item.storedStatus !== 'Expired',
    )
    .map((item) => ({
      id: item.id,
      label: item.productName,
      start: item.startDate,
      last: item.lastActiveDate,
    }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * What stops a meal plan starting on a day, judged before anything is sent (the server judges again):
 * the plan has to sit inside the paid Nutrition dates, and an active plan of theirs cannot overlap.
 */
export function startIssue(
  cover: NutritionCover | null,
  plans: readonly PlanRow[],
  start: string,
  days: number,
  today: string,
  locale: string,
  name: string,
): string | null {
  if (cover === null) {
    return $localize`${name}:name:’s plan has no Nutrition to assign this under.`;
  }
  const last = addDaysIso(start, days - 1);
  if (start < cover.start || last > cover.last) {
    const latest = addDaysIso(cover.last, -(days - 1));
    const window = `${dayWords(cover.start, today, locale)} – ${dayWords(cover.last, today, locale)}`;
    return latest < cover.start
      ? $localize`This meal plan is ${days}:days: days long, longer than ${name}:name:’s Nutrition (${window}:window:). Renew their plan first.`
      : $localize`${name}:name:’s Nutrition covers ${window}:window:, so a ${days}:days:-day meal plan can start ${dayWords(cover.start, today, locale)}:first: to ${dayWords(latest, today, locale)}:latest:.`;
  }
  const clash = plans.find(
    (plan) =>
      (plan.state === 'running' || plan.state === 'coming') &&
      start < plan.endExclusive &&
      plan.start <= last,
  );
  if (clash) {
    return $localize`${name}:name: already has ${clash.name}:plan: from ${dayWords(clash.start, today, locale)}:start: to ${dayWords(clash.lastDay, today, locale)}:end:. A new one can start on ${dayWords(clash.endExclusive, today, locale)}:day: or later.`;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------
// The server's refusals, in words
// ------------------------------------------------------------------------------------------------

export function nutritionClosed(reason: FeatureAccessReason, name: string): string {
  switch (reason) {
    case 'NoEntitlement':
      return $localize`Nutrition isn’t part of ${name}:name:’s plan.`;
    case 'Expired':
      return $localize`${name}:name:’s plan has ended, so their nutrition isn’t shown.`;
    case 'Cancelled':
      return $localize`${name}:name:’s plan was cancelled, so their nutrition isn’t shown.`;
    case 'Paused':
      return $localize`${name}:name:’s plan is paused, so their nutrition isn’t shown.`;
    case 'PaymentRequired':
      return $localize`${name}:name:’s plan is waiting for payment, so their nutrition isn’t shown.`;
    case 'NotStarted':
      return $localize`${name}:name:’s plan hasn’t started yet, so their nutrition isn’t shown.`;
    case 'RelationshipBlocked':
      return $localize`You have blocked ${name}:name:, so their nutrition isn’t shown.`;
    case 'MembershipInactive':
      return $localize`${name}:name: is no longer with you, so their nutrition isn’t shown.`;
    case 'PlatformBlocked':
      return $localize`${name}:name:’s access is blocked, so their nutrition isn’t shown.`;
    default:
      return $localize`${name}:name:’s nutrition isn’t available right now.`;
  }
}

/** The stable code a refusal carries, when it carries one. */
export function refusalCode(error: unknown): string | null {
  return error instanceof HttpErrorResponse
    ? ((error.error as { code?: string } | null)?.code ?? null)
    : null;
}

/** A box's value, or null for an empty or half-typed one (`valueAsNumber` is NaN there). */
export function numberOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/** The text a refusal carries, with .NET's "(Parameter 'input')" tail taken off. */
export function refusalText(message: string): string {
  return message.replace(/\s*\(Parameter '[^']*'\)\s*$/, '').trim();
}

/**
 * What the server's known refusals of a calculation mean for the coach. A refusal not listed here is
 * shown as the server wrote it, without its parameter note.
 */
export function calculationRefusal(message: string): string {
  const text = refusalText(message);
  if (/protein and fat calories cannot exceed/i.test(text)) {
    return $localize`Protein and fat together come to more calories than the target. Lower the protein or the fat share, or raise the goal.`;
  }
  if (/katch-mcardle requires/i.test(text)) {
    return $localize`That formula needs their body fat. Enter it, or choose another formula.`;
  }
  if (/calorie target must be positive/i.test(text)) {
    return $localize`The goal takes the target to zero or below. Choose a smaller difference from what they burn.`;
  }
  return text;
}

export function assignRefusal(
  code: string | null,
  message: string,
  name: string,
  window: string,
): string {
  const text = refusalText(message);
  if (code === 'nutrition_plan_conflict' || /conflicts with current nutrition state/i.test(text)) {
    return $localize`${name}:name: already has a meal plan on some of these days. Pick a start after it ends.`;
  }
  if (/inside its nutrition entitlement/i.test(text)) {
    return $localize`That meal plan would run past ${name}:name:’s Nutrition (${window}:window:). Start it earlier, or renew their plan first.`;
  }
  if (/only a published meal-plan version/i.test(text)) {
    return $localize`That meal plan is not published, so it cannot be assigned.`;
  }
  return text;
}

// ------------------------------------------------------------------------------------------------
// Allergens
// ------------------------------------------------------------------------------------------------

export function allergenName(code: AllergenCode): string {
  return ALLERGEN_LABELS.find((item) => item.code === code)?.label ?? code;
}

/** The allergens in the order the list names them, whatever order the server sent. */
export function inListOrder(codes: readonly AllergenCode[]): AllergenCode[] {
  const wanted = new Set(codes);
  return ALLERGEN_LABELS.map((item) => item.code).filter((code) => wanted.has(code));
}

export function sameAllergens(a: readonly AllergenCode[], b: readonly AllergenCode[]): boolean {
  return a.length === b.length && inListOrder(a).join() === inListOrder(b).join();
}

/** "Milk, peanuts and sesame". */
export function allergenList(codes: readonly AllergenCode[]): string {
  const names = inListOrder(codes).map((code) => allergenName(code).replace(/ \(.*\)$/, ''));
  if (names.length === 0) return '';
  const lower = names.map((name, index) => (index === 0 ? name : name.toLowerCase()));
  return new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' }).format(lower);
}

// ------------------------------------------------------------------------------------------------
// The workspace's days
// ------------------------------------------------------------------------------------------------

export function workedOutOn(
  instant: string,
  timeZone: string,
  today: string,
  locale: string,
): string {
  const day = dayInZone(instant, timeZone);
  return day === today ? $localize`today` : dayWords(day, today, locale);
}

export function longDay(date: string, locale: string): string {
  return formatDate(date, 'EEEE d MMMM y', locale);
}
