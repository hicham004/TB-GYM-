import { describe, expect, it } from 'vitest';
import type {
  ClientSetView,
  ClientTrainingDayResult,
  PreviousExercisePerformanceView,
  PreviousSetPerformanceView,
  WorkoutSetSaveView,
} from '../../core/api/generated';
import {
  applyWorkoutSetSave,
  effortOutOfRange,
  hasLoadUnitForActualLoad,
  previousSetFor,
  reconcileWorkoutSetDrafts,
  snapshotWorkoutSetDraft,
  startingWorkoutUnit,
  toRecordSetRequest,
  updateWorkoutSetDraft,
  withWorkoutUnit,
} from './workout-set-drafts';

describe('workout set drafts', () => {
  /**
   * TRN-029: one tap logs the set as prescribed. Live, Maya's squat target was 52.5 kg × 5 while
   * her rows started at last time's 50 × 5, so ✓ logged 50 kg under a Target line saying 52.5.
   */
  it('starts every set at the prescription, whatever was done last time', () => {
    const day = trainingDay();
    const exercise = day.workouts[0].exercises[0];
    exercise.previousPerformance = lastTime([
      { position: 1, repetitions: 9, load: 105, loadUnit: 'Kilogram', rpe: 8 },
      { position: 2, repetitions: 7, load: 230, loadUnit: 'Pound', rpe: 9 },
    ]);

    const drafts = reconcileWorkoutSetDrafts(day, {});

    for (const id of ['set-1', 'set-2', 'set-3', 'set-4']) {
      // The lowest of the 8–10 range, the coach's load and the coach's unit.
      expect(drafts[id]).toMatchObject({
        actualRepetitions: 8,
        actualLoad: 100,
        actualLoadUnit: 'Kilogram',
        dirty: false,
      });
    }
  });

  it('fills from last time only what the prescription leaves open, on the same set', () => {
    const day = trainingDay();
    const exercise = day.workouts[0].exercises[0];
    exercise.sets = exercise.sets.map((set) => ({
      ...set,
      prescribedLoad: null,
      prescribedLoadUnit: null,
      prescribedRepetitionsMinimum: null,
      prescribedRepetitionsMaximum: null,
      actualLoadUnit: null,
    }));
    exercise.sets[1].prescribedRepetitionsMinimum = 12;
    exercise.previousPerformance = lastTime([
      { position: 1, repetitions: 9, load: 40, loadUnit: 'Kilogram', rpe: 8 },
      { position: 2, repetitions: 7, load: 45, loadUnit: 'Kilogram', rpe: 8 },
      { position: 3, repetitions: 6, load: 100, loadUnit: 'Pound', rpe: 9 },
    ]);

    const drafts = reconcileWorkoutSetDrafts(day, {});

    expect(drafts['set-1']).toMatchObject({
      actualRepetitions: 9,
      actualLoad: 40,
      actualLoadUnit: 'Kilogram',
    });
    // The coach's 12 reps still win; only the open load comes from last time.
    expect(drafts['set-2']).toMatchObject({ actualRepetitions: 12, actualLoad: 45 });
    // With no prescribed unit, last time's own unit comes with its load.
    expect(drafts['set-3']).toMatchObject({
      actualRepetitions: 6,
      actualLoad: 100,
      actualLoadUnit: 'Pound',
    });
    // Nothing prescribed and nothing last time: empty, and no unit is guessed (TRN-016).
    expect(drafts['set-4']).toMatchObject({
      actualRepetitions: null,
      actualLoad: null,
      actualLoadUnit: null,
    });
  });

  it('never brings last time’s load into a set prescribed in the other unit', () => {
    const day = trainingDay();
    const exercise = day.workouts[0].exercises[0];
    exercise.sets[0] = { ...exercise.sets[0], prescribedLoad: null, actualLoadUnit: null };
    exercise.previousPerformance = lastTime([
      { position: 1, repetitions: 8, load: 225, loadUnit: 'Pound', rpe: 8 },
    ]);

    const drafts = reconcileWorkoutSetDrafts(day, {});

    expect(drafts['set-1']).toMatchObject({ actualLoad: null, actualLoadUnit: 'Kilogram' });
  });

  /** The coach wrote 100 kg for the squat; on the approved swap that number means nothing. */
  it('starts a swapped exercise from last time on it, keeping the prescribed reps', () => {
    const day = trainingDay();
    const exercise = day.workouts[0].exercises[0];
    exercise.wasSubstituted = true;
    exercise.actualExerciseId = 'exercise-2';
    exercise.actualExerciseName = 'Leg press';
    exercise.sets = exercise.sets.map((set) => ({ ...set, actualLoadUnit: null }));
    exercise.previousPerformance = lastTime([
      { position: 1, repetitions: 10, load: 160, loadUnit: 'Kilogram', rpe: 8 },
    ]);

    const drafts = reconcileWorkoutSetDrafts(day, {});

    expect(drafts['set-1']).toMatchObject({
      actualRepetitions: 8,
      actualLoad: 160,
      actualLoadUnit: 'Kilogram',
    });
    expect(drafts['set-2']).toMatchObject({
      actualRepetitions: 8,
      actualLoad: null,
      actualLoadUnit: 'Kilogram',
    });
  });

  it('keeps a logged set exactly as logged, and a typed draft over a reload', () => {
    const day = trainingDay();
    const exercise = day.workouts[0].exercises[0];
    // A bodyweight set logged with no load must not grow the prescribed 100 kg when edited.
    exercise.sets[0] = {
      ...exercise.sets[0],
      isCompleted: true,
      actualRepetitions: 12,
      actualLoad: null,
      actualLoadUnit: null,
    };
    exercise.sets[2].actualLoad = 110;

    let drafts = reconcileWorkoutSetDrafts(day, {});
    expect(drafts['set-1']).toMatchObject({
      actualRepetitions: 12,
      actualLoad: null,
      actualLoadUnit: null,
    });
    expect(drafts['set-3'].actualLoad).toBe(110);

    drafts = updateWorkoutSetDraft(drafts, 'set-2', { actualLoad: 97.5 });
    drafts = reconcileWorkoutSetDrafts(day, drafts);
    expect(drafts['set-2']).toMatchObject({ actualLoad: 97.5, dirty: true });
  });

  it('starts the kg or lb choice on the coach’s unit, else last time’s, else on neither', () => {
    const day = trainingDay();
    const workout = day.workouts[0];
    expect(startingWorkoutUnit(workout, reconcileWorkoutSetDrafts(day, {}))).toBe('Kilogram');

    const exercise = workout.exercises[0];
    exercise.sets = exercise.sets.map((set) => ({
      ...set,
      prescribedLoad: null,
      prescribedLoadUnit: null,
      actualLoadUnit: null,
    }));
    expect(startingWorkoutUnit(workout, reconcileWorkoutSetDrafts(day, {}))).toBeNull();

    exercise.previousPerformance = lastTime([
      { position: 2, repetitions: 8, load: 135, loadUnit: 'Pound', rpe: 8 },
    ]);
    expect(startingWorkoutUnit(workout, reconcileWorkoutSetDrafts(day, {}))).toBe('Pound');
  });

  it('reads last time’s set by its position, not its place in the list', () => {
    const exercise = trainingDay().workouts[0].exercises[0];
    exercise.previousPerformance = lastTime([
      { position: 1, repetitions: 9, load: 40, loadUnit: 'Kilogram', rpe: 8 },
      { position: 3, repetitions: 6, load: 50, loadUnit: 'Kilogram', rpe: 9 },
    ]);

    expect(previousSetFor(exercise, exercise.sets[1])).toBeNull();
    expect(previousSetFor(exercise, exercise.sets[2])?.load).toBe(50);
  });

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

  /**
   * Audit CLIENT-1: tapping lb then kg emptied every load, marked every set edited and so blocked
   * Finish. A choice of unit is not an edit, and kilograms and pounds are never converted.
   */
  describe('the kg or lb choice', () => {
    it('restarts an untouched set in the unit chosen, not edited, and back again', () => {
      const day = trainingDay();
      const workout = day.workouts[0];
      const start = reconcileWorkoutSetDrafts(day, {});

      const pounds = withWorkoutUnit(start, workout, 'Pound');
      // The coach wrote 100 kg: in pounds the set has no load until the client types one.
      expect(pounds['set-1']).toMatchObject({
        actualLoad: null,
        actualLoadUnit: 'Pound',
        actualRepetitions: 8,
        dirty: false,
      });

      const kilograms = withWorkoutUnit(pounds, workout, 'Kilogram');
      expect(kilograms['set-1']).toMatchObject({
        actualLoad: 100,
        actualLoadUnit: 'Kilogram',
        dirty: false,
      });
    });

    it('keeps a typed load’s number and gives it the unit chosen', () => {
      const day = trainingDay();
      let drafts = reconcileWorkoutSetDrafts(day, {});
      drafts = updateWorkoutSetDraft(drafts, 'set-2', { actualLoad: 225 });
      const typed = drafts['set-2'];

      drafts = withWorkoutUnit(drafts, day.workouts[0], 'Pound');
      expect(drafts['set-2']).toMatchObject({
        actualLoad: 225,
        actualLoadUnit: 'Pound',
        dirty: true,
      });
      // A save already on its way in kilograms must not settle the draft now in pounds.
      expect(drafts['set-2'].revision).toBe(typed.revision + 1);
      // Choosing the unit it already has changes nothing.
      expect(withWorkoutUnit(drafts, day.workouts[0], 'Pound')['set-2']).toBe(drafts['set-2']);
    });

    it('starts from last time’s load in the unit chosen, and leaves logged sets alone', () => {
      const day = trainingDay();
      const exercise = day.workouts[0].exercises[0];
      exercise.previousPerformance = lastTime([
        { position: 1, repetitions: 9, load: 225, loadUnit: 'Pound', rpe: 8 },
        { position: 2, repetitions: 9, load: 102.5, loadUnit: 'Kilogram', rpe: 8 },
      ]);
      exercise.sets[2] = {
        ...exercise.sets[2],
        isCompleted: true,
        actualRepetitions: 8,
        actualLoad: 100,
        actualLoadUnit: 'Kilogram',
      };

      const drafts = withWorkoutUnit(reconcileWorkoutSetDrafts(day, {}), day.workouts[0], 'Pound');
      expect(drafts['set-1']).toMatchObject({ actualLoad: 225, actualLoadUnit: 'Pound' });
      // Last time's 102.5 kg is not a pound number either.
      expect(drafts['set-2']).toMatchObject({ actualLoad: null, actualLoadUnit: 'Pound' });
      expect(drafts['set-3']).toMatchObject({ actualLoad: 100, actualLoadUnit: 'Kilogram' });
    });

    it('keeps the unit chosen when the day is read again', () => {
      const day = trainingDay();
      const drafts = reconcileWorkoutSetDrafts(day, {}, new Map([['session-1', 'Pound']]));

      expect(drafts['set-1']).toMatchObject({ actualLoad: null, actualLoadUnit: 'Pound' });
      expect(reconcileWorkoutSetDrafts(day, {})['set-1']).toMatchObject({
        actualLoad: 100,
        actualLoadUnit: 'Kilogram',
      });
    });
  });

  describe('effort', () => {
    it('sends RPE or reps left, never both, RPE first (STR-003)', () => {
      const snapshot = snapshotWorkoutSetDraft(
        reconcileWorkoutSetDrafts(trainingDay(), {}),
        'set-1',
      )!;

      expect(
        toRecordSetRequest({ ...snapshot, actualRpe: 8, actualRir: 2 }, 'Kilogram', 4),
      ).toMatchObject({
        rpe: 8,
        rir: null,
      });
      expect(
        toRecordSetRequest({ ...snapshot, actualRpe: null, actualRir: 1.5 }, 'Kilogram', 4),
      ).toMatchObject({
        rpe: null,
        rir: 1.5,
      });
    });

    it('finds the number the server would refuse before it is sent (STR-004)', () => {
      const effort = (actualRpe: number | null, actualRir: number | null) =>
        effortOutOfRange({ actualRpe, actualRir });

      expect([effort(8.5, null), effort(5, null), effort(10, null)]).toEqual([null, null, null]);
      expect([effort(8.3, null), effort(11, null), effort(4.5, null)]).toEqual([
        'rpe',
        'rpe',
        'rpe',
      ]);
      expect([effort(null, 0), effort(null, 1.5), effort(null, 5)]).toEqual([null, null, null]);
      expect([effort(null, 6), effort(null, 0.3), effort(null, -1)]).toEqual(['rir', 'rir', 'rir']);
      // The reps left a saved set reads back from its RPE are never checked over it.
      expect(effort(8, 7)).toBeNull();
      expect(effort(null, null)).toBeNull();
    });
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
    coachNotes: null,
    actualRepetitions: null,
    actualLoad: null,
    actualLoadUnit: 'Kilogram',
    actualRpe: null,
    actualRir: null,
    isCompleted: false,
    clientNote: null,
  };
}

function lastTime(sets: PreviousSetPerformanceView[]): PreviousExercisePerformanceView {
  return {
    date: '2026-08-19',
    bestLoad: null,
    unit: null,
    repetitions: null,
    rpe: null,
    sets,
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
