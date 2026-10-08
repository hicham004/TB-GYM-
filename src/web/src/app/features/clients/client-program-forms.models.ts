import { HttpErrorResponse } from '@angular/common/http';
import { formatDate } from '@angular/common';
import { apiErrorMessage } from '../../core/api/api-error';
import type { ClientEnrollment } from '../../core/api/api.models';
import type {
  AssignMesocycleRequest,
  PreviousProgramMaxesView,
  ProgramTemplateSummary,
  ProgramTemplateVersionView,
  ProgressionPreviewView,
  SetPrescriptionView,
  StrengthMaxView,
  TrainingLoadRoundingMode,
  TrainingLoadUnit,
  TrainingMesocycleView,
  TrainingSessionView,
} from '../../core/api/generated';
import { unitLabel } from '../training/training-program.models';
import { setLines } from './client-program.models';
import { addDays } from './client-overview.models';
import { weekOneAnchor, type WeekOneAnchor } from './program-maxes.models';

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
  /** What the program is called, which a client's copy keeps unless the coach names it. */
  readonly name: string;
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
      name: template.name,
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
  /** How the max is set: a number, or worked out from the weight of week 1's first set (P2). */
  readonly mode: 'number' | 'weekOne';
  /** The weight of week 1's first set, while `mode` is `weekOne`. */
  readonly weekOneWeight: number | null;
  /** The set that weight is for; null when the chart covers none of the lift's week 1 sets. */
  readonly anchor: WeekOneAnchor | null;
  /** The latest program's max this value carries over (STR-014); null once the coach typed their own. */
  readonly carriedFromMaxId?: string | null;
  /** The logged set whose suggestion this value is (STR-014); the server works the number out again. */
  readonly loggedSetId?: string | null;
  /** Where the client's latest program left this lift, in this unit; null when it has none. */
  readonly previous?: PreviousMax | null;
}

/** A lift of the client's latest program: the max it uses now and what its logged sets suggest. */
export interface PreviousMax {
  readonly maxId: string;
  readonly value: number;
  /** The workspace day that max was set. */
  readonly setOn: string;
  readonly programName: string;
  readonly suggestion: {
    readonly value: number;
    readonly loggedSetId: string;
    readonly load: number;
    readonly repetitions: number;
    readonly rpe: number;
  } | null;
}

/** The latest program's lift, when that program weighs in this unit: kilograms and pounds are never converted. */
export function previousMax(
  previous: PreviousProgramMaxesView | null,
  exerciseId: string,
  unit: TrainingLoadUnit,
): PreviousMax | null {
  if (!previous || previous.loadUnit !== unit || !previous.programName) return null;
  const lift = previous.maxes.find((item) => item.exerciseId === exerciseId);
  if (!lift) return null;
  const set = lift.suggestion?.basis.loggedSet;
  return {
    maxId: lift.maxId,
    value: Number(lift.value),
    setOn: lift.setOn,
    programName: previous.programName,
    suggestion:
      lift.suggestion && set
        ? {
            value: Number(lift.suggestion.value),
            loggedSetId: set.setPerformanceId,
            load: Number(lift.suggestion.basis.load),
            repetitions: Number(lift.suggestion.basis.repetitions),
            rpe: Number(lift.suggestion.basis.rpe),
          }
        : null,
  };
}

export interface MaxNeed {
  readonly exerciseId: string;
  readonly name: string;
  readonly anchor?: WeekOneAnchor | null;
}

/**
 * The exercises whose load is worked out from a training max: a share of it, or an effort target.
 * Only these need a number before the program can be assigned.
 */
export function exercisesNeedingMax(version: ProgramTemplateVersionView): MaxNeed[] {
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
  return [...needed].map(([exerciseId, name]) => ({
    exerciseId,
    name,
    anchor: weekOneAnchor(version, exerciseId),
  }));
}

/**
 * Where the new program's max starts: the max the client's latest program uses now (STR-014), unless a
 * training max recorded since is newer; else the latest training max recorded in this unit, else the
 * latest of any kind in it.
 */
export function maxRow(
  need: MaxNeed,
  history: readonly StrengthMaxView[],
  unit: TrainingLoadUnit,
  previous: PreviousProgramMaxesView | null = null,
): MaxRow {
  const matching = history.filter(
    (item) => item.exerciseId === need.exerciseId && item.unit === unit,
  );
  const source = matching.find((item) => item.kind === 'CoachWorkingMax') ?? matching[0];
  const last = previousMax(previous, need.exerciseId, unit);
  const carries = last !== null && (!source || source.effectiveDate <= last.setOn);
  return {
    exerciseId: need.exerciseId,
    name: need.name,
    value: carries ? last.value : source ? Number(source.value) : null,
    unit,
    sourceRecordId: carries ? null : (source?.id ?? null),
    mode: 'number',
    weekOneWeight: null,
    anchor: need.anchor ?? null,
    carriedFromMaxId: carries ? last.maxId : null,
    loggedSetId: null,
    previous: last,
  };
}

/** Takes what the latest program's logged sets suggest; the server works the number out again from the set. */
export function withSuggestedMax(row: MaxRow): MaxRow {
  const suggestion = row.previous?.suggestion;
  return suggestion
    ? {
        ...row,
        mode: 'number',
        value: suggestion.value,
        weekOneWeight: null,
        sourceRecordId: null,
        carriedFromMaxId: null,
        loggedSetId: suggestion.loggedSetId,
      }
    : row;
}

/** A number the coach types is their own: it no longer names a recorded, carried or suggested max. */
export function withTypedMax(row: MaxRow, value: number | null): MaxRow {
  return { ...row, value, sourceRecordId: null, carriedFromMaxId: null, loggedSetId: null };
}

/** Choosing how a max is set clears what the other way held, so only one is ever sent. */
export function withMaxMode(row: MaxRow, mode: MaxRow['mode']): MaxRow {
  return mode === row.mode || (mode === 'weekOne' && row.anchor === null)
    ? row
    : { ...row, mode, weekOneWeight: null, loggedSetId: null };
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
  /** What the client's copy is called; empty keeps the program's own name (TRN-002). */
  name?: string;
}

export const PROGRAM_NAME_LIMIT = 160;

export function programNameErrors(name: string): string[] {
  const text = name.trim();
  if (!text) return [$localize`Give the program a name.`];
  if (text.length > PROGRAM_NAME_LIMIT) {
    return [$localize`Keep the name to ${PROGRAM_NAME_LIMIT}:limit: characters or fewer.`];
  }
  return [];
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
  if ((values.name ?? '').trim().length > PROGRAM_NAME_LIMIT) {
    errors['name'] = [
      $localize`Keep the name to ${PROGRAM_NAME_LIMIT}:limit: characters or fewer.`,
    ];
  }
  for (const row of values.maxes) {
    const given = row.mode === 'weekOne' ? row.weekOneWeight : row.value;
    if (given === null || !(given > 0)) {
      errors[`max:${row.exerciseId}`] = [
        row.mode === 'weekOne'
          ? $localize`Enter the weight for ${row.name}:exercise: in week 1.`
          : $localize`Enter the training max for ${row.name}:exercise:.`,
      ];
    }
  }
  return errors;
}

export type AssignmentRequest = Omit<AssignMesocycleRequest, 'idempotencyKey'>;

/** The request, without its idempotency key, which is bound to exactly this payload. */
export function assignmentRequest(values: AssignmentValues): AssignmentRequest {
  const name = (values.name ?? '').trim();
  return {
    enrollmentId: values.enrollmentId,
    templateVersionId: values.templateVersionId,
    startDate: values.startDate,
    kind: 'Primary',
    loadUnit: values.loadUnit,
    loadIncrement: values.loadIncrement!,
    loadRoundingMode: values.loadRoundingMode,
    workingMaxes: values.maxes.map((row) =>
      row.mode === 'weekOne'
        ? {
            exerciseId: row.exerciseId,
            strengthMaxRecordId: null,
            value: null,
            unit: row.unit,
            weekOneWeight: row.weekOneWeight!,
          }
        : row.loggedSetId
          ? {
              exerciseId: row.exerciseId,
              strengthMaxRecordId: null,
              value: null,
              unit: row.unit,
              loggedSetId: row.loggedSetId,
            }
          : {
              exerciseId: row.exerciseId,
              strengthMaxRecordId: row.sourceRecordId,
              value: row.value!,
              unit: row.unit,
              ...(row.carriedFromMaxId ? { carriedFromMaxId: row.carriedFromMaxId } : {}),
            },
    ),
    ...(name ? { name } : {}),
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

// ------------------------------------------------------------------------------------------------
// Build next block (STR-006, TRN-025)
// ------------------------------------------------------------------------------------------------

/** The most copies of each week one go makes, and the most weeks a program holds. */
export const MAX_COPIES = 12;
export const MAX_PROGRAM_WEEKS = 52;

/**
 * What Build next block asks for: the weeks to repeat, how many copies of each, and how far each copy
 * moves from the one before it. They are the builder's four steps (TRN-025); the server's rules are the
 * ones checked here, and it checks them again.
 */
export interface ProgressionValues {
  readonly weekIds: readonly string[];
  readonly iterations: number | null;
  readonly rpeStep: number | null;
  readonly repetitionsStep: number | null;
  readonly percentageStep: number | null;
  readonly loadStep: number | null;
}

export type ProgressionField = 'weeks' | 'copies' | 'rpe' | 'reps' | 'percentage' | 'load';
export type ProgressionProblems = Readonly<Record<ProgressionField, readonly string[]>>;

/** The steps a new block starts from: a little more effort each week, nothing else moving. */
export const STARTING_STEPS = { iterations: 3, rpe: 0.5, reps: 0, percentage: 0, load: 0 } as const;

/**
 * How many copies of each chosen week still fit: at most 12, and no more than the 52 weeks a program
 * holds leave room for.
 */
export function copiesThatFit(weeksNow: number, chosen: number): number {
  const room = Math.floor((MAX_PROGRAM_WEEKS - weeksNow) / Math.max(1, chosen));
  return Math.max(0, Math.min(MAX_COPIES, room));
}

function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

function isWhole(value: number | null, from: number, to: number): boolean {
  return value !== null && Number.isInteger(value) && value >= from && value <= to;
}

function isTwoDecimals(value: number | null, limit: number): boolean {
  return (
    value !== null &&
    Number.isFinite(value) &&
    Math.abs(value) <= limit &&
    hasAtMostTwoDecimals(value)
  );
}

/** What is wrong, field by field, in the way the server will check it. Empty lists mean nothing is. */
export function progressionErrors(values: ProgressionValues, room: number): ProgressionProblems {
  const rpe = values.rpeStep;
  return {
    weeks: values.weekIds.length === 0 ? [$localize`Choose at least one week to build on.`] : [],
    copies: isWhole(values.iterations, 1, room)
      ? []
      : [
          room === 0
            ? $localize`A program holds up to 52 weeks, and this one is full. Assign a new program to carry on.`
            : $localize`Choose 1 to ${room}:count: copies.`,
        ],
    rpe:
      rpe !== null && rpe >= -2 && rpe <= 2 && rpe * 2 === Math.trunc(rpe * 2)
        ? []
        : [$localize`Use -2 to 2, in steps of 0.5.`],
    reps: isWhole(values.repetitionsStep, -20, 20)
      ? []
      : [$localize`Use a whole number from -20 to 20.`],
    percentage: isTwoDecimals(values.percentageStep, 50)
      ? []
      : [$localize`Use -50 to 50 points, with at most two decimals.`],
    load: isTwoDecimals(values.loadStep, 500)
      ? []
      : [$localize`Use -500 to 500, with at most two decimals.`],
  };
}

export function hasProgressionProblems(problems: ProgressionProblems): boolean {
  return Object.values(problems).some((messages) => messages.length > 0);
}

/** The program's weeks that the coach chose to build on, in the order they run. */
function chosenWeeks(view: TrainingMesocycleView, weekIds: readonly string[]) {
  return view.weeks
    .filter((week) => weekIds.includes(week.id))
    .sort((a, b) => Number(a.weekNumber) - Number(b.weekNumber));
}

function chosenSets(
  view: TrainingMesocycleView,
  weekIds: readonly string[],
): SetPrescriptionView[] {
  return chosenWeeks(view, weekIds).flatMap((week) =>
    week.sessions.flatMap((session) => session.exercises.flatMap((exercise) => exercise.sets)),
  );
}

/** How many of the chosen weeks' sets each step would move, so a step is never a guess. */
export interface StepReach {
  readonly rpe: number;
  readonly reps: number;
  readonly percentage: number;
  readonly load: number;
  /** The unit of the fixed weights the weight step moves: "kg", "lb", or "kg / lb". */
  readonly unit: string | null;
}

export function stepReach(view: TrainingMesocycleView, weekIds: readonly string[]): StepReach {
  // A warm-up stays as it is (TRN-025).
  const sets = chosenSets(view, weekIds).filter((set) => set.setType !== 'WarmUp');
  const fixed = sets.filter(
    (set) => set.isManualLoadOverride || (set.loadStrategy === 'Direct' && set.directLoad !== null),
  );
  const units = new Set(fixed.map((set) => unitLabel(set.loadUnit ?? view.loadUnit)));
  return {
    rpe: sets.filter((set) => set.targetRpe !== null).length,
    reps: sets.filter((set) => set.repetitionsMinimum !== null || set.repetitionsMaximum !== null)
      .length,
    percentage: sets.filter(
      (set) => set.loadStrategy === 'PercentageWorkingMax' && set.percentageWorkingMax !== null,
    ).length,
    load: fixed.length,
    unit: units.size === 0 ? null : [...units].sort().join(' / '),
  };
}

/**
 * The formula the chosen weeks' sets that take their weight from an RPE use: the RTS chart, the Epley
 * curve, both ('mixed') or neither (null). The new weeks keep each set's own formula (STR-005, STR-010).
 */
export type NextBlockFormula = 'RpeChart' | 'RpeBasedEpley' | 'mixed' | null;

export function nextBlockFormula(
  view: TrainingMesocycleView,
  weekIds: readonly string[],
): NextBlockFormula {
  const used = new Set(
    chosenSets(view, weekIds)
      .map((set) => set.loadStrategy)
      .filter((strategy) => strategy === 'RpeChart' || strategy === 'RpeBasedEpley'),
  );
  if (used.size === 0) return null;
  if (used.size > 1) return 'mixed';
  return used.has('RpeChart') ? 'RpeChart' : 'RpeBasedEpley';
}

export interface PreviewSet {
  readonly text: string;
  /** Not the same as the week it builds on, so the coach sees what moved. */
  readonly changed: boolean;
}

export interface PreviewExercise {
  readonly name: string;
  readonly sets: readonly PreviewSet[];
}

export interface PreviewSession {
  readonly name: string;
  readonly exercises: readonly PreviewExercise[];
}

export interface PreviewWeek {
  readonly number: number;
  /** The week it builds on, told only when several weeks were chosen and it could be any of them. */
  readonly from: number | null;
  readonly sessions: readonly PreviewSession[];
}

/**
 * The weeks a preview would add, as sessions with their exercises. Each set is marked when it differs
 * from the week its copy builds on: the chosen week itself for the first round, then the round before.
 */
export function previewWeeks(
  preview: ProgressionPreviewView,
  view: TrainingMesocycleView | null,
  weekIds: readonly string[],
  unit: TrainingLoadUnit,
  locale: string,
): PreviewWeek[] {
  const sources = view ? chosenWeeks(view, weekIds) : [];
  const linesOf = (session: TrainingSessionView | undefined) =>
    (session?.exercises ?? []).map((exercise) => setLines(exercise.sets, unit, locale));
  const generated = preview.generatedWeeks;
  return generated.map((week, index) => {
    // The server makes every chosen week once, then every chosen week again: round by round.
    const from = sources.length > 0 ? sources[index % sources.length] : null;
    const base =
      index < sources.length ? from?.sessions : generated[index - sources.length]?.sessions;
    return {
      number: Number(week.weekNumber),
      from: from !== null && sources.length > 1 ? Number(from.weekNumber) : null,
      sessions: week.sessions.map((session, sessionIndex) => {
        const before = linesOf(base?.[sessionIndex]);
        return {
          name: session.name,
          exercises: linesOf(session).map((lines, exerciseIndex) => ({
            name: session.exercises[exerciseIndex].exerciseName,
            sets: lines.map((text) => ({
              text,
              changed: base !== undefined && !(before[exerciseIndex] ?? []).includes(text),
            })),
          })),
        };
      }),
    };
  });
}

// ------------------------------------------------------------------------------------------------
// What the server may answer
// ------------------------------------------------------------------------------------------------

const SYSTEM_WORDS = /mesocycle|enrollment|entitlement|template|snapshot|idempotency|primary/i;

/** The code a refusal carries, such as `training_max_suggestion_changed`; null for anything else. */
export function serverCode(error: unknown): string | null {
  return serverText(error).code;
}

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
  if (code === 'training_maxes_preview_changed') {
    return $localize`The new weights changed since you looked at them. Show them again, then update.`;
  }
  if (code === 'training_max_suggestion_changed') {
    return $localize`${name}:name: logged a newer set since you looked, so the suggested max changed. Look at the new suggestion, then try again.`;
  }
  if (code === 'training_maxes_conflict' || code === 'progression_conflict') {
    return $localize`This program changed since you opened this. Close it and open it again to see the latest, then try again.`;
  }
  if (code === 'progression_preview_changed') {
    return $localize`The new weeks changed since you looked at them. Preview them again, then add them.`;
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
