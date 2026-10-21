import type {
  CheckInAssignmentListItem,
  CheckInResponseStatus,
  ClientPersonalRecordsResult,
  ClientProfileOverviewView,
  CoachWeekView,
  MesocycleSummary,
  ProgressDashboardView,
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
    planName: 'Online coaching',
    attention: [],
    lastActivityKind: 'WorkoutCompleted',
    lastActivityAtUtc: '2026-10-01T10:00:00Z',
    lastWorkout: {
      kind: 'WorkoutCompleted',
      client: MAYA,
      occurredAtUtc: '2026-10-01T10:00:00Z',
      subjectId: 'workout-1',
      title: 'Lower A',
      durationSeconds: 3120,
      personalRecords: [{ exerciseName: 'Back squat', repetitions: 5, load: 85, unit: 'Kilogram' }],
    },
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

/** One week of weigh-ins: its first day, its mean in the display unit and the days weighed. */
export interface DashboardWeekView {
  readonly weekStart: string;
  readonly displayMean: number | null;
  readonly observedDayCount: number;
}

/** A calendar date some days on, as the server writes it. */
function addDaysTo(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/**
 * `progressDashboard()` as the server sends it (`mapProgressDashboard` turns one into the other),
 * which the client's page reads and maps itself (audit WEB-5). Its weigh-ins can be replaced.
 */
export function progressDashboardView(
  bodyweight: {
    readonly weeks?: readonly DashboardWeekView[];
    readonly latestDate?: string | null;
  } = {},
): ProgressDashboardView {
  const view = progressDashboard();
  const latestDate =
    bodyweight.latestDate === undefined ? view.bodyweight.latestDate : bodyweight.latestDate;
  return {
    clientProfileId: view.clientProfileId,
    timeZoneId: view.timeZoneId,
    weekStartsOn: 'Monday',
    from: view.from,
    toExclusive: view.toExclusive,
    windowDayCount: view.windowDayCount,
    displayUnit: view.displayUnit,
    measurementDisplayUnit: view.measurementDisplayUnit,
    bodyweight: {
      latest:
        latestDate === null
          ? null
          : {
              id: 'weight-latest',
              measurementDate: latestDate,
              valueKilograms: 71.2,
              enteredValue: 71.2,
              enteredUnit: 'Kilogram',
              source: 'Client',
              recordedByUserId: null,
              recordedAtUtc: `${latestDate}T05:10:00Z`,
              status: 'Active',
              version: 1,
            },
      latestDisplayValue: view.bodyweight.latestDisplayValue,
      change: null,
      weeks: (bodyweight.weeks ?? view.bodyweight.weeks).map((week) => ({
        weekStart: week.weekStart,
        weekEndExclusive: addDaysTo(week.weekStart, 7),
        meanKilograms: week.displayMean,
        displayMean: week.displayMean,
        observedDayCount: week.observedDayCount,
      })),
      trend: {
        isEstimate: true,
        availability: 'Available',
        methodKey: 'BodyweightTrendEwma',
        methodVersion: '1',
        timeConstantDays: 10,
        warmupDays: 7,
        minimumSampleCount: 5,
        sampleCount: view.bodyweight.observedDayCount,
        windowStart: view.from,
        windowEndExclusive: view.toExclusive,
        latestEstimateKilograms: view.bodyweight.trendEstimate,
        latestDisplayEstimate: view.bodyweight.trendEstimate,
      },
      observedDayCount: view.bodyweight.observedDayCount,
    },
    measurements: { measurements: [], observedDayCount: 0 },
    photos: { poses: [], photoCount: 0, missingThumbnailCount: 0, previewPhotoCount: 0 },
    nutrition: {
      feature: 'Nutrition',
      availability: 'Available',
      reason: 'Granted',
      context: {
        recentFrom: WEEK_FROM,
        recentToExclusive: '2026-10-05',
        ...view.nutrition.context!,
      },
    },
    training: {
      feature: 'Training',
      availability: 'Available',
      reason: 'Granted',
      context: {
        recentFrom: WEEK_FROM,
        recentToExclusive: '2026-10-05',
        ...view.training.context!,
      },
    },
  };
}
