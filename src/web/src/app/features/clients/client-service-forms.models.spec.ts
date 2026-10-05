import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import {
  cancelledPlan,
  catalog,
  enrollment,
  SERVICE_TODAY,
  unpaidRenewal,
} from '../../../testing/client-service-fixtures';
import {
  overlappingPlan,
  paymentErrors,
  paymentOutcome,
  planPeriod,
  planRunText,
  planStartErrors,
  reasonErrors,
  receivedAtUtc,
  serviceWriteError,
} from './client-service-forms.models';
import { offerChoices } from './client-service.models';

const [twelveWeeks, fourWeeks, recipes] = offerChoices(catalog(), 'en-US');

describe('starting or renewing a plan', () => {
  it('works the dates out as the server does: half-open, from the option’s length', () => {
    expect(planPeriod('2026-10-13', 84)).toEqual({
      lastDay: '2027-01-04',
      endExclusive: '2027-01-05',
    });
    expect(planRunText('2026-10-02', 28, SERVICE_TODAY, 'en-US')).toBe(
      'Runs Fri 2 Oct – Thu 29 Oct',
    );
    expect(planRunText('2026-10-13', 84, SERVICE_TODAY, 'en-US')).toBe(
      'Runs Tue 13 Oct 2026 – Mon 4 Jan 2027',
    );
  });

  it('asks for a price option and a first day, and refuses a plan that would already be over', () => {
    expect(planStartErrors({ offerId: '', startDate: '' }, undefined, SERVICE_TODAY)).toEqual({
      offerId: ['Choose a price option.'],
      startDate: ['Choose the first day.'],
    });
    expect(
      planStartErrors({ offerId: 'o-4', startDate: '2026-09-01' }, fourWeeks, SERVICE_TODAY),
    ).toEqual({ startDate: ['That plan would already be over. Choose a later first day.'] });
    // A plan may start in the past as long as some of it is still ahead.
    expect(
      planStartErrors({ offerId: 'o-4', startDate: '2026-09-10' }, fourWeeks, SERVICE_TODAY),
    ).toEqual({});
  });

  it('finds a live plan that already covers the same things on those dates', () => {
    const plans = [enrollment(), cancelledPlan()];

    expect(overlappingPlan(twelveWeeks, SERVICE_TODAY, plans, SERVICE_TODAY)?.id).toBe('e-1');
    expect(overlappingPlan(twelveWeeks, '2026-10-13', plans, SERVICE_TODAY)).toBeNull();
    // An option that may run alongside another plan for nutrition does not clash.
    expect(overlappingPlan(recipes, SERVICE_TODAY, plans, SERVICE_TODAY)).toBeNull();
    // A cancelled plan never clashes.
    expect(overlappingPlan(fourWeeks, '2026-06-10', [cancelledPlan()], '2026-06-05')).toBeNull();
  });
});

describe('recording a payment', () => {
  it('asks for an amount up to what is left, in cents at most, received by today', () => {
    expect(paymentErrors({ amount: null, receivedOn: '' }, 180, SERVICE_TODAY)).toEqual({
      amount: ['Enter the amount received.'],
      receivedOn: ['Choose the day it was received.'],
    });
    expect(paymentErrors({ amount: 0, receivedOn: SERVICE_TODAY }, 180, SERVICE_TODAY)).toEqual({
      amount: ['Enter the amount received.'],
    });
    expect(paymentErrors({ amount: 200, receivedOn: SERVICE_TODAY }, 180, SERVICE_TODAY)).toEqual({
      amount: ['That is more than is left to pay.'],
    });
    expect(
      paymentErrors({ amount: 10.005, receivedOn: SERVICE_TODAY }, 180, SERVICE_TODAY),
    ).toEqual({
      amount: ['Use at most two decimals.'],
    });
    expect(paymentErrors({ amount: 0.29, receivedOn: '2026-10-02' }, 180, SERVICE_TODAY)).toEqual({
      receivedOn: ['A payment can’t be received in the future.'],
    });
    expect(paymentErrors({ amount: 180, receivedOn: '2026-09-30' }, 180, SERVICE_TODAY)).toEqual(
      {},
    );
  });

  it('records now for today, and midday for an earlier day so the day itself is kept', () => {
    const now = new Date('2026-10-01T12:34:56Z');

    expect(receivedAtUtc(SERVICE_TODAY, SERVICE_TODAY, now)).toBe('2026-10-01T12:34:56.000Z');
    const earlier = new Date(receivedAtUtc('2026-09-28', SERVICE_TODAY, now));
    expect([
      earlier.getFullYear(),
      earlier.getMonth(),
      earlier.getDate(),
      earlier.getHours(),
    ]).toEqual([2026, 8, 28, 12]);
  });

  it('says what the payment does: what is left, or when access opens', () => {
    const plan = { balance: 180, currency: 'USD', startDate: '2026-10-13' };

    expect(paymentOutcome(100, plan, 'Maya', SERVICE_TODAY, 'en-US')).toBe(
      'USD 80 will still be left. Maya gets access once the full price is paid.',
    );
    expect(paymentOutcome(180, plan, 'Maya', SERVICE_TODAY, 'en-US')).toBe(
      'This pays the plan in full. Maya gets access from Tue 13 Oct.',
    );
    expect(
      paymentOutcome(180, { ...plan, startDate: '2026-09-01' }, 'Maya', SERVICE_TODAY, 'en-US'),
    ).toBe('This pays the plan in full, so Maya gets access right away.');
    expect(paymentOutcome(500, plan, 'Maya', SERVICE_TODAY, 'en-US')).toBe('');
  });

  it('keeps the balance of the fixture renewal in step with its payments', () => {
    const renewal = unpaidRenewal();
    expect(renewal.priceAmount - renewal.paidAmount).toBe(renewal.balanceAmount);
  });
});

describe('the reason kept on record', () => {
  it('is required and short', () => {
    expect(reasonErrors('  ')).toEqual(['Say why. It is kept on the record.']);
    expect(reasonErrors('x'.repeat(501))).toEqual(['Keep it under 500 characters.']);
    expect(reasonErrors('Travelling for work')).toEqual([]);
  });
});

describe('the server’s refusals, in coach words', () => {
  const refusal = (status: number, body: Record<string, unknown>) =>
    new HttpErrorResponse({ status, error: body });
  const say = (body: Record<string, unknown>, status = 400) =>
    serviceWriteError(refusal(status, body), 'Fallback.', 'Maya');

  it('rewrites the codes and sentences the server is known to send', () => {
    expect(say({ code: 'entitlement_overlap', message: 'overlapping coverage' }, 409)).toBe(
      'Maya already has a plan that includes the same things on some of those dates. Start after it ends, or cancel it first.',
    );
    expect(say({ code: 'concurrency_conflict' }, 409)).toBe(
      'This was changed somewhere else since you opened it. The page has been reloaded: check it, then try again.',
    );
    expect(say({ code: 'idempotency_key_reused' }, 409)).toBe(
      'That clashes with an earlier request. Reload the page to see what was saved.',
    );
    expect(say({ code: 'workspace_read_only' }, 403)).toContain('read-only');
    expect(
      say({
        errors: { amount: ['The payment cannot exceed the outstanding enrollment balance.'] },
      }),
    ).toBe('That is more than is left to pay.');
    expect(
      say({
        errors: {
          currencyCode: [
            'Phase 2 payments must use the enrollment price currency; cross-currency settlement requires an explicit FX record.',
          ],
        },
      }),
    ).toBe('A payment has to be in the plan’s own currency.');
    expect(
      say({ errors: { enrollment: ['An expired enrollment cannot receive a payment.'] } }),
    ).toBe('This plan has ended, so it can’t take a payment.');
    expect(
      say({
        errors: { enrollment: ['Only a pending-payment enrollment can receive a manual payment.'] },
      }),
    ).toBe('This plan is already paid.');
    expect(
      say({
        errors: {
          startDate: [
            'The assigned service period must end after today in the workspace time zone.',
          ],
        },
      }),
    ).toBe('That plan would already be over. Choose a later first day.');
    expect(
      say({
        errors: { offerId: ['A renewal offer must belong to the original coaching product.'] },
      }),
    ).toBe('A renewal uses one of the same plan’s price options.');
    expect(say({ errors: { status: ['Only an active enrollment can be paused.'] } })).toBe(
      'Only a running, paid plan can be paused.',
    );
  });

  it('never shows a sentence about the engine', () => {
    expect(say({ message: 'The enrollment entitlement exploded.' })).toBe('Fallback.');
    expect(say({ message: 'Something plain went wrong.' })).toBe('Something plain went wrong.');
    expect(serviceWriteError(new Error('offline'), 'Fallback.', 'Maya')).toBe('Fallback.');
  });

  it('keeps the authorized server explanation of the plan and dates that clash', () => {
    const message =
      'Maya already has Online Coaching from Tue 21 Jul 2026 to Mon 12 Oct 2026. Start after it ends.';
    expect(say({ code: 'entitlement_overlap', message }, 409)).toBe(message);
  });
});
