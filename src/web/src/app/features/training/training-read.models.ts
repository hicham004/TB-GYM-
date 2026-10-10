import { formatNumber } from '@angular/common';
import type {
  ClientSetView,
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

/**
 * Why a coach cannot read a client's workout, in a coach's words. The client's own sentence
 * ("Your coaching plan has ended") would read as if it were addressed to the coach.
 */
export function coachWorkoutAccessLabel(reason: string): string {
  switch (reason) {
    case 'RelationshipBlocked':
      return $localize`Their access is paused, so this workout is closed.`;
    case 'Expired':
      return $localize`Their plan has ended, so this workout is closed.`;
    case 'NotStarted':
      return $localize`Their plan has not started yet.`;
    case 'NoEntitlement':
      return $localize`Training is not included in their plan.`;
    case 'Paused':
      return $localize`Their plan is paused, so this workout is closed.`;
    case 'Cancelled':
      return $localize`Their plan was cancelled, so this workout is closed.`;
    case 'PaymentRequired':
      return $localize`Their plan is not active yet, so this workout is closed.`;
    case 'PlatformBlocked':
      return $localize`Their account is blocked, so this workout is closed.`;
    case 'MembershipInactive':
      return $localize`Their coaching has ended, so this workout is closed.`;
    default:
      return $localize`Training is not available for this client.`;
  }
}

type Quantity = null | number | string;

function numberText(value: Quantity, locale: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? formatNumber(number, locale, '1.0-2') : null;
}

/** "6" when one number is asked for, "6–8" for a range, and nothing when no reps are set. */
function repsText(minimum: Quantity, maximum: Quantity, locale: string): string | null {
  const low = numberText(minimum, locale);
  const high = numberText(maximum, locale);
  if (low === null && high === null) return null;
  if (low === null) return $localize`up to ${high}:reps: reps`;
  if (high === null || Number(minimum) === Number(maximum)) return $localize`${low}:reps: reps`;
  return $localize`${low}:low:–${high}:high: reps`;
}

function loadText(load: Quantity, unit: null | string, locale: string): string | null {
  const value = numberText(load, locale);
  return value === null ? null : `${value} ${unit === 'Pound' ? 'lb' : 'kg'}`;
}

/** RPE is the canonical effort scale; RIR is said only when no RPE was set. */
function effortText(rpe: Quantity, rir: Quantity, locale: string): string | null {
  const effort = numberText(rpe, locale);
  if (effort !== null) return `RPE ${effort}`;
  const reserve = numberText(rir, locale);
  return reserve === null ? null : `RIR ${reserve}`;
}

function joined(parts: (string | null)[]): string {
  return parts.filter((part): part is string => part !== null).join(' · ');
}

/** What the coach asked for in a set, such as "6–8 reps · 60 kg · RPE 8". */
export function setTargetText(set: ClientSetView, locale: string): string {
  const text = joined([
    repsText(set.prescribedRepetitionsMinimum, set.prescribedRepetitionsMaximum, locale),
    loadText(set.prescribedLoad, set.prescribedLoadUnit, locale),
    effortText(set.prescribedTargetRpe, set.prescribedTargetRir, locale),
  ]);
  return text === '' ? $localize`Open` : text;
}

/** What the client logged in a set, or a dash when nothing was entered (the status says Not logged). */
export function setActualText(set: ClientSetView, locale: string): string {
  const text = joined([
    repsText(set.actualRepetitions, set.actualRepetitions, locale),
    loadText(set.actualLoad, set.actualLoadUnit, locale),
    effortText(set.actualRpe, set.actualRir, locale),
  ]);
  return text === '' ? '—' : text;
}
