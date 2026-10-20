import { formatDate } from '@angular/common';
import type {
  BodyweightUnit,
  ClientIntakeProfile,
  CompleteClientOnboardingRequest,
  LengthUnit,
  UpdateClientIntakeRequest,
} from '../../core/api/api.models';
import {
  CENTIMETERS_PER_INCH,
  HEIGHT_CM,
  lengthCentimeters,
  POUNDS_TO_KILOGRAMS,
  WEIGHT_KG,
  weightKilograms,
} from '../../core/units/body-units';
import { addYears, adultCutoff, isIsoDate, type IsoDate } from '../../ui/calendar';
import type { DateInputStatus } from '../../ui/date-input';

/**
 * What the profile asks, says and checks (R5.3b): the four groups of answers a person can edit at any
 * time, the fifth step that only the first run has (the starting weight), and the words for each. The
 * server decides everything that matters (who is an adult, what a height can be, what finishes setting
 * up); this only asks for the same things in the same order, so a person is told in words before the
 * server has to refuse.
 */

/** The groups of answers, in the order they are asked and shown. */
export type IntakeGroup = 'about' | 'goal' | 'life' | 'health';

/** The five steps of the first run: the four groups, then the starting weight. */
export type IntakeStepId = IntakeGroup | 'start';

export const INTAKE_GROUPS: readonly IntakeGroup[] = ['about', 'goal', 'life', 'health'];
export const INTAKE_STEPS: readonly IntakeStepId[] = [...INTAKE_GROUPS, 'start'];

/** Every answer a person can type, as the boxes hold them. */
export interface IntakeValues {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  /** A real day, `YYYY-MM-DD`, or `''` while the three boxes hold no real day. */
  birthDate: string;
  birthStatus: DateInputStatus;
  heightValue: number | null;
  heightUnit: LengthUnit;
  workType: string;
  averageDailySteps: number | null;
  goals: string;
  trainingBackground: string;
  foodPreferences: string;
  foodAversions: string;
  allergies: string;
  medications: string;
  previousInjuries: string;
  /** The starting weight, asked once, at the last step of the first run. */
  weightValue: number | null;
  weightUnit: BodyweightUnit;
  /** The day it was weighed, `YYYY-MM-DD`. */
  weighedOn: string;
}

export interface IntakeDefaults {
  /** Today in the coaching space's own time zone. */
  today: IsoDate;
  /** The person's saved unit; kilograms until they chose another. */
  weightUnit: BodyweightUnit;
}

export function valuesFromProfile(
  profile: ClientIntakeProfile,
  defaults: IntakeDefaults,
): IntakeValues {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    phoneNumber: profile.phoneNumber ?? '',
    birthDate: profile.birthDate ?? '',
    birthStatus: profile.birthDate ? 'valid' : 'empty',
    heightValue: profile.heightEnteredValue,
    heightUnit: profile.heightEnteredUnit ?? 'Centimeter',
    workType: profile.workType ?? '',
    averageDailySteps: profile.averageDailySteps,
    goals: profile.goals ?? '',
    trainingBackground: profile.trainingBackground ?? '',
    foodPreferences: profile.foodPreferences ?? '',
    foodAversions: profile.foodAversions ?? '',
    allergies: profile.allergies ?? '',
    medications: profile.medications ?? '',
    previousInjuries: profile.previousInjuries ?? '',
    weightValue: null,
    weightUnit: defaults.weightUnit,
    weighedOn: defaults.today,
  };
}

/** The boxes each group owns, so a sheet saves and compares only its own. */
const FIELDS: Record<IntakeStepId, readonly (keyof IntakeValues)[]> = {
  about: [
    'firstName',
    'lastName',
    'phoneNumber',
    'birthDate',
    'birthStatus',
    'heightValue',
    'heightUnit',
  ],
  goal: ['goals', 'trainingBackground'],
  life: ['workType', 'averageDailySteps', 'foodPreferences', 'foodAversions'],
  health: ['allergies', 'medications', 'previousInjuries'],
  start: ['weightValue', 'weightUnit', 'weighedOn'],
};

/** A box's content for comparison: text is trimmed, so a stray space is not a change. */
function comparable(value: IntakeValues[keyof IntakeValues]): string | number | null {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * `saved` with the boxes of `steps` taken from `typed`: what one step sends, so a save never carries
 * answers the person typed in a step they have not pressed Continue on yet.
 */
export function mergeSteps(
  saved: IntakeValues,
  typed: IntakeValues,
  steps: readonly IntakeStepId[],
): IntakeValues {
  const merged = { ...saved };
  for (const step of steps) {
    for (const field of FIELDS[step]) {
      (merged as Record<keyof IntakeValues, IntakeValues[keyof IntakeValues]>)[field] =
        typed[field];
    }
  }
  return merged;
}

/**
 * `current` with every step the person has not touched replaced by what the server now holds, so a
 * fresh profile reaches the boxes while whatever they are typing stays where it is.
 */
export function followSaved(
  current: IntakeValues,
  before: IntakeValues,
  after: IntakeValues,
): IntakeValues {
  const untouched = INTAKE_STEPS.filter((step) => !hasChanges(current, before, [step]));
  return mergeSteps(current, after, untouched);
}

/** Whether the person has typed anything in these steps that `saved` does not hold. */
export function hasChanges(
  values: IntakeValues,
  saved: IntakeValues,
  steps: readonly IntakeStepId[] = INTAKE_STEPS,
): boolean {
  return steps.some((step) =>
    FIELDS[step].some((field) => comparable(values[field]) !== comparable(saved[field])),
  );
}

/** What one save came to: it worked, or the server's reason in words. */
export type IntakeOutcome =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * What the first-run steps and the edit sheets need from the page that owns the profile. The page
 * sends the request as its own workspace's write (so a late answer never lands in another one), puts
 * the saved profile where it keeps it, and says only whether it worked.
 */
export interface IntakeSaver {
  save(request: UpdateClientIntakeRequest): Promise<IntakeOutcome>;
  complete(request: CompleteClientOnboardingRequest): Promise<IntakeOutcome>;
}

// ---------- what each step says ----------

/** Who the answers are about: the person themselves, or a client their coach is looking at. */
export type IntakeSubject =
  { readonly kind: 'self' } | { readonly kind: 'client'; readonly name: string };

export function groupTitle(step: IntakeStepId, subject: IntakeSubject): string {
  if (subject.kind === 'self') {
    switch (step) {
      case 'about':
        return $localize`About you`;
      case 'goal':
        return $localize`Your goal`;
      case 'life':
        return $localize`Your day and food`;
      case 'health':
        return $localize`Your health`;
      case 'start':
        return $localize`Where you start`;
    }
  }
  const name = subject.name;
  switch (step) {
    case 'about':
      return $localize`About ${name}:name:`;
    case 'goal':
      return $localize`${name}:name:’s goal`;
    case 'life':
      return $localize`${name}:name:’s day and food`;
    case 'health':
      return $localize`${name}:name:’s health`;
    case 'start':
      return $localize`Starting weight`;
  }
}

/** The one-line reason for a step, in the voice of someone talking to the client. */
export function stepLede(step: IntakeStepId): string {
  switch (step) {
    case 'about':
      return $localize`So your coach knows who they are working with.`;
    case 'goal':
      return $localize`What do you want out of coaching? Your coach builds your plan around it.`;
    case 'life':
      return $localize`So your plan fits the way you live and eat. All of this is optional.`;
    case 'health':
      return $localize`Anything your coach should know before planning your training and food. Leave a box empty if nothing applies.`;
    case 'start':
      return $localize`Your starting weight is where your progress is measured from.`;
  }
}

/** The short name a step has in the progress list. */
export function stepName(step: IntakeStepId): string {
  switch (step) {
    case 'about':
      return $localize`About you`;
    case 'goal':
      return $localize`Goal`;
    case 'life':
      return $localize`Day and food`;
    case 'health':
      return $localize`Health`;
    case 'start':
      return $localize`Weight`;
  }
}

// ---------- what finishes setting up ----------

/** What a person must still give before setting up can finish, in the order it is asked. */
export type SetupItem = 'birthDate' | 'height' | 'goals' | 'weight';

export function setupItemLabel(item: SetupItem): string {
  switch (item) {
    case 'birthDate':
      return $localize`date of birth`;
    case 'height':
      return $localize`height`;
    case 'goals':
      return $localize`a goal`;
    case 'weight':
      return $localize`starting weight`;
  }
}

/** Nothing once setting up is finished; the starting weight is never held on the profile itself. */
export function missingForSetup(profile: ClientIntakeProfile): SetupItem[] {
  if (profile.onboardingStatus === 'Completed') return [];
  const missing: SetupItem[] = [];
  if (!profile.birthDate) missing.push('birthDate');
  if (profile.heightEnteredValue === null) missing.push('height');
  if (!(profile.goals ?? '').trim()) missing.push('goals');
  missing.push('weight');
  return missing;
}

/** "date of birth, height and a goal": a list read aloud. */
export function listWords(items: readonly string[], locale: string): string {
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);
}

/** Whether a step has what it needs in the saved profile, so a returning person starts after it. */
export function isStepDone(step: IntakeStepId, profile: ClientIntakeProfile): boolean {
  const filled = (value: string | null) => (value ?? '').trim() !== '';
  switch (step) {
    case 'about':
      return profile.birthDate !== null && profile.heightEnteredValue !== null;
    case 'goal':
      return filled(profile.goals);
    case 'life':
      return (
        filled(profile.workType) ||
        profile.averageDailySteps !== null ||
        filled(profile.foodPreferences) ||
        filled(profile.foodAversions)
      );
    case 'health':
      return (
        filled(profile.allergies) || filled(profile.medications) || filled(profile.previousInjuries)
      );
    case 'start':
      return profile.onboardingStatus === 'Completed';
  }
}

/** Where a person who left half way picks up: the first step the saved profile does not finish. */
export function firstOpenStep(profile: ClientIntakeProfile): IntakeStepId {
  return INTAKE_STEPS.find((step) => !isStepDone(step, profile)) ?? 'start';
}

// ---------- checking ----------

export type IntakeErrors = Record<string, string[]>;

export interface IntakeCheck {
  /** Today in the coaching space's own time zone, for the adult rule and the weighing day. */
  today: IsoDate;
  /**
   * Whether the date of birth, the height and a goal must be there. True for a person finishing
   * setting up and for any profile already finished; false while a coach prefills what they know.
   */
  required: boolean;
}

const STEPS = { min: 0, max: 100_000 } as const;

function tooLong(errors: IntakeErrors, field: string, value: string, limit: number): void {
  if (value.trim().length > limit) {
    const count = new Intl.NumberFormat('en').format(limit);
    errors[field] = [$localize`Keep it to ${count}:count: characters.`];
  }
}

/** Centimetres in a typed height, for the server's 50 to 300 cm rule. */
export function heightCentimeters(value: number, unit: LengthUnit): number {
  return lengthCentimeters(value, unit);
}

export { weightKilograms };

function range(low: number, high: number, locale = 'en'): string {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return $localize`${number.format(low)}:low: and ${number.format(high)}:high:`;
}

export function stepErrors(
  step: IntakeStepId,
  values: IntakeValues,
  check: IntakeCheck,
): IntakeErrors {
  const errors: IntakeErrors = {};
  switch (step) {
    case 'about': {
      const first = values.firstName.trim();
      if (first === '') errors['firstName'] = [$localize`Enter a first name.`];
      else tooLong(errors, 'firstName', first, 100);
      const last = values.lastName.trim();
      if (last === '') errors['lastName'] = [$localize`Enter a last name.`];
      else tooLong(errors, 'lastName', last, 100);
      tooLong(errors, 'phoneNumber', values.phoneNumber, 32);
      Object.assign(errors, birthDateErrors(values, check));
      Object.assign(errors, heightErrors(values, check));
      break;
    }
    case 'goal':
      if (check.required && values.goals.trim() === '') {
        errors['goals'] = [$localize`Write at least one goal, even a short one.`];
      } else {
        tooLong(errors, 'goals', values.goals, 4000);
      }
      tooLong(errors, 'trainingBackground', values.trainingBackground, 4000);
      break;
    case 'life': {
      tooLong(errors, 'workType', values.workType, 200);
      const steps = values.averageDailySteps;
      if (steps !== null && (!Number.isInteger(steps) || steps < STEPS.min || steps > STEPS.max)) {
        errors['averageDailySteps'] = [
          $localize`Use a whole number from 0 to 100,000, or leave it empty.`,
        ];
      }
      tooLong(errors, 'foodPreferences', values.foodPreferences, 4000);
      tooLong(errors, 'foodAversions', values.foodAversions, 4000);
      break;
    }
    case 'health':
      tooLong(errors, 'allergies', values.allergies, 4000);
      tooLong(errors, 'medications', values.medications, 4000);
      tooLong(errors, 'previousInjuries', values.previousInjuries, 4000);
      break;
    case 'start':
      Object.assign(errors, weightErrors(values, check));
      break;
  }
  return errors;
}

function birthDateErrors(values: IntakeValues, check: IntakeCheck): IntakeErrors {
  switch (values.birthStatus) {
    case 'incomplete':
      return { birthDate: [$localize`Enter the day, month and year, or leave all three empty.`] };
    case 'invalid':
      return { birthDate: [$localize`That day does not exist. Check the day and the month.`] };
    case 'empty':
      return check.required
        ? { birthDate: [$localize`Enter a date of birth: day, month and year.`] }
        : {};
    case 'valid':
      if (!isIsoDate(values.birthDate)) return {};
      if (values.birthDate > adultCutoff(check.today)) {
        return { birthDate: [$localize`Clients have to be 18 or older.`] };
      }
      if (values.birthDate < addYears(check.today, -120)) {
        return { birthDate: [$localize`Check the year: that is more than 120 years ago.`] };
      }
      return {};
  }
}

function heightErrors(values: IntakeValues, check: IntakeCheck): IntakeErrors {
  const height = values.heightValue;
  if (height === null) {
    return check.required ? { heightValue: [$localize`Enter a height.`] } : {};
  }
  const centimeters = heightCentimeters(height, values.heightUnit);
  if (!Number.isFinite(centimeters) || centimeters < HEIGHT_CM.min || centimeters > HEIGHT_CM.max) {
    return {
      heightValue:
        values.heightUnit === 'Inch'
          ? [
              $localize`Height has to be between ${range(
                Math.ceil((HEIGHT_CM.min / CENTIMETERS_PER_INCH) * 10) / 10,
                Math.floor((HEIGHT_CM.max / CENTIMETERS_PER_INCH) * 10) / 10,
              )}:range: inches.`,
            ]
          : [$localize`Height has to be between ${range(HEIGHT_CM.min, HEIGHT_CM.max)}:range: cm.`],
    };
  }
  return {};
}

function weightErrors(values: IntakeValues, check: IntakeCheck): IntakeErrors {
  const errors: IntakeErrors = {};
  const weight = values.weightValue;
  if (weight === null) {
    errors['weightValue'] = [$localize`Enter a weight.`];
  } else {
    const kilograms = weightKilograms(weight, values.weightUnit);
    if (!Number.isFinite(kilograms) || kilograms < WEIGHT_KG.min || kilograms > WEIGHT_KG.max) {
      errors['weightValue'] =
        values.weightUnit === 'Pound'
          ? [
              $localize`Weight has to be between ${range(
                Math.ceil((WEIGHT_KG.min / POUNDS_TO_KILOGRAMS) * 10) / 10,
                Math.floor((WEIGHT_KG.max / POUNDS_TO_KILOGRAMS) * 10) / 10,
              )}:range: lb.`,
            ]
          : [$localize`Weight has to be between ${range(WEIGHT_KG.min, WEIGHT_KG.max)}:range: kg.`];
    }
  }
  if (!isIsoDate(values.weighedOn)) errors['weighedOn'] = [$localize`Choose the day you weighed.`];
  else if (values.weighedOn > check.today) {
    errors['weighedOn'] = [
      $localize`That day has not happened yet. Choose today or an earlier day.`,
    ];
  }
  return errors;
}

/** Every check of the groups in `steps`, for a sheet or a whole profile. */
export function allErrors(
  steps: readonly IntakeStepId[],
  values: IntakeValues,
  check: IntakeCheck,
): IntakeErrors {
  return steps.reduce<IntakeErrors>(
    (all, step) => ({ ...all, ...stepErrors(step, values, check) }),
    {},
  );
}

// ---------- what is sent ----------

function textOrNull(value: string): string | null {
  const text = value.trim();
  return text === '' ? null : text;
}

/** The whole intake the server takes on every save; `version` is the profile version last read. */
export function toUpdateRequest(values: IntakeValues, version: number): UpdateClientIntakeRequest {
  const hasHeight = values.heightValue !== null;
  return {
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    phoneNumber: textOrNull(values.phoneNumber),
    birthDate: values.birthDate === '' ? null : values.birthDate,
    heightValue: hasHeight ? values.heightValue : null,
    heightUnit: hasHeight ? values.heightUnit : null,
    workType: textOrNull(values.workType),
    averageDailySteps: values.averageDailySteps,
    trainingBackground: textOrNull(values.trainingBackground),
    foodPreferences: textOrNull(values.foodPreferences),
    foodAversions: textOrNull(values.foodAversions),
    goals: textOrNull(values.goals),
    allergies: textOrNull(values.allergies),
    medications: textOrNull(values.medications),
    previousInjuries: textOrNull(values.previousInjuries),
    version,
  };
}

/** The request that finishes setting up, or null while the starting weight is still missing. */
export function toCompleteRequest(
  values: IntakeValues,
  version: number,
): CompleteClientOnboardingRequest | null {
  if (values.weightValue === null) return null;
  return {
    intake: toUpdateRequest(values, version),
    initialBodyweightValue: values.weightValue,
    initialBodyweightUnit: values.weightUnit,
    measurementDate: values.weighedOn,
  };
}

// ---------- what the summary shows ----------

export interface AnswerRow {
  readonly key: string;
  readonly label: string;
  /** What was answered, or null when nothing was. */
  readonly value: string | null;
  /** Long free text, shown on its own line and kept with its line breaks. */
  readonly longText: boolean;
}

export function unitWords(unit: LengthUnit): string {
  return unit === 'Inch' ? $localize`in` : $localize`cm`;
}

/** "14 Mar 1994": a calendar day with its year, as the app writes one (audit COACH-6), never "Mar 14, 1994". */
function longDate(date: string, locale: string): string {
  return formatDate(date, 'd MMM y', locale);
}

/** The answers of one group as the summary lists them: a label and a value, or nothing. */
export function answerRows(
  profile: ClientIntakeProfile,
  group: IntakeGroup,
  locale: string,
): AnswerRow[] {
  const text = (key: string, label: string, value: string | null): AnswerRow => ({
    key,
    label,
    value: (value ?? '').trim() === '' ? null : value!.trim(),
    longText: true,
  });
  const short = (key: string, label: string, value: string | null): AnswerRow => ({
    ...text(key, label, value),
    longText: false,
  });
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  switch (group) {
    case 'about':
      return [
        short('name', $localize`Name`, `${profile.firstName} ${profile.lastName}`.trim()),
        short('email', $localize`Email`, profile.email),
        short('phoneNumber', $localize`Phone number`, profile.phoneNumber),
        short(
          'birthDate',
          $localize`Date of birth`,
          profile.birthDate ? longDate(profile.birthDate, locale) : null,
        ),
        short(
          'height',
          $localize`Height`,
          profile.heightEnteredValue !== null && profile.heightEnteredUnit
            ? `${number.format(profile.heightEnteredValue)} ${unitWords(profile.heightEnteredUnit)}`
            : null,
        ),
      ];
    case 'goal':
      return [
        text('goals', $localize`Goals`, profile.goals),
        text('trainingBackground', $localize`Training background`, profile.trainingBackground),
      ];
    case 'life':
      return [
        short('workType', $localize`Work`, profile.workType),
        short(
          'averageDailySteps',
          $localize`Average daily steps`,
          profile.averageDailySteps === null
            ? null
            : new Intl.NumberFormat(locale).format(profile.averageDailySteps),
        ),
        text('foodPreferences', $localize`Favorite foods`, profile.foodPreferences),
        text('foodAversions', $localize`Foods to avoid`, profile.foodAversions),
      ];
    case 'health':
      return [
        text('allergies', $localize`Allergies`, profile.allergies),
        text('medications', $localize`Medications`, profile.medications),
        text('previousInjuries', $localize`Previous injuries`, profile.previousInjuries),
      ];
  }
}
