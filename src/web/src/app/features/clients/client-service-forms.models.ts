import { formatDate } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import type { ClientEnrollment } from '../../core/api/api.models';
import { addDays } from './client-overview.models';
import { money, type OfferChoice } from './client-service.models';

/**
 * The forms of Service & access: starting or renewing a plan, recording a payment, and the reason a
 * pause, cancellation or block asks for. Validation here only spares a round trip; the server checks
 * every one again (SUB-003 to SUB-011) and its refusals are rewritten in coach words below.
 */

export type FieldMessages = Record<string, string[]>;

/** The reason a pause, cancellation or block keeps on record, as the server allows it. */
export const REASON_LIMIT = 500;

export function reasonErrors(reason: string): string[] {
  const text = reason.trim();
  if (!text) return [$localize`Say why. It is kept on the record.`];
  if (text.length > REASON_LIMIT) {
    return [$localize`Keep it under ${REASON_LIMIT}:limit: characters.`];
  }
  return [];
}

// ------------------------------------------------------------------------------------------------
// Starting or renewing a plan
// ------------------------------------------------------------------------------------------------

/** A plan's days from its start, half-open (SUB-003, SUB-005): the server works it out the same way. */
export function planPeriod(start: string, days: number): { lastDay: string; endExclusive: string } {
  const endExclusive = addDays(start, days);
  return { lastDay: addDays(endExclusive, -1), endExclusive };
}

export interface PlanStartValues {
  readonly offerId: string;
  readonly startDate: string;
}

export function planStartErrors(
  values: PlanStartValues,
  choice: OfferChoice | undefined,
  today: string,
): FieldMessages {
  const errors: FieldMessages = {};
  if (!values.offerId || !choice) errors['offerId'] = [$localize`Choose a price option.`];
  if (!values.startDate) {
    errors['startDate'] = [$localize`Choose the first day.`];
  } else if (choice && planPeriod(values.startDate, choice.days).endExclusive <= today) {
    errors['startDate'] = [$localize`That plan would already be over. Choose a later first day.`];
  }
  return errors;
}

/** "Runs Mon 12 Oct – Sun 3 Jan", with the year when it is not this one. */
export function planRunText(start: string, days: number, today: string, locale: string): string {
  const { lastDay } = planPeriod(start, days);
  const sameYear =
    start.slice(0, 4) === today.slice(0, 4) && lastDay.slice(0, 4) === today.slice(0, 4);
  const pattern = sameYear ? 'EEE d MMM' : 'EEE d MMM y';
  return $localize`Runs ${formatDate(start, pattern, locale)}:from: – ${formatDate(lastDay, pattern, locale)}:to:`;
}

/**
 * Another live plan that already covers one of these features on these dates (SUB-004), which the
 * server would refuse; null when there is none. A feature the option may cover alongside another
 * plan does not count.
 */
export function overlappingPlan(
  choice: OfferChoice,
  start: string,
  plans: readonly ClientEnrollment[],
  today: string,
): ClientEnrollment | null {
  const { endExclusive } = planPeriod(start, choice.days);
  const blocking = choice.features.filter((feature) => !choice.concurrent.includes(feature));
  return (
    plans
      .filter(
        (plan) =>
          plan.storedStatus !== 'Cancelled' &&
          plan.endDateExclusive > today &&
          plan.startDate < endExclusive &&
          start < plan.endDateExclusive &&
          plan.features.some((feature) => blocking.includes(feature)),
      )
      .sort((a, b) => b.endDateExclusive.localeCompare(a.endDateExclusive))[0] ?? null
  );
}

// ------------------------------------------------------------------------------------------------
// Recording a payment
// ------------------------------------------------------------------------------------------------

export interface PaymentValues {
  readonly amount: number | null;
  readonly receivedOn: string;
}

export function paymentErrors(
  values: PaymentValues,
  balance: number,
  today: string,
): FieldMessages {
  const errors: FieldMessages = {};
  const amount = values.amount;
  if (amount === null || !Number.isFinite(amount) || amount <= 0) {
    errors['amount'] = [$localize`Enter the amount received.`];
  } else if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
    errors['amount'] = [$localize`Use at most two decimals.`];
  } else if (amount > balance) {
    errors['amount'] = [$localize`That is more than is left to pay.`];
  }
  if (!values.receivedOn) {
    errors['receivedOn'] = [$localize`Choose the day it was received.`];
  } else if (values.receivedOn > today) {
    errors['receivedOn'] = [$localize`A payment can’t be received in the future.`];
  }
  return errors;
}

/** What the payment does, in a sentence under the amount. */
export function paymentOutcome(
  amount: number | null,
  plan: { balance: number; currency: string; startDate: string },
  firstName: string,
  today: string,
  locale: string,
): string {
  if (amount === null || !Number.isFinite(amount) || amount <= 0 || amount > plan.balance)
    return '';
  const left = Math.round((plan.balance - amount) * 100) / 100;
  if (left > 0) {
    return $localize`${money(left, plan.currency, locale)}:left: will still be left. ${firstName}:name: gets access once the full price is paid.`;
  }
  return plan.startDate > today
    ? $localize`This pays the plan in full. ${firstName}:name: gets access from ${formatDate(plan.startDate, 'EEE d MMM', locale)}:date:.`
    : $localize`This pays the plan in full, so ${firstName}:name: gets access right away.`;
}

// ------------------------------------------------------------------------------------------------
// The server's refusals, in coach words
// ------------------------------------------------------------------------------------------------

const SYSTEM_WORDS = /enrollment|entitlement|offer|idempotency|phase 2|fx/i;

function serverText(error: unknown): { code: string | null; text: string | null } {
  if (!(error instanceof HttpErrorResponse)) return { code: null, text: null };
  const body = error.error as
    | { code?: string; message?: string; title?: string; errors?: Record<string, string[]> }
    | null
    | undefined;
  const first = body?.errors ? Object.values(body.errors).flat()[0] : undefined;
  return { code: body?.code ?? null, text: body?.message ?? first ?? body?.title ?? null };
}

/**
 * What a change to a plan or the client's access was answered with. The server's sentences are
 * about its engine ("the enrollment…"), so the ones it is known to send are rewritten, and anything
 * else that still carries a system word is replaced by `fallback`.
 */
export function serviceWriteError(error: unknown, fallback: string, name: string): string {
  const { code, text } = serverText(error);
  switch (code) {
    case 'entitlement_overlap':
      return text && text.includes(' from ') && text.includes(' to ')
        ? text
        : $localize`${name}:name: already has a plan that includes the same things on some of those dates. Start after it ends, or cancel it first.`;
    case 'concurrency_conflict':
      return $localize`This was changed somewhere else since you opened it. The page has been reloaded: check it, then try again.`;
    case 'idempotency_key_reused':
    case 'assignment_conflict':
    case 'payment_conflict':
      return $localize`That clashes with an earlier request. Reload the page to see what was saved.`;
    case 'workspace_read_only':
      return $localize`Your coaching space is read-only until its TB Gym bill is paid. You can still view everything.`;
  }
  const said = (text ?? '').toLowerCase();
  if (said.includes('cannot exceed the outstanding'))
    return $localize`That is more than is left to pay.`;
  if (said.includes('price currency')) {
    return $localize`A payment has to be in the plan’s own currency.`;
  }
  if (said.includes('expired enrollment cannot receive')) {
    return $localize`This plan has ended, so it can’t take a payment.`;
  }
  if (said.includes('only a pending-payment enrollment')) {
    return $localize`This plan is already paid.`;
  }
  if (said.includes('must end after today')) {
    return $localize`That plan would already be over. Choose a later first day.`;
  }
  if (said.includes('belong to the original coaching product')) {
    return $localize`A renewal uses one of the same plan’s price options.`;
  }
  if (said.includes('only an active product and offer')) {
    return $localize`That price option is no longer offered. Choose another.`;
  }
  if (said.includes('expired enrollment cannot change')) {
    return $localize`This plan has ended, so it can’t change any more.`;
  }
  if (said.includes('only an active enrollment can be paused')) {
    return $localize`Only a running, paid plan can be paused.`;
  }
  if (said.includes('only a paused enrollment can be resumed')) {
    return $localize`This plan isn’t paused.`;
  }
  if (said.includes('cannot be cancelled again')) {
    return $localize`This plan is already over.`;
  }
  return text && !SYSTEM_WORDS.test(text) ? text : fallback;
}
