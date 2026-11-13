import type {
  ExercisePoolExerciseResult,
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

/** The pool's page and an exercise's page (notes plan N9b4): a demo that is a picture. */
export const POOL_DUMBBELL_ROW = poolExercise('Dumbbell row', {
  equipment: 'Dumbbell',
  movementPattern: 'HorizontalPull',
  muscles: [{ muscle: 'Back', role: 'Primary' }],
  demos: [{ mediaAssetId: 'm-row-photo', kind: 'Picture' }],
});
/** A demo that is a YouTube video, which opens on YouTube's own page (C18). */
export const POOL_ROMANIAN_DEADLIFT = poolExercise('Romanian deadlift', {
  movementPattern: 'Hinge',
  muscles: [{ muscle: 'Hamstrings', role: 'Primary' }],
  demos: [{ mediaAssetId: 'm-rdl-link', kind: 'VideoLink' }],
});
/**
 * Everything an exercise's page shows: the house's own type, the muscles it also works, instructions
 * over two lines, and three demos (a picture first, then a video, then a link).
 */
export const POOL_WALKING_LUNGE = poolExercise('Walking lunge', {
  classification: 'Other',
  typeName: 'Rehab',
  equipment: 'None',
  movementPattern: 'Locomotion',
  muscles: [
    { muscle: 'Quadriceps', role: 'Primary' },
    { muscle: 'Glutes', role: 'Secondary' },
    { muscle: 'Hamstrings', role: 'Secondary' },
  ],
  instructions: 'Step forward and lower the back knee.\nPush through the front heel to stand.',
  demos: [
    { mediaAssetId: 'm-lunge-photo', kind: 'Picture' },
    { mediaAssetId: 'm-lunge-video', kind: 'Video' },
    { mediaAssetId: 'm-lunge-link', kind: 'VideoLink' },
  ],
});

/** One exercise as `GET /api/exercise-pool/{id}` answers it: null when it is not in the pool. */
export function poolResult(
  exercise: PoolExerciseView | null,
  overrides: Partial<ExercisePoolExerciseResult> = {},
): ExercisePoolExerciseResult {
  return { isAllowed: true, accessReason: 'Granted', exercise, ...overrides };
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
