import { formatDate, formatNumber } from '@angular/common';
import type {
  CoachMoneyReceivedView,
  CoachMonthNumbersView,
  CoachMonthReportView,
  CoachMonthRowView,
} from '../../core/api/generated';
import { initialsOf } from '../../shell/initials';
import { money } from '../clients/client-service.models';
import { moneyLine } from '../dashboard/coach-today.models';

/**
 * The This month page (critique B10d, SUB-018) in coach words. Every number is the server's, counted
 * in the workspace's calendar; this only phrases them. Each currency keeps its own line and is never
 * added to another, and there is no percentage: a month so far beside a whole month would mislead.
 */

/** One currency this month, beside what it brought last month. */
export interface MonthMoney {
  currency: string;
  /** "USD 2,340", "USD 0" for a currency last month alone had. */
  amount: string;
  /** "7 payments", or nothing to say with none this month. */
  payments: string;
  /** "September: USD 1,980", or "Nothing in September". */
  last: string;
}

export type MonthCountKey = 'sessions' | 'plans' | 'packs' | 'started' | 'ended';

export interface MonthCount {
  key: MonthCountKey;
  label: string;
  value: string;
  /** "September: 9". */
  last: string;
}

/** One month's numbers on a row of the owner's table. */
export interface RowNumbers {
  /** One entry per currency, "USD 300"; empty with none. */
  money: string[];
  sessions: string;
  plans: string;
  packs: string;
  started: string;
  ended: string;
}

export interface CoachRow {
  key: string;
  /** "You" for the owner, else the coach's name. */
  name: string;
  initials: string;
  hasLeftTheTeam: boolean;
  thisMonth: RowNumbers;
  lastMonth: RowNumbers;
}

export interface MonthPage {
  /** "October so far". */
  soFar: string;
  /** "September". */
  lastMonth: string;
  /** Whose numbers these are: the whole coaching space's for the owner, a coach's own. */
  whose: string;
  /** One line per currency either month held, in currency order. */
  money: MonthMoney[];
  counts: MonthCount[];
  /**
   * Each coach's row, the owner's alone and only with someone to tell apart: another coach, or the
   * No coach line.
   */
  coaches: CoachRow[] | null;
  /**
   * What counted while a client waited for a coach (N9d1b, MonthNumbers v3), the owner's alone; null
   * when nothing did in either month. The rows plus this line add up to the Total.
   */
  noCoach: { thisMonth: RowNumbers; lastMonth: RowNumbers } | null;
  /** The owner's Total row, the same numbers as the top of the page. */
  total: { thisMonth: RowNumbers; lastMonth: RowNumbers };
  /** Nothing to count in either month. */
  empty: boolean;
}

export function monthPage(view: CoachMonthReportView, locale: string): MonthPage {
  const lastMonth = formatDate(view.lastMonthFrom, 'MMMM', locale);
  const now = view.thisMonth;
  const before = view.lastMonth;
  const count = (key: MonthCountKey, label: string, value: (month: Numbers) => unknown) => ({
    key,
    label,
    value: whole(value(now), locale),
    last: $localize`${lastMonth}:month:: ${whole(value(before), locale)}:count:`,
  });
  // Only beside the owner's rows: a coach's own report never has one.
  const noCoach =
    view.coaches !== null && view.noCoach
      ? {
          thisMonth: rowNumbers(view.noCoach.thisMonth, locale),
          lastMonth: rowNumbers(view.noCoach.lastMonth, locale),
        }
      : null;
  return {
    soFar: $localize`${formatDate(view.thisMonthFrom, 'MMMM', locale)}:month: so far`,
    lastMonth,
    whose: view.coaches === null ? $localize`Your numbers` : $localize`Your coaching space`,
    money: moneyLines(now.moneyReceived, before.moneyReceived, lastMonth, locale),
    counts: [
      count('sessions', $localize`1-on-1 sessions held`, (month) => month.sessionsHeld),
      count('plans', $localize`Coaching plans sold`, (month) => month.plansSold),
      count('packs', $localize`Session packs sold`, (month) => month.packsSold),
      count('started', $localize`Clients started`, (month) => month.clientsStarted),
      count('ended', $localize`Clients ended`, (month) => month.clientsEnded),
    ],
    coaches:
      view.coaches !== null && (view.coaches.length > 1 || noCoach !== null)
        ? view.coaches.map((row) => coachRow(row, locale))
        : null,
    noCoach,
    total: { thisMonth: rowNumbers(now, locale), lastMonth: rowNumbers(before, locale) },
    empty: isEmpty(now) && isEmpty(before),
  };
}

type Numbers = CoachMonthNumbersView;

function moneyLines(
  now: readonly CoachMoneyReceivedView[],
  before: readonly CoachMoneyReceivedView[],
  lastMonth: string,
  locale: string,
): MonthMoney[] {
  const currencies = [...new Set([...now, ...before].map((total) => total.currency))].sort();
  return currencies.map((currency) => {
    const current = now.find((total) => total.currency === currency);
    const earlier = before.find((total) => total.currency === currency);
    const line = current ? moneyLine(current, locale) : null;
    return {
      currency,
      amount: line?.amount ?? money(0, currency, locale),
      payments: line?.payments ?? '',
      last: earlier
        ? $localize`${lastMonth}:month:: ${money(Number(earlier.amount), currency, locale)}:amount:`
        : $localize`Nothing in ${lastMonth}:month:`,
    };
  });
}

function coachRow(row: CoachMonthRowView, locale: string): CoachRow {
  return {
    key: row.coachUserId,
    name: row.isYou ? $localize`You` : row.name,
    initials: initialsOf(row.name),
    hasLeftTheTeam: row.hasLeftTheTeam,
    thisMonth: rowNumbers(row.thisMonth, locale),
    lastMonth: rowNumbers(row.lastMonth, locale),
  };
}

function rowNumbers(month: Numbers, locale: string): RowNumbers {
  return {
    money: month.moneyReceived.map((total) => moneyLine(total, locale).amount),
    sessions: whole(month.sessionsHeld, locale),
    plans: whole(month.plansSold, locale),
    packs: whole(month.packsSold, locale),
    started: whole(month.clientsStarted, locale),
    ended: whole(month.clientsEnded, locale),
  };
}

function isEmpty(month: Numbers): boolean {
  return (
    month.moneyReceived.length === 0 &&
    [
      month.sessionsHeld,
      month.plansSold,
      month.packsSold,
      month.clientsStarted,
      month.clientsEnded,
    ].every((count) => Number(count) === 0)
  );
}

function whole(value: unknown, locale: string): string {
  return formatNumber(Number(value), locale, '1.0-0');
}
