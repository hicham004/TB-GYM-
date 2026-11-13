import type {
  ExercisePoolPage,
  OwnWorkoutExerciseView,
  OwnWorkoutSetView,
  OwnWorkoutView,
  PoolExerciseView,
  WorkoutNoteView,
} from '../app/core/api/generated';

/**
 * A workout of one's own (TRN-033, notes plan N9b3) as its routes answer it, and TB Gym's exercise pool
 * (LIB-006) its picker lists: generated-contract fixtures for the player, the picker and their models.
 * The workout is "Workout", the name the server gives every one, started on Fri 13 Nov 2026 at version 5
 * with Goblet squat and its one empty set.
 */

/** A pool exercise as the picker lists it; its id is what an exercise of the workout points at. */
export function poolExercise(
  name: string,
  overrides: Partial<PoolExerciseView> = {},
): PoolExerciseView {
  return {
    id: `pool-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    classification: 'Strength',
    typeName: null,
    equipment: 'Barbell',
    movementPattern: 'Squat',
    muscles: [{ muscle: 'Quadriceps', role: 'Primary' }],
    instructions: null,
    demos: [],
    ...overrides,
  };
}

/** The pool in name order: Bench press, Goblet squat with a video demo, Plank with no equipment. */
export const POOL_BENCH_PRESS = poolExercise('Bench press', {
  movementPattern: 'HorizontalPush',
  // The main muscle listed second: the picker's line still names it.
  muscles: [
    { muscle: 'Triceps', role: 'Secondary' },
    { muscle: 'Chest', role: 'Primary' },
  ],
});
export const POOL_GOBLET_SQUAT = poolExercise('Goblet squat', {
  equipment: 'Kettlebell',
  muscles: [
    { muscle: 'Quadriceps', role: 'Primary' },
    { muscle: 'Glutes', role: 'Secondary' },
  ],
  demos: [{ mediaAssetId: 'm-goblet-video', kind: 'Video' }],
});
export const POOL_PLANK = poolExercise('Plank', {
  equipment: 'None',
  movementPattern: 'Other',
  muscles: [{ muscle: 'Abdominals', role: 'Primary' }],
});

/** One page of the pool as `GET /api/exercise-pool` answers it while Training is open. */
export function poolPage(
  items: PoolExerciseView[],
  total: number = items.length,
): ExercisePoolPage {
  return { isAllowed: true, accessReason: 'Granted', total, items };
}

export function ownSetView(overrides: Partial<OwnWorkoutSetView> = {}): OwnWorkoutSetView {
  return {
    performanceId: 'own-set-1',
    position: 1,
    actualRepetitions: null,
    actualLoad: null,
    actualLoadUnit: null,
    actualRpe: null,
    actualRir: null,
    isCompleted: false,
    clientNote: null,
    ...overrides,
  };
}

/** A set as logged: 24 kg × 10 unless told otherwise. */
export function loggedOwnSetView(overrides: Partial<OwnWorkoutSetView> = {}): OwnWorkoutSetView {
  return ownSetView({
    actualRepetitions: 10,
    actualLoad: 24,
    actualLoadUnit: 'Kilogram',
    isCompleted: true,
    ...overrides,
  });
}

export function ownExerciseView(
  overrides: Partial<OwnWorkoutExerciseView> = {},
): OwnWorkoutExerciseView {
  return {
    performanceId: 'own-exercise-1',
    exerciseId: POOL_GOBLET_SQUAT.id,
    exerciseName: POOL_GOBLET_SQUAT.name,
    position: 1,
    mediaAssetIds: [],
    previousPerformance: null,
    sets: [ownSetView()],
    ...overrides,
  };
}

export function ownWorkoutView(overrides: Partial<OwnWorkoutView> = {}): OwnWorkoutView {
  return {
    workoutExecutionId: 'own-1',
    name: 'Workout',
    date: '2026-11-13',
    status: 'InProgress',
    startedAtUtc: '2026-11-13T07:00:00Z',
    completedAtUtc: null,
    version: 5,
    exercises: [ownExerciseView()],
    notes: [],
    ...overrides,
  };
}

/** The trainee's own note: on the whole workout, or on the exercise it names. */
export function ownWorkoutNote(
  text: string,
  exercisePerformanceId: string | null = null,
): WorkoutNoteView {
  return {
    id: `note-${exercisePerformanceId ?? 'workout'}`,
    exercisePerformanceId,
    authorUserId: 'trainee-1',
    authorRole: 'Client',
    text,
    createdAtUtc: '2026-11-13T07:20:00Z',
  };
}
