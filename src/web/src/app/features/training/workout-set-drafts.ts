import type {
  ClientSetView,
  ClientTrainingDayResult,
  RecordSetActualRequest,
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
        next[set.performanceId] = draft?.dirty ? draft : draftFromSet(set, draft?.revision ?? 0);
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

function draftFromSet(set: ClientSetView, revision: number): WorkoutSetDraft {
  return {
    actualRepetitions: set.actualRepetitions,
    actualLoad: set.actualLoad,
    actualLoadUnit: set.actualLoadUnit ?? set.prescribedLoadUnit,
    actualRpe: set.actualRpe,
    actualRir: set.actualRir,
    isCompleted: set.isCompleted,
    clientNote: set.clientNote,
    revision,
    dirty: false,
  };
}
