import { formatDate, formatNumber } from '@angular/common';
import type {
  CoachActivityItemView,
  CoachActivityKind,
  CoachAttentionItemView,
  CoachAttentionKind,
  CoachClientRef,
  CoachTodayView,
} from '../../core/api/generated';
import { initialsOf } from '../../shell/initials';

/**
 * Coach Today (C1) in coach words: the server's queue, feed and week (CLI-018) turned into rows a
 * template can draw. Ranking, gating and counting stay on the server; this only phrases them.
 * Workspace dates ("today", "tomorrow") are measured against the date the server sent, never the
 * browser's, and only elapsed time ("2 hours ago") uses the device clock.
 */

export type AttentionTone = 'review' | 'message' | 'renew' | 'ending' | 'share' | 'missed' | 'new';

export interface CoachAction {
  label: string;
  /** Read after the label by screen readers, so every button in the queue says whose it is. */
  forWhom: string;
  link: string;
  queryParams: Record<string, string> | null;
}

export interface AttentionRow {
  key: string;
  kind: CoachAttentionKind;
  clientId: string;
  name: string;
  initials: string;
  heading: string;
  detail: string;
  /** The client's coach, shown to an Owner for a team member's client; null for the caller's own. */
  coach: string | null;
  tag: string;
  tone: AttentionTone;
  action: CoachAction;
}

export interface ActivityRow {
  key: string;
  kind: CoachActivityKind;
  name: string;
  initials: string;
  sentence: string;
  /** The first records of a workout, phrased ("Back squat 130 kg × 6"), and how many more it set. */
  records: string[];
  moreRecords: number;
  occurredAt: string;
  ago: string;
  link: string;
}

export interface WeekBar {
  date: string;
  label: string;
  longLabel: string;
  scheduled: number;
  completed: number;
  isToday: boolean;
  isFuture: boolean;
  /** Bar height against the busiest day, and the done share of that bar, both in percent. */
  height: number;
  done: number;
}

export interface CoachToday {
  today: string;
  dateLabel: string;
  partOfDay: 'morning' | 'afternoon' | 'evening';
  clientCount: number;
  /** Distinct clients with anything in the queue. */
  needsCount: number;
  plansEndingSoon: number;
  renewalRequests: number;
  attention: AttentionRow[];
  activity: ActivityRow[];
  week: {
    from: string;
    scheduled: number;
    completed: number;
    dueSoFar: number;
    bars: WeekBar[];
  };
}

export interface CoachTodayContext {
  locale: string;
  /** The device clock, for elapsed time and the greeting only. */
  now: Date;
  /** The signed-in coach: an item about their own client does not name its coach. */
  userId: string | null;
}

const MAX_RECORDS = 2;
const NEW_CLIENT_DAYS = 14;

export function mapCoachToday(view: CoachTodayView, context: CoachTodayContext): CoachToday {
  const attention = view.attention.map((item) => attentionRow(item, view.today, context));
  const bars = weekBars(view, context.locale);
  return {
    today: view.today,
    dateLabel: formatDate(view.today, 'EEEE d MMMM', context.locale),
    partOfDay: partOfDay(context.now, view.timeZoneId),
    clientCount: Number(view.clientCount),
    needsCount: new Set(attention.map((row) => row.clientId)).size,
    plansEndingSoon: Number(view.plansEndingSoonCount),
    renewalRequests: Number(view.renewalRequestCount),
    attention,
    activity: view.activity.map((item) => activityRow(item, context)),
    week: {
      from: view.week.from,
      scheduled: Number(view.week.scheduled),
      completed: Number(view.week.completed),
      dueSoFar: bars.filter((bar) => !bar.isFuture).reduce((sum, bar) => sum + bar.scheduled, 0),
      bars,
    },
  };
}

export function attentionRow(
  item: CoachAttentionItemView,
  today: string,
  context: CoachTodayContext,
): AttentionRow {
  const client = item.client;
  const name = fullName(client);
  const count = Number(item.count ?? 0);
  const date = (value: string | null) =>
    value ? formatDate(value, 'EEE d MMM', context.locale) : '';
  const base = {
    key: `${item.kind}:${client.clientProfileId}`,
    kind: item.kind,
    clientId: client.clientProfileId,
    name,
    initials: initialsOf(name),
    coach:
      context.userId !== null && client.assignedCoachUserId !== context.userId
        ? client.assignedCoachName
        : null,
  };
  const clientPage = `/clients/${client.clientProfileId}`;
  const forWhom = $localize`for ${name}:name:`;
  const go = (
    label: string,
    link: string,
    queryParams: Record<string, string> | null = null,
  ): CoachAction => ({ label, forWhom, link, queryParams });
  const renew = go(
    $localize`Renew plan`,
    `${clientPage}/service`,
    item.subjectId ? { renew: item.subjectId } : null,
  );

  switch (item.kind) {
    case 'CheckInToReview':
      return {
        ...base,
        heading:
          count > 1
            ? $localize`${name}:name: sent ${count}:count: check-ins`
            : $localize`${name}:name: sent a check-in`,
        detail: $localize`Sent ${ago(item.since, context)}:ago:`,
        tag: $localize`Check-in`,
        tone: 'review',
        action: go($localize`Review`, `${clientPage}/checkins`),
      };
    case 'UnreadMessages':
      return {
        ...base,
        heading:
          count > 1
            ? $localize`${name}:name: sent you ${count}:count: messages`
            : $localize`${name}:name: sent you a message`,
        detail:
          count > 1
            ? $localize`The first came ${ago(item.since, context)}:ago:`
            : $localize`Sent ${ago(item.since, context)}:ago:`,
        tag: $localize`Message`,
        tone: 'message',
        action: go(
          $localize`Reply`,
          '/messages',
          item.subjectId ? { conversation: item.subjectId } : null,
        ),
      };
    case 'RenewalRequested':
      return {
        ...base,
        heading: $localize`${name}:name: asked to renew`,
        detail: $localize`Plan ended ${date(item.date)}:date:`,
        tag: $localize`Renewal`,
        tone: 'renew',
        action: renew,
      };
    case 'PlanEndingSoon':
      return {
        ...base,
        heading: endsHeading(name, daysBetween(today, item.date), date(item.date)),
        detail: $localize`Last day ${date(item.date)}:date:`,
        tag: $localize`Ending soon`,
        tone: 'ending',
        action: renew,
      };
    case 'WeekNotShared': {
      const week = Number(item.weekNumber ?? 0);
      const startsIn = daysBetween(today, item.date);
      return {
        ...base,
        heading: $localize`${name}:name:'s week ${week}:week: isn't shared yet`,
        detail:
          startsIn === 0
            ? $localize`It starts today`
            : startsIn === 1
              ? $localize`It starts tomorrow`
              : startsIn > 1
                ? $localize`It starts ${date(item.date)}:date:`
                : $localize`It started ${date(item.date)}:date:`,
        tag: $localize`Program`,
        tone: 'share',
        action: go($localize`Share week`, `${clientPage}/training`),
      };
    }
    case 'MissedSessions':
      return {
        ...base,
        heading: $localize`${name}:name: missed ${count}:count: sessions in a row`,
        detail: item.date
          ? $localize`Last trained ${date(item.date)}:date:`
          : $localize`No workout logged yet`,
        tag: $localize`Missed`,
        tone: 'missed',
        action: go($localize`See training`, `${clientPage}/training`),
      };
    case 'NoProgram': {
      const isNew = item.date !== null && -daysBetween(today, item.date) < NEW_CLIENT_DAYS;
      return {
        ...base,
        heading: $localize`${name}:name: has no program yet`,
        detail: $localize`Joined ${date(item.date)}:date:`,
        tag: isNew ? $localize`New` : $localize`Program`,
        tone: 'new',
        action: go($localize`Assign program`, `${clientPage}/training`),
      };
    }
  }
}

export function activityRow(item: CoachActivityItemView, context: CoachTodayContext): ActivityRow {
  const name = fullName(item.client);
  const clientPage = `/clients/${item.client.clientProfileId}`;
  const base = {
    key: `${item.kind}:${item.subjectId}`,
    kind: item.kind,
    name,
    initials: initialsOf(name),
    occurredAt: item.occurredAtUtc,
    ago: ago(item.occurredAtUtc, context),
  };
  if (item.kind === 'WorkoutCompleted') {
    const title = item.title ?? '';
    const minutes = Math.round(Number(item.durationSeconds ?? 0) / 60);
    return {
      ...base,
      sentence:
        minutes > 0
          ? $localize`${name}:name: finished ${title}:session: in ${minutes}:minutes: min`
          : $localize`${name}:name: finished ${title}:session:`,
      records: item.personalRecords.slice(0, MAX_RECORDS).map((record) => {
        const load = formatNumber(Number(record.load), context.locale, '1.0-2');
        const reps = Number(record.repetitions);
        return record.unit === 'Pound'
          ? $localize`${record.exerciseName}:exercise: ${load}:load: lb × ${reps}:reps:`
          : $localize`${record.exerciseName}:exercise: ${load}:load: kg × ${reps}:reps:`;
      }),
      moreRecords: Math.max(0, item.personalRecords.length - MAX_RECORDS),
      link: `${clientPage}/training`,
    };
  }

  return {
    ...base,
    sentence: item.title
      ? $localize`${name}:name: sent a check-in: ${item.title}:form:`
      : $localize`${name}:name: sent a check-in`,
    records: [],
    moreRecords: 0,
    link: `${clientPage}/checkins`,
  };
}

function weekBars(view: CoachTodayView, locale: string): WeekBar[] {
  const days = view.week.days.map((day) => ({
    date: day.date,
    scheduled: Number(day.scheduled),
    completed: Number(day.completed),
  }));
  const busiest = Math.max(1, ...days.map((day) => day.scheduled));
  return days.map((day) => ({
    ...day,
    label: formatDate(day.date, 'EEE', locale),
    longLabel: formatDate(day.date, 'EEEE d MMMM', locale),
    isToday: day.date === view.today,
    isFuture: day.date > view.today,
    height: Math.round((100 * day.scheduled) / busiest),
    done:
      day.scheduled > 0
        ? Math.round((100 * Math.min(day.completed, day.scheduled)) / day.scheduled)
        : 0,
  }));
}

function endsHeading(name: string, inDays: number, date: string): string {
  if (inDays <= 0) return $localize`${name}:name:'s plan ends today`;
  if (inDays === 1) return $localize`${name}:name:'s plan ends tomorrow`;
  return $localize`${name}:name:'s plan ends ${date}:date:`;
}

function fullName(client: CoachClientRef): string {
  return `${client.firstName} ${client.lastName}`.trim();
}

/** Whole days from one workspace date to another; both are calendar dates, so no clock is read. */
export function daysBetween(from: string, to: string | null): number {
  if (!to) return 0;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Elapsed time in the reader's language: "just now", "35 minutes ago", "yesterday". */
export function ago(instant: string | null, context: CoachTodayContext): string {
  if (!instant) return '';
  const seconds = Math.max(0, (context.now.getTime() - Date.parse(instant)) / 1000);
  if (seconds < 60) return $localize`just now`;
  const format = new Intl.RelativeTimeFormat(context.locale, { numeric: 'auto' });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return format.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return format.format(-hours, 'hour');
  return format.format(-Math.floor(hours / 24), 'day');
}

/** Morning before noon, afternoon before six, evening after, in the workspace's own time zone. */
export function partOfDay(now: Date, timeZone: string): 'morning' | 'afternoon' | 'evening' {
  let hour = now.getHours();
  try {
    hour = Number(
      new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now),
    );
  } catch {
    // An unknown zone name falls back to the device's hour; the greeting is all it affects.
  }
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}
