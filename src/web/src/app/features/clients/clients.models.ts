import { formatDate } from '@angular/common';
import type { FormerClient } from '../../core/api/api.models';
import type {
  ClientOverviewRow,
  ClientOverviewStatus,
  ClientOverviewView,
  CoachAttentionKind,
  SessionDayCountView,
} from '../../core/api/generated';
import { initialsOf } from '../../shell/initials';
import type { StatusPillTone } from '../../ui/status-pill';
import { ago, daysBetween } from '../dashboard/coach-today.models';

/**
 * The coach's client list (C2) in coach words: the server's status, attention and last seven days
 * (CLI-018) turned into rows a template can draw. Status, gating and counting stay on the server;
 * this only phrases them and decides which filter chips a row answers to. Plan dates are measured
 * against the workspace date the server sent; only "2 hours ago" uses the device clock.
 */

export type ClientFilter = 'all' | 'attention' | 'ending' | 'paused' | 'new';

export const CLIENT_FILTERS: readonly ClientFilter[] = [
  'all',
  'attention',
  'ending',
  'paused',
  'new',
];

/** A day of the last seven, as the strip draws it. */
export type DayMark = 'done' | 'partial' | 'missed' | 'due' | 'rest';

export interface ClientDay {
  date: string;
  mark: DayMark;
}

export interface ClientWeek {
  /** Empty when nothing was scheduled: seven blank days would say nothing the words don't. */
  days: ClientDay[];
  /** "3 of 4", or "None scheduled", beside the strip. */
  value: string;
  /** The strip in words, for screen readers. */
  summary: string;
}

export interface ClientRow {
  id: string;
  name: string;
  initials: string;
  goal: string | null;
  link: string;
  /** The client's coach, shown to an Owner for a team member's client; null for the caller's own. */
  coach: string | null;
  status: { label: string; tone: StatusPillTone };
  /** Why the client needs attention, in short words joined by "·"; empty when nothing does. */
  reasons: string;
  activity: string;
  activityAt: string | null;
  /** Null when training is not in the client's plan. */
  week: ClientWeek | null;
  plan: { label: string; soon: boolean };
  filters: ReadonlySet<ClientFilter>;
  /** Name and goal, lower-cased and without accents, for the search box. */
  searchText: string;
}

export interface ClientList {
  rows: ClientRow[];
  counts: Record<ClientFilter, number>;
}

export interface FormerClientRow {
  id: string;
  name: string;
  initials: string;
  link: string;
  ended: string;
  endedAt: string;
  how: string;
  reason: string;
}

export interface ClientListContext {
  locale: string;
  /** The device clock, for elapsed time only. */
  now: Date;
  /** The signed-in coach: their own client does not name its coach. */
  userId: string | null;
}

/** A plan this close to its last day is flagged, as Coach Today's queue does (CLI-018). */
const ENDING_SOON_DAYS = 14;

export function mapClientList(view: ClientOverviewView, context: ClientListContext): ClientList {
  const rows = view.clients.map((row) => clientRow(row, view.today, context));
  const counts = Object.fromEntries(
    CLIENT_FILTERS.map((filter) => [filter, rows.filter((row) => row.filters.has(filter)).length]),
  ) as Record<ClientFilter, number>;
  return { rows, counts };
}

export function clientRow(
  row: ClientOverviewRow,
  today: string,
  context: ClientListContext,
): ClientRow {
  const client = row.client;
  const name = `${client.firstName} ${client.lastName}`.trim();
  const goal = row.goals?.trim() || null;
  const filters = new Set<ClientFilter>(['all']);
  if (row.status === 'NeedsAttention') filters.add('attention');
  if (row.status === 'EndingSoon' || row.attention.includes('PlanEndingSoon')) {
    filters.add('ending');
  }
  if (row.planState === 'Paused') filters.add('paused');
  if (row.isNew) filters.add('new');

  return {
    id: client.clientProfileId,
    name,
    initials: initialsOf(name),
    goal,
    link: `/clients/${client.clientProfileId}`,
    coach:
      context.userId !== null && client.assignedCoachUserId !== context.userId
        ? client.assignedCoachName
        : null,
    status: statusPill(row.status),
    reasons: row.attention
      .filter((kind) => kind !== 'PlanEndingSoon')
      .map(attentionReason)
      .join(' · '),
    activity: activityLabel(row, context),
    activityAt: row.lastActivityAtUtc,
    week: row.recentSessions ? clientWeek(row.recentSessions, today) : null,
    plan: planLabel(row, today, context.locale),
    filters,
    searchText: searchable(`${name} ${goal ?? ''}`),
  };
}

/** Whether a row answers the chosen chip and every word typed in the search box. */
export function matches(row: ClientRow, filter: ClientFilter, search: string): boolean {
  if (!row.filters.has(filter)) return false;
  const words = searchable(search).split(/\s+/).filter(Boolean);
  return words.every((word) => row.searchText.includes(word));
}

export function formerClientRow(client: FormerClient, locale: string): FormerClientRow {
  const name = `${client.firstName} ${client.lastName}`.trim();
  return {
    id: client.id,
    name,
    initials: initialsOf(name),
    link: `/clients/${client.id}`,
    ended: formatDate(client.releasedAtUtc, 'EEE d MMM y', locale),
    endedAt: client.releasedAtUtc,
    how:
      client.departureKind === 'LeftByClient'
        ? $localize`Left by client`
        : $localize`Ended by owner`,
    reason: client.reason,
  };
}

export function statusPill(status: ClientOverviewStatus): { label: string; tone: StatusPillTone } {
  switch (status) {
    case 'NeedsAttention':
      return { label: $localize`Needs attention`, tone: 'warning' };
    case 'Paused':
      return { label: $localize`Paused`, tone: 'info' };
    case 'EndingSoon':
      return { label: $localize`Ending soon`, tone: 'warm' };
    case 'OnTrack':
      return { label: $localize`On track`, tone: 'success' };
    case 'NoActivePlan':
      return { label: $localize`No active plan`, tone: 'neutral' };
  }
}

function attentionReason(kind: CoachAttentionKind): string {
  switch (kind) {
    case 'CheckInToReview':
      return $localize`Check-in to review`;
    case 'UnreadMessages':
      return $localize`Unread messages`;
    case 'RenewalRequested':
      return $localize`Asked to renew`;
    case 'PlanEndingSoon':
      return $localize`Plan ending soon`;
    case 'WeekNotShared':
      return $localize`Week not shared`;
    case 'MissedSessions':
      return $localize`Missed sessions`;
    case 'NoProgram':
      return $localize`No program yet`;
  }
}

function activityLabel(row: ClientOverviewRow, context: ClientListContext): string {
  const when = ago(row.lastActivityAtUtc, context);
  switch (row.lastActivityKind) {
    case 'WorkoutCompleted':
      return $localize`Trained ${when}:ago:`;
    case 'CheckInSubmitted':
      return $localize`Sent a check-in ${when}:ago:`;
    case 'WeighInLogged':
      return $localize`Weighed in ${when}:ago:`;
    default:
      // Activity is read only for what the plan includes, so a lapsed plan may hide older work.
      return row.status === 'NoActivePlan'
        ? $localize`No activity to show`
        : $localize`No activity yet`;
  }
}

export function clientWeek(days: readonly SessionDayCountView[], today: string): ClientWeek {
  let done = 0;
  let scheduled = 0;
  const marks = days.map((day) => {
    const planned = Number(day.scheduled);
    const completed = Math.min(Number(day.completed), planned);
    done += completed;
    scheduled += planned;
    return { date: day.date, mark: dayMark(planned, completed, day.date, today) };
  });
  if (scheduled === 0) {
    return {
      days: [],
      value: $localize`None scheduled`,
      summary: $localize`Nothing scheduled in the last 7 days`,
    };
  }
  return {
    days: marks,
    value: $localize`${done}:done: of ${scheduled}:scheduled:`,
    summary: $localize`${done}:done: of ${scheduled}:scheduled: sessions done in the last 7 days`,
  };
}

function dayMark(scheduled: number, completed: number, date: string, today: string): DayMark {
  if (scheduled === 0) return 'rest';
  if (completed >= scheduled) return 'done';
  if (completed > 0) return 'partial';
  // The window ends today, so a session due today is not missed yet.
  return date < today ? 'missed' : 'due';
}

function planLabel(
  row: ClientOverviewRow,
  today: string,
  locale: string,
): { label: string; soon: boolean } {
  const ends = row.planEndsOn;
  const date = (value: string) =>
    formatDate(value, value.slice(0, 4) === today.slice(0, 4) ? 'EEE d MMM' : 'd MMM y', locale);
  switch (row.planState) {
    case 'Running': {
      if (!ends) return { label: $localize`Plan running`, soon: false };
      const left = daysBetween(today, ends);
      if (left <= 0) return { label: $localize`Plan ends today`, soon: true };
      if (left === 1) return { label: $localize`Plan ends tomorrow`, soon: true };
      if (left <= ENDING_SOON_DAYS) {
        return { label: $localize`Plan ends in ${left}:count: days`, soon: true };
      }
      return { label: $localize`Plan ends ${date(ends)}:date:`, soon: false };
    }
    case 'Paused':
      return { label: $localize`Plan paused`, soon: false };
    case 'PaymentDue':
      return { label: $localize`Payment due`, soon: false };
    case 'NotStarted':
      return { label: $localize`Plan not started`, soon: false };
    case 'Ended':
      return {
        label: ends ? $localize`Plan ended ${date(ends)}:date:` : $localize`Plan ended`,
        soon: false,
      };
    case 'Blocked':
      return { label: $localize`Access blocked`, soon: false };
    case 'None':
      return { label: $localize`No plan yet`, soon: false };
  }
}

/** Lower case without accents, so "elie" finds "Élie". */
function searchable(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}
