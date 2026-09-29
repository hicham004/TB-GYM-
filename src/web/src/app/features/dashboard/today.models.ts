import type { FeatureAccessDecision, FeatureAccessReason } from '../../core/api/api.models';
import type {
  CheckInAssignmentListItem,
  CheckInAssignmentListView,
  ClientTrainingDayResult,
  ClientWorkoutView,
} from '../../core/api/generated';
import type { Conversation } from '../messaging/messaging.models';
import type { NutritionDay } from '../nutrition/nutrition.models';
import type { UpcomingTraining } from '../training/training-read.models';

/**
 * The rules behind the client's Today (339:2140 and its annotations), kept apart from the template
 * so every state has a fixed test. Nothing here reads a clock: "today" is always the workspace date
 * the server returned.
 */

export interface WorkoutSummary {
  exercises: number;
  sets: number;
  setsLogged: number;
}

export type TrainingCard =
  | { kind: 'hidden' }
  | { kind: 'access-closed'; reason: string }
  | { kind: 'scheduled'; workout: ClientWorkoutView; summary: WorkoutSummary; moreToday: number }
  | {
      kind: 'in-progress';
      workout: ClientWorkoutView;
      summary: WorkoutSummary;
      /** Set when the workout was started on an earlier day and is still open. */
      startedOn: string | null;
      /** An earlier workout outranks today's session, which is then offered as a link. */
      alsoToday: ClientWorkoutView | null;
      moreToday: number;
    }
  | { kind: 'completed'; workout: ClientWorkoutView; summary: WorkoutSummary }
  | { kind: 'rest-day'; next: { date: string; name: string } | null }
  | { kind: 'week-not-shared' }
  | { kind: 'between-programs'; startsOn: string }
  | { kind: 'nothing-assigned' };

export function workoutSummary(workout: ClientWorkoutView): WorkoutSummary {
  const sets = workout.exercises.flatMap((exercise) => exercise.sets);
  return {
    exercises: workout.exercises.length,
    sets: sets.length,
    setsLogged: sets.filter((set) => set.isCompleted).length,
  };
}

/**
 * Which training card Today shows. `hideWhenNotInPlan` is true when training is outside the plan
 * but something else is in it, so a nutrition-only client is not told nothing is assigned.
 */
export function trainingCard(
  day: ClientTrainingDayResult,
  upcoming: UpcomingTraining,
  hideWhenNotInPlan: boolean,
): TrainingCard {
  if (!day.isAllowed || !upcoming.isAllowed) {
    const reason = day.isAllowed ? upcoming.accessReason : day.accessReason;
    if (reason === 'NoEntitlement') {
      return hideWhenNotInPlan ? { kind: 'hidden' } : { kind: 'nothing-assigned' };
    }
    return { kind: 'access-closed', reason };
  }

  // Today's sessions arrive in their programmed order.
  const openToday = day.workouts.filter((workout) => workout.status !== 'Completed');
  const earlier = upcoming.unfinishedWorkouts[0];
  if (earlier) {
    return {
      kind: 'in-progress',
      workout: earlier.workout,
      summary: workoutSummary(earlier.workout),
      startedOn: earlier.date,
      alsoToday: openToday[0] ?? null,
      moreToday: Math.max(0, openToday.length - 1),
    };
  }

  const primary = openToday[0];
  if (primary) {
    const moreToday = openToday.length - 1;
    return primary.status === 'InProgress'
      ? {
          kind: 'in-progress',
          workout: primary,
          summary: workoutSummary(primary),
          startedOn: null,
          alsoToday: null,
          moreToday,
        }
      : { kind: 'scheduled', workout: primary, summary: workoutSummary(primary), moreToday };
  }

  if (day.workouts.length > 0) {
    return {
      kind: 'completed',
      workout: day.workouts[0],
      summary: workoutSummary(day.workouts[0]),
    };
  }

  // No workout today: the coverage says why, so a gap or an unshared week is never a rest day.
  const coverage = upcoming.todayCoverage;
  if (!coverage?.activeBlock) {
    return coverage?.nextBlockStartDate
      ? { kind: 'between-programs', startsOn: coverage.nextBlockStartDate }
      : { kind: 'nothing-assigned' };
  }
  if (!coverage.activeBlock.isCurrentWeekPublished) {
    return { kind: 'week-not-shared' };
  }
  return {
    kind: 'rest-day',
    next: upcoming.nextSession
      ? { date: upcoming.nextSession.date, name: upcoming.nextSession.name }
      : null,
  };
}

/** The outcome of one section's own read. `missing` is a 404, `denied` a 403. */
export type ReadState<T> =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'missing' }
  | { kind: 'denied' }
  | { kind: 'ok'; value: T };

export type RowState<T> =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'closed'; reason: FeatureAccessReason }
  | { kind: 'ready'; value: T };

/**
 * One feature's access decision against its read. A feature outside the plan has no row, a closed
 * one says why, and null leaves the rest to the read.
 */
function rowAccess<T>(
  decision: FeatureAccessDecision | null,
  read: ReadState<unknown>,
): RowState<T> | null {
  if (decision && !decision.isAllowed) {
    return decision.reason === 'NoEntitlement'
      ? { kind: 'hidden' }
      : { kind: 'closed', reason: decision.reason };
  }
  if (read.kind === 'loading') return { kind: 'loading' };
  if (read.kind === 'failed') return { kind: 'failed' };
  if (read.kind === 'denied') {
    // Refused while the decision is unknown: say it is closed without inventing a reason.
    return { kind: 'closed', reason: decision?.reason ?? 'Granted' };
  }
  return null;
}

export type NutritionRow =
  | { kind: 'no-plan' }
  | { kind: 'planned'; total: number }
  | { kind: 'logging'; logged: number; total: number }
  | { kind: 'completed'; logged: number; total: number };

/**
 * The nutrition row. The day read answers 404 both for "no plan today" and "no access", so a 404 is
 * "no plan" only once the access decision says nutrition is allowed; while the decision is still
 * loading the row keeps loading, and if it could not be read the row offers a retry.
 */
export function nutritionRow(
  decision: FeatureAccessDecision | null,
  accessStatus: 'idle' | 'loading' | 'loaded' | 'failed',
  read: ReadState<NutritionDay>,
): RowState<NutritionRow> {
  const access = rowAccess<NutritionRow>(decision, read);
  if (access) return access;
  if (read.kind === 'missing') {
    if (decision?.isAllowed) return { kind: 'ready', value: { kind: 'no-plan' } };
    return accessStatus === 'failed' ? { kind: 'failed' } : { kind: 'loading' };
  }
  if (read.kind !== 'ok') return { kind: 'failed' };
  const day = read.value;
  const total = day.slots.length;
  const logged = day.slots.filter((slot) => slot.selectedChoiceId).length;
  if (day.logStatus === 'Completed')
    return { kind: 'ready', value: { kind: 'completed', logged, total } };
  if (day.logStatus === 'InProgress')
    return { kind: 'ready', value: { kind: 'logging', logged, total } };
  return { kind: 'ready', value: { kind: 'planned', total } };
}

export type CheckInRow =
  | {
      kind: 'due';
      title: string;
      dueDate: string;
      when: 'today' | 'later' | 'overdue';
      draft: boolean;
    }
  | { kind: 'submitted-today'; title: string }
  | { kind: 'reviewed-today'; title: string }
  | { kind: 'nothing-due' };

/**
 * The check-in row: the open assignment (not started or a draft) due first; otherwise one sent today.
 * Only the first page (50, newest due date first) is read, so an open assignment beyond it is missed.
 */
export function checkInRow(
  decision: FeatureAccessDecision | null,
  read: ReadState<CheckInAssignmentListView>,
  today: string | null,
): RowState<CheckInRow> {
  const access = rowAccess<CheckInRow>(decision, read);
  if (access) return access;
  if (read.kind !== 'ok') return { kind: 'failed' };
  const items = read.value.items;
  const isOpen = (item: CheckInAssignmentListItem) =>
    item.response === null || item.response.status === 'Draft';
  const next = items
    .filter(isOpen)
    .sort((a, b) => a.assignment.dueDate.localeCompare(b.assignment.dueDate))[0];
  if (next) {
    const due = next.assignment.dueDate;
    const when = today === null || due > today ? 'later' : due === today ? 'today' : 'overdue';
    return {
      kind: 'ready',
      value: {
        kind: 'due',
        title: next.assignment.formTitle,
        dueDate: due,
        when,
        draft: next.response?.status === 'Draft',
      },
    };
  }
  const sentToday =
    today === null ? undefined : items.find((item) => item.response?.submittedDate === today);
  if (sentToday?.response?.status === 'Submitted') {
    return {
      kind: 'ready',
      value: { kind: 'submitted-today', title: sentToday.assignment.formTitle },
    };
  }
  if (sentToday?.response?.status === 'Reviewed') {
    return {
      kind: 'ready',
      value: { kind: 'reviewed-today', title: sentToday.assignment.formTitle },
    };
  }
  return { kind: 'ready', value: { kind: 'nothing-due' } };
}

/**
 * The coach's latest message. Shown only when a conversation has a message; a closed conversation
 * shows its reason instead of the text, and messaging outside the plan shows nothing at all.
 */
export function coachMessage(
  decision: FeatureAccessDecision | null,
  read: ReadState<Conversation | null>,
): RowState<Conversation> {
  if (decision?.reason === 'NoEntitlement') return { kind: 'hidden' };
  if (read.kind === 'loading') return { kind: 'loading' };
  if (read.kind !== 'ok') return read.kind === 'failed' ? { kind: 'failed' } : { kind: 'hidden' };
  const conversation = read.value;
  return conversation?.lastMessage ? { kind: 'ready', value: conversation } : { kind: 'hidden' };
}

/** Why a feature is closed, short enough for a row's status line. */
export function rowAccessLabel(reason: FeatureAccessReason): string {
  switch (reason) {
    case 'RelationshipBlocked':
      return $localize`Your coach has paused your access`;
    case 'Paused':
      return $localize`Your coaching plan is paused`;
    case 'Expired':
      return $localize`Your coaching plan has ended`;
    case 'Cancelled':
      return $localize`Your coaching plan was cancelled`;
    case 'PaymentRequired':
      return $localize`Your coaching plan is waiting for payment`;
    case 'NotStarted':
      return $localize`Your coaching plan has not started yet`;
    case 'NoEntitlement':
      return $localize`Not in your plan. Ask your coach.`;
    case 'MembershipInactive':
      return $localize`Your coaching has ended`;
    case 'PlatformBlocked':
      return $localize`Your account is blocked`;
    default:
      return $localize`Not available right now`;
  }
}

/** Date-only strings compare as calendar dates; an instant is compared by its device-local date. */
export function localDateOf(instant: string): string {
  const value = new Date(instant);
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}
