import type {
  ClientTrainingUpcomingView,
  ClientWorkoutView,
  CoachWorkoutDetailResult,
} from '../../core/api/generated';

export interface DatedWorkout {
  date: string;
  timeZoneId?: string;
  workout: ClientWorkoutView;
  hasMoreNotes: boolean;
}

export interface UpcomingTraining {
  isAllowed: boolean;
  accessReason: string;
  localDate: string;
  timeZoneId?: string;
  hasAssignedProgram: boolean;
  hasVisibleSessions: boolean;
  searchThrough: string;
  nextSession: { sessionId: string; date: string; name: string } | null;
  unfinishedWorkouts: DatedWorkout[];
  nextSkip: number | null;
  todayCoverage: TodayCoverage | null;
}

/** Which block covers the workspace's today (null when training is not allowed). */
export interface TodayCoverage {
  activeBlock: {
    id: string;
    name: string;
    weekNumber: number;
    weekCount: number;
    isCurrentWeekPublished: boolean;
  } | null;
  nextBlockStartDate: string | null;
}

export interface CoachWorkoutDetail {
  isAllowed: boolean;
  accessReason: string;
  detail: DatedWorkout | null;
  nextNotesSkip: number | null;
}

export function mapUpcomingTraining(value: ClientTrainingUpcomingView): UpcomingTraining {
  return {
    ...value,
    nextSession: value.nextSession ? { ...value.nextSession } : null,
    unfinishedWorkouts: value.unfinishedWorkouts.map((item) => ({ ...item })),
    nextSkip: value.nextSkip == null ? null : Number(value.nextSkip),
    todayCoverage: value.todayCoverage
      ? {
          activeBlock: value.todayCoverage.activeBlock
            ? {
                ...value.todayCoverage.activeBlock,
                weekNumber: Number(value.todayCoverage.activeBlock.weekNumber),
                weekCount: Number(value.todayCoverage.activeBlock.weekCount),
              }
            : null,
          nextBlockStartDate: value.todayCoverage.nextBlockStartDate,
        }
      : null,
  };
}

export function mapCoachWorkoutDetail(value: CoachWorkoutDetailResult): CoachWorkoutDetail {
  return {
    ...value,
    detail: value.detail ? { ...value.detail } : null,
    nextNotesSkip: value.nextNotesSkip == null ? null : Number(value.nextNotesSkip),
  };
}

export function trainingReadAccessLabel(reason: string): string {
  switch (reason) {
    case 'RelationshipBlocked':
      return $localize`Your coach has paused your access.`;
    case 'Expired':
      return $localize`Your coaching plan has ended. Contact your coach.`;
    case 'NotStarted':
      return $localize`Your coaching plan has not started yet.`;
    case 'NoEntitlement':
      return $localize`Training is not included in your coaching plan.`;
    case 'Paused':
      return $localize`Your coaching plan is paused.`;
    case 'Cancelled':
      return $localize`Your coaching plan has been cancelled.`;
    case 'PaymentRequired':
      return $localize`Contact your coach to activate your coaching plan.`;
    case 'PlatformBlocked':
      return $localize`Your account is blocked. Contact support.`;
    case 'MembershipInactive':
      return $localize`Your coaching has ended, so training is closed.`;
    default:
      return $localize`Training is not available. Contact your coach.`;
  }
}

export function workoutNoteTime(value: string, timeZone = 'UTC'): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
