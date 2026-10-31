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
  chargeReason,
  overlappingPlan,
  paymentErrors,
  paymentOutcome,
  planPeriod,
  planRunText,
  planStartErrors,
  reasonErrors,
  serviceWriteError,
  sessionErrors,
  sessionRequest,
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

describe('recording a session', () => {
  const held = { kind: 'Held', day: SERVICE_TODAY, heldBy: null, note: '', reason: '' } as const;
  const noShow = { ...held, kind: 'NoShow', reason: 'No-show' } as const;

  it('asks for a day that has happened', () => {
    expect(sessionErrors(held, SERVICE_TODAY, 'Maya')).toEqual({});
    expect(sessionErrors({ ...held, day: '' }, SERVICE_TODAY, 'Maya')['day']).toEqual([
      'Choose the day of the session.',
    ]);
    expect(sessionErrors({ ...held, day: '2026-10-02' }, SERVICE_TODAY, 'Maya')['day']).toEqual([
      'A session counts once it has happened. Choose today or an earlier day.',
    ]);
  });

  it('asks a charge why, in words the client reads, and a note only to keep it short', () => {
    expect(sessionErrors(noShow, SERVICE_TODAY, 'Maya')).toEqual({});
    expect(sessionErrors({ ...noShow, reason: '  ' }, SERVICE_TODAY, 'Maya')['reason']).toEqual([
      'Say why it is charged. Maya reads it.',
    ]);
    const long = 'x'.repeat(501);
    expect(Object.keys(sessionErrors({ ...noShow, reason: long }, SERVICE_TODAY, 'Maya'))).toEqual([
      'reason',
    ]);
    expect(Object.keys(sessionErrors({ ...held, note: long }, SERVICE_TODAY, 'Maya'))).toEqual([
      'note',
    ]);
    // What the other kind would ask for does not count against this one.
    expect(sessionErrors({ ...held, reason: long }, SERVICE_TODAY, 'Maya')).toEqual({});
  });

  it('starts a charge from what happened', () => {
    expect(chargeReason('NoShow')).toBe('No-show');
    expect(chargeReason('LateCancel')).toBe('Late cancel');
    expect(chargeReason('Held')).toBe('');
  });

  it('sends what the kind takes, and the money only when the pack waits for it', () => {
    expect(sessionRequest({ ...held, note: ' Legs ', reason: 'x' }, null, 'Cash', 'key')).toEqual({
      outcome: 'Held',
      day: SERVICE_TODAY,
      note: 'Legs',
      reason: null,
      receipt: null,
      idempotencyKey: 'key',
      heldByUserId: null,
    });
    expect(sessionRequest({ ...noShow, note: 'x' }, null, 'Cash', 'key')).toEqual(
      expect.objectContaining({ outcome: 'Charged', note: null, reason: 'No-show' }),
    );
    const target = { line: '', receipt: { amount: 35, currency: 'USD' } };
    expect(sessionRequest(held, target, 'BankTransfer', 'key').receipt).toEqual({
      amount: 35,
      currencyCode: 'USD',
      method: 'BankTransfer',
    });
  });

  it('names who held a session held, and nobody on a charge', () => {
    expect(sessionRequest({ ...held, heldBy: 'lea' }, null, 'Cash', 'key').heldByUserId).toBe(
      'lea',
    );
    expect(sessionRequest({ ...noShow, heldBy: 'lea' }, null, 'Cash', 'key').heldByUserId).toBe(
      null,
    );
  });

  it('keeps the server’s own words, even when a pack’s name holds a system word', () => {
    const refused = (code: string, message: string) =>
      serviceWriteError(
        new HttpErrorResponse({ status: 409, error: { code, message } }),
        'Try again.',
        'Maya',
      );
    expect(refused('no_sessions_left', 'Maya has no sessions left on Summer offer.')).toBe(
      'Maya has no sessions left on Summer offer.',
    );
    expect(refused('session_pack_paused', 'Summer offer is paused.')).toBe(
      'Summer offer is paused.',
    );
    expect(refused('session_conflict', 'The enrollment clashed.')).toBe('Try again.');
  });
});
