import type {
  ExerciseHistoryItem,
  ExerciseHistoryPage,
  ExerciseSearchResult,
  ExerciseView,
  StrengthMaxPage,
  StrengthMaxView,
} from '../app/core/api/generated';

export { NOW, TODAY, workspace } from './intake-fixtures';

/**
 * Rana Haddad's strength history (R5.3d), read on Sat 10 Oct 2026: a program's training maxes beside
 * a max the coach recorded by hand, as the server lists them (STR-015), newest first.
 */

export const SQUAT = 'ex-squat';
export const BENCH = 'ex-bench';
export const DEADLIFT = 'ex-deadlift';

export function maxView(overrides: Partial<StrengthMaxView> = {}): StrengthMaxView {
  return {
    id: 'max-1',
    clientProfileId: 'client-1',
    exerciseId: SQUAT,
    exerciseName: 'Back Squat',
    kind: 'CoachWorkingMax',
    value: 62.5,
    unit: 'Kilogram',
    effectiveDate: '2026-09-15',
    source: 'Calculation',
    methodKey: 'ProgramTrainingMax',
    methodVersion: '1.0',
    sourceWorkoutExecutionId: null,
    note: null,
    createdAtUtc: '2026-09-15T08:00:00Z',
    program: {
      mesocycleId: 'meso-2',
      programName: 'Lean & Strong · Phase 2',
      effectiveFromWeek: 1,
      origin: 'Typed',
    },
    ...overrides,
  };
}

/** Back Squat 60 then 62.5 kg as training maxes and a tested 92.5 kg; Bench 32.5 then 35; Deadlift 77.5. */
export function mayaMaxes(): StrengthMaxView[] {
  return [
    maxView({
      id: 'max-tested',
      kind: 'TestedOneRepMax',
      value: 92.5,
      effectiveDate: '2026-09-20',
      createdAtUtc: '2026-09-20T10:00:00Z',
      methodKey: 'TestedLift',
      source: 'Manual',
      note: 'Tested after the deload week.',
      program: null,
    }),
    maxView({ id: 'max-squat-2' }),
    maxView({
      id: 'max-bench-2',
      exerciseId: BENCH,
      exerciseName: 'Bench Press',
      value: 35,
      createdAtUtc: '2026-09-15T08:01:00Z',
    }),
    maxView({
      id: 'max-deadlift-1',
      exerciseId: DEADLIFT,
      exerciseName: 'Deadlift',
      value: 77.5,
      createdAtUtc: '2026-09-15T08:02:00Z',
    }),
    maxView({
      id: 'max-squat-1',
      value: 60,
      effectiveDate: '2026-08-05',
      createdAtUtc: '2026-08-05T08:00:00Z',
      program: {
        mesocycleId: 'meso-1',
        programName: 'Lean & Strong · Phase 1',
        effectiveFromWeek: 1,
        origin: 'Typed',
      },
    }),
    maxView({
      id: 'max-bench-1',
      exerciseId: BENCH,
      exerciseName: 'Bench Press',
      value: 32.5,
      effectiveDate: '2026-08-05',
      createdAtUtc: '2026-08-05T08:01:00Z',
      program: {
        mesocycleId: 'meso-1',
        programName: 'Lean & Strong · Phase 1',
        effectiveFromWeek: 1,
        origin: 'Typed',
      },
    }),
  ];
}

export function maxPage(items: StrengthMaxView[], total = items.length): StrengthMaxPage {
  return { total, skip: 0, take: 100, items };
}

export function exercise(
  id: string,
  name: string,
  overrides: Partial<ExerciseView> = {},
): ExerciseView {
  return {
    id,
    name,
    instructions: null,
    equipment: 'Barbell',
    movementPattern: 'Squat',
    classification: 'Strength',
    isArchived: false,
    muscles: [],
    tags: [],
    alternatives: [],
    mediaAssetIds: [],
    version: 1,
    ...overrides,
  };
}

export function library(names: readonly (readonly [string, string])[]): ExerciseSearchResult {
  const items = names.map(([id, name]) => exercise(id, name));
  return { total: items.length, items };
}

export function performance(
  date: string,
  load: number | null,
  repetitions: number | null,
  estimate: number | null,
  overrides: Partial<ExerciseHistoryItem> = {},
): ExerciseHistoryItem {
  return {
    workoutExecutionId: `workout-${date}`,
    date,
    prescribedExerciseId: SQUAT,
    actualExerciseId: SQUAT,
    wasSubstituted: false,
    repetitions,
    load,
    loadUnit: load === null ? null : 'Kilogram',
    rpe: 8,
    rir: null,
    estimatedOneRepMax: estimate,
    // These numbers are Epley's; a set read on the RTS chart says so (TRAIN-4).
    estimateMethodKey: estimate === null ? null : 'Epley',
    volume: load !== null && repetitions !== null ? load * repetitions : null,
    note: null,
    ...overrides,
  };
}

/** Squat top sets, newest first as the server sends them. */
export function squatHistory(): ExerciseHistoryPage {
  const items = [
    performance('2026-10-08', 60, 5, 70, { note: 'Felt fast.' }),
    performance('2026-10-04', 57.5, 5, 67.1),
    performance('2026-09-29', 55, 6, 65.5, { wasSubstituted: true }),
    performance('2026-09-24', null, 8, null, { rpe: null, rir: 2 }),
  ];
  return { total: items.length, skip: 0, take: 50, items };
}
