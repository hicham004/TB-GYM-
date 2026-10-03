import type {
  CheckInAssignmentListItem,
  CheckInResponseStatus,
  ClientPersonalRecordsResult,
  ClientProfileOverviewView,
  CoachWeekView,
  MesocycleSummary,
} from '../app/core/api/generated';
import type { ProgressDashboard } from '../app/features/progress/progress-dashboard.models';
import { COACH_TODAY, MAYA } from './coach-today-fixtures';

/**
 * Maya Fakhoury's page (C3) on Thu 1 Oct 2026, the same day and people as Coach Today's fixtures.
 * The workspace week runs Mon 28 Sep to Sun 4 Oct, so today is the fourth day of seven.
 */
export const WEEK_FROM = '2026-09-28';

/** Seven days of [scheduled, completed], Monday first. */
export function weekDays(counts: readonly (readonly [number, number])[]): CoachWeekView {
  const days = counts.map(([scheduled, completed], index) => ({
    date: new Date(Date.parse(`${WEEK_FROM}T00:00:00Z`) + index * 86_400_000)
      .toISOString()
      .slice(0, 10),
    scheduled,
    completed,
  }));
  return {
    from: WEEK_FROM,
    toExclusive: '2026-10-05',
    scheduled: days.reduce((sum, day) => sum + day.scheduled, 0),
    completed: days.reduce((sum, day) => sum + day.completed, 0),
    days,
  };
}

export const MAYA_WEEK = weekDays([
  [1, 1], // Mon: done
  [0, 0], // Tue: rest
  [2, 1], // Wed: one of two
  [1, 0], // Thu, today: still to do
  [1, 0], // Fri: to do
  [0, 0],
  [0, 0],
]);

export function profileOverview(
  overrides: Partial<ClientProfileOverviewView> = {},
): ClientProfileOverviewView {
  return {
    today: COACH_TODAY,
    client: MAYA,
    joinedOn: '2026-07-14',
    isNew: false,
    status: 'OnTrack',
    planState: 'Running',
    planEndsOn: '2026-12-20',
    attention: [],
    lastActivityKind: 'WorkoutCompleted',
    lastActivityAtUtc: '2026-10-01T10:00:00Z',
    week: MAYA_WEEK,
    attentionRuleKey: 'CoachAttention',
    attentionRuleVersion: 1,
    trainingRuleKey: 'MissedSinceLastWorkoutAndUnsharedWeek',
    trainingRuleVersion: 1,
    ...overrides,
  };
}

export function personalRecords(
  items: ClientPersonalRecordsResult['items'] = [],
  overrides: Partial<ClientPersonalRecordsResult> = {},
): ClientPersonalRecordsResult {
  return { isAllowed: true, accessReason: 'Granted', items, ...overrides };
}

export function record(
  exerciseName: string,
  repetitions: number,
  load: number,
  date: string,
  unit: 'Kilogram' | 'Pound' = 'Kilogram',
): ClientPersonalRecordsResult['items'][number] {
  return {
    exerciseId: `exercise-${exerciseName.toLowerCase().replace(/\W+/g, '-')}`,
    exerciseName,
    date,
    repetitions,
    load,
    unit,
    ruleKey: 'ExactRepsLoad',
    ruleVersion: 1,
  };
}

export function checkInItem(
  id: string,
  dueDate: string,
  status: CheckInResponseStatus | null,
  submittedAtUtc: string | null = null,
  reviewedAtUtc: string | null = null,
  isLate = false,
): CheckInAssignmentListItem {
  return {
    assignment: {
      id,
      formId: 'form-1',
      formTitle: 'Weekly check-in',
      formVersionId: 'version-1',
      formVersionNumber: 1,
      clientProfileId: MAYA.clientProfileId,
      dueDate,
      assignedAtUtc: '2026-09-01T09:00:00Z',
      assignedByUserId: 'coach-1',
    },
    response:
      status === null
        ? null
        : {
            responseId: `response-${id}`,
            status,
            submittedDate: submittedAtUtc?.slice(0, 10) ?? null,
            submittedAtUtc,
            reviewedAtUtc,
            isLate,
          },
  };
}

export function programBlock(overrides: Partial<MesocycleSummary> = {}): MesocycleSummary {
  return {
    id: 'block-1',
    enrollmentId: 'enrollment-1',
    name: 'Lean & Strong · Phase 2',
    startDate: '2026-09-14',
    endDateExclusive: '2026-10-26',
    kind: 'Primary',
    status: 'Active',
    revealAllWeeks: false,
    version: 1,
    ...overrides,
  };
}

/** A progress dashboard window of eight weeks ending with this one. */
export function progressDashboard(overrides: Partial<ProgressDashboard> = {}): ProgressDashboard {
  return {
    clientProfileId: MAYA.clientProfileId,
    timeZoneId: 'Asia/Beirut',
    from: '2026-08-10',
    toExclusive: '2026-10-05',
    windowDayCount: 56,
    displayUnit: 'Kilogram',
    measurementDisplayUnit: 'Centimetre',
    bodyweight: {
      latestDate: '2026-10-01',
      latestDisplayValue: 71.2,
      change: null,
      weeks: [
        { weekStart: '2026-09-07', displayMean: 72.6, observedDayCount: 6 },
        { weekStart: '2026-09-14', displayMean: 72.2, observedDayCount: 7 },
        { weekStart: '2026-09-21', displayMean: 71.8, observedDayCount: 6 },
        { weekStart: '2026-09-28', displayMean: 71.4, observedDayCount: 4 },
      ],
      trendEstimate: 71.5,
      trendIsAvailable: true,
      observedDayCount: 40,
    },
    measurements: [],
    measurementObservedDayCount: 0,
    photos: { poses: [], photoCount: 0, missingThumbnailCount: 0, previewPhotoCount: 0 },
    nutrition: {
      available: true,
      reason: 'Granted',
      context: {
        recentDayCount: 7,
        recentLoggedDayCount: 6,
        recentCompletedDayCount: 4,
        windowLoggedDayCount: 40,
        windowCompletedDayCount: 30,
        lastLoggedDate: '2026-10-01',
      },
    },
    training: {
      available: true,
      reason: 'Granted',
      context: {
        recentDayCount: 7,
        recentScheduledSessionCount: 5,
        recentCompletedWorkoutCount: 2,
        windowScheduledSessionCount: 30,
        windowCompletedWorkoutCount: 27,
        windowInProgressWorkoutCount: 0,
        lastCompletedDate: '2026-09-30',
      },
    },
    isEmpty: false,
    ...overrides,
  };
}
