import type {
  ClientTrainingDayResult,
  ClientTrainingWeekView,
  ClientWorkoutView,
  OwnWorkoutSetView,
  OwnWorkoutView,
} from '../app/core/api/generated';
import { day, TODAY } from './today-fixtures';

/**
 * A workout of one's own (TRN-033, notes plan N9b3) as Today's reads carry it, on Today's fixed day,
 * Sun 20 Sep 2026: "Workout", the name the server stores, started that morning with Bench press, the
 * first of its two sets logged.
 */
export function ownSet(id: string, position: number, isCompleted = false): OwnWorkoutSetView {
  return {
    performanceId: id,
    position,
    actualRepetitions: isCompleted ? 8 : null,
    actualLoad: isCompleted ? 60 : null,
    actualLoadUnit: isCompleted ? 'Kilogram' : null,
    actualRpe: null,
    actualRir: null,
    isCompleted,
    clientNote: null,
  };
}

export function ownWorkout(overrides: Partial<OwnWorkoutView> = {}): OwnWorkoutView {
  return {
    workoutExecutionId: 'own-1',
    name: 'Workout',
    date: TODAY,
    status: 'InProgress',
    startedAtUtc: '2026-09-20T06:00:00Z',
    completedAtUtc: null,
    version: 3,
    exercises: [
      {
        performanceId: 'own-bench',
        exerciseId: 'bench-press',
        exerciseName: 'Bench press',
        position: 1,
        mediaAssetIds: [],
        previousPerformance: null,
        sets: [ownSet('own-bench-1', 1, true), ownSet('own-bench-2', 2)],
      },
    ],
    notes: [],
    ...overrides,
  };
}

/** Today's read with a workout of one's own beside the program's workouts of the day. */
export function dayWithOwn(
  own: OwnWorkoutView | null,
  workouts: ClientWorkoutView[] = [],
): ClientTrainingDayResult {
  return { ...day(workouts), ownWorkout: own };
}

/**
 * The week of Mon 14 to Sun 20 Sep 2026 as `GET /api/training/me/week` answers it: each day's program
 * sessions planned and done, and the workouts of one's own finished on it. A day that gives no
 * `ownCompleted` leaves it out, as a read from before workouts of one's own did.
 */
export function trainingWeek(
  days: readonly { scheduled?: number; completed?: number; ownCompleted?: number }[] = [],
): ClientTrainingWeekView {
  return {
    isAllowed: true,
    accessReason: 'Granted',
    localDate: TODAY,
    weekStart: '2026-09-14',
    days: [0, 1, 2, 3, 4, 5, 6].map((offset) => {
      const counts = days[offset] ?? {};
      return {
        date: `2026-09-${14 + offset}`,
        scheduled: counts.scheduled ?? 0,
        completed: counts.completed ?? 0,
        ...(counts.ownCompleted === undefined ? {} : { ownCompleted: counts.ownCompleted }),
      };
    }),
  };
}
