import { HttpErrorResponse } from '@angular/common/http';
import { formatDate } from '@angular/common';
import { apiErrorMessage } from '../../core/api/api-error';
import type { ClientEnrollment } from '../../core/api/api.models';
import type {
  AssignMesocycleRequest,
  ProgramTemplateSummary,
  ProgramTemplateVersionView,
  ProgressionPreviewView,
  StrengthMaxView,
  TrainingLoadRoundingMode,
  TrainingLoadUnit,
} from '../../core/api/generated';
import { exerciseLines, type ExerciseLine } from './client-program.models';
import { addDays } from './client-overview.models';

/**
 * What the Training section's sheets and dialogs ask of a coach, and what they say back. These are
 * only checks that save a round trip and the words for what the server may answer; the server
 * decides every one of them again (coverage, overlap, who may change what).
 */

// ------------------------------------------------------------------------------------------------
// Choosing a plan and a program
// ------------------------------------------------------------------------------------------------

export interface PlanChoice {
  readonly id: string;
  /** "Online Coaching · 12 weeks · 1 Sep – 23 Nov 2026". */
  readonly label: string;
  readonly startDate: string;
  /** The last day the plan covers. */
  readonly lastDay: string;
}

/**
 * The plans a program can be assigned under: they include training and are neither cancelled nor
 * over. A plan whose last day has passed counts as over even before the system marks it so.
 */
export function planChoices(
  enrollments: readonly ClientEnrollment[],
  locale: string,
): PlanChoice[] {
  return enrollments
    .filter(
      (enrollment) =>
        enrollment.features.includes('Training') &&
        enrollment.effectiveStatus !== 'Cancelled' &&
        enrollment.effectiveStatus !== 'Expired',
    )
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((enrollment) => ({
      id: enrollment.id,
      label: `${enrollment.productName} · ${enrollment.offerLabel} · ${formatDate(enrollment.startDate, 'd MMM', locale)} – ${formatDate(enrollment.lastActiveDate, 'd MMM y', locale)}`,
      startDate: enrollment.startDate,
      lastDay: enrollment.lastActiveDate,
    }));
}

export interface ProgramChoice {
  /** The published version to assign. */
  readonly versionId: string;
  readonly label: string;
  readonly weekCount: number;
}

/**
 * The programs a coach can assign: each template once, at its newest published version. Older
 * versions stay in history; offering them beside it read as "v1" and "v2" (plan §6).
 */
export function programChoices(templates: readonly ProgramTemplateSummary[]): ProgramChoice[] {
  const choices: ProgramChoice[] = [];
  for (const template of templates) {
    if (template.isArchived) continue;
    const latest = template.versions
      .filter((version) => version.isPublished)
      .sort((a, b) => Number(b.versionNumber) - Number(a.versionNumber))[0];
    if (!latest) continue;
    const weeks = Number(latest.weekCount);
    choices.push({
      versionId: latest.id,
      label:
        weeks === 1
          ? $localize`${template.name}:name: · 1 week`
          : $localize`${template.name}:name: · ${weeks}:weeks: weeks`,
      weekCount: weeks,
    });
  }
  return choices.sort((a, b) => a.label.localeCompare(b.label));
}

/** Today, or the day a plan that has not begun starts: nothing can be assigned before it. */
export function defaultStartDate(today: string, plan: PlanChoice | undefined): string {
  return plan && plan.startDate > today ? plan.startDate : today;
}

export interface RunSummary {
  /** "Runs Mon 12 Oct – Sun 22 Nov". */
  readonly text: string;
  /** The program would run past the last day of the plan. */
  readonly pastPlanEnd: boolean;
}

/** The last day of a program of `weeks` weeks starting on `start`. */
export function lastDayOf(start: string, weeks: number): string {
  return addDays(start, weeks * 7 - 1);
}

export function runSummary(
  start: string,
  weeks: number,
  planLastDay: string | null,
  locale: string,
): RunSummary | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || weeks < 1) return null;
  const last = lastDayOf(start, weeks);
  return {
    text: $localize`Runs ${formatDate(start, 'EEE d MMM', locale)}:from: – ${formatDate(last, 'EEE d MMM', locale)}:to:`,
    pastPlanEnd: planLastDay !== null && last > planLastDay,
  };
}

// ------------------------------------------------------------------------------------------------
// Training maxes
// ------------------------------------------------------------------------------------------------

export interface MaxRow {
  readonly exerciseId: string;
  readonly name: string;
  readonly value: number | null;
  readonly unit: TrainingLoadUnit;
  /** The recorded max this value came from; null once the coach typed their own. */
  readonly sourceRecordId: string | null;
}

/**
 * The exercises whose load is worked out from a training max: a share of it, or an effort target.
 * Only these need a number before the program can be assigned.
 */
export function exercisesNeedingMax(
  version: ProgramTemplateVersionView,
): { exerciseId: string; name: string }[] {
  const needed = new Map<string, string>();
  for (const week of version.weeks) {
    for (const session of week.sessions) {
      for (const exercise of session.exercises) {
        if (
          exercise.sets.some(
            (set) =>
              set.loadStrategy === 'PercentageWorkingMax' ||
              set.loadStrategy === 'RpeBasedEpley' ||
              set.loadStrategy === 'RpeChart',
          )
        ) {
          needed.set(exercise.exerciseId, exercise.exerciseName);
        }
      }
    }
  }
  return [...needed].map(([exerciseId, name]) => ({ exerciseId, name }));
}

/** The latest training max recorded in this unit, else the latest of any kind in it. */
export function maxRow(
  need: { exerciseId: string; name: string },
  history: readonly StrengthMaxView[],
  unit: TrainingLoadUnit,
): MaxRow {
  const matching = history.filter(
    (item) => item.exerciseId === need.exerciseId && item.unit === unit,
  );
  const source = matching.find((item) => item.kind === 'CoachWorkingMax') ?? matching[0];
  return {
    exerciseId: need.exerciseId,
    name: need.name,
    value: source ? Number(source.value) : null,
    unit,
    sourceRecordId: source?.id ?? null,
  };
}

// ------------------------------------------------------------------------------------------------
// Assigning a program
// ------------------------------------------------------------------------------------------------

export interface AssignmentValues {
  enrollmentId: string;
  templateVersionId: string;
  startDate: string;
  loadUnit: TrainingLoadUnit;
  loadIncrement: number | null;
  loadRoundingMode: TrainingLoadRoundingMode;
  maxes: readonly MaxRow[];
}

/** Messages by field, only for the fields that are wrong. A max is `max:<exercise id>`. */
export type FieldMessages = Record<string, string[]>;

export function assignmentErrors(values: AssignmentValues): FieldMessages {
  const errors: FieldMessages = {};
  if (!values.enrollmentId) errors['enrollmentId'] = [$localize`Choose a plan.`];
  if (!values.templateVersionId) errors['templateVersionId'] = [$localize`Choose a program.`];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.startDate)) {
    errors['startDate'] = [$localize`Choose a start date.`];
  }
  if (values.loadIncrement === null || !(values.loadIncrement > 0)) {
    errors['loadIncrement'] = [$localize`Enter a number above 0, such as 2.5.`];
  }
  for (const row of values.maxes) {
    if (row.value === null || !(row.value > 0)) {
      errors[`max:${row.exerciseId}`] = [
        $localize`Enter the training max for ${row.name}:exercise:.`,
      ];
    }
  }
  return errors;
}

export type AssignmentRequest = Omit<AssignMesocycleRequest, 'idempotencyKey'>;

/** The request, without its idempotency key, which is bound to exactly this payload. */
export function assignmentRequest(values: AssignmentValues): AssignmentRequest {
  return {
    enrollmentId: values.enrollmentId,
    templateVersionId: values.templateVersionId,
    startDate: values.startDate,
    kind: 'Primary',
    loadUnit: values.loadUnit,
    loadIncrement: values.loadIncrement!,
    loadRoundingMode: values.loadRoundingMode,
    workingMaxes: values.maxes.map((row) => ({
      exerciseId: row.exerciseId,
      strengthMaxRecordId: row.sourceRecordId,
      value: row.value!,
      unit: row.unit,
    })),
  };
}

// ------------------------------------------------------------------------------------------------
// Rescheduling, cancelling and adding weeks
// ------------------------------------------------------------------------------------------------

export function rescheduleErrors(date: string): string[] {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? [] : [$localize`Choose the new start date.`];
}

export const CANCEL_REASON_LIMIT = 500;

export function cancelReasonErrors(reason: string): string[] {
  const text = reason.trim();
  if (!text) return [$localize`Say why, so it is on record.`];
  if (text.length > CANCEL_REASON_LIMIT) {
    return [$localize`Keep the reason to ${CANCEL_REASON_LIMIT}:limit: characters or fewer.`];
  }
  return [];
}

export interface ProgressionValues {
  weekIds: readonly string[];
  iterations: number | null;
  rpeIncrement: number | null;
}

/** What to repeat, how many times and how much harder, checked the way the server checks it. */
export function progressionErrors(values: ProgressionValues): string[] {
  const errors: string[] = [];
  if (values.weekIds.length === 0) errors.push($localize`Choose at least one week to build on.`);
  const iterations = values.iterations;
  if (iterations === null || !Number.isInteger(iterations) || iterations < 1 || iterations > 12) {
    errors.push($localize`Add between 1 and 12 weeks.`);
  }
  const step = values.rpeIncrement;
  if (step === null || step < -2 || step > 2 || step * 2 !== Math.trunc(step * 2)) {
    errors.push($localize`The effort change must be between -2 and 2, in steps of 0.5.`);
  }
  return errors;
}

export interface PreviewWeek {
  readonly number: number;
  readonly sessions: readonly {
    readonly name: string;
    readonly exercises: readonly ExerciseLine[];
  }[];
}

/** The weeks a preview would add, as sessions with their exercises. */
export function previewWeeks(
  preview: ProgressionPreviewView,
  unit: TrainingLoadUnit,
  locale: string,
): PreviewWeek[] {
  return preview.generatedWeeks.map((week) => ({
    number: Number(week.weekNumber),
    sessions: week.sessions.map((session) => ({
      name: session.name,
      exercises: exerciseLines(session, unit, locale),
    })),
  }));
}

// ------------------------------------------------------------------------------------------------
// What the server may answer
// ------------------------------------------------------------------------------------------------

const SYSTEM_WORDS = /mesocycle|enrollment|entitlement|template|snapshot|idempotency|primary/i;

function serverText(error: unknown): { code: string | null; text: string | null } {
  if (!(error instanceof HttpErrorResponse)) return { code: null, text: null };
  const body = error.error as
    | { code?: string; message?: string; title?: string; errors?: Record<string, string[]> }
    | null
    | undefined;
  const first = body?.errors ? Object.values(body.errors).flat()[0] : undefined;
  return { code: body?.code ?? null, text: body?.message ?? first ?? body?.title ?? null };
}

/**
 * The words for what a change to a program was answered with. The server's own sentences are about
 * its engine ("the mesocycle overlaps…"), so the ones it is known to send are rewritten for a coach,
 * and anything else that still carries a system word is replaced by `fallback`.
 */
export function programWriteError(error: unknown, fallback: string, name: string): string {
  const { code, text } = serverText(error);
  if (code === 'mesocycle_overlap') {
    return text && text.includes(' from ') && text.includes(' to ')
      ? text
      : $localize`${name}:name: already has a program on those dates. Choose other dates, or change the other program first.`;
  }
  if (code === 'concurrency_conflict') {
    return $localize`This program was changed somewhere else since you opened it. It has been reloaded: check it, then try again.`;
  }
  if (code === 'idempotency_conflict' || code === 'assignment_conflict') {
    return $localize`That clashes with another assignment. Reload the page and try again.`;
  }
  const known = text ? knownSentence(text, name) : null;
  if (known) return known;
  const message = apiErrorMessage(error, fallback);
  return SYSTEM_WORDS.test(message) ? fallback : message;
}

function knownSentence(text: string, name: string): string | null {
  const said = text.toLowerCase();
  if (said.includes('remain inside its training entitlement')) return coverageSentence(name);
  if (said.includes('does not provide usable training entitlement')) {
    return $localize`${name}:name:’s plan doesn’t include training on those dates.`;
  }
  if (said.includes('cannot be rescheduled after a workout starts')) {
    return $localize`The dates can’t move once ${name}:name: has started a workout.`;
  }
  if (said.includes('workout in progress cannot be cancelled')) {
    return $localize`${name}:name: has a workout open right now. Cancel the program once it is finished.`;
  }
  if (said.includes('or the last day must have passed')) {
    return $localize`The program can be closed after its last day, or once every session is done.`;
  }
  if (said.includes('workout in progress cannot be completed')) {
    return $localize`${name}:name: has a workout open right now. Close the program once it is finished.`;
  }
  if (said.includes('cannot be completed before it starts')) {
    return $localize`A program that hasn’t started can’t be closed.`;
  }
  if (said.includes('history is immutable')) {
    return $localize`A completed or cancelled program can’t be changed.`;
  }
  if (
    said.includes('historical sessions cannot be reprogrammed') ||
    said.includes('already started')
  ) {
    return $localize`That session has already begun, so it can’t be swapped.`;
  }
  return null;
}

/** The sentence for a program that would run past the plan, wherever the server says so. */
export function coverageSentence(name: string): string {
  return $localize`These weeks run past the end of ${name}:name:’s plan.`;
}

/** What a preview's `coverageMessage` says, in coach words. */
export function coverageText(message: string | null, name: string): string {
  return message && !SYSTEM_WORDS.test(message) ? message : coverageSentence(name);
}
