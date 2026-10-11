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

export function reconcileWorkoutSetDrafts(
  day: ClientTrainingDayResult,
  current: WorkoutSetDrafts,
): WorkoutSetDrafts {
  const next: Record<string, WorkoutSetDraft> = {};

  for (const workout of day.workouts) {
    for (const exercise of workout.exercises) {
      for (const set of exercise.sets) {
        if (!set.performanceId) {
          continue;
        }

        const draft = current[set.performanceId];
        next[set.performanceId] = draft?.dirty
          ? draft
          : draftFromSet(set, exercise, draft?.revision ?? 0);
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

export function toRecordSetRequest(
  snapshot: WorkoutSetDraftSnapshot,
  prescribedLoadUnit: ClientSetView['prescribedLoadUnit'],
  version: number,
): RecordSetActualRequest {
  const load = nullableNumeric(snapshot.actualLoad);
  return {
    repetitions: nullableNumeric(snapshot.actualRepetitions),
    load,
    loadUnit: load === null ? null : (snapshot.actualLoadUnit ?? prescribedLoadUnit),
    rpe: nullableNumeric(snapshot.actualRpe),
    rir: nullableNumeric(snapshot.actualRir),
    isCompleted: snapshot.isCompleted,
    clientNote: snapshot.clientNote?.trim() || null,
    version,
  };
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

/** A logged set keeps exactly what was logged; any other starts as `startingValues` say. */
function draftFromSet(
  set: ClientSetView,
  exercise: ClientExerciseView,
  revision: number,
): WorkoutSetDraft {
  const start = set.isCompleted ? null : startingValues(set, exercise);
  return {
    actualRepetitions: set.actualRepetitions ?? start?.repetitions ?? null,
    actualLoad: set.actualLoad ?? start?.load ?? null,
    actualLoadUnit: set.actualLoadUnit ?? start?.loadUnit ?? null,
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
 * which the coach wrote for another lift.
 */
function startingValues(set: ClientSetView, exercise: ClientExerciseView) {
  const previous = previousSetFor(exercise, set);
  const previousLoad =
    previous?.load != null &&
    (!set.prescribedLoadUnit || previous.loadUnit === set.prescribedLoadUnit)
      ? previous
      : null;
  return {
    repetitions:
      set.prescribedRepetitionsMinimum ??
      set.prescribedRepetitionsMaximum ??
      previous?.repetitions ??
      null,
    load: (exercise.wasSubstituted ? null : set.prescribedLoad) ?? previousLoad?.load ?? null,
    loadUnit: set.prescribedLoadUnit ?? previousLoad?.loadUnit ?? null,
  };
}
