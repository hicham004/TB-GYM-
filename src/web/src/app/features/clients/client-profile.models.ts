import { formatDate, formatNumber } from '@angular/common';
import type {
  CheckInAssignmentListItem,
  ClientPersonalRecordView,
  ClientPlanState,
  CoachAttentionItemView,
  CoachAttentionKind,
  CoachWeekView,
  FeatureAccessReason,
  MesocycleSummary,
} from '../../core/api/generated';
import type { StatusPillTone } from '../../ui/status-pill';
import { ago, carriedMaxDetail, suggestedMaxDetail } from '../dashboard/coach-today.models';
import type {
  DashboardNutrition,
  DashboardSection,
  ProgressDashboard,
} from '../progress/progress-dashboard.models';
import { activeBlock, addDays, bodyweightSummary, daysBetween } from './client-overview.models';
import { dayMark, type DayMark } from './clients.models';

/**
 * One client's page (C3) in coach words. Every figure is something a server read already decided
 * (CLI-018 for what needs the coach and the week, TRN-019 for records, ADR 0013 for the dashboard);
 * this only phrases it. Workspace dates ("today", "in 5 days") are measured against the date the
 * server sent, never the browser's, and only elapsed time ("2 hours ago") uses the device clock.
 */

export interface ProfileContext {
  locale: string;
  /** The device clock, for elapsed time only. */
  now: Date;
  clientId: string;
  /** The name the sentences use: "Maya asked to renew". */
  firstName: string;
}

export interface PageAction {
  label: string;
  link: string;
  queryParams: Record<string, string> | null;
}

// ------------------------------------------------------------------------------------------------
// Needs you
// ------------------------------------------------------------------------------------------------

export type NeedTone = 'review' | 'message' | 'renew' | 'ending' | 'share' | 'missed' | 'new';

export interface NeedRow {
  key: string;
  kind: CoachAttentionKind;
  tone: NeedTone;
  tag: string;
  heading: string;
  detail: string;
  action: PageAction;
}

/** What waits for the coach on this client, in the server's order, each with its one action. */
export function needRows(
  items: readonly CoachAttentionItemView[],
  today: string,
  context: ProfileContext,
): NeedRow[] {
  return items.map((item) => needRow(item, today, context));
}

function needRow(item: CoachAttentionItemView, today: string, context: ProfileContext): NeedRow {
  const count = Number(item.count ?? 0);
  const name = context.firstName;
  const page = `/clients/${context.clientId}`;
  const date = (value: string | null) =>
    value ? formatDate(value, 'EEE d MMM', context.locale) : '';
  const since = elapsed(item.since, context);
  const base = { key: item.kind, kind: item.kind };

  switch (item.kind) {
    case 'CheckInToReview':
      return {
        ...base,
        tone: 'review',
        tag: $localize`Check-in`,
        heading:
          count > 1
            ? $localize`${count}:count: check-ins to review`
            : $localize`Check-in ready to review`,
        detail:
          count > 1 ? $localize`The first was sent ${since}:ago:` : $localize`Sent ${since}:ago:`,
        // One waiting opens straight at its review; several open the list, where each can be read.
        action:
          item.subjectId && count <= 1
            ? {
                label: $localize`Review`,
                link: `${page}/checkins/${item.subjectId}`,
                queryParams: null,
              }
            : { label: $localize`Review`, link: `${page}/checkins`, queryParams: null },
      };
    case 'UnreadMessages':
      return {
        ...base,
        tone: 'message',
        tag: $localize`Message`,
        heading:
          count > 1 ? $localize`${count}:count: unread messages` : $localize`1 unread message`,
        detail: count > 1 ? $localize`The first came ${since}:ago:` : $localize`Sent ${since}:ago:`,
        action: {
          label: $localize`Reply`,
          link: '/messages',
          queryParams: item.subjectId ? { conversation: item.subjectId } : null,
        },
      };
    case 'RenewalRequested':
      return {
        ...base,
        tone: 'renew',
        tag: $localize`Renewal`,
        heading: $localize`${name}:name: asked to renew`,
        detail: $localize`Plan ended ${date(item.date)}:date:`,
        action: renewAction(page, item.subjectId),
      };
    case 'PlanEndingSoon': {
      const left = daysBetween(today, item.date ?? today);
      return {
        ...base,
        tone: 'ending',
        tag: $localize`Ending soon`,
        heading:
          left <= 0
            ? $localize`Plan ends today`
            : left === 1
              ? $localize`Plan ends tomorrow`
              : $localize`Plan ends in ${left}:count: days`,
        // Only a paid plan covers days (BEB-7): a renewal waiting for payment is what to act on.
        detail:
          count > 0
            ? $localize`Paid until ${date(item.date)}:date: · The renewal isn’t paid yet`
            : $localize`Last day ${date(item.date)}:date:`,
        action:
          count > 0 && item.subjectId
            ? {
                label: $localize`Record payment`,
                link: `${page}/service`,
                queryParams: { pay: item.subjectId },
              }
            : renewAction(page, item.subjectId),
      };
    }
    case 'WeekNotShared': {
      const week = Number(item.weekNumber ?? 0);
      const startsIn = daysBetween(today, item.date ?? today);
      return {
        ...base,
        tone: 'share',
        tag: $localize`Program`,
        heading: $localize`Week ${week}:week: isn’t shared with ${name}:name: yet`,
        detail:
          startsIn === 0
            ? $localize`It starts today`
            : startsIn === 1
              ? $localize`It starts tomorrow`
              : startsIn > 1
                ? $localize`It starts ${date(item.date)}:date:`
                : $localize`It started ${date(item.date)}:date:`,
        action: { label: $localize`Share week`, link: `${page}/training`, queryParams: null },
      };
    }
    case 'MissedSessions':
      return {
        ...base,
        tone: 'missed',
        tag: $localize`Missed`,
        heading: $localize`Missed ${count}:count: sessions in a row`,
        detail: item.date
          ? $localize`Last trained ${date(item.date)}:date:`
          : $localize`No workout logged yet`,
        action: { label: $localize`See training`, link: `${page}/training`, queryParams: null },
      };
    case 'MaxesToReview': {
      const lifts = item.maxes ?? [];
      return {
        ...base,
        tone: 'share',
        tag: $localize`Maxes`,
        heading:
          lifts.length === 1
            ? $localize`Logged sets suggest a new ${lifts[0].exerciseName}:lift: max`
            : $localize`Logged sets suggest new maxes for ${count}:count: lifts`,
        detail: suggestedMaxDetail(lifts, context.locale),
        action: {
          label: $localize`Review maxes`,
          link: `${page}/training`,
          queryParams: { action: 'maxes' },
        },
      };
    }
    case 'NoProgram':
      return {
        ...base,
        tone: 'new',
        tag: $localize`Program`,
        heading: item.subjectId ? $localize`No program running` : $localize`No program yet`,
        detail:
          (item.maxes ?? []).length > 0
            ? carriedMaxDetail(item.maxes ?? [], context.locale)
            : $localize`Joined ${date(item.date)}:date:`,
        // Opens the Training section with the Assign program sheet already open.
        action: {
          label: $localize`Assign program`,
          link: `${page}/training`,
          queryParams: { action: 'assign' },
        },
      };
  }
}

function renewAction(page: string, enrollmentId: string | null): PageAction {
  return {
    label: $localize`Renew plan`,
    link: `${page}/service`,
    queryParams: enrollmentId ? { renew: enrollmentId } : null,
  };
}

// ------------------------------------------------------------------------------------------------
// Why training is closed
// ------------------------------------------------------------------------------------------------

/**
 * The server's reason a feature is closed, read from where the client's plan stands: the week is
 * missing from the read exactly when training is not available, and `planState` says why.
 */
export function planStateReason(state: ClientPlanState): FeatureAccessReason {
  switch (state) {
    case 'Paused':
      return 'Paused';
    case 'PaymentDue':
      return 'PaymentRequired';
    case 'NotStarted':
      return 'NotStarted';
    case 'Ended':
      return 'Expired';
    case 'Blocked':
      return 'RelationshipBlocked';
    case 'Running':
    case 'None':
      return 'NoEntitlement';
  }
}

/**
 * Why a client's training is not shown, in a sentence. "Not part of the plan" and "the plan has
 * ended" are different facts, and saying the first about the second would be wrong.
 */
export function trainingClosed(reason: FeatureAccessReason, name: string): string {
  switch (reason) {
    case 'NoEntitlement':
      return $localize`Training isn’t part of ${name}:name:’s plan.`;
    case 'Expired':
      return $localize`${name}:name:’s plan has ended, so their training isn’t shown.`;
    case 'Cancelled':
      return $localize`${name}:name:’s plan was cancelled, so their training isn’t shown.`;
    case 'Paused':
      return $localize`${name}:name:’s plan is paused, so their training isn’t shown.`;
    case 'PaymentRequired':
      return $localize`${name}:name:’s plan is waiting for payment, so their training isn’t shown.`;
    case 'NotStarted':
      return $localize`${name}:name:’s plan hasn’t started yet.`;
    case 'RelationshipBlocked':
      return $localize`You have blocked ${name}:name:, so their training isn’t shown.`;
    case 'MembershipInactive':
      return $localize`${name}:name: is no longer with you, so their training isn’t shown.`;
    case 'PlatformBlocked':
      return $localize`${name}:name:’s access is blocked, so their training isn’t shown.`;
    default:
      return $localize`${name}:name:’s training isn’t available right now.`;
  }
}

// ------------------------------------------------------------------------------------------------
// This week
// ------------------------------------------------------------------------------------------------

export interface WeekDayView {
  date: string;
  /** "Mon", and in full for assistive technology. */
  label: string;
  longLabel: string;
  mark: DayMark;
  isToday: boolean;
  scheduled: number;
  completed: number;
  /** What the day's mark means, in words, for screen readers. */
  state: string;
}

export interface WeekStory {
  /** "Mon 28 Sep – Sun 4 Oct". */
  range: string;
  done: number;
  scheduled: number;
  days: WeekDayView[];
  summary: string;
}

/** The workspace's calendar week as seven marks, counted by the server as Today counts it. */
export function weekStory(week: CoachWeekView, today: string, locale: string): WeekStory {
  const days = week.days.map((day) => {
    const scheduled = Number(day.scheduled);
    const completed = Math.min(Number(day.completed), scheduled);
    const mark = dayMark(scheduled, completed, day.date, today);
    return {
      date: day.date,
      label: formatDate(day.date, 'EEE', locale),
      longLabel: formatDate(day.date, 'EEEE d MMMM', locale),
      mark,
      isToday: day.date === today,
      scheduled,
      completed,
      state: markState(mark, scheduled, completed),
    };
  });
  const done = Number(week.completed);
  const scheduled = Number(week.scheduled);
  const last = addDays(week.toExclusive, -1);
  return {
    range: $localize`${formatDate(week.from, 'EEE d MMM', locale)}:from: – ${formatDate(last, 'EEE d MMM', locale)}:to:`,
    done,
    scheduled,
    days,
    summary:
      scheduled === 0
        ? $localize`No sessions scheduled this week`
        : $localize`${done}:done: of ${scheduled}:scheduled: sessions done this week`,
  };
}

function markState(mark: DayMark, scheduled: number, completed: number): string {
  switch (mark) {
    case 'done':
      return scheduled > 1 ? $localize`all ${scheduled}:count: sessions done` : $localize`done`;
    case 'partial':
      return $localize`${completed}:done: of ${scheduled}:scheduled: sessions done`;
    case 'missed':
      return scheduled > 1 ? $localize`${scheduled}:count: sessions missed` : $localize`missed`;
    case 'due':
      return scheduled > 1
        ? $localize`${scheduled}:count: sessions to do`
        : $localize`session to do`;
    case 'rest':
      return $localize`no session`;
  }
}

/** "Lean & Strong · Phase 2 · Week 3 of 6", for the block covering today, if there is one. */
export function programLine(blocks: readonly MesocycleSummary[], today: string): string | null {
  const block = activeBlock(blocks, today);
  if (!block) return null;
  const weeks = Math.max(1, Math.round(daysBetween(block.startDate, block.endDateExclusive) / 7));
  const week = Math.min(
    weeks,
    Math.max(1, Math.floor(daysBetween(block.startDate, today) / 7) + 1),
  );
  return $localize`${block.name}:name: · Week ${week}:week: of ${weeks}:weeks:`;
}

export interface NutritionWeek {
  logged: number;
  elapsed: number;
  text: string;
}

/**
 * Days logged so far this week, never more than the days that have happened: the window the
 * dashboard counts over also holds days still to come.
 */
export function nutritionWeek(
  section: DashboardSection<DashboardNutrition>,
  elapsedDays: number,
): NutritionWeek | null {
  if (!section.available || !section.context) return null;
  const logged = Math.min(section.context.recentLoggedDayCount, elapsedDays);
  return {
    logged,
    elapsed: elapsedDays,
    text: $localize`${logged}:logged: of ${elapsedDays}:elapsed: days logged so far`,
  };
}

// ------------------------------------------------------------------------------------------------
// Weight
// ------------------------------------------------------------------------------------------------

export interface WeightStory {
  /** The latest weekly average, "71.4". */
  value: string;
  unit: string;
  /** "↓ 0.8 kg vs last week": a fact about the averages, never judged good or bad. */
  context: string;
  /** The latest weigh-in, "Last weighed Fri 2 Oct", or null when there is none in the window. */
  lastWeighed: string | null;
  /** Weekly averages, oldest first, for the sparkline. */
  values: number[];
  summary: string;
}

export function weightStory(
  dashboard: ProgressDashboard,
  locale: string,
  weeks: number,
): WeightStory | null {
  const summary = bodyweightSummary(dashboard.bodyweight.weeks);
  if (summary.latest === null) return null;
  const unit = dashboard.displayUnit === 'Pound' ? 'lb' : 'kg';
  const amount = (value: number) => formatNumber(Math.abs(value), locale, '1.1-1');
  const change = summary.change;
  const lastDate = dashboard.bodyweight.latestDate;
  return {
    value: formatNumber(summary.latest.value, locale, '1.1-1'),
    unit,
    context:
      change === null
        ? $localize`One week of weigh-ins so far`
        : change === 0
          ? $localize`No change on last week`
          : change < 0
            ? $localize`↓ ${amount(change)}:amount: ${unit}:unit: vs last week`
            : $localize`↑ ${amount(change)}:amount: ${unit}:unit: vs last week`,
    lastWeighed: lastDate
      ? $localize`Last weighed ${formatDate(lastDate, 'EEE d MMM', locale)}:date:`
      : null,
    values: summary.points.map((point) => point.value),
    summary: $localize`Weekly average weight over the last ${weeks}:weeks: weeks, from ${formatNumber(summary.points[0].value, locale, '1.1-1')}:first: to ${formatNumber(summary.latest.value, locale, '1.1-1')}:last: ${unit}:unit:`,
  };
}

// ------------------------------------------------------------------------------------------------
// Strength records
// ------------------------------------------------------------------------------------------------

export interface RecordRow {
  key: string;
  exercise: string;
  /** "85 kg × 5", in the unit it was lifted in: kilograms and pounds are never converted. */
  amount: string;
  date: string;
  isoDate: string;
  /** Set within the last seven days. */
  recent: boolean;
}

export function recordRows(
  items: readonly ClientPersonalRecordView[],
  today: string,
  locale: string,
): RecordRow[] {
  return items.map((item) => {
    const load = formatNumber(Number(item.load), locale, '1.0-2');
    const reps = Number(item.repetitions);
    return {
      key: `${item.exerciseId}:${reps}:${item.unit}`,
      exercise: item.exerciseName,
      amount:
        item.unit === 'Pound'
          ? $localize`${load}:load: lb × ${reps}:reps:`
          : $localize`${load}:load: kg × ${reps}:reps:`,
      date: formatDate(
        item.date,
        item.date.slice(0, 4) === today.slice(0, 4) ? 'EEE d MMM' : 'd MMM y',
        locale,
      ),
      isoDate: item.date,
      recent: daysBetween(item.date, today) < 7,
    };
  });
}

// ------------------------------------------------------------------------------------------------
// Latest check-in
// ------------------------------------------------------------------------------------------------

export interface CheckInCard {
  /** The newest check-in the client sent, or a plain line when none has been sent. */
  heading: string;
  detail: string;
  pill: { label: string; tone: StatusPillTone } | null;
  /** The next one still owed: when it is due, or that it is overdue. Null when none is open. */
  next: { text: string; late: boolean } | null;
  /**
   * The one thing to do about it, or null when there is nothing to do. It is shown quietly: Needs
   * you already carries the filled Review for the same check-in.
   */
  action: PageAction | null;
}

/**
 * The newest check-in the client sent, and the next one owed: workflow facts only. It never reads,
 * rates or compares an answer (CHK-012); comparing answers belongs to the review screen. Lateness is
 * a recorded fact, so it may be said.
 */
export function checkInCard(
  items: readonly CheckInAssignmentListItem[],
  today: string,
  context: ProfileContext,
): CheckInCard {
  const page = `/clients/${context.clientId}`;
  const date = (value: string) => formatDate(value, 'EEE d MMM', context.locale);
  const latest = items
    .filter(
      (item) =>
        (item.response?.status === 'Submitted' || item.response?.status === 'Reviewed') &&
        item.response.submittedAtUtc !== null,
    )
    .sort((a, b) => b.response!.submittedAtUtc!.localeCompare(a.response!.submittedAtUtc!))[0];
  const open = items
    .filter((item) => item.response === null || item.response.status === 'Draft')
    .sort((a, b) => a.assignment.dueDate.localeCompare(b.assignment.dueDate));
  // A client who missed several is told about the most recent one; the next one due comes after.
  const overdue = open.filter((item) => item.assignment.dueDate < today).at(-1);
  const upcoming = open.find((item) => item.assignment.dueDate >= today);
  const next = overdue
    ? {
        text: $localize`Was due ${date(overdue.assignment.dueDate)}:date:, not sent`,
        late: true,
      }
    : upcoming
      ? { text: $localize`Next one due ${date(upcoming.assignment.dueDate)}:date:`, late: false }
      : null;

  if (!latest) {
    return items.length === 0
      ? {
          heading: $localize`No check-ins yet`,
          detail: $localize`Once one is assigned, ${context.firstName}:name: reports in here.`,
          pill: null,
          next: null,
          action: {
            label: $localize`Open check-ins`,
            link: `${page}/checkins`,
            queryParams: null,
          },
        }
      : {
          heading: $localize`No check-in sent yet`,
          detail: '',
          pill: null,
          next,
          action: null,
        };
  }

  const response = latest.response!;
  const sent = elapsed(response.submittedAtUtc, context);
  const needsReview = response.status === 'Submitted';
  const detail = needsReview
    ? response.isLate
      ? $localize`Sent ${sent}:ago:, after its due date`
      : $localize`Sent ${sent}:ago:`
    : response.isLate
      ? $localize`Sent ${sent}:ago:, after its due date. Reviewed ${elapsed(response.reviewedAtUtc, context)}:reviewed:`
      : $localize`Sent ${sent}:ago:. Reviewed ${elapsed(response.reviewedAtUtc, context)}:reviewed:`;
  return {
    heading: latest.assignment.formTitle,
    detail,
    pill: needsReview
      ? { label: $localize`Needs review`, tone: 'warning' }
      : { label: $localize`Reviewed`, tone: 'success' },
    next,
    action: needsReview
      ? {
          label: $localize`Review`,
          link: `${page}/checkins/${latest.assignment.id}`,
          queryParams: null,
        }
      : null,
  };
}

// ------------------------------------------------------------------------------------------------

/** "just now", "35 minutes ago", "yesterday", in the reader's language. */
function elapsed(instant: string | null, context: ProfileContext): string {
  return ago(instant, { locale: context.locale, now: context.now, userId: null });
}
