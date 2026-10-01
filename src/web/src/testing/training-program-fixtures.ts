import type {
  ClientProgramSessionView,
  ClientProgramWeekView,
  ClientSessionState,
  ClientTrainingProgramView,
  ClientWorkoutHistoryItemView,
  ClientWorkoutHistoryPage,
} from '../app/core/api/generated';

/**
 * Read on Wed 30 Sep 2026: "Strength Foundations" runs four weeks from Mon 14 Sep. Week 2 has a
 * missed session, week 3 is this week with "Lower A" due today, and week 4 opens on Mon 5 Oct.
 */
export const PROGRAM_TODAY = '2026-09-30';

export function programSession(
  id: string,
  name: string,
  scheduledDate: string,
  state: ClientSessionState,
): ClientProgramSessionView {
  return {
    sessionId: id,
    name,
    scheduledDate,
    state,
    workoutExecutionId: state === 'Completed' || state === 'InProgress' ? `w-${id}` : null,
    exerciseCount: 4,
    setCount: 12,
  };
}

function week(
  weekNumber: number,
  startDate: string,
  sessions: ClientProgramSessionView[],
  visible = true,
): ClientProgramWeekView {
  return { weekNumber, startDate, isVisible: visible, isShared: true, sessions };
}

export function programView(
  overrides: Partial<ClientTrainingProgramView> = {},
): ClientTrainingProgramView {
  return {
    isAllowed: true,
    accessReason: 'Granted',
    localDate: PROGRAM_TODAY,
    nextProgramStartDate: null,
    sessionStateRuleKey: 'WorkoutThenScheduledDate',
    sessionStateRuleVersion: 1,
    program: {
      id: 'block-1',
      name: 'Strength Foundations',
      startDate: '2026-09-14',
      endDateExclusive: '2026-10-12',
      phase: 'Current',
      weekCount: 4,
      currentWeekNumber: 3,
      sessionCount: 6,
      completedCount: 4,
      missedCount: 1,
      weeks: [
        week(1, '2026-09-14', [
          programSession('s1', 'Lower A', '2026-09-14', 'Completed'),
          programSession('s2', 'Upper A', '2026-09-17', 'Completed'),
        ]),
        week(2, '2026-09-21', [
          programSession('s3', 'Lower B', '2026-09-21', 'Completed'),
          programSession('s4', 'Upper B', '2026-09-24', 'Missed'),
        ]),
        week(3, '2026-09-28', [
          programSession('s5', 'Upper A', '2026-09-28', 'Completed'),
          programSession('s6', 'Lower A', PROGRAM_TODAY, 'Today'),
        ]),
        week(4, '2026-10-05', [], false),
      ],
    },
    ...overrides,
  };
}

export function historyItem(
  overrides: Partial<ClientWorkoutHistoryItemView> = {},
): ClientWorkoutHistoryItemView {
  return {
    workoutExecutionId: 'w-s5',
    name: 'Upper A',
    programName: 'Strength Foundations',
    date: '2026-09-28',
    completedAtUtc: '2026-09-28T17:52:00Z',
    durationSeconds: 3120,
    completedSetCount: 12,
    totalSetCount: 12,
    volume: [{ unit: 'Kilogram', loadTimesRepetitions: 4250 }],
    personalRecords: [
      {
        setPerformanceId: 'set-9',
        exerciseName: 'Bench press',
        repetitions: 6,
        load: 62.5,
        unit: 'Kilogram',
        ruleKey: 'ExactRepsLoad',
        ruleVersion: 1,
      },
    ],
    ...overrides,
  };
}

export function historyPage(
  items: ClientWorkoutHistoryItemView[] = [
    historyItem(),
    historyItem({
      workoutExecutionId: 'w-s3',
      name: 'Lower B',
      date: '2026-09-21',
      durationSeconds: 0,
      completedSetCount: 10,
      volume: [],
      personalRecords: [],
    }),
  ],
  nextSkip: number | null = null,
): ClientWorkoutHistoryPage {
  return {
    isAllowed: true,
    accessReason: 'Granted',
    items,
    nextSkip,
    personalRecordRuleKey: 'ExactRepsLoad',
    personalRecordRuleVersion: 1,
  };
}
