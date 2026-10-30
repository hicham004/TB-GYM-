import type { OwnPlansView, OwnPlanView } from '../../core/api/generated';
import type { StatusPillTone } from '../../ui/status-pill';
import { daysBetween } from '../clients/client-overview.models';
import { dateRange, shortDate } from '../clients/client-service.models';
import { featureChip, FEATURES, type FeatureChip } from '../commercial/products.models';

/**
 * My plan (critique B10a, SUB-017): a client's own plans in their own words. Pure functions of the
 * server's answer and the workspace's today, which the answer carries, so every rule here has a
 * fixed test. The server decides each plan's status; this only says it.
 */
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
  /** The plan has ended, so Today is where it goes on from (ADR 0029). */
  readonly ended: boolean;
  /** What's included, in one fixed order. */
  readonly includes: readonly FeatureChip[];
  readonly description: string | null;
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

function status(plan: OwnPlanView, today: string, locale: string): Pick<OwnPlan, 'pill' | 'note'> {
  switch (plan.status) {
    case 'Active':
      return { pill: { label: runningLabel(today, plan.lastDay), tone: 'success' }, note: null };
    case 'Upcoming':
      return { pill: { label: startsLabel(today, plan.startDate), tone: 'info' }, note: null };
    case 'PendingPayment':
      return {
        pill: { label: $localize`Waiting for payment`, tone: 'warm' },
        note: $localize`It starts once your coach has your payment.`,
      };
    case 'Paused':
      return {
        pill: { label: $localize`Paused`, tone: 'warning' },
        // A pause has no end of its own (SUB-006), which a client would not guess.
        note: $localize`Your coach has paused this plan. It still ends on ${shortDate(plan.lastDay, locale)}:date:.`,
      };
    case 'Blocked':
      return {
        pill: { label: $localize`Access paused`, tone: 'warning' },
        note: $localize`Your coach has paused your access.`,
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
        note: $localize`If you’d like to keep going, ask your coach to renew it.`,
      };
  }
}

export function ownPlan(plan: OwnPlanView, today: string, locale: string): OwnPlan {
  return {
    id: plan.id,
    name: plan.name,
    option: plan.optionLabel,
    dates: dateRange(plan.startDate, plan.lastDay, { today, locale }),
    ...status(plan, today, locale),
    ended: plan.status === 'Expired',
    includes: FEATURES.filter((feature) => plan.features.includes(feature)).map(featureChip),
    description: plan.description,
  };
}

export function ownPlans(view: OwnPlansView, locale: string): OwnPlan[] {
  return view.plans.map((plan) => ownPlan(plan, view.today, locale));
}
