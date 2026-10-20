import type {
  ClientExerciseView,
  ClientSetView,
  ClientTrainingDayResult,
  ClientWorkoutView,
  PreviousSetPerformanceView,
  RecordSetActualRequest,
  TrainingLoadUnit,
  WorkoutSetSaveView,
} from '../../core/api/generated';
import { nullableNumeric } from './training-builder.models';

export interface WorkoutSetDraft {
  actualRepetitions: ClientSetView['actualRepetitions'];
  actualLoad: ClientSetView['actualLoad'];
  actualLoadUnit: ClientSetView['actualLoadUnit'];
  actualRpe: ClientSetView['actualRpe'];
  actualRir: ClientSetView['actualRir'];
  isCompleted: boolean;
  clientNote: ClientSetView['clientNote'];
  revision: number;
  dirty: boolean;
}

export type WorkoutSetDrafts = Readonly<Record<string, WorkoutSetDraft>>;

export interface WorkoutSetDraftSnapshot {
  revision: number;
  actualRepetitions: ClientSetView['actualRepetitions'];
  actualLoad: ClientSetView['actualLoad'];
  actualLoadUnit: ClientSetView['actualLoadUnit'];
  actualRpe: ClientSetView['actualRpe'];
  actualRir: ClientSetView['actualRir'];
  isCompleted: boolean;
  clientNote: ClientSetView['clientNote'];
}

/**
 * The drafts for a day read from the server. Typed work stays (TRN-017); every other set starts where
 * TRN-029 starts it, in the kg or lb the client chose for its workout, if they chose one.
 */
export function reconcileWorkoutSetDrafts(
  day: ClientTrainingDayResult,
  current: WorkoutSetDrafts,
  chosenUnits: ReadonlyMap<string, TrainingLoadUnit> = new Map(),
): WorkoutSetDrafts {
  const next: Record<string, WorkoutSetDraft> = {};

  for (const workout of day.workouts) {
    const unit = chosenUnits.get(workout.sessionId) ?? null;
    for (const exercise of workout.exercises) {
      for (const set of exercise.sets) {
        if (!set.performanceId) {
          continue;
        }

        const draft = current[set.performanceId];
        next[set.performanceId] = draft?.dirty
          ? draft
          : draftFromSet(set, exercise, draft?.revision ?? 0, unit);
      }
    }
  }

  return next;
}

/**
 * The workout's kg or lb choice on its sets not yet logged (audit CLIENT-1). Choosing is never an edit
 * and loses nothing: a load the client typed keeps its number and takes the unit chosen, and a set they
 * have not touched starts again where TRN-029 starts it in that unit. Kilograms and pounds are never
 * converted, so a set the coach wrote in the other unit starts with no load, and choosing back brings
 * the coach's number back.
 */
export function withWorkoutUnit(
  current: WorkoutSetDrafts,
  workout: ClientWorkoutView,
  unit: TrainingLoadUnit,
): WorkoutSetDrafts {
  const next: Record<string, WorkoutSetDraft> = { ...current };
  for (const exercise of workout.exercises) {
    for (const set of exercise.sets) {
      const draft = set.performanceId ? current[set.performanceId] : undefined;
      if (!draft || set.isCompleted) continue;
      if (!draft.dirty) {
        next[set.performanceId!] = draftFromSet(set, exercise, draft.revision, unit);
      } else if (draft.actualLoadUnit !== unit) {
        // A new revision, so a save already on its way for the old unit cannot settle this draft.
        next[set.performanceId!] = { ...draft, actualLoadUnit: unit, revision: draft.revision + 1 };
      }
    }
  }

  return next;
}

export function updateWorkoutSetDraft(
  current: WorkoutSetDrafts,
  performanceId: string,
  changes: Partial<Omit<WorkoutSetDraft, 'revision' | 'dirty'>>,
): WorkoutSetDrafts {
  const draft = current[performanceId];
  if (!draft) {
    return current;
  }

  return {
    ...current,
    [performanceId]: {
      ...draft,
      ...changes,
      revision: draft.revision + 1,
      dirty: true,
    },
  };
}

export function snapshotWorkoutSetDraft(
  current: WorkoutSetDrafts,
  performanceId: string,
): WorkoutSetDraftSnapshot | null {
  const draft = current[performanceId];
  if (!draft) {
    return null;
  }

  return {
    revision: draft.revision,
    actualRepetitions: draft.actualRepetitions,
    actualLoad: draft.actualLoad,
    actualLoadUnit: draft.actualLoadUnit,
    actualRpe: draft.actualRpe,
    actualRir: draft.actualRir,
    isCompleted: draft.isCompleted,
    clientNote: draft.clientNote,
  };
}

export function hasLoadUnitForActualLoad(
  snapshot: WorkoutSetDraftSnapshot,
  prescribedLoadUnit: ClientSetView['prescribedLoadUnit'],
): boolean {
  return (
    nullableNumeric(snapshot.actualLoad) === null ||
    Boolean(snapshot.actualLoadUnit ?? prescribedLoadUnit)
  );
}

/**
 * What ✓ sends. Effort goes as RPE or as reps left, never both (STR-003): a saved set comes back
 * with both, RPE being canonical and reps left read from it, so RPE wins whenever it is there.
 */
export function toRecordSetRequest(
  snapshot: WorkoutSetDraftSnapshot,
  prescribedLoadUnit: ClientSetView['prescribedLoadUnit'],
  version: number,
): RecordSetActualRequest {
  const load = nullableNumeric(snapshot.actualLoad);
  const rpe = nullableNumeric(snapshot.actualRpe);
  return {
    repetitions: nullableNumeric(snapshot.actualRepetitions),
    load,
    loadUnit: load === null ? null : (snapshot.actualLoadUnit ?? prescribedLoadUnit),
    rpe,
    rir: rpe === null ? nullableNumeric(snapshot.actualRir) : null,
    isCompleted: snapshot.isCompleted,
    clientNote: snapshot.clientNote?.trim() || null,
    version,
  };
}

/**
 * The effort a set would send that the server refuses (STR-004: RPE 5 to 10, reps left 0 to 5, each
 * in half steps), found before the round trip (audit CLIENT-5). Null when there is none to refuse.
 */
export function effortOutOfRange(
  draft: Pick<WorkoutSetDraftSnapshot, 'actualRpe' | 'actualRir'>,
): 'rpe' | 'rir' | null {
  const rpe = nullableNumeric(draft.actualRpe);
  if (rpe !== null) return halfStepWithin(rpe, 5, 10) ? null : 'rpe';
  const rir = nullableNumeric(draft.actualRir);
  return rir === null || halfStepWithin(rir, 0, 5) ? null : 'rir';
}

function halfStepWithin(value: number, minimum: number, maximum: number): boolean {
  return (
    Number.isFinite(value) && value >= minimum && value <= maximum && Number.isInteger(value * 2)
  );
}

export function applyWorkoutSetSave(
  current: WorkoutSetDrafts,
  response: WorkoutSetSaveView,
  submittedRevision: number,
): WorkoutSetDrafts {
  const draft = current[response.setPerformanceId];
  if (!draft || draft.revision !== submittedRevision) {
    return current;
  }

  return {
    ...current,
    [response.setPerformanceId]: {
      actualRepetitions: response.actualRepetitions,
      actualLoad: response.actualLoad,
      actualLoadUnit: response.actualLoadUnit,
      actualRpe: response.actualRpe,
      actualRir: response.actualRir,
      isCompleted: response.isCompleted,
      clientNote: response.clientNote,
      revision: draft.revision,
      dirty: false,
    },
  };
}

export function applyWorkoutSetSaveToDay(
  day: ClientTrainingDayResult,
  response: WorkoutSetSaveView,
): ClientTrainingDayResult {
  return {
    ...day,
    workouts: day.workouts.map((workout) =>
      workout.workoutExecutionId !== response.workoutExecutionId
        ? workout
        : {
            ...workout,
            executionVersion: response.executionVersion,
            exercises: workout.exercises.map((exercise) => ({
              ...exercise,
              sets: exercise.sets.map((set) =>
                set.performanceId !== response.setPerformanceId
                  ? set
                  : {
                      ...set,
                      actualRepetitions: response.actualRepetitions,
                      actualLoad: response.actualLoad,
                      actualLoadUnit: response.actualLoadUnit,
                      actualRpe: response.actualRpe,
                      actualRir: response.actualRir,
                      isCompleted: response.isCompleted,
                      clientNote: response.clientNote,
                    },
              ),
            })),
          },
    ),
  };
}

/** What the client did on this set last time: the same set position, on the exercise done now. */
export function previousSetFor(
  exercise: ClientExerciseView,
  set: ClientSetView,
): PreviousSetPerformanceView | null {
  return exercise.previousPerformance?.sets?.find((item) => item.position === set.position) ?? null;
}

/**
 * The unit the workout's kg/lb choice starts on: the coach's, else the one last time's loads
 * brought into the drafts. With neither the choice starts empty, never on a guess (TRN-016).
 */
export function startingWorkoutUnit(
  workout: ClientWorkoutView,
  drafts: WorkoutSetDrafts,
): TrainingLoadUnit | null {
  const sets = workout.exercises.flatMap((exercise) => exercise.sets);
  return (
    sets.find((set) => set.prescribedLoadUnit)?.prescribedLoadUnit ??
    sets
      .filter((set) => !set.isCompleted && set.performanceId)
      .map((set) => drafts[set.performanceId!])
      .find((draft) => draft?.actualLoad != null && draft.actualLoadUnit)?.actualLoadUnit ??
    null
  );
}

/**
 * A logged set keeps exactly what was logged; any other starts as `startingValues` say, in the unit
 * chosen for its workout when there is one. A load saved earlier without logging the set stays, unless
 * it is in the other unit.
 */
function draftFromSet(
  set: ClientSetView,
  exercise: ClientExerciseView,
  revision: number,
  unit: TrainingLoadUnit | null = null,
): WorkoutSetDraft {
  const start = set.isCompleted ? null : startingValues(set, exercise, unit);
  const saved =
    set.isCompleted || (set.actualLoad != null && (!unit || set.actualLoadUnit === unit));
  return {
    actualRepetitions: set.actualRepetitions ?? start?.repetitions ?? null,
    actualLoad: saved ? set.actualLoad : (start?.load ?? null),
    actualLoadUnit: saved
      ? set.actualLoadUnit
      : (unit ?? set.actualLoadUnit ?? start?.loadUnit ?? null),
    actualRpe: set.actualRpe,
    actualRir: set.actualRir,
    isCompleted: set.isCompleted,
    clientNote: set.clientNote,
    revision,
    dirty: false,
  };
}

/**
 * Where a set not yet logged starts (TRN-029, `PrescriptionThenLastTime` v1), so one tap on ✓ logs
 * it as the coach prescribed: the prescribed load and unit, and the prescribed reps (the lowest of a
 * range). Last time's numbers on the same set fill only what the prescription leaves open, and a
 * load only in the set's own unit. A swapped exercise keeps the prescribed reps but not the load,
 * which the coach wrote for another lift. Once the client chooses kg or lb for the workout, that is
 * the set's unit: the coach's load counts only when written in it, else last time's in it.
 */
function startingValues(
  set: ClientSetView,
  exercise: ClientExerciseView,
  chosenUnit: TrainingLoadUnit | null,
) {
  const previous = previousSetFor(exercise, set);
  const unit = chosenUnit ?? set.prescribedLoadUnit;
  const previousLoad =
    previous?.load != null && (!unit || previous.loadUnit === unit) ? previous : null;
  const coachLoad =
    exercise.wasSubstituted || (chosenUnit && set.prescribedLoadUnit !== chosenUnit)
      ? null
      : set.prescribedLoad;
  return {
    repetitions:
      set.prescribedRepetitionsMinimum ??
      set.prescribedRepetitionsMaximum ??
      previous?.repetitions ??
      null,
    load: coachLoad ?? previousLoad?.load ?? null,
    loadUnit: unit ?? previousLoad?.loadUnit ?? null,
  };
}
