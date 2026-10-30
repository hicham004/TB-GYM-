import { formatNumber } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import type {
  EstimateOneRepMaxRequest,
  ExerciseHistoryItem,
  OneRepMaxEstimateView,
  RecordMaxFromSetRequest,
  RecordStrengthMaxRequest,
  StrengthMaxKind,
  StrengthMaxView,
  TrainingLoadUnit,
} from '../../core/api/generated';
import { strengthMaxKindLabel } from '../../core/i18n/display-labels';
import { dayWords } from '../progress/progress-entries.models';
import { unitLabel } from '../training/training-program.models';
import { historySourceWords } from './program-maxes.models';

/**
 * A client's strength history for their coach (C3; R5.3d): every max on record, one lift at a time,
 * and how they have performed one exercise. The server holds the rules (STR-001, STR-015: a max is
 * appended, never changed, and a program's training maxes sit beside the recorded ones). This only
 * groups, words and checks what a form can check before a round trip.
 */

const toNumber = (value: number | string): number => Number(value);

/** The server's limit on a recorded max, in either unit (kilograms and pounds are never converted). */
export const MAX_LOAD = { min: 0, max: 2000 } as const;

/**
 * The most reps a max from a set they did takes (critique B7b, STR-017): the server's Epley v1 reads 12, but an
 * estimate from reps loses accuracy past about 10, so the product asks for 10 or fewer. The server refuses more.
 */
export const SET_REPS = { min: 1, max: 10 } as const;

/**
 * What Record a max offers (critique B7b): a training max or a tested one typed in, or a set they did, whose
 * estimate the server works out. An estimate is never typed (STR-001), so it is not a kind of its own here.
 */
export type MaxChoice = Extract<StrengthMaxKind, 'CoachWorkingMax' | 'TestedOneRepMax'> | 'FromSet';

export const MAX_CHOICES: readonly {
  readonly value: MaxChoice;
  readonly label: string;
  readonly hint: string;
}[] = [
  {
    value: 'CoachWorkingMax',
    label: $localize`Training max`,
    hint: $localize`The number a program’s percentages use; 5/3/1-style programs set it at 85 to 90% of the best single, others use the single itself.`,
  },
  {
    value: 'TestedOneRepMax',
    label: $localize`Tested 1RM`,
    hint: $localize`The heaviest single they actually lifted, on that day.`,
  },
  {
    value: 'FromSet',
    label: $localize`From a set they did`,
    hint: $localize`Its weight × reps, up to 10 reps; their 1RM is worked out from it.`,
  },
];

// ------------------------------------------------------------------------------------------------
// Every max on record
// ------------------------------------------------------------------------------------------------

export interface MaxEntry {
  readonly id: string;
  readonly exerciseId: string;
  readonly exerciseName: string;
  readonly kind: StrengthMaxKind;
  readonly kindLabel: string;
  readonly value: number;
  readonly unit: TrainingLoadUnit;
  /** The day the max was true, never the day it was typed in. */
  readonly date: string;
  readonly createdAtUtc: string;
  /** Where it came from, in words: a program and its week, a set they did, or how a coach recorded it. */
  readonly source: string;
  readonly note: string | null;
  /** The estimate a training max was set from in the same save (STR-017), so it reads right above it. */
  readonly derivedFrom: string | null;
}

/** Maps one row of the history; `locale` words the numbers in where it came from. */
export function mapMax(view: StrengthMaxView, locale = 'en'): MaxEntry {
  return {
    id: view.id,
    exerciseId: view.exerciseId,
    exerciseName: view.exerciseName,
    kind: view.kind,
    kindLabel: strengthMaxKindLabel(view.kind),
    value: toNumber(view.value),
    unit: view.unit,
    date: view.effectiveDate,
    createdAtUtc: view.createdAtUtc,
    source: historySourceWords(view, locale),
    note: view.note,
    derivedFrom: view.fromEstimate?.estimateId ?? null,
  };
}

export function valueWords(value: number, unit: TrainingLoadUnit, locale = 'en'): string {
  return `${formatNumber(value, locale, '1.0-2')} ${unitLabel(unit)}`;
}

/**
 * One lift: the max a program works from (its newest training max, else its newest max of any kind),
 * how that one has moved, the newest max of each other kind beside it, and every max, newest first.
 */
export interface Lift {
  readonly exerciseId: string;
  readonly name: string;
  readonly entries: readonly MaxEntry[];
  readonly latest: MaxEntry;
  /** The newest tested or estimated max, when the lift has one besides the headline. */
  readonly also: readonly MaxEntry[];
  /** The max before the latest of the same kind and unit, when there is one. */
  readonly previous: MaxEntry | null;
  /** Oldest first, for the small chart; null without two of the same kind and unit. */
  readonly series: readonly number[] | null;
}

const newestFirst = (a: MaxEntry, b: MaxEntry) =>
  b.date.localeCompare(a.date) ||
  b.createdAtUtc.localeCompare(a.createdAtUtc) ||
  // Saved together, a training max set from an estimate reads above the estimate it was made from.
  (a.derivedFrom === b.id ? -1 : b.derivedFrom === a.id ? 1 : 0);

/** Lifts with the most recent change first, so what moved lately is on top. */
export function groupLifts(entries: readonly MaxEntry[]): Lift[] {
  const byExercise = new Map<string, MaxEntry[]>();
  for (const entry of entries) {
    byExercise.set(entry.exerciseId, [...(byExercise.get(entry.exerciseId) ?? []), entry]);
  }
  return [...byExercise.values()]
    .map((list) => {
      const sorted = [...list].sort(newestFirst);
      const latest = sorted.find((item) => item.kind === 'CoachWorkingMax') ?? sorted[0];
      const same = sorted.filter((item) => item.kind === latest.kind && item.unit === latest.unit);
      const also = (['TestedOneRepMax', 'EstimatedOneRepMax'] as const)
        .filter((kind) => kind !== latest.kind)
        .map((kind) => sorted.find((item) => item.kind === kind))
        .filter((item): item is MaxEntry => item !== undefined)
        .sort(newestFirst);
      return {
        exerciseId: latest.exerciseId,
        name: latest.exerciseName,
        entries: sorted,
        latest,
        also,
        previous: same[1] ?? null,
        series: same.length >= 2 ? [...same].reverse().map((item) => item.value) : null,
      };
    })
    .sort((a, b) => newestFirst(a.entries[0], b.entries[0]) || a.name.localeCompare(b.name));
}

/** "+2.5 kg since Tue 15 Sep", or "−5 kg since …"; null when there is nothing to compare. */
export function changeWords(lift: Lift, today: string, locale: string): string | null {
  const previous = lift.previous;
  if (!previous) return null;
  const delta = Math.round((lift.latest.value - previous.value) * 1000) / 1000;
  const since = dayWords(previous.date, today, locale);
  if (delta === 0) return $localize`Unchanged since ${since}:day:`;
  const amount = formatNumber(Math.abs(delta), locale, '1.0-2');
  const sign = delta > 0 ? '+' : '−';
  return $localize`${sign}:sign:${amount}:amount: ${unitLabel(lift.latest.unit)}:unit: since ${since}:day:`;
}

/** The spoken summary of a lift's small chart. */
export function liftSummary(lift: Lift, today: string, locale: string): string {
  const same = lift.entries.filter(
    (item) => item.kind === lift.latest.kind && item.unit === lift.latest.unit,
  );
  const first = same[same.length - 1];
  const kind = lift.latest.kindLabel;
  const last = valueWords(lift.latest.value, lift.latest.unit, locale);
  if (same.length < 2) return $localize`${lift.name}:lift: ${kind}:kind: is ${last}:last:.`;
  const from = valueWords(first.value, first.unit, locale);
  const day = dayWords(first.date, today, locale);
  // Said as the visible line says it: a number that has not moved is "unchanged", never "moved from 25 to 25".
  if (same.every((item) => sameValue(item.value, lift.latest.value))) {
    return $localize`${lift.name}:lift: ${kind}:kind: is ${last}:last:, unchanged since ${day}:day:.`;
  }
  if (sameValue(first.value, lift.latest.value)) {
    return $localize`${lift.name}:lift: ${kind}:kind: is back to ${last}:last:, where it was on ${day}:day:.`;
  }
  return $localize`${lift.name}:lift: ${kind}:kind: has moved from ${from}:first: on ${day}:day: to ${last}:last:.`;
}

/** Two maxes are the same at the three decimals the server keeps, as `changeWords` compares them. */
function sameValue(a: number, b: number): boolean {
  return Math.round((a - b) * 1000) === 0;
}

// ------------------------------------------------------------------------------------------------
// Recording a max
// ------------------------------------------------------------------------------------------------

export interface MaxValues {
  exerciseId: string | null;
  kind: MaxChoice;
  /** The max typed, or the weight of the set they did. */
  value: number | null;
  /** The reps of the set they did; only a set has them. */
  repetitions: number | null;
  unit: TrainingLoadUnit;
  date: string;
  note: string;
  /** Whether a set's estimate also sets their training max at 90% of it (TrainingMaxShare v1). */
  alsoTrainingMax: boolean;
}

export type MaxField = 'exercise' | 'value' | 'repetitions' | 'date';

export function maxErrors(values: MaxValues, today: string): Record<MaxField, string[]> {
  const errors: Record<MaxField, string[]> = { exercise: [], value: [], repetitions: [], date: [] };
  const fromSet = values.kind === 'FromSet';
  if (values.exerciseId === null) errors.exercise.push($localize`Choose the exercise.`);
  if (values.value === null || !Number.isFinite(values.value)) {
    errors.value.push($localize`Enter the weight.`);
  } else if (values.value <= MAX_LOAD.min || values.value > MAX_LOAD.max) {
    errors.value.push(
      fromSet
        ? $localize`The weight has to be more than 0 and at most 2,000 ${unitLabel(values.unit)}:unit:.`
        : $localize`A max has to be more than 0 and at most 2,000 ${unitLabel(values.unit)}:unit:.`,
    );
  }
  if (fromSet) {
    const reps = values.repetitions;
    if (reps === null || !Number.isFinite(reps)) {
      errors.repetitions.push($localize`Enter the reps.`);
    } else if (!Number.isInteger(reps) || reps < SET_REPS.min || reps > SET_REPS.max) {
      errors.repetitions.push(
        $localize`From 1 to 10 reps: past 10, an estimate from reps is too rough to use.`,
      );
    }
  }
  if (!values.date) {
    errors.date.push(
      fromSet ? $localize`Choose the day they did it.` : $localize`Choose the day it was true.`,
    );
  } else if (values.date > today) {
    errors.date.push(
      fromSet
        ? $localize`A set they did is from today or a day that has passed.`
        : $localize`A max can be recorded for today or a day that has passed.`,
    );
  }
  return errors;
}

export function maxProblems(errors: Record<MaxField, readonly string[]>): number {
  return (
    errors.exercise.length + errors.value.length + errors.repetitions.length + errors.date.length
  );
}

const noteOrNull = (note: string): string | null => (note.trim() === '' ? null : note.trim());

/** Recorded by hand, so its source is a coach entry; the server names the method itself. */
export function recordRequest(
  values: MaxValues & { kind: Exclude<MaxChoice, 'FromSet'> },
): RecordStrengthMaxRequest {
  return {
    exerciseId: values.exerciseId!,
    kind: values.kind,
    value: values.value!,
    unit: values.unit,
    effectiveDate: values.date,
    source: 'Manual',
    methodKey: null,
    methodVersion: null,
    sourceWorkoutExecutionId: null,
    note: noteOrNull(values.note),
  };
}

/** A set they did: the server works the estimate out from it, and the training max when asked (STR-017). */
export function fromSetRequest(values: MaxValues): RecordMaxFromSetRequest {
  return {
    exerciseId: values.exerciseId!,
    load: values.value!,
    repetitions: values.repetitions!,
    unit: values.unit,
    effectiveDate: values.date,
    alsoSetTrainingMax: values.alsoTrainingMax,
    note: noteOrNull(values.note),
  };
}

/**
 * What the server's calculator is asked for a set while the coach types (INV-9), or null while the weight or
 * the reps cannot make an estimate yet. Nothing is worked out in the browser.
 */
export function estimateRequest(
  values: Pick<MaxValues, 'value' | 'repetitions' | 'unit'>,
): EstimateOneRepMaxRequest | null {
  const { value, repetitions } = values;
  if (value === null || !Number.isFinite(value) || value <= MAX_LOAD.min || value > MAX_LOAD.max) {
    return null;
  }
  if (
    repetitions === null ||
    !Number.isInteger(repetitions) ||
    repetitions < SET_REPS.min ||
    repetitions > SET_REPS.max
  ) {
    return null;
  }
  return { load: value, repetitions, unit: values.unit, methodKey: 'Epley' };
}

/** The server's estimate for a set, in the sheet's words. */
export interface SetEstimate {
  /** "116.67 kg" */
  readonly estimate: string;
  /** The server's own sentence: "Epley v1: 100 kg × (1 + 5 / 30) = 116.667 kg." */
  readonly explanation: string;
  /** "105 kg", what "Also set their training max at 90%" records; null past what a max can be. */
  readonly trainingMax: string | null;
  /** A max is at most 2,000: past it the save is refused, so the sheet says so first. */
  readonly tooHeavy: boolean;
}

export function setEstimate(view: OneRepMaxEstimateView, locale = 'en'): SetEstimate {
  const estimate = toNumber(view.estimate);
  const trainingMax = view.trainingMax ? toNumber(view.trainingMax.value) : null;
  return {
    estimate: valueWords(estimate, view.unit, locale),
    explanation: view.explanation,
    trainingMax: trainingMax === null ? null : valueWords(trainingMax, view.unit, locale),
    tooHeavy: estimate > MAX_LOAD.max,
  };
}

/** The toast once a max is recorded: one entry, or a set's estimate and the training max set from it. */
export function recordedWords(entries: readonly MaxEntry[], locale = 'en'): string {
  const [first, second] = entries;
  if (second) {
    return $localize`${first.exerciseName}:lift: — Estimated 1RM ${valueWords(first.value, first.unit, locale)}:estimate: and training max ${valueWords(second.value, second.unit, locale)}:trainingMax: recorded.`;
  }
  return $localize`${first.exerciseName}:lift: — ${first.kindLabel}:kind: ${valueWords(first.value, first.unit, locale)}:value: recorded.`;
}

/** What a refused recording means for the coach. */
export function recordRefusal(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 404) {
      return $localize`That exercise is no longer in your library, or this client is no longer yours to change.`;
    }
    const body = error.error as { errors?: Record<string, string[]>; message?: string } | null;
    const first = body?.message ?? Object.values(body?.errors ?? {}).flat()[0];
    if (first) {
      const text = first.replace(/\s*\(Parameter '[^']*'\)\s*$/, '').trim();
      if (/load must be greater than zero/i.test(text)) {
        return $localize`A max has to be more than 0 and at most 2,000.`;
      }
      return text;
    }
  }
  return fallback;
}

// ------------------------------------------------------------------------------------------------
// How they have performed one exercise
// ------------------------------------------------------------------------------------------------

export interface Performance {
  readonly key: string;
  readonly date: string;
  /** "60 kg × 5", or "5 reps" when no load was logged. */
  readonly set: string;
  /** "RPE 8" or "RIR 2" when the set had one. */
  readonly effort: string | null;
  readonly estimate: number | null;
  /**
   * What read the estimate (TRAIN-4): the RTS chart for a set with an RPE it covers, the number the
   * Training maxes panel gives the same set, else Epley.
   */
  readonly formula: 'RpeChart' | 'Epley' | null;
  readonly unit: TrainingLoadUnit | null;
  readonly volume: number | null;
  readonly substituted: boolean;
  readonly note: string | null;
}

export function mapPerformance(item: ExerciseHistoryItem, index: number): Performance {
  const load = item.load === null ? null : toNumber(item.load);
  const reps = item.repetitions === null ? null : toNumber(item.repetitions);
  const unit = item.loadUnit;
  let set: string;
  if (load !== null && reps !== null && unit) {
    set = $localize`${valueWords(load, unit)}:load: × ${reps}:reps:`;
  } else if (reps !== null) {
    set = $localize`${reps}:reps: reps`;
  } else {
    set = '—';
  }
  const rpe = item.rpe === null ? null : toNumber(item.rpe);
  const rir = item.rir === null ? null : toNumber(item.rir);
  return {
    key: `${item.workoutExecutionId}:${item.date}:${index}`,
    date: item.date,
    set,
    effort:
      rpe !== null ? $localize`RPE ${rpe}:rpe:` : rir !== null ? $localize`RIR ${rir}:rir:` : null,
    estimate: item.estimatedOneRepMax === null ? null : toNumber(item.estimatedOneRepMax),
    formula:
      item.estimatedOneRepMax === null
        ? null
        : item.estimateMethodKey === 'RpeChart'
          ? 'RpeChart'
          : item.estimateMethodKey === 'Epley'
            ? 'Epley'
            : null,
    unit,
    volume: item.volume === null ? null : toNumber(item.volume),
    substituted: item.wasSubstituted,
    note: item.note && item.note.trim() !== '' ? item.note.trim() : null,
  };
}

export interface PerformanceSummary {
  /** The best estimated max, with the day and unit; null when no set had one. */
  readonly best: { value: number; unit: TrainingLoadUnit; date: string } | null;
  /** Estimated maxes, oldest first, in one unit only; null when fewer than two. */
  readonly series: readonly number[] | null;
  readonly last: string | null;
  readonly count: number;
}

/**
 * The shape of the history, worked from the rows as they are: a chart needs one unit (kilograms and
 * pounds are never converted), so a mixed history keeps its best figure and its list but draws none.
 */
export function summarize(rows: readonly Performance[]): PerformanceSummary {
  const estimated = rows.filter(
    (row): row is Performance & { estimate: number; unit: TrainingLoadUnit } =>
      row.estimate !== null && row.unit !== null,
  );
  let best: PerformanceSummary['best'] = null;
  for (const row of estimated) {
    if (best === null || (row.unit === best.unit && row.estimate > best.value)) {
      best = { value: row.estimate, unit: row.unit, date: row.date };
    }
  }
  const unit = estimated[0]?.unit;
  const oneUnit = estimated.every((row) => row.unit === unit);
  const ordered = [...estimated].sort((a, b) => a.date.localeCompare(b.date));
  return {
    best,
    series: oneUnit && ordered.length >= 2 ? ordered.map((row) => row.estimate) : null,
    last: rows.length > 0 ? [...rows].sort((a, b) => b.date.localeCompare(a.date))[0].date : null,
    count: rows.length,
  };
}
