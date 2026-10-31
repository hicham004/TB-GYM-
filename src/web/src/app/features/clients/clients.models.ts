import { formatDate } from '@angular/common';
import type { FormerClient } from '../../core/api/api.models';
import { dayInZone } from '../../core/i18n/house-dates';
import type {
  ClientOverviewRow,
  ClientOverviewStatus,
  ClientOverviewView,
  ClientPlanStatus,
  CoachAttentionItemView,
  CoachAttentionKind,
  SessionDayCountView,
} from '../../core/api/generated';
import { initialsOf } from '../../shell/initials';
import { ageOn } from '../../ui/calendar';
import type { UiMenuItem } from '../../ui/menu';
import type { StatusPillTone } from '../../ui/status-pill';
import { duration } from '../commercial/products.models';
import { ago, attentionTarget, daysBetween } from '../dashboard/coach-today.models';
import { featureLabels, money, sessionsLeft } from './client-service.models';

/**
 * The coach's client list (C2, critique B4a) in coach words: the server's status, attention, plan and
 * last seven days (CLI-018) turned into rows a template can draw. Status, gating, counting and whether a
 * plan ends soon stay on the server; this only phrases them and decides which filter chips a row
 * answers to. Dates are measured against the workspace date the server sent; only "2 hours ago" uses
 * the device clock.
 */

export type ClientFilter = 'all' | 'attention' | 'ending' | 'paused' | 'new' | 'maxes';

export const CLIENT_FILTERS: readonly ClientFilter[] = [
  'all',
  'attention',
  'ending',
  'paused',
  'new',
  'maxes',
];

/**
 * Chips the list offers only while a client answers them (or the address asks for one): a coach who
 * never programs from training maxes never sees an empty "Maxes to review".
 */
export const CLIENT_FILTERS_WHEN_USED: ReadonlySet<ClientFilter> = new Set(['maxes']);

/** A day of the last seven, as the client's page draws it. */
export type DayMark = 'done' | 'partial' | 'missed' | 'due' | 'rest';

/**
 * A day of the last seven, as the list's strip draws it and its legend names it: ✓ done, × missed,
 * – still due, and a quiet dot for a day with no workout.
 */
export type StripMark = 'done' | 'missed' | 'due' | 'rest';

export interface ClientDay {
  date: string;
  mark: StripMark;
}

export interface ClientWeek {
  /** Empty when nothing was scheduled: seven blank days would say nothing the words don't. */
  days: ClientDay[];
  /** "3 of 4", or "None scheduled", beside the strip. */
  value: string;
  /** The strip in words, for screen readers. */
  summary: string;
}

/** Something waiting for the coach, as a tag on the client's row that opens where it is handled. */
export interface ReasonTag {
  kind: CoachAttentionKind;
  /** "2 check-ins to review": what waits, with its count. */
  label: string;
  link: string;
  queryParams: Record<string, string> | null;
}

/** The plan whose end the row shows (critique B4a), in short lines. */
export interface PlanCell {
  /** Its name as it was booked, "Online coaching" (critique B4c); null without a plan. */
  name: string | null;
  /** What it includes, "Training, Nutrition, Check-ins"; null without a plan. */
  includes: string | null;
  /** Its length as sold and its price, "12 weeks · USD 330"; null without a plan. */
  terms: string | null;
  /** When it ends, or where it stands: "Ends Sun 20 Dec", "Paused since Tue 20 Oct · ends Fri 11 Dec". */
  end: string;
  /** The server flags the plan ending soon (CLI-018), so its end is drawn warm. */
  soon: boolean;
  /** "+1 more plan" while others run or are booked beside it; their prices are never added. */
  more: string | null;
}

export interface ClientRow {
  id: string;
  name: string;
  initials: string;
  /** "Age 34", worked out for the workspace's today (CLI-005); null without a birth date. */
  age: string | null;
  goal: string | null;
  link: string;
  /** The client's coach, shown to an Owner for a team member's client; null for the caller's own. */
  coach: string | null;
  /** Who coaches the client, the caller included: what the owner's Coach filter keeps (B3a). */
  coachId: string;
  /**
   * What waits for the coach, in Today's order, each a link to where it is handled. A plan's end has
   * its own pill and maxes to review are good news, so neither is a tag.
   */
  tags: ReasonTag[];
  /** The plan's own status, shown beside the tags whatever they are (CLI-018 v4). */
  planPill: { label: string; tone: StatusPillTone };
  /**
   * "2 sessions left" (critique B10c), while sessions are in today's plan; warm once the server says
   * they are running out (SES-008), so its count is never this screen's own.
   */
  sessions: { label: string; tone: StatusPillTone } | null;
  /** The client has not finished setting up their profile: "Not set up yet" (audit LOST-12). */
  notSetUp: boolean;
  /** Null when training is not in the client's plan. */
  week: ClientWeek | null;
  plan: PlanCell;
  /** "Sent 2 days ago", "None sent yet", or "Not in plan" while check-ins are not in today's plan. */
  checkIn: string;
  checkInAt: string | null;
  activity: string;
  activityAt: string | null;
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

/** Kinds that have a pill or a chip of their own instead of a warning tag on the row. */
const NOT_TAGS: ReadonlySet<CoachAttentionKind> = new Set([
  'PlanEndingSoon',
  'SessionsRunningOut',
  'MaxesToReview',
]);

export function mapClientList(view: ClientOverviewView, context: ClientListContext): ClientList {
  const rows = view.clients.map((row) => clientRow(row, view.today, context));
  return { rows, counts: filterCounts(rows) };
}

/** How many of these rows each chip holds: the whole list's, or one coach's (critique B3a). */
export function filterCounts(rows: readonly ClientRow[]): Record<ClientFilter, number> {
  return Object.fromEntries(
    CLIENT_FILTERS.map((filter) => [filter, rows.filter((row) => row.filters.has(filter)).length]),
  ) as Record<ClientFilter, number>;
}

export function clientRow(
  row: ClientOverviewRow,
  today: string,
  context: ClientListContext,
): ClientRow {
  const client = row.client;
  const name = `${client.firstName} ${client.lastName}`.trim();
  const goal = row.goals?.trim() || null;
  const years = ageOn(row.birthDate, today);
  const filters = new Set<ClientFilter>(['all']);
  if (row.status === 'NeedsAttention') filters.add('attention');
  if (row.status === 'EndingSoon' || row.attention.includes('PlanEndingSoon')) {
    filters.add('ending');
  }
  if (row.planState === 'Paused') filters.add('paused');
  if (row.isNew) filters.add('new');
  // Good news, so never part of Needs attention, but a coach can still find everyone to review (P4c).
  if (row.attention.includes('MaxesToReview')) filters.add('maxes');

  return {
    id: client.clientProfileId,
    name,
    initials: initialsOf(name),
    age: years === null ? null : $localize`Age ${years}:age:`,
    goal,
    link: `/clients/${client.clientProfileId}`,
    coach:
      context.userId !== null && client.assignedCoachUserId !== context.userId
        ? client.assignedCoachName
        : null,
    coachId: client.assignedCoachUserId,
    tags: row.attentionItems
      .filter((item) => !NOT_TAGS.has(item.kind))
      .map((item) => ({ kind: item.kind, label: attentionReason(item), ...attentionTarget(item) })),
    planPill: planPill(row.planStatus),
    sessions: sessionsChip(row),
    notSetUp: row.onboardingStatus === 'NotStarted' || row.onboardingStatus === 'InProgress',
    week: row.recentSessions ? clientWeek(row.recentSessions, today) : null,
    plan: planCell(row, today, context.locale),
    checkIn: lastCheckIn(row, context),
    checkInAt: row.featuresToday.includes('CheckIns') ? row.lastCheckInSentAtUtc : null,
    activity: activityLabel(row, context),
    activityAt: row.lastActivityAtUtc,
    filters,
    searchText: searchable(`${name} ${goal ?? ''}`),
  };
}

/** Whether a row answers the chosen chip and every word typed in the search box. */
export function matches(
  row: ClientRow,
  filter: ClientFilter,
  search: string,
  coachId = '',
): boolean {
  if (!row.filters.has(filter)) return false;
  if (coachId !== '' && row.coachId !== coachId) return false;
  const words = searchable(search).split(/\s+/).filter(Boolean);
  return words.every((word) => row.searchText.includes(word));
}

/**
 * The lede over the list, "12 clients · 9 need attention · 1 plan ends soon": what the chips count, so
 * it follows the owner's chosen coach as they do (critique B3a) and never seems to disagree with them.
 */
export function listSummary(counts: Record<ClientFilter, number>): string {
  if (counts.all === 0) return '';
  const clients = counts.all === 1 ? $localize`1 client` : $localize`${counts.all}:count: clients`;
  const attention =
    counts.attention === 0
      ? $localize`nobody needs attention`
      : counts.attention === 1
        ? $localize`1 needs attention`
        : $localize`${counts.attention}:count: need attention`;
  const ending =
    counts.ending === 0
      ? null
      : counts.ending === 1
        ? $localize`1 plan ends soon`
        : $localize`${counts.ending}:count: plans end soon`;
  return [clients, attention, ending].filter((part) => part !== null).join(' · ');
}

/** The coach the owner narrowed the list to: their name, or "your" when it is the owner. */
export interface ChosenCoach {
  readonly name: string;
  readonly isYou: boolean;
}

export interface EmptyList {
  heading: string;
  description: string;
  action: string;
}

/**
 * What an empty filtered list says, and the one action that brings rows back. With a coach chosen it
 * speaks for that coach's clients, and its action keeps the coach (review of B3a): the rest of the
 * list may well hold what this coach's clients do not.
 */
export function emptyList(
  filter: ClientFilter,
  search: string,
  coach: ChosenCoach | null,
): EmptyList {
  const typed = search.trim();
  if (typed !== '') {
    return {
      heading:
        coach === null
          ? $localize`No client matches “${typed}:search:”`
          : coach.isYou
            ? $localize`None of your clients matches “${typed}:search:”`
            : $localize`None of ${coach.name}:coach:’s clients matches “${typed}:search:”`,
      description: $localize`Search looks at names and goals.`,
      action: $localize`Clear search`,
    };
  }
  const description = $localize`Clients will show up here when this changes.`;
  if (coach === null) {
    const headings: Record<ClientFilter, string> = {
      all: '',
      attention: $localize`Nobody needs attention right now`,
      ending: $localize`No plan ends in the next 14 days`,
      paused: $localize`No plan is paused`,
      new: $localize`No new clients in the last 14 days`,
      maxes: $localize`No logged sets suggest a new max right now`,
    };
    return { heading: headings[filter], description, action: $localize`Show all clients` };
  }
  if (coach.isYou) {
    const headings: Record<ClientFilter, string> = {
      all: '',
      attention: $localize`None of your clients needs attention right now`,
      ending: $localize`None of your clients has a plan ending in the next 14 days`,
      paused: $localize`None of your clients has a paused plan`,
      new: $localize`None of your clients joined in the last 14 days`,
      maxes: $localize`No logged sets of your clients suggest a new max right now`,
    };
    return { heading: headings[filter], description, action: $localize`Show all your clients` };
  }
  const name = coach.name;
  const headings: Record<ClientFilter, string> = {
    all: '',
    attention: $localize`None of ${name}:coach:’s clients needs attention right now`,
    ending: $localize`None of ${name}:coach:’s clients has a plan ending in the next 14 days`,
    paused: $localize`None of ${name}:coach:’s clients has a paused plan`,
    new: $localize`None of ${name}:coach:’s clients joined in the last 14 days`,
    maxes: $localize`No logged sets of ${name}:coach:’s clients suggest a new max right now`,
  };
  return {
    heading: headings[filter],
    description,
    action: $localize`Show all of ${name}:coach:’s clients`,
  };
}

/** The owner's Coach filter (critique B3a), a chip with a menu as the exercise library's are. */
export interface CoachChip {
  /** "Coach", or "Coach: Lea Khoury" once one is chosen: the chip's words and its name. */
  readonly name: string;
  /** Whether the list is narrowed to the chosen coach, a coach the list still holds. */
  readonly active: boolean;
  /** The coach the list is narrowed to, for the words that speak for their clients alone. */
  readonly chosen: ChosenCoach | null;
  readonly items: readonly UiMenuItem[];
}

/**
 * One choice per coach with clients here: you first, then the others by name. A list with one coach,
 * as every coach's own list is, has nothing to filter by, so it has no chip.
 */
export function coachChip(
  rows: readonly ClientRow[],
  chosen: string,
  me: string | null,
  locale: string,
): CoachChip | null {
  const coaches = new Map<string, string>();
  for (const row of rows) {
    if (!coaches.has(row.coachId)) coaches.set(row.coachId, row.coach ?? '');
  }
  if (coaches.size < 2) return null;

  const you = $localize`You`;
  const others = [...coaches]
    .filter(([id]) => id !== me)
    .sort(([, a], [, b]) => a.localeCompare(b, locale));
  const items: UiMenuItem[] = [
    { label: $localize`Every coach`, action: '' },
    ...(me !== null && coaches.has(me) ? [{ label: you, action: me }] : []),
    ...others.map(([id, name]) => ({ label: name, action: id })),
  ];
  const isYou = chosen === me && coaches.has(chosen);
  const chosenName = isYou ? you : coaches.get(chosen);
  return {
    name: chosenName === undefined ? $localize`Coach` : $localize`Coach: ${chosenName}:coach:`,
    active: chosenName !== undefined,
    chosen:
      chosenName === undefined ? null : { name: isYou ? you : (coaches.get(chosen) ?? ''), isYou },
    items,
  };
}

/**
 * A former client as the list reads them. The day coaching ended is the one it was on the workspace's
 * calendar (audit WEB-17), never the device's: a browser a day ahead would otherwise move it.
 */
export function formerClientRow(
  client: FormerClient,
  locale: string,
  timeZone: string | null,
): FormerClientRow {
  const name = `${client.firstName} ${client.lastName}`.trim();
  return {
    id: client.id,
    name,
    initials: initialsOf(name),
    link: `/clients/${client.id}`,
    ended: formatDate(dayInZone(client.releasedAtUtc, timeZone), 'EEE d MMM y', locale),
    endedAt: client.releasedAtUtc,
    how:
      client.departureKind === 'LeftByClient'
        ? $localize`Left by client`
        : $localize`Ended by owner`,
    reason: client.reason,
  };
}

/** The one status the chat's client panel shows (CLI-018). */
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

/** The plan's own status beside the reasons (CLI-018 v4: a plan's end keeps its own status). */
export function planPill(status: ClientPlanStatus): { label: string; tone: StatusPillTone } {
  switch (status) {
    case 'OnTrack':
      return { label: $localize`On track`, tone: 'success' };
    case 'Paused':
      return { label: $localize`Plan paused`, tone: 'info' };
    case 'EndingSoon':
      return { label: $localize`Plan ends soon`, tone: 'warm' };
    case 'NoActivePlan':
      return { label: $localize`No active plan`, tone: 'neutral' };
  }
}

function sessionsChip(
  row: Pick<ClientOverviewRow, 'sessionsLeft' | 'attention'>,
): ClientRow['sessions'] {
  const left = row.sessionsLeft;
  if (left === null || left === undefined) return null;
  return {
    label: sessionsLeft(Number(left)),
    tone: row.attention.includes('SessionsRunningOut') ? 'warm' : 'neutral',
  };
}

/** What waits for the coach, in a short tag with its count: "2 check-ins to review". */
export function attentionReason(item: CoachAttentionItemView): string {
  const count = Number(item.count ?? 0);
  switch (item.kind) {
    case 'CheckInToReview':
      return count > 1
        ? $localize`${count}:count: check-ins to review`
        : $localize`1 check-in to review`;
    case 'UnreadMessages':
      return count > 1 ? $localize`${count}:count: unread messages` : $localize`1 unread message`;
    case 'RenewalRequested':
      return $localize`Asked to renew`;
    case 'PlanEndingSoon':
      return $localize`Plan ends soon`;
    case 'SessionsRunningOut':
      return sessionsLeft(Number(item.sessionsLeft ?? 0));
    case 'WeekNotShared':
      return $localize`Week not shared`;
    case 'MissedSessions':
      return count > 1 ? $localize`${count}:count: missed workouts` : $localize`1 missed workout`;
    case 'CheckInOverdue':
      return count > 1
        ? $localize`${count}:count: check-ins overdue`
        : $localize`1 check-in overdue`;
    case 'NoProgram':
      return item.subjectId ? $localize`No program running` : $localize`No program yet`;
    case 'MaxesToReview':
      return $localize`Maxes to review`;
    case 'NoPlan':
      return $localize`Joined, no plan yet`;
  }
}

/**
 * What a client last did, in words; the list, a client's own page and the chat's panel say it the same
 * way. The list also names a finished workout ("Trained Lower A · 2 days ago").
 */
export function activityLabel(
  row: Pick<ClientOverviewRow, 'lastActivityKind' | 'lastActivityAtUtc' | 'status'> & {
    lastActivityTitle?: string | null;
    planStatus?: ClientPlanStatus | null;
  },
  context: ClientListContext,
): string {
  const when = ago(row.lastActivityAtUtc, context);
  switch (row.lastActivityKind) {
    case 'WorkoutCompleted': {
      const title = row.lastActivityTitle?.trim();
      return title
        ? $localize`Trained ${title}:workout: · ${when}:ago:`
        : $localize`Trained ${when}:ago:`;
    }
    case 'CheckInSubmitted':
      return $localize`Sent a check-in ${when}:ago:`;
    case 'WeighInLogged':
      return $localize`Weighed in ${when}:ago:`;
    default: {
      // Activity is read only for what the plan includes today, so a plan that is not running (paused,
      // ended, waiting for payment) may hide older work, and "yet" would not be true.
      const hidden = row.planStatus
        ? row.planStatus !== 'OnTrack' && row.planStatus !== 'EndingSoon'
        : row.status === 'NoActivePlan' || row.status === 'Paused';
      return hidden ? $localize`No activity to show` : $localize`No activity yet`;
    }
  }
}

/**
 * When the client last sent a check-in. It is read only while check-ins are in today's plan (CHK-011),
 * so a row says which of "not in the plan" and "none sent" holds.
 */
export function lastCheckIn(
  row: Pick<ClientOverviewRow, 'featuresToday' | 'lastCheckInSentAtUtc'>,
  context: ClientListContext,
): string {
  if (!row.featuresToday.includes('CheckIns')) return $localize`Not in plan`;
  return row.lastCheckInSentAtUtc
    ? $localize`Sent ${ago(row.lastCheckInSentAtUtc, context)}:ago:`
    : $localize`None sent yet`;
}

export function clientWeek(days: readonly SessionDayCountView[], today: string): ClientWeek {
  let done = 0;
  let scheduled = 0;
  // The marks are hidden from screen readers, so the summary says what × and – say.
  let missed = 0;
  let dueToday = 0;
  const marks = days.map((day) => {
    const planned = Number(day.scheduled);
    const completed = Math.min(Number(day.completed), planned);
    done += completed;
    scheduled += planned;
    if (day.date < today) missed += planned - completed;
    else if (day.date === today) dueToday += planned - completed;
    return {
      date: day.date,
      mark: stripMark(dayMark(planned, completed, day.date, today), day.date, today),
    };
  });
  if (scheduled === 0) {
    return {
      days: [],
      value: $localize`None scheduled`,
      summary: $localize`Nothing scheduled in the last 7 days`,
    };
  }
  const summary = [
    $localize`${done}:done: of ${scheduled}:scheduled: workouts done in the last 7 days`,
  ];
  if (missed > 0) summary.push($localize`${missed}:missed: missed`);
  if (dueToday > 0) summary.push($localize`${dueToday}:due: still due today`);
  return {
    days: marks,
    value: $localize`${done}:done: of ${scheduled}:scheduled:`,
    summary: summary.join(', '),
  };
}

export function dayMark(
  scheduled: number,
  completed: number,
  date: string,
  today: string,
): DayMark {
  if (scheduled === 0) return 'rest';
  if (completed >= scheduled) return 'done';
  if (completed > 0) return 'partial';
  // The window ends today, so a session due today is not missed yet.
  return date < today ? 'missed' : 'due';
}

/**
 * The strip's legend has three marks, so a day with some of its workouts done reads as the rest of
 * them: missed on a past day, still due today. "3 of 4" beside it keeps the exact count.
 */
export function stripMark(mark: DayMark, date: string, today: string): StripMark {
  if (mark !== 'partial') return mark;
  return date < today ? 'missed' : 'due';
}

/**
 * The plan whose end the row shows (R3.5b's plan), as its name as it was booked (critique B4c), what it
 * includes, its length as sold, its exact price in its own currency, and its end, or since when it is
 * paused, a pause having no end of its own (SUB-006). Other plans beside it are counted, never added to
 * its price.
 */
export function planCell(
  row: Pick<
    ClientOverviewRow,
    'plan' | 'planState' | 'planStatus' | 'planEndsOn' | 'planPausedSince' | 'otherPlanCount'
  >,
  today: string,
  locale: string,
): PlanCell {
  const date = (value: string) =>
    formatDate(value, value.slice(0, 4) === today.slice(0, 4) ? 'EEE d MMM' : 'd MMM y', locale);
  const plan = row.plan;
  const others = Number(row.otherPlanCount);
  const price = plan ? Number(plan.priceAmount) : 0;
  return {
    name: plan?.name.trim() || null,
    includes: plan
      ? new Intl.ListFormat(locale, { style: 'short', type: 'unit' }).format(
          featureLabels(plan.features),
        ) || null
      : null,
    terms: plan
      ? [
          duration({ durationCount: plan.lengthCount, durationUnit: plan.lengthUnit }),
          price === 0 ? $localize`Free` : money(price, plan.priceCurrency, locale),
        ].join(' · ')
      : null,
    end: planEnd(row, today, date),
    soon: row.planStatus === 'EndingSoon',
    more:
      others <= 0
        ? null
        : others === 1
          ? $localize`+1 more plan`
          : $localize`+${others}:count: more plans`,
  };
}

function planEnd(
  row: Pick<ClientOverviewRow, 'planState' | 'planEndsOn' | 'planPausedSince'>,
  today: string,
  date: (value: string) => string,
): string {
  const ends = row.planEndsOn;
  switch (row.planState) {
    case 'Running': {
      if (!ends) return $localize`Running`;
      const left = daysBetween(today, ends);
      if (left <= 0) return $localize`Ends today`;
      if (left === 1) return $localize`Ends tomorrow`;
      return $localize`Ends ${date(ends)}:date:`;
    }
    case 'Paused': {
      const since = row.planPausedSince;
      if (since && ends)
        return $localize`Paused since ${date(since)}:since: · ends ${date(ends)}:date:`;
      if (since) return $localize`Paused since ${date(since)}:since:`;
      return ends ? $localize`Paused · ends ${date(ends)}:date:` : $localize`Paused`;
    }
    case 'PaymentDue':
      return $localize`Payment due`;
    case 'NotStarted':
      return $localize`Not started yet`;
    case 'Ended':
      return ends ? $localize`Ended ${date(ends)}:date:` : $localize`Ended`;
    case 'Blocked':
      return $localize`Access blocked`;
    case 'None':
      return $localize`No plan yet`;
  }
}

/**
 * Where the plan stands, as the chat's client panel says it. Whether it ends soon is the server's flag
 * (CLI-018: within 14 days, today counted), never a count of the screen's own; the days are counted
 * only to say how many.
 */
export function planLabel(
  row: Pick<ClientOverviewRow, 'planState' | 'planEndsOn'>,
  today: string,
  locale: string,
  endingSoon: boolean,
): { label: string; soon: boolean } {
  const ends = row.planEndsOn;
  const date = (value: string) =>
    formatDate(value, value.slice(0, 4) === today.slice(0, 4) ? 'EEE d MMM' : 'd MMM y', locale);
  switch (row.planState) {
    case 'Running': {
      if (!ends) return { label: $localize`Plan running`, soon: false };
      const left = daysBetween(today, ends);
      if (left <= 0) return { label: $localize`Plan ends today`, soon: endingSoon };
      if (left === 1) return { label: $localize`Plan ends tomorrow`, soon: endingSoon };
      if (endingSoon) {
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
