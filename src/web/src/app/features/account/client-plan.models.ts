import { formatDate } from '@angular/common';
import type {
  OwnFreePlanView,
  OwnPlansView,
  OwnPlanView,
  OwnSessionView,
} from '../../core/api/generated';
import type { StatusPillTone } from '../../ui/status-pill';
import { daysBetween } from '../clients/client-overview.models';
import { dateRange, shortDate } from '../clients/client-service.models';
import { featureChip, LISTED_FEATURES, type FeatureChip } from '../commercial/products.models';
import { sessionsLine } from './own-sessions.models';

/**
 * My plan (critique B10a, SUB-017): a client's own plans in their own words. Pure functions of the
 * server's answer and the workspace's today, which the answer carries, so every rule here has a
 * fixed test. The server decides each plan's status; this only says it.
 */

/** A session held or charged that stands, as its client reads it (critique B10c, SES-007). */
export interface OwnSession {
  readonly key: string;
  /** "Tue 20 Oct" */
  readonly day: string;
  /** "Held", or "Charged" with the reason the coach wrote for them. */
  readonly what: string;
  readonly reason: string | null;
}

/** What a pack holds: where it stands, and what happened to each session so far, newest first. */
export interface OwnPackSessions {
  /** "7 of 10 sessions with Karim left, until 9 January"; null while it waits for payment. */
  readonly line: string | null;
  readonly history: readonly OwnSession[];
}

export interface OwnPlan {
  readonly id: string;
  /** "Online Coaching" */
  readonly name: string;
  /** The name of the price, "12 weeks" or the coach's own, as sold. */
  readonly option: string;
  /** "Mon 5 Oct – Sat 28 Nov" */
  readonly dates: string;
  readonly pill: { readonly label: string; readonly tone: StatusPillTone };
  /** What the status means for them, where the pill alone leaves a question. */
  readonly note: string | null;
  /** The plan has ended, so Ask to renew, or else Today, is where it goes on from (ADR 0029). */
  readonly ended: boolean;
  /** What's included, in one fixed order. */
  readonly includes: readonly FeatureChip[];
  readonly description: string | null;
  /** A session pack's sessions; null on a coaching plan. */
  readonly sessions: OwnPackSessions | null;
}

/** The days left in a running plan, its last two by name. */
function runningLabel(today: string, lastDay: string): string {
  const left = daysBetween(today, lastDay);
  if (left <= 0) return $localize`Ends today`;
  if (left === 1) return $localize`Ends tomorrow`;
  return $localize`Active · ${left}:count: days left`;
}

function startsLabel(today: string, startDate: string): string {
  const until = daysBetween(today, startDate);
  return until === 1 ? $localize`Starts tomorrow` : $localize`Starts in ${until}:count: days`;
}

/**
 * A plan's pill and what it means. For a self-directed trainee of the house (`trainee`), TB Gym stands
 * where a coach would, and a paid plan that ran out leaves them on Free (notes plan N9c2).
 */
function status(
  plan: OwnPlanView,
  today: string,
  locale: string,
  trainee = false,
): Pick<OwnPlan, 'pill' | 'note'> {
  switch (plan.status) {
    case 'Active':
      return { pill: { label: runningLabel(today, plan.lastDay), tone: 'success' }, note: null };
    case 'Upcoming':
      return { pill: { label: startsLabel(today, plan.startDate), tone: 'info' }, note: null };
    case 'PendingPayment':
      return {
        pill: { label: $localize`Waiting for payment`, tone: 'warm' },
        note: trainee
          ? $localize`It starts once TB Gym has your payment.`
          : $localize`It starts once your coach has your payment.`,
      };
    case 'Paused':
      return {
        pill: { label: $localize`Paused`, tone: 'warning' },
        // A pause has no end of its own (SUB-006), which a client would not guess.
        note: trainee
          ? $localize`TB Gym has paused this plan. It still ends on ${shortDate(plan.lastDay, locale)}:date:.`
          : $localize`Your coach has paused this plan. It still ends on ${shortDate(plan.lastDay, locale)}:date:.`,
      };
    case 'Blocked':
      return {
        pill: { label: $localize`Access paused`, tone: 'warning' },
        note: trainee
          ? $localize`TB Gym has paused your access.`
          : $localize`Your coach has paused your access.`,
      };
    case 'Cancelled':
      return {
        pill: {
          // The day it was cancelled, never its last day, which may still be to come (COACH-20).
          label: plan.cancelledOn
            ? $localize`Cancelled ${shortDate(plan.cancelledOn, locale)}:date:`
            : $localize`Cancelled`,
          tone: 'neutral',
        },
        note: null,
      };
    case 'Expired':
      return {
        pill: { label: $localize`Ended`, tone: 'neutral' },
        note: trainee
          ? $localize`You’re back on Free. Everything you logged stays yours.`
          : $localize`If you’d like to keep going, ask your coach to renew it.`,
      };
  }
}

function ownSession(session: OwnSessionView, index: number, locale: string): OwnSession {
  return {
    key: `${session.day}-${index}`,
    day: shortDate(session.day, locale),
    what: session.outcome === 'Held' ? $localize`Held` : $localize`Charged`,
    reason: session.reason,
  };
}

export function ownPlan(
  plan: OwnPlanView,
  today: string,
  locale: string,
  coachName: string | null = null,
  trainee = false,
): OwnPlan {
  return {
    id: plan.id,
    name: plan.name,
    option: plan.optionLabel,
    dates: dateRange(plan.startDate, plan.lastDay, { today, locale }),
    ...status(plan, today, locale, trainee),
    ended: plan.status === 'Expired',
    includes: LISTED_FEATURES.filter((feature) => plan.features.includes(feature)).map(featureChip),
    description: plan.description,
    sessions: plan.sessions
      ? {
          line: sessionsLine(plan, coachName, today, locale),
          history: plan.sessions.sessions.map((session, index) =>
            ownSession(session, index, locale),
          ),
        }
      : null,
  };
}

/**
 * The plans in the server's order. Only a self-directed trainee of the house has Free (N9b1), so `trainee`
 * follows it unless the caller says otherwise.
 */
export function ownPlans(
  view: OwnPlansView,
  locale: string,
  trainee = view.free !== null && view.free !== undefined,
): OwnPlan[] {
  return view.plans.map((plan) =>
    ownPlan(plan, view.today, locale, view.coachName ?? null, trainee),
  );
}

/** Free, TB Gym's own plan under every trainee's paid ones (N9b1): it never ends, so it has no end date. */
export interface FreePlan {
  /** "Free", as the house names it. */
  readonly name: string;
  /** "Since Thu 1 Oct" */
  readonly since: string;
  readonly pill: { readonly label: string; readonly tone: StatusPillTone };
  /** What the pill leaves to say, in order: a pause of access, then that it never ends. */
  readonly notes: readonly string[];
  readonly includes: readonly FeatureChip[];
}

export function freePlan(free: OwnFreePlanView, today: string, locale: string): FreePlan {
  const since =
    free.since.slice(0, 4) === today.slice(0, 4)
      ? shortDate(free.since, locale)
      : formatDate(free.since, 'd MMM y', locale);
  const never = $localize`It never ends, and it keeps running beside any plan you add.`;
  let pill: FreePlan['pill'];
  let notes: string[] = [never];
  switch (free.status) {
    case 'Active':
      pill = { label: $localize`No end date`, tone: 'success' };
      break;
    case 'Blocked':
      pill = { label: $localize`Access paused`, tone: 'warning' };
      notes = [$localize`TB Gym has paused your access.`, never];
      break;
    default:
      // Never a last day: the plan's own pill, read as if Free ended the day it began, says none.
      pill = status(
        {
          id: 'free',
          name: free.name,
          optionLabel: '',
          description: null,
          startDate: free.since,
          lastDay: free.since,
          cancelledOn: null,
          status: free.status,
          features: free.features,
        },
        today,
        locale,
        true,
      ).pill;
  }
  return {
    name: free.name,
    since: $localize`Since ${since}:date:`,
    pill,
    notes,
    includes: LISTED_FEATURES.filter((feature) => free.features.includes(feature)).map(featureChip),
  };
}
