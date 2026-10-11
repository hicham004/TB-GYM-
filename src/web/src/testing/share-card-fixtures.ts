import type {
  ClientProgramSummaryView,
  WorkoutPersonalRecordView,
} from '../app/core/api/generated';

/**
 * Share card facts (R6.1a) as the server sends them: Maya's bench press record from a finish summary,
 * and the eight-week program it finished. Plain data, so Playwright specs can use it too.
 */
export function personalRecord(
  overrides: Partial<WorkoutPersonalRecordView> = {},
): WorkoutPersonalRecordView {
  return {
    setPerformanceId: 'set-bench',
    exerciseName: 'Barbell bench press',
    repetitions: 6,
    load: 62.5,
    unit: 'Kilogram',
    ruleKey: 'ExactRepsLoad',
    ruleVersion: 1,
    ...overrides,
  };
}

export function programSummary(
  overrides: Partial<ClientProgramSummaryView> = {},
): ClientProgramSummaryView {
  return {
    id: 'block-1',
    name: 'Strength Foundations',
    startDate: '2026-08-10',
    endDateExclusive: '2026-10-05',
    weekCount: 8,
    workoutCount: 30,
    personalRecordCount: 7,
    personalRecordRuleKey: 'ExactRepsLoad',
    personalRecordRuleVersion: 1,
    ...overrides,
  };
}
