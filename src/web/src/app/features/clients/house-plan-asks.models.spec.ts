import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import {
  bookedAsk,
  closedAsk,
  enrollment,
  freePlan,
  housePlanAsk,
  SERVICE_TODAY,
} from '../../../testing/client-service-fixtures';
import {
  amountInput,
  askedPlan,
  askEnded,
  askPill,
  askRow,
  askRows,
  bookingErrors,
  bookingIntro,
  bookingLine,
  bookingRefusal,
  closingRefusal,
  isHouseTrainee,
  isOpenAsk,
  toHousePlanAsk,
} from './house-plan-asks.models';

const CONTEXT = { locale: 'en-US', today: SERVICE_TODAY };

const refusal = (status: number, error: unknown) => new HttpErrorResponse({ status, error });

describe('a house trainee’s asks for a plan (SUB-020)', () => {
  it('reads the server’s figures as numbers, whatever form they arrive in', () => {
    const ask = toHousePlanAsk(housePlanAsk({ priceAmount: '47.50', durationCount: '4' }));

    expect(ask.priceAmount).toBe(47.5);
    expect(ask.durationCount).toBe(4);
    expect(ask.moneySent).toEqual({
      whishName: 'Maya Fakhoury',
      whishNumber: '+961 70 123 456',
      sentOn: '2026-09-30',
    });
    expect(ask.outcome).toBeNull();
  });

  it('knows a house trainee by the house’s Free alone', () => {
    expect(isHouseTrainee([enrollment(), freePlan()])).toBe(true);
    expect(isHouseTrainee([enrollment()])).toBe(false);
    expect(isHouseTrainee([enrollment({ houseTier: 'ProPlus' })])).toBe(false);
    expect(isHouseTrainee([])).toBe(false);
    expect(isHouseTrainee(null)).toBe(false);
  });

  it('keeps an ask open while it is asked or said sent, and ends it when booked or closed', () => {
    expect(
      (['Asked', 'MoneySent', 'Booked', 'Closed'] as const).map((state) => [
        isOpenAsk({ state }),
        askPill(state),
      ]),
    ).toEqual([
      [true, { label: 'Waiting for the money', tone: 'warm' }],
      [true, { label: 'Says it’s sent', tone: 'info' }],
      [false, { label: 'Booked', tone: 'success' }],
      [false, { label: 'Closed', tone: 'neutral' }],
    ]);
  });

  it('names the plan and the option asked for, its price and the day it was asked', () => {
    const row = askRow(toHousePlanAsk(housePlanAsk({ state: 'Asked', moneySent: null })), CONTEXT);

    expect(row).toEqual({
      id: 'ask-1',
      name: 'Pro+ Programs, 4 weeks',
      meta: 'USD 47.50 · asked Tue 29 Sep',
      pill: { label: 'Waiting for the money', tone: 'warm' },
      sent: null,
      decided: null,
      reason: null,
      open: true,
      // The visible words first, so a coach who says "Book plan" reaches the button (WCAG 2.5.3).
      bookLabel: 'Book plan, Pro+ Programs, 4 weeks',
      closeLabel: 'Close ask, Pro+ Programs, 4 weeks',
    });
  });

  it('carries the Whish details the trainee said the money came from, or the day alone once erased', () => {
    expect(askRow(toHousePlanAsk(housePlanAsk()), CONTEXT).sent).toEqual({
      name: 'Maya Fakhoury',
      number: '+961 70 123 456',
      day: 'Wed 30 Sep',
    });
    expect(
      askRow(
        toHousePlanAsk(
          housePlanAsk({ moneySent: { whishName: null, whishNumber: null, sentOn: '2026-09-30' } }),
        ),
        CONTEXT,
      ).sent,
    ).toEqual({ name: null, number: null, day: 'Wed 30 Sep' });
  });

  it('says who booked a plan, when, and the days it runs, with or without their name', () => {
    const booked = askRow(toHousePlanAsk(bookedAsk()), CONTEXT);
    expect([booked.name, booked.meta, booked.decided, booked.reason, booked.open]).toEqual([
      'Pro+ Programs, 8 weeks',
      'USD 89.75 · asked Sat 1 Aug',
      'Booked by Karim Haddad on Mon 3 Aug: runs Mon 3 Aug – Sun 27 Sep.',
      null,
      false,
    ]);

    const outcome = bookedAsk().outcome!;
    expect(
      askRow(toHousePlanAsk(bookedAsk({ outcome: { ...outcome, decidedByName: null } })), CONTEXT)
        .decided,
    ).toBe('Booked on Mon 3 Aug: runs Mon 3 Aug – Sun 27 Sep.');
    // A plan running into next year says its years.
    expect(
      askRow(
        toHousePlanAsk(
          bookedAsk({
            outcome: { ...outcome, planStartDate: '2026-12-14', planLastDay: '2027-01-10' },
          }),
        ),
        CONTEXT,
      ).decided,
    ).toBe('Booked by Karim Haddad on Mon 3 Aug: runs 14 Dec 2026 – 10 Jan 2027.');
  });

  it('says who closed an ask and when, with the reason on its own line', () => {
    const closed = askRow(toHousePlanAsk(closedAsk()), CONTEXT);
    expect([closed.pill.label, closed.decided, closed.reason, closed.open, closed.sent]).toEqual([
      'Closed',
      'Closed by Lea Khoury on Mon 27 Jul.',
      'No money came in a week. Ask again when you are ready.',
      false,
      null,
    ]);

    const outcome = closedAsk().outcome!;
    expect(
      askRow(toHousePlanAsk(closedAsk({ outcome: { ...outcome, decidedByName: null } })), CONTEXT)
        .decided,
    ).toBe('Closed on Mon 27 Jul.');
  });

  it('lists the newest ask first, and keeps the server’s order within a day', () => {
    const rows = askRows(
      [
        toHousePlanAsk(closedAsk()),
        toHousePlanAsk(housePlanAsk({ id: 'same-day-a' })),
        toHousePlanAsk(bookedAsk()),
        toHousePlanAsk(housePlanAsk({ id: 'same-day-b' })),
      ],
      CONTEXT,
    );

    expect(rows.map((row) => row.id)).toEqual(['same-day-a', 'same-day-b', 'ask-0', 'ask-closed']);
  });

  describe('booking', () => {
    const ask = toHousePlanAsk(housePlanAsk());

    it('says what is booked, for how long, and what to check first', () => {
      expect(askedPlan(ask)).toBe('Pro+ Programs, 4 weeks');
      // An option named by its length says it once.
      expect(bookingLine(ask, 'en-US')).toBe('Pro+ Programs, 4 weeks');
      expect(bookingLine({ ...ask, optionLabel: '4 Weeks' }, 'en-US')).toBe(
        'Pro+ Programs, 4 Weeks',
      );
      expect(bookingLine({ ...ask, durationCount: 30, durationUnit: 'Day' }, 'en-US')).toBe(
        'Pro+ Programs, 4 weeks · 30 days',
      );
      expect(bookingLine({ ...ask, optionLabel: 'Starter month' }, 'en-US')).toBe(
        'Pro+ Programs, Starter month · 4 weeks',
      );
      expect(bookingIntro(ask, 'Maya', 'en-US')).toBe(
        'Check the Whish account for USD 47.50 first. Booking starts Maya’s plan today, or the day after their current plan ends, and records the money as received by Whish today.',
      );
    });

    it('fills the amount with the price asked for, with its cents only when it has some', () => {
      expect(amountInput(47.5)).toBe('47.50');
      expect(amountInput(89.75)).toBe('89.75');
      expect(amountInput(45)).toBe('45');
      expect(amountInput(0.5)).toBe('0.50');
    });

    it('asks for an amount in money, and leaves the price rule to the server', () => {
      expect(bookingErrors({ amount: 47.5 })).toEqual({});
      // A part is the server's to refuse: it names the price to record.
      expect(bookingErrors({ amount: 20 })).toEqual({});
      expect(bookingErrors({ amount: null })).toEqual({ amount: ['Enter the amount received.'] });
      expect(bookingErrors({ amount: 0 })).toEqual({ amount: ['Enter the amount received.'] });
      expect(bookingErrors({ amount: 47.505 })).toEqual({ amount: ['Use at most two decimals.'] });
    });

    it('puts the server’s word on the amount or the reference under that field', () => {
      const amount =
        'Record the plan’s exact price, USD 47.50. A part books nothing: wait for the rest, or close the ask.';
      expect(bookingRefusal(refusal(400, { errors: { amount: [amount] } }), 'Maya')).toEqual({
        field: 'amount',
        message: amount,
      });
      expect(
        bookingRefusal(
          refusal(400, { errors: { Reference: ['Keep it to 200 characters.'] } }),
          'Maya',
        ),
      ).toEqual({ field: 'reference', message: 'Keep it to 200 characters.' });
    });

    it('says every other refusal in the summary, in words for the staff', () => {
      const said = (status: number, body: unknown) => bookingRefusal(refusal(status, body), 'Maya');

      expect(
        said(409, {
          code: 'house_plan_ask_ended',
          message:
            'This ask was already booked or closed. Reload the client to see where it stands.',
        }),
      ).toEqual({
        field: null,
        message: 'This ask was already booked or closed. Reload the client to see where it stands.',
      });
      expect(
        said(409, {
          code: 'entitlement_overlap',
          message:
            'Another plan already covers some of these days. Reload the client to check their plans.',
        }).message,
      ).toBe(
        'Another plan already covers some of these days. Reload the client to check their plans.',
      );
      expect(said(409, { code: 'idempotency_key_reused', message: 'x' }).message).toBe(
        'That clashes with an earlier request. Reload the page to see what was saved.',
      );
      expect(said(403, { code: 'workspace_read_only', message: 'x' }).message).toBe(
        'Your coaching space is read-only until its TB Gym bill is paid. You can still view everything.',
      );
      expect(
        said(409, {
          code: 'client_blocked',
          message: 'This trainee is blocked. Unblock them before booking a plan, or close the ask.',
        }).message,
      ).toBe('This trainee is blocked. Unblock them before booking a plan, or close the ask.');
      // A currency the server would not take, and a key it never got: the summary, never under a field.
      expect(
        said(400, {
          errors: { currencyCode: ['Record the money in the plan’s own currency, USD.'] },
        }),
      ).toEqual({ field: null, message: 'Record the money in the plan’s own currency, USD.' });
      expect(
        said(400, { errors: { idempotencyKey: ['An idempotency key is required.'] } }),
      ).toEqual({
        field: null,
        message: 'The plan could not be booked. Try again.',
      });
      expect(bookingRefusal(new Error('offline'), 'Maya')).toEqual({
        field: null,
        message: 'The plan could not be booked. Try again.',
      });
    });
  });

  it('knows an ask booked or closed meanwhile, so the page reads the asks again', () => {
    expect(askEnded(refusal(409, { code: 'house_plan_ask_ended', message: 'Ended.' }))).toBe(true);
    expect(askEnded(refusal(409, { code: 'entitlement_overlap', message: 'Overlap.' }))).toBe(
      false,
    );
    expect(askEnded(refusal(400, null))).toBe(false);
    expect(askEnded(new Error('offline'))).toBe(false);
  });

  it('puts the server’s word on a closing’s reason under it, and anything else in the summary', () => {
    expect(
      closingRefusal(
        refusal(400, { errors: { reason: ['Say why, in 500 characters at most.'] } }),
        'Maya',
      ),
    ).toEqual({ field: 'reason', message: 'Say why, in 500 characters at most.' });
    expect(
      closingRefusal(
        refusal(409, {
          code: 'house_plan_ask_ended',
          message:
            'This ask was already booked or closed. Reload the client to see where it stands.',
        }),
        'Maya',
      ),
    ).toEqual({
      field: null,
      message: 'This ask was already booked or closed. Reload the client to see where it stands.',
    });
    expect(closingRefusal(new Error('offline'), 'Maya')).toEqual({
      field: null,
      message: 'The ask could not be closed. Try again.',
    });
  });
});
