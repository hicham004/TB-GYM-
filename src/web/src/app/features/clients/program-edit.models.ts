import { formatDate } from '@angular/common';
import type {
  ClientSessionState,
  ExercisePrescriptionView,
  ProgramEditChangeKind,
  ProgramEditPreviewView,
  ProgramEditWeekRequest,
  TrainingLoadUnit,
  TrainingMesocycleView,
  TrainingSessionView,
} from '../../core/api/generated';
import type { StatusPillTone } from '../../ui/status-pill';
import {
  draftProblem,
  type DraftProblem,
  duplicateWeekAfter,
  MAX_WEEKS,
  moveWeek,
} from '../training/program-builder.models';
import {
  type DraftExercise,
  type DraftSession,
  type DraftWeek,
  nullableNumeric,
  numeric,
  type ProgramDraft,
  toTrainingSessionRequest,
} from '../training/training-builder.models';
import { exerciseLines, type ExerciseLine } from './client-program.models';
import { addDays } from './client-overview.models';

/**
 * Editing a client's weeks in the builder's grid (P3b, TRN-028). The grid holds the sessions the
 * coach may still change, in the builder's own shape, so the builder's drops and menus work on it
 * unchanged; the sessions that started, finished or passed are drawn beside them and never sent.
 * The server plans, checks and records every edit; this only keeps the grid honest about what the
 * server will refuse, so the coach is told before asking.
 */

/** A session that can no longer change: started, finished, or on a day already gone. */
export interface LockedSession {
  readonly id: string;
  readonly day: number;
  readonly name: string;
  readonly label: string;
  readonly tone: StatusPillTone;
}

/** The program as it was opened: what the grid edits, and what stays as it is. */
export interface ProgramEdit {
  readonly mesocycleId: string;
  readonly version: number;
  readonly name: string;
  readonly startDate: string;
  readonly endDateExclusive: string;
  /** The workspace's own date, from the server. */
  readonly today: string;
  readonly loadUnit: TrainingLoadUnit;
  /**
   * Weeks 1 to `frozen` keep their place, because each up to the last holds a session that is not
   * open. Their open sessions can still change; the weeks cannot move or go, and nothing new goes
   * before them.
   */
  readonly frozen: number;
  /** The sessions that cannot change, under the id of the week that holds them. */
  readonly locked: ReadonlyMap<string, readonly LockedSession[]>;
  /** The open sessions in the builder's shape: what the coach edits and the server receives. */
  readonly draft: ProgramDraft;
}

let fallbackKey = 0;

function newKey(): string {
  fallbackKey += 1;
  return globalThis.crypto?.randomUUID?.() ?? `edit-${fallbackKey}`;
}

/** Open while it has not started and its day is today or later (TRN-028, as replacing one, TRN-004). */
export function isOpen(session: TrainingSessionView, today: string): boolean {
  return !session.hasStarted && (session.scheduledDate ?? '') >= today;
}

function lockedSession(
  session: TrainingSessionView,
  state: ClientSessionState | null | undefined,
): LockedSession {
  const base = { id: session.id, day: numeric(session.dayOffset), name: session.name };
  if (session.isCompleted || state === 'Completed') {
    return { ...base, label: $localize`Done`, tone: 'success' };
  }
  if (session.hasStarted || state === 'InProgress') {
    return { ...base, label: $localize`In progress`, tone: 'info' };
  }
  // A session the client could not open (its week was never shared) is not missed, only past.
  return state === 'Missed'
    ? { ...base, label: $localize`Missed`, tone: 'warm' }
    : { ...base, label: $localize`Past`, tone: 'neutral' };
}

/** A stored session as the builder holds one; its id travels so the server knows which row it is. */
export function draftSession(session: TrainingSessionView, unit: TrainingLoadUnit): DraftSession {
  return {
    key: newKey(),
    sourceId: session.id,
    name: session.name,
    dayOffset: numeric(session.dayOffset),
    coachNotes: session.coachNotes ?? '',
    exercises: [...session.exercises]
      .sort((a, b) => numeric(a.position) - numeric(b.position))
      .map((exercise) => draftExercise(exercise, unit)),
  };
}

function draftExercise(exercise: ExercisePrescriptionView, unit: TrainingLoadUnit): DraftExercise {
  return {
    key: newKey(),
    exerciseId: exercise.exerciseId,
    exerciseName: exercise.exerciseName,
    isMainLift: exercise.isMainLift,
    modificationPolicy: exercise.modificationPolicy,
    coachNotes: exercise.coachNotes ?? '',
    approvedAlternativeExerciseIds: [...exercise.approvedAlternativeExerciseIds],
    sets: [...exercise.sets]
      .sort((a, b) => numeric(a.position) - numeric(b.position))
      .map((set) => ({
        key: newKey(),
        setType: set.setType,
        repetitionsMinimum: nullableNumeric(set.repetitionsMinimum),
        repetitionsMaximum: nullableNumeric(set.repetitionsMaximum),
        loadStrategy: set.loadStrategy,
        loadValue:
          set.loadStrategy === 'Direct'
            ? nullableNumeric(set.directLoad)
            : nullableNumeric(set.percentageWorkingMax),
        loadUnit: set.loadUnit ?? unit,
        exertionDisplayPreference: set.exertionDisplayPreference,
        exertionTarget:
          set.exertionDisplayPreference === 'Rir'
            ? nullableNumeric(set.targetRir)
            : nullableNumeric(set.targetRpe),
        restSeconds: nullableNumeric(set.restSeconds),
        tempo: set.tempo ?? '',
        coachNotes: set.coachNotes ?? '',
        // A typed weight is kept as the weight the client was given, as the server stores it.
        manualLoadOverride: set.isManualLoadOverride ? nullableNumeric(set.prescribedLoad) : null,
      })),
  };
}

/**
 * The program as the grid opens it. `states` are the session states the coach's program read gives
 * (TRN-022), so a locked card says what the Training tab says about it.
 */
export function programEdit(
  view: TrainingMesocycleView,
  today: string,
  states: ReadonlyMap<string, ClientSessionState | null>,
): ProgramEdit {
  const weeks = [...view.weeks].sort((a, b) => numeric(a.weekNumber) - numeric(b.weekNumber));
  let frozen = 0;
  const locked = new Map<string, LockedSession[]>();
  weeks.forEach((week, index) => {
    const closed = week.sessions
      .filter((session) => !isOpen(session, today))
      .sort(bySchedule)
      .map((session) => lockedSession(session, states.get(session.id)));
    if (closed.length > 0) {
      frozen = index + 1;
      locked.set(week.id, closed);
    }
  });

  return {
    mesocycleId: view.id,
    version: numeric(view.version),
    name: view.name,
    startDate: view.startDate,
    endDateExclusive: view.endDateExclusive,
    today,
    loadUnit: view.loadUnit,
    frozen,
    locked,
    draft: {
      templateId: null,
      sourceVersion: null,
      sourceVersionId: null,
      name: view.name,
      description: '',
      publish: false,
      weeks: weeks.map((week) => ({
        key: newKey(),
        sourceId: week.id,
        label: week.label ?? '',
        isPublished: week.isPublished,
        sessions: week.sessions
          .filter((session) => isOpen(session, today))
          .sort(bySchedule)
          .map((session) => draftSession(session, view.loadUnit)),
      })),
    },
  };
}

function bySchedule(a: TrainingSessionView, b: TrainingSessionView): number {
  return numeric(a.dayOffset) - numeric(b.dayOffset) || numeric(a.position) - numeric(b.position);
}

/** What the server is asked: every week in order with its open sessions, as the grid holds them. */
export function editRequest(draft: ProgramDraft): ProgramEditWeekRequest[] {
  return draft.weeks.map((week) => ({
    weekId: week.sourceId,
    label: week.label.trim() || null,
    isPublished: week.isPublished,
    sessions: week.sessions.map((session) => ({
      sessionId: session.sourceId,
      session: toTrainingSessionRequest(session),
    })),
  }));
}

/** Whether the grid differs from the program as it was opened. */
export function hasEdits(opened: ProgramDraft, current: ProgramDraft): boolean {
  return JSON.stringify(editRequest(opened)) !== JSON.stringify(editRequest(current));
}

/** The date of a day of the week at `index` (0-based): the program's weeks run from its start date. */
export function dayDate(startDate: string, index: number, day: number): string {
  return addDays(startDate, index * 7 + day);
}

/** A day already gone takes nothing new; the server refuses a session dated before today. */
export function isClosedDay(edit: ProgramEdit, index: number, day: number): boolean {
  return dayDate(edit.startDate, index, day) < edit.today;
}

export function canMoveWeek(edit: ProgramEdit, count: number, index: number, by: -1 | 1): boolean {
  const target = index + by;
  return index >= edit.frozen && target >= edit.frozen && target < count;
}

export function canRemoveWeek(edit: ProgramEdit, count: number, index: number): boolean {
  return index >= edit.frozen && count > 1;
}

export function moveEditWeek(
  edit: ProgramEdit,
  draft: ProgramDraft,
  weekKey: string,
  by: -1 | 1,
): ProgramDraft {
  const index = draft.weeks.findIndex((week) => week.key === weekKey);
  return canMoveWeek(edit, draft.weeks.length, index, by) ? moveWeek(draft, weekKey, by) : draft;
}

/**
 * A copy of a week straight after it, or after the last week that keeps its place when the copy
 * would land among them.
 */
export function duplicateEditWeek(
  edit: ProgramEdit,
  draft: ProgramDraft,
  weekKey: string,
): ProgramDraft {
  const index = draft.weeks.findIndex((week) => week.key === weekKey);
  if (index < 0 || draft.weeks.length >= MAX_WEEKS) return draft;
  const next = duplicateWeekAfter(draft, weekKey);
  const at = Math.max(index + 1, edit.frozen);
  if (at === index + 1) return next;
  const [copy] = next.weeks.splice(index + 1, 1);
  next.weeks.splice(at, 0, copy);
  return next;
}

/**
 * The first thing that stops the edit, saying where: the builder's own checks, then a session on a
 * day that has already gone.
 */
export function editProblem(
  edit: ProgramEdit,
  draft: ProgramDraft,
  locale: string,
): DraftProblem | null {
  const problem = draftProblem(draft);
  if (problem) return problem;
  for (const [index, week] of draft.weeks.entries()) {
    for (const session of week.sessions) {
      if (!isClosedDay(edit, index, session.dayOffset)) continue;
      const name = session.name.trim() || $localize`A session`;
      const day = formatDate(
        dayDate(edit.startDate, index, session.dayOffset),
        'EEE d MMM',
        locale,
      );
      return {
        weekKey: week.key,
        sessionKey: session.key,
        message: $localize`Week ${index + 1}:week:, ${name}:session:: ${day}:date: has passed. Move it to today or a later day.`,
      };
    }
  }
  return null;
}

// ------------------------------------------------------------------------------------------------
// The review: what the server says the edit does
// ------------------------------------------------------------------------------------------------

export interface ReviewRow {
  readonly key: string;
  readonly kind: string;
  readonly tone: StatusPillTone;
  /** "Week 2 · Tue 13 Oct · Heavy squats". */
  readonly title: string;
  /** "Was week 3, Tue 20 Oct", for a session or week that moved. */
  readonly from: string | null;
  /** The session as it will be, with every weight worked out; empty for a removal or a move. */
  readonly lines: readonly ExerciseLine[];
  /** Said when the client does not see that week. */
  readonly hidden: string | null;
}

export interface EditReview {
  /** "1 session changed · 1 added · 1 week added". */
  readonly headline: string;
  /** "The program now ends Sun 22 Nov, a week later." when the end moves. */
  readonly endLine: string | null;
  readonly weeks: readonly ReviewRow[];
  readonly sessions: readonly ReviewRow[];
  readonly problems: readonly string[];
  readonly hasChanges: boolean;
}

function kindWords(
  kind: ProgramEditChangeKind,
  of: 'session' | 'week',
): { kind: string; tone: StatusPillTone } {
  switch (kind) {
    case 'Added':
      return { kind: $localize`New`, tone: 'success' };
    case 'Edited':
      return of === 'session'
        ? { kind: $localize`Changed`, tone: 'info' }
        : { kind: $localize`Renamed or shared`, tone: 'info' };
    case 'Moved':
      return { kind: $localize`Moved`, tone: 'neutral' };
    default:
      return { kind: $localize`Removed`, tone: 'warm' };
  }
}

function plural(count: number, one: string, many: string): string | null {
  return count === 0 ? null : count === 1 ? one : many;
}

/** What changed about a week that kept its place: its name, whether the client sees it, or both. */
function weekEditWords(
  was: DraftWeek,
  label: string | null,
  isShared: boolean,
  firstName: string,
): { kind: string; tone: StatusPillTone } {
  const renamed = (was.label.trim() || null) !== label;
  if (was.isPublished === isShared) return { kind: $localize`Renamed`, tone: 'info' };
  const shared = isShared
    ? $localize`Now shared with ${firstName}:name:`
    : $localize`No longer shared with ${firstName}:name:`;
  return renamed
    ? { kind: $localize`Renamed · ${shared}:sharing:`, tone: 'info' }
    : { kind: shared, tone: isShared ? 'success' : 'warning' };
}

/**
 * The server's preview in coach words. `opened` is the grid as it was opened, so a week that kept
 * its place can say whether it was renamed or shared differently.
 */
export function editReview(
  preview: ProgramEditPreviewView,
  unit: TrainingLoadUnit,
  locale: string,
  firstName: string,
  opened?: ProgramDraft,
): EditReview {
  const day = (date: string) => formatDate(date, 'EEE d MMM', locale);
  const n = (value: number | string) => numeric(value);
  const parts = [
    plural(
      n(preview.sessionsEdited),
      $localize`1 session changed`,
      $localize`${n(preview.sessionsEdited)}:count: sessions changed`,
    ),
    plural(
      n(preview.sessionsAdded),
      $localize`1 session added`,
      $localize`${n(preview.sessionsAdded)}:count: sessions added`,
    ),
    plural(
      n(preview.sessionsMoved),
      $localize`1 session moved`,
      $localize`${n(preview.sessionsMoved)}:count: sessions moved`,
    ),
    plural(
      n(preview.sessionsRemoved),
      $localize`1 session removed`,
      $localize`${n(preview.sessionsRemoved)}:count: sessions removed`,
    ),
    plural(
      n(preview.weeksAdded),
      $localize`1 week added`,
      $localize`${n(preview.weeksAdded)}:count: weeks added`,
    ),
    plural(
      n(preview.weeksMoved),
      $localize`1 week moved`,
      $localize`${n(preview.weeksMoved)}:count: weeks moved`,
    ),
    plural(
      n(preview.weeksRemoved),
      $localize`1 week removed`,
      $localize`${n(preview.weeksRemoved)}:count: weeks removed`,
    ),
  ].filter((part): part is string => part !== null);
  const weekRenames = preview.weekChanges.filter((change) => change.kind === 'Edited').length;
  if (weekRenames > 0) {
    parts.push(
      weekRenames === 1
        ? $localize`1 week renamed or shared differently`
        : $localize`${weekRenames}:count: weeks renamed or shared differently`,
    );
  }

  const hasChanges = preview.weekChanges.length + preview.sessionChanges.length > 0;
  const endLine =
    preview.resultingEndDateExclusive === preview.currentEndDateExclusive
      ? null
      : $localize`The program now ends ${day(addDays(preview.resultingEndDateExclusive, -1))}:date:. It ended ${day(addDays(preview.currentEndDateExclusive, -1))}:date: before.`;
  const notShared = $localize`Not shared with ${firstName}:name:`;

  const weeks: ReviewRow[] = preview.weekChanges.map((change, index) => {
    const number = n(change.weekNumber);
    const plain = $localize`Week ${number}:number:`;
    // A label that already starts with the week's own number is the title as it is.
    const title = !change.label
      ? plain
      : new RegExp(`^Week ${number}\\b`).test(change.label)
        ? change.label
        : `${plain} · ${change.label}`;
    const previous = change.previousWeekNumber === null ? null : n(change.previousWeekNumber);
    const was = change.kind === 'Edited' ? opened?.weeks[number - 1] : undefined;
    return {
      key: `week-${index}`,
      ...(was
        ? weekEditWords(was, change.label, change.isShared, firstName)
        : kindWords(change.kind, 'week')),
      title,
      from:
        change.kind === 'Moved' && previous !== null
          ? $localize`Was week ${previous}:number:`
          : null,
      lines: [],
      hidden: change.kind !== 'Removed' && !change.isShared ? notShared : null,
    };
  });

  const sessions: ReviewRow[] = preview.sessionChanges.map((change, index) => {
    const words = kindWords(change.kind, 'session');
    const previousDate = change.previousDate ? day(change.previousDate) : null;
    const previousWeek = change.previousWeekNumber === null ? null : n(change.previousWeekNumber);
    return {
      key: `session-${index}`,
      ...words,
      title: `${$localize`Week ${n(change.weekNumber)}:number:`} · ${day(change.date)} · ${change.name}`,
      from:
        previousDate && previousWeek !== null
          ? $localize`Was week ${previousWeek}:number:, ${previousDate}:date:`
          : null,
      lines: change.after ? exerciseLines(change.after, unit, locale) : [],
      hidden: change.kind !== 'Removed' && !change.weekIsShared ? notShared : null,
    };
  });

  return {
    headline: parts.length > 0 ? parts.join(' · ') : $localize`Nothing changes`,
    endLine,
    weeks,
    sessions,
    problems: preview.problems,
    hasChanges,
  };
}
