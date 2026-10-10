import { formatNumber } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import type {
  ExerciseHistoryItem,
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

/** The kinds a coach may record by hand: an estimate only ever comes from a calculation or a set. */
export const RECORDABLE_KINDS: readonly {
  readonly value: Extract<StrengthMaxKind, 'CoachWorkingMax' | 'TestedOneRepMax'>;
  readonly label: string;
  readonly hint: string;
}[] = [
  {
    value: 'CoachWorkingMax',
    label: $localize`Training max`,
    hint: $localize`The number a program works its percentages from.`,
  },
  {
    value: 'TestedOneRepMax',
    label: $localize`Tested 1RM`,
    hint: $localize`The heaviest single they lifted when it was tested.`,
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
  /** Where it came from, in words: a program and its week, or how a coach recorded it. */
  readonly source: string;
  readonly note: string | null;
}

export function mapMax(view: StrengthMaxView): MaxEntry {
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
    source: historySourceWords(view),
    note: view.note,
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
  b.date.localeCompare(a.date) || b.createdAtUtc.localeCompare(a.createdAtUtc);

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
  return $localize`${lift.name}:lift: ${kind}:kind: has moved from ${from}:first: on ${day}:day: to ${last}:last:.`;
}

// ------------------------------------------------------------------------------------------------
// Recording a max
// ------------------------------------------------------------------------------------------------

export interface MaxValues {
  exerciseId: string | null;
  kind: Extract<StrengthMaxKind, 'CoachWorkingMax' | 'TestedOneRepMax'>;
  value: number | null;
  unit: TrainingLoadUnit;
  date: string;
  note: string;
}

export type MaxField = 'exercise' | 'value' | 'date';

export function maxErrors(values: MaxValues, today: string): Record<MaxField, string[]> {
  const errors: Record<MaxField, string[]> = { exercise: [], value: [], date: [] };
  if (values.exerciseId === null) errors.exercise.push($localize`Choose the exercise.`);
  if (values.value === null || !Number.isFinite(values.value)) {
    errors.value.push($localize`Enter the weight.`);
  } else if (values.value <= MAX_LOAD.min || values.value > MAX_LOAD.max) {
    errors.value.push(
      $localize`A max has to be more than 0 and at most 2,000 ${unitLabel(values.unit)}:unit:.`,
    );
  }
  if (!values.date) {
    errors.date.push($localize`Choose the day it was true.`);
  } else if (values.date > today) {
    errors.date.push($localize`A max can be recorded for today or a day that has passed.`);
  }
  return errors;
}

export function maxProblems(errors: Record<MaxField, readonly string[]>): number {
  return errors.exercise.length + errors.value.length + errors.date.length;
}

/** Recorded by hand, so its source is a coach entry; the server names the method itself. */
export function recordRequest(values: MaxValues): RecordStrengthMaxRequest {
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
    note: values.note.trim() === '' ? null : values.note.trim(),
  };
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
