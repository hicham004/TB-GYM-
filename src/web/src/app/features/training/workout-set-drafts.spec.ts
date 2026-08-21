import { describe, expect, it } from 'vitest';
import type {
  ClientSetView,
  ClientTrainingDayResult,
  WorkoutSetSaveView,
} from '../../core/api/generated';
import {
  applyWorkoutSetSave,
  hasLoadUnitForActualLoad,
  reconcileWorkoutSetDrafts,
  snapshotWorkoutSetDraft,
  updateWorkoutSetDraft,
} from './workout-set-drafts';

describe('workout set drafts', () => {
  it('applies an authoritative save only to the submitted set', () => {
    let drafts = reconcileWorkoutSetDrafts(trainingDay(), {});
    for (let index = 1; index <= 4; index += 1) {
      drafts = updateWorkoutSetDraft(drafts, `set-${index}`, {
        actualLoad: 100 + index,
        actualRepetitions: 10 + index,
      });
    }

    const submitted = snapshotWorkoutSetDraft(drafts, 'set-1')!;
    drafts = applyWorkoutSetSave(drafts, savedSet({ actualLoad: 102.5 }), submitted.revision);

    expect(drafts['set-1'].actualLoad).toBe(102.5);
    expect(drafts['set-1'].dirty).toBe(false);
    expect(drafts['set-2'].actualLoad).toBe(102);
    expect(drafts['set-3'].actualLoad).toBe(103);
    expect(drafts['set-4'].actualLoad).toBe(104);
    expect(drafts['set-2'].dirty).toBe(true);
  });

  it('retains every draft when a save fails', () => {
    let drafts = reconcileWorkoutSetDrafts(trainingDay(), {});
    drafts = updateWorkoutSetDraft(drafts, 'set-1', { actualLoad: 111 });
    const beforeRequest = drafts;

    // A rejected request never calls applyWorkoutSetSave.
    expect(drafts).toBe(beforeRequest);
    expect(drafts['set-1'].actualLoad).toBe(111);
    expect(drafts['set-1'].dirty).toBe(true);
  });

  it('ignores a response when the athlete typed newer values while it was in flight', () => {
    let drafts = reconcileWorkoutSetDrafts(trainingDay(), {});
    drafts = updateWorkoutSetDraft(drafts, 'set-1', { actualLoad: 100 });
    const submitted = snapshotWorkoutSetDraft(drafts, 'set-1')!;
    drafts = updateWorkoutSetDraft(drafts, 'set-1', { actualLoad: 105 });

    const afterResponse = applyWorkoutSetSave(
      drafts,
      savedSet({ actualLoad: 100 }),
      submitted.revision,
    );

    expect(afterResponse['set-1'].actualLoad).toBe(105);
    expect(afterResponse['set-1'].dirty).toBe(true);
  });

  it('requires an explicit unit when an unweighted prescription receives an actual load', () => {
    const withoutUnit = {
      ...snapshotWorkoutSetDraft(reconcileWorkoutSetDrafts(trainingDay(), {}), 'set-1')!,
      actualLoad: 20,
      actualLoadUnit: null,
    };

    expect(hasLoadUnitForActualLoad(withoutUnit, null)).toBe(false);
    expect(hasLoadUnitForActualLoad({ ...withoutUnit, actualLoadUnit: 'Kilogram' }, null)).toBe(
      true,
    );
    expect(hasLoadUnitForActualLoad({ ...withoutUnit, actualLoad: null }, null)).toBe(true);
  });
});

function trainingDay(): ClientTrainingDayResult {
  return {
    isAllowed: true,
    accessReason: 'Allowed',
    localDate: '2026-08-21',
    workouts: [
      {
        sessionId: 'session-1',
        mesocycleId: 'mesocycle-1',
        workoutExecutionId: 'workout-1',
        name: 'Session',
        coachNotes: null,
        status: 'InProgress',
        exercises: [
          {
            prescriptionId: 'exercise-prescription-1',
            performanceId: 'exercise-performance-1',
            prescribedExerciseId: 'exercise-1',
            prescribedExerciseName: 'Squat',
            actualExerciseId: 'exercise-1',
            actualExerciseName: 'Squat',
            wasSubstituted: false,
            modificationPolicy: 'Locked',
            alternatives: [],
            coachNotes: null,
            mediaAssetIds: [],
            previousPerformance: null,
            sets: [1, 2, 3, 4].map(setView),
          },
        ],
        notes: [],
        executionVersion: 1,
      },
    ],
  };
}

function setView(index: number): ClientSetView {
  return {
    prescriptionId: `prescription-${index}`,
    performanceId: `set-${index}`,
    position: index,
    setType: 'Normal',
    prescribedRepetitionsMinimum: 8,
    prescribedRepetitionsMaximum: 10,
    prescribedLoad: 100,
    prescribedLoadUnit: 'Kilogram',
    prescribedTargetRpe: 8,
    prescribedTargetRir: null,
    restSeconds: 120,
    tempo: null,
    actualRepetitions: null,
    actualLoad: null,
    actualLoadUnit: 'Kilogram',
    actualRpe: null,
    actualRir: null,
    isCompleted: false,
    clientNote: null,
  };
}

function savedSet(overrides: Partial<WorkoutSetSaveView> = {}): WorkoutSetSaveView {
  return {
    workoutExecutionId: 'workout-1',
    executionVersion: 2,
    setPerformanceId: 'set-1',
    actualRepetitions: 11,
    actualLoad: 101,
    actualLoadUnit: 'Kilogram',
    actualRpe: 8,
    actualRir: null,
    isCompleted: true,
    clientNote: null,
    ...overrides,
  };
}
