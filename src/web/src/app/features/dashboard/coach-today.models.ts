import { formatDate, formatNumber } from '@angular/common';
import type {
  CoachActivityItemView,
  CoachActivityKind,
  CoachAttentionItemView,
  CoachAttentionKind,
  CoachClientCountView,
  CoachClientRef,
  CoachMoneyReceivedView,
  CoachMonthView,
  CoachPlanEndedView,
  CoachPlanEndingView,
  CoachTodayView,
} from '../../core/api/generated';
import { initialsOf } from '../../shell/initials';
import { money, sessionsLeft } from '../clients/client-service.models';

/**
 * Coach Today (C1) in coach words: the server's queue, This month, the plans ending soon or ended
 * and the feed (CLI-018, CLI-020) turned into rows a template can draw. Ranking, gating, counting
 * and money stay on the server; this only phrases them, and never adds amounts. Workspace dates
 * ("today", "tomorrow") are measured against the date the server sent, never the browser's, and
 * only elapsed time ("2 hours ago") uses the device clock.
 */

export type AttentionTone = 'review' | 'message' | 'renew' | 'ending' | 'share' | 'missed' | 'new';

export interface CoachAction {
  label: string;
  /** Read after the label by screen readers, so every button in the queue says whose it is. */
  forWhom: string;
  link: string;
  queryParams: Record<string, string> | null;
  /**
   * Remind with no chat yet (critique B4a): the action is a button that starts the coach's chat with
   * this client and opens it, as the client page's Message does. Null for every link.
   */
  startsChatWith: string | null;
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

/** Money received in one currency (SUB-016): one line each, never added to another currency. */
export interface MoneyLine {
  currency: string;
  /** "USD 2,340", "USD 82.50": exact, the code first, as every amount in the app reads. */
  amount: string;
  /** How many payments made it up, part payments included: "7 payments". */
  payments: string;
}

/** One member of the owner's team on This month, with their clients. */
export interface StaffRow {
  key: string;
  /** "You" for the caller, else the member's name. */
  name: string;
  initials: string;
  /** "4 of 5 clients active", or "No clients yet". */
  clients: string;
}

/** This month (critique B4b, CLI-020), counted by the server for the workspace's calendar month. */
export interface CoachMonth {
  /** The month's name, "October". */
  name: string;
  /** Empty when nothing has arrived yet this month. */
  money: MoneyLine[];
  /** Whose money it is: a coach's own clients', the whole coaching space's for the owner. */
  moneyFrom: string;
  /** "9 of 12 clients": the clients whose plan runs today, out of every current client. */
  active: string;
  /** The 1-on-1 sessions held (SES-008); null while there is nothing to count from. */
  sessions: { held: string; by: string } | null;
  /** The owner's team, the owner first as "You"; null for a coach, who never sees it. */
  staff: StaffRow[] | null;
}

/** What ending a client's coaching asks for (ADR 0027): who, and the version the owner saw. */
export interface ReleaseTarget {
  id: string;
  firstName: string;
  lastName: string;
  version: number;
  /** Read after "End coaching" by screen readers: "with Elie Azar". */
  forWhom: string;
}

/** A plan ending soon, or one that ran out lately and was not renewed (critique B4b). */
export interface PlanRow {
  key: string;
  clientId: string;
  name: string;
  initials: string;
  /** The client's coach, shown to an Owner for a team member's client; null for the caller's own. */
  coach: string | null;
  /** The plan's name as it was sold, in the coach's own words; empty when it has none. */
  plan: string;
  /** When it ends or ended, then anything else to know: "Ended Sun 27 Sep · Asked to renew on …". */
  detail: string;
  /** Renew, or Record payment for a plan booked after it and still unpaid (BEB-7). */
  action: CoachAction;
  /** Message, only on a plan ending soon and only when the caller may message the client (CLI-013). */
  message: CoachAction | null;
  /** End coaching, on an ended plan and for the owner alone, who alone receives the version. */
  release: ReleaseTarget | null;
}

export interface CoachToday {
  today: string;
  dateLabel: string;
  partOfDay: 'morning' | 'afternoon' | 'evening';
  clientCount: number;
  /** Distinct clients with anything in the queue. */
  needsCount: number;
  attention: AttentionRow[];
  month: CoachMonth;
  /** The soonest end first, as the server ordered them. */
  plansEnding: PlanRow[];
  /** The latest end first, as the server ordered them. */
  plansEnded: PlanRow[];
  activity: ActivityRow[];
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
  const clientCount = Number(view.clientCount);
  return {
    today: view.today,
    dateLabel: formatDate(view.today, 'EEEE d MMMM', context.locale),
    partOfDay: partOfDay(context.now, view.timeZoneId),
    clientCount,
    needsCount: new Set(attention.map((row) => row.clientId)).size,
    attention,
    month: thisMonth(view.month, clientCount, context.locale),
    plansEnding: view.plansEndingSoon.map((item) => planEndingRow(item, view.today, context)),
    plansEnded: view.plansEndedNotRenewed.map((item) => planEndedRow(item, view.today, context)),
    activity: view.activity.map((item) => activityRow(item, context)),
  };
}

/**
 * This month in words (SUB-016, CLI-020). Each currency keeps its own line with the server's exact
 * total, never added to another; only the owner's answer carries the team, so it also says whose
 * money the lines are.
 */
export function thisMonth(month: CoachMonthView, clientCount: number, locale: string): CoachMonth {
  const owner = month.coaches !== null;
  return {
    name: formatDate(month.from, 'MMMM', locale),
    money: month.moneyReceived.map((total) => moneyLine(total, locale)),
    moneyFrom: owner
      ? $localize`Received by your coaching space`
      : $localize`Received from your clients`,
    active: activeClients(Number(month.activeClientCount), clientCount),
    sessions: sessionsHeld(month, owner, locale),
    staff: month.coaches?.map((member) => staffRow(member)) ?? null,
  };
}

function sessionsHeld(
  month: CoachMonthView,
  owner: boolean,
  locale: string,
): CoachMonth['sessions'] {
  const held = month.sessionsHeld;
  if (held === null || held === undefined) return null;
  return {
    held: formatNumber(Number(held), locale, '1.0-0'),
    by: owner ? $localize`Held by your coaching space` : $localize`Held by you`,
  };
}

export function moneyLine(total: CoachMoneyReceivedView, locale: string): MoneyLine {
  const payments = Number(total.paymentCount);
  return {
    currency: total.currency,
    amount: money(Number(total.amount), total.currency, locale),
    payments: payments === 1 ? $localize`1 payment` : $localize`${payments}:count: payments`,
  };
}

/** "9 of 12 clients": active is a plan running today, out of every current client (CLI-020). */
export function activeClients(active: number, total: number): string {
  return total === 1
    ? $localize`${active}:active: of 1 client`
    : $localize`${active}:active: of ${total}:total: clients`;
}

function staffRow(member: CoachClientCountView): StaffRow {
  const active = Number(member.activeClientCount);
  const total = Number(member.clientCount);
  return {
    key: member.coachUserId,
    name: member.isYou ? $localize`You` : member.name,
    initials: initialsOf(member.name),
    clients:
      total === 0
        ? $localize`No clients yet`
        : total === 1
          ? $localize`${active}:active: of 1 client active`
          : $localize`${active}:active: of ${total}:total: clients active`,
  };
}

/**
 * A plan ending soon (CLI-018's flag): its last paid day, Renew, or Record payment for a renewal
 * booked and still unpaid (BEB-7), and Message only when the caller may message the client.
 */
export function planEndingRow(
  item: CoachPlanEndingView,
  today: string,
  context: CoachTodayContext,
): PlanRow {
  const date = shortDay(item.lastDay, context.locale);
  const inDays = daysBetween(today, item.lastDay);
  const name = fullName(item.client);
  return {
    ...planBase(item.client, item.planName, context),
    detail: item.unpaidRenewalId
      ? $localize`Paid until ${date}:date: · The renewal isn’t paid yet`
      : inDays <= 0
        ? $localize`Ends today`
        : inDays === 1
          ? $localize`Ends tomorrow`
          : $localize`Ends ${date}:date:`,
    action: renewOrPay(item.client, item.enrollmentId, item.unpaidRenewalId),
    message: item.canMessage
      ? {
          label: $localize`Message`,
          forWhom: name,
          link: '/messages',
          queryParams: item.chatId ? { conversation: item.chatId } : null,
          // No chat yet: the button starts it, as the client page's Message does.
          startsChatWith: item.chatId ? null : item.client.clientProfileId,
        }
      : null,
    release: null,
  };
}

/**
 * A plan that ran out in the last 30 days with nothing after it (CLI-020): the day it ended, a plan
 * booked after it and unpaid, the client's ask to renew, and, for the owner alone, End coaching.
 */
export function planEndedRow(
  item: CoachPlanEndedView,
  today: string,
  context: CoachTodayContext,
): PlanRow {
  const notes = [
    -daysBetween(today, item.lastDay) === 1
      ? $localize`Ended yesterday`
      : $localize`Ended ${shortDay(item.lastDay, context.locale)}:date:`,
  ];
  if (item.unpaidRenewalId) notes.push($localize`The next plan isn’t paid yet`);
  if (item.renewalRequestedOn) {
    notes.push(
      $localize`Asked to renew on ${shortDay(item.renewalRequestedOn, context.locale)}:date:`,
    );
  }
  const base = planBase(item.client, item.planName, context);
  const version = item.clientVersion;
  return {
    ...base,
    detail: notes.join(' · '),
    action: renewOrPay(item.client, item.enrollmentId, item.unpaidRenewalId),
    message: null,
    release:
      version === null || version === undefined
        ? null
        : {
            id: item.client.clientProfileId,
            firstName: item.client.firstName,
            lastName: item.client.lastName,
            version: Number(version),
            forWhom: $localize`with ${base.name}:name:`,
          },
  };
}

function planBase(client: CoachClientRef, plan: string, context: CoachTodayContext) {
  const name = fullName(client);
  return {
    key: client.clientProfileId,
    clientId: client.clientProfileId,
    name,
    initials: initialsOf(name),
    coach: coachOf(client, context),
    plan: plan.trim(),
  };
}

/**
 * Renew opens the client's renew sheet; a plan booked after this one and still unpaid covers
 * nothing until it is paid (SUB-008), so its payment is recorded instead of a second renewal.
 */
function renewOrPay(
  client: CoachClientRef,
  enrollmentId: string,
  unpaidPlanId: string | null,
): CoachAction {
  const name = fullName(client);
  return {
    label: unpaidPlanId ? $localize`Record payment` : $localize`Renew`,
    forWhom: $localize`for ${name}:name:`,
    link: `/clients/${client.clientProfileId}/service`,
    queryParams: unpaidPlanId ? { pay: unpaidPlanId } : { renew: enrollmentId },
    startsChatWith: null,
  };
}

/** The client's coach, named to an Owner on a team member's client (ADR 0026). */
function coachOf(client: CoachClientRef, context: CoachTodayContext): string | null {
  return context.userId !== null && client.assignedCoachUserId !== context.userId
    ? client.assignedCoachName
    : null;
}

function shortDay(date: string, locale: string): string {
  return formatDate(date, 'EEE d MMM', locale);
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
    coach: coachOf(client, context),
  };
  const forWhom = $localize`for ${name}:name:`;
  // Where the item is handled, which the Clients table's tag for it opens too.
  const target = attentionTarget(item);
  const go = (label: string): CoachAction => ({
    label,
    forWhom,
    link: target.link,
    queryParams: target.queryParams,
    startsChatWith: null,
  });

  switch (item.kind) {
    case 'CheckInToReview':
      return {
        ...base,
        heading:
          count > 1
            ? $localize`${name}:name: sent ${count}:count: check-ins`
            : $localize`${name}:name: sent a check-in`,
        // The oldest ranks the row; the newest is the one the coach may not have seen (CLIENT-19).
        detail:
          count > 1 && item.newestAt
            ? $localize`The newest came ${ago(item.newestAt, context)}:newest:, the first ${ago(item.since, context)}:first:`
            : $localize`Sent ${ago(item.since, context)}:ago:`,
        tag: $localize`Check-in`,
        tone: 'review',
        // One waiting opens straight at its review; several open the client's list of check-ins.
        action: go($localize`Review`),
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
        action: go($localize`Reply`),
      };
    case 'RenewalRequested':
      return {
        ...base,
        heading: $localize`${name}:name: asked to renew`,
        detail: $localize`Plan ended ${date(item.date)}:date:`,
        tag: $localize`Renewal`,
        tone: 'renew',
        action: go($localize`Renew plan`),
      };
    case 'PlanEndingSoon':
      // Only a paid plan covers days (BEB-7): with a renewal still waiting for payment, the item is
      // about that renewal, and the action records its payment.
      return {
        ...base,
        heading: endsHeading(name, daysBetween(today, item.date), date(item.date)),
        detail:
          count > 0
            ? $localize`Paid until ${date(item.date)}:date: · The renewal isn't paid yet`
            : withSessionsLeft(item, $localize`Last day ${date(item.date)}:date:`),
        tag: $localize`Ending soon`,
        tone: 'ending',
        action: go(count > 0 && item.subjectId ? $localize`Record payment` : $localize`Renew plan`),
      };
    case 'SessionsRunningOut':
      // What is left is what matters; the packs' last day says how long there is to use it (SES-008).
      return {
        ...base,
        heading: runningOutHeading(name, Number(item.sessionsLeft ?? 0)),
        detail:
          count > 0
            ? $localize`Last day ${date(item.date)}:date: · The next pack isn’t paid yet`
            : $localize`Last day ${date(item.date)}:date:`,
        tag: $localize`Sessions`,
        tone: 'ending',
        action: go(count > 0 && item.subjectId ? $localize`Record payment` : $localize`Renew pack`),
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
        action: go($localize`Share week`),
      };
    }
    case 'MissedSessions':
      return {
        ...base,
        heading: $localize`${name}:name: missed ${count}:count: workouts in a row`,
        detail: item.date
          ? $localize`Last trained ${date(item.date)}:date:`
          : $localize`No workout logged yet`,
        tag: $localize`Missed`,
        tone: 'missed',
        action: go($localize`See training`),
      };
    case 'CheckInOverdue':
      // Never sent, so there is nothing to read (CHK-015): the action asks for it, in the chat only the
      // client's own coach has while messaging is in the plan, else it opens their check-ins (CLI-013).
      return {
        ...base,
        heading:
          count > 1
            ? $localize`${name}:name: has ${count}:count: check-ins overdue`
            : $localize`${name}:name:'s check-in is overdue`,
        detail: overdueDetail(count, date(item.date)),
        tag: $localize`Overdue`,
        tone: 'missed',
        action: item.canMessage
          ? {
              label: $localize`Remind`,
              forWhom: name,
              link: '/messages',
              queryParams: item.subjectId ? { conversation: item.subjectId } : null,
              startsChatWith: item.subjectId ? null : client.clientProfileId,
            }
          : go($localize`See check-ins`),
      };
    case 'NoPlan':
      // A new client with no plan at all (COACH-9, the owner's decision of 2026-10-19).
      return {
        ...base,
        heading: $localize`${name}:name: joined`,
        detail: joinedDetail(item.date, today, context.locale),
        tag: $localize`New`,
        tone: 'new',
        // Opens the client's Service & access with Start a plan already open.
        action: go($localize`Start a plan`),
      };
    case 'NoProgram': {
      const isNew = item.date !== null && -daysBetween(today, item.date) < NEW_CLIENT_DAYS;
      return {
        ...base,
        heading: item.subjectId
          ? $localize`${name}:name: has no program running`
          : $localize`${name}:name: has no program yet`,
        detail: $localize`Joined ${date(item.date)}:date:`,
        tag: isNew ? $localize`New` : $localize`Program`,
        tone: 'new',
        // Opens the client's Training with the Assign program sheet already open (R3.4a).
        action: go($localize`Assign program`),
      };
    }
  }
}

/**
 * Where an attention item is handled (CLI-018): what Today's action and the client page's open, and
 * what the Clients table's tag for it links to (critique B4a). An overdue check-in's tag opens the
 * client's check-ins, what it names; Remind is Today's and the client page's own action.
 */
export function attentionTarget(item: CoachAttentionItemView): {
  link: string;
  queryParams: Record<string, string> | null;
} {
  const page = `/clients/${item.client.clientProfileId}`;
  const count = Number(item.count ?? 0);
  const subject = item.subjectId;
  switch (item.kind) {
    case 'CheckInToReview':
      // One waiting opens straight at its review; several open the client's list of check-ins.
      return {
        link: subject && count <= 1 ? `${page}/checkins/${subject}` : `${page}/checkins`,
        queryParams: null,
      };
    case 'UnreadMessages':
      return { link: '/messages', queryParams: subject ? { conversation: subject } : null };
    case 'RenewalRequested':
      return { link: `${page}/service`, queryParams: subject ? { renew: subject } : null };
    case 'PlanEndingSoon':
    case 'SessionsRunningOut':
      // Only a paid plan covers days (BEB-7): with a renewal still unpaid, its payment is the action.
      return {
        link: `${page}/service`,
        queryParams: subject ? (count > 0 ? { pay: subject } : { renew: subject }) : null,
      };
    case 'WeekNotShared':
    case 'MissedSessions':
      return { link: `${page}/training`, queryParams: null };
    case 'CheckInOverdue':
      return { link: `${page}/checkins`, queryParams: null };
    case 'NoProgram':
      // Opens the client's Training with the Assign program sheet already open (R3.4a).
      return { link: `${page}/training`, queryParams: { action: 'assign' } };
    case 'NoPlan':
      // Opens the client's Service & access with Start a plan already open.
      return { link: `${page}/service`, queryParams: { action: 'start' } };
  }
}

/** When an overdue check-in was due, the oldest one's day when there are several. */
export function overdueDetail(count: number, dueDay: string): string {
  return count > 1
    ? $localize`The oldest was due ${dueDay}:date:`
    : $localize`It was due ${dueDay}:date:`;
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
    // The feed names one check-in, so it opens that check-in's review.
    link: item.subjectId ? `${clientPage}/checkins/${item.subjectId}` : `${clientPage}/checkins`,
  };
}

/** When a new client joined, beside "no plan yet": "Today · no plan yet", "Mon 12 Oct · no plan yet". */
export function joinedDetail(joinedOn: string | null, today: string, locale: string): string {
  if (!joinedOn) return $localize`No plan yet`;
  const daysAgo = -daysBetween(today, joinedOn);
  if (daysAgo <= 0) return $localize`Today · no plan yet`;
  if (daysAgo === 1) return $localize`Yesterday · no plan yet`;
  return $localize`${formatDate(joinedOn, 'EEE d MMM', locale)}:date: · no plan yet`;
}

/** A pack standing as the client's plan says what is left on the plan's own item (ADR 0038). */
export function withSessionsLeft(
  item: Pick<CoachAttentionItemView, 'sessionsLeft'>,
  detail: string,
): string {
  const left = item.sessionsLeft;
  return left === null || left === undefined ? detail : `${sessionsLeft(Number(left))} · ${detail}`;
}

function runningOutHeading(name: string, left: number): string {
  if (left <= 0) return $localize`${name}:name: has no sessions left`;
  return left === 1
    ? $localize`${name}:name: has 1 session left`
    : $localize`${name}:name: has ${left}:count: sessions left`;
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
