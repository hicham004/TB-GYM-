import { formatDate } from '@angular/common';
import type { OwnPlansView, OwnPlanView, OwnSessionsView } from '../../core/api/generated';
import { daysBetween } from '../clients/client-overview.models';

/**
 * A client's 1-on-1 sessions in their own words (critique B10c, SES-007): the sentence My plan and Today
 * share, "7 of 10 sessions with Karim left, until 9 January". Pure functions of the server's answer
 * and the workspace's today, which the answer carries. The server counts; this only says it.
 */

/** Past this many days a pack's date names its year: a pack can run longer than a year. */
const SAME_YEAR_DAYS = 300;

/** "9 January", with its year only when it could be taken for another. */
function longDate(date: string, today: string, locale: string): string {
  const far = Math.abs(daysBetween(today, date)) > SAME_YEAR_DAYS;
  return formatDate(date, far ? 'd MMMM y' : 'd MMMM', locale);
}

/** A person calls their coach by their first name; the server sends the name in full. */
export function firstName(name: string | null | undefined): string | null {
  return name?.trim().split(/\s+/)[0] || null;
}

function sessionWords(count: number, coach: string | null): string {
  if (count === 1) return coach ? $localize`session with ${coach}:coach:` : $localize`session`;
  return coach ? $localize`sessions with ${coach}:coach:` : $localize`sessions`;
}

/** What became of a pack that is over: what was used, and what lapsed with its end (SES-006). */
function overLine(pack: OwnSessionsView, words: string, today: string, locale: string): string {
  const count = Number(pack.count);
  const used = Number(pack.used);
  const lapsed = Number(pack.lapsed);
  const on = lapsed > 0 && pack.lapsedOn ? longDate(pack.lapsedOn, today, locale) : null;
  if (count === 1) {
    return on ? $localize`Your ${words}:sessions: lapsed on ${on}:date:` : usedUp(count, words);
  }
  if (!on) return usedUp(count, words);
  return used === 0
    ? $localize`All ${count}:count: ${words}:sessions: lapsed on ${on}:date:`
    : $localize`${used}:used: of ${count}:count: ${words}:sessions: used, and ${lapsed}:lapsed: lapsed on ${on}:date:`;
}

function usedUp(count: number, words: string): string {
  return count === 1
    ? $localize`Your ${words}:sessions: is used`
    : $localize`All ${count}:count: ${words}:sessions: used`;
}

/**
 * Where a pack stands, or null while it waits for payment and holds no session yet (SES-003): the
 * plan's own note says so.
 */
export function sessionsLine(
  plan: Pick<OwnPlanView, 'status' | 'lastDay' | 'sessions'>,
  coachName: string | null | undefined,
  today: string,
  locale: string,
): string | null {
  const pack = plan.sessions;
  if (!pack || plan.status === 'PendingPayment') return null;
  const count = Number(pack.count);
  const left = Number(pack.left);
  const words = sessionWords(count, firstName(coachName));
  if (plan.status === 'Expired' || plan.status === 'Cancelled') {
    return overLine(pack, words, today, locale);
  }
  if (left <= 0) return usedUp(count, words);
  const until = longDate(plan.lastDay, today, locale);
  return count === 1
    ? $localize`1 ${words}:sessions: left, until ${until}:date:`
    : $localize`${left}:left: of ${count}:count: ${words}:sessions: left, until ${until}:date:`;
}

/** Today's line under "1-on-1 sessions". */
export interface TodaySessions {
  /** The pack a session goes on next, or where it stands while it can't take one. */
  readonly line: string;
  /** "+1 more pack" while others run or are to come; null with none. */
  readonly more: string | null;
}

/** Not over: a pack that has ended has left Today, whatever My plan keeps of it. */
function isLive(plan: OwnPlanView): boolean {
  return Boolean(plan.sessions) && plan.status !== 'Expired' && plan.status !== 'Cancelled';
}

/** The pack ending first with a session left (SES-004), else the first in the server's order. */
function nextPack(packs: readonly OwnPlanView[]): OwnPlanView {
  const usable = packs
    .filter((plan) => plan.status === 'Active' && Number(plan.sessions?.left ?? 0) > 0)
    .sort((a, b) => a.lastDay.localeCompare(b.lastDay));
  return usable[0] ?? packs[0];
}

function statusLine(plan: OwnPlanView, line: string | null): string {
  switch (plan.status) {
    case 'PendingPayment':
      return $localize`Waiting for payment`;
    case 'Paused':
      return line ? $localize`Paused · ${line}:sessions:` : $localize`Paused`;
    case 'Blocked':
      return $localize`Your coach has paused your access`;
    default:
      return line ?? '';
  }
}

/** The client's packs on Today: null with none running or to come. */
export function todaySessions(view: OwnPlansView, locale: string): TodaySessions | null {
  const packs = view.plans.filter(isLive);
  if (packs.length === 0) return null;
  const next = nextPack(packs);
  const others = packs.length - 1;
  return {
    line: statusLine(next, sessionsLine(next, view.coachName, view.today, locale)),
    more:
      others === 0
        ? null
        : others === 1
          ? $localize`+1 more pack`
          : $localize`+${others}:count: more packs`,
  };
}
