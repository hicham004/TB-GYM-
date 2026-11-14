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
import { maxAsk } from '../../../testing/max-staff-fixtures';
import {
  amountInput,
  askedPlan,
  askEnded,
  askPill,
  askRow,
  askRows,
  asksOutOfDate,
  bookingErrors,
  bookingIntro,
  bookingLine,
  bookingNoPlace,
  bookingRefusal,
  closingRefusal,
  isHouseTrainee,
  isOpenAsk,
  placeLine,
  toHousePlanAsk,
} from './house-plan-asks.models';

const CONTEXT = { locale: 'en-US', today: SERVICE_TODAY, firstName: 'Maya' };

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
    // A Pro+ ask, and an older answer, carry no place of Max's.
    expect([ask.placeOpen, ask.placeInLine]).toEqual([null, null]);
  });

  it('reads a Max ask’s place and turn, the turn as a number whatever form it arrives in (N9c5a)', () => {
    expect(
      [
        maxAsk(),
        maxAsk({ placeInLine: '3' }),
        maxAsk({ placeOpen: true, placeInLine: null }),
        maxAsk({ placeOpen: null, placeInLine: undefined }),
        maxAsk({ placeInLine: 'soon' }),
        maxAsk({ placeInLine: 0 }),
      ].map((view) => {
        const ask = toHousePlanAsk(view);
        return [ask.tier, ask.placeOpen, ask.placeInLine];
      }),
    ).toEqual([
      ['Max', false, 2],
      ['Max', false, 3],
      ['Max', true, null],
      ['Max', null, null],
      ['Max', false, null],
      ['Max', false, null],
    ]);
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
        askPill({ state, tier: 'ProPlus', placeOpen: null }),
      ]),
    ).toEqual([
      [true, { label: 'Waiting for the money', tone: 'warm' }],
      [true, { label: 'Says it’s sent', tone: 'info' }],
      [false, { label: 'Booked', tone: 'success' }],
      [false, { label: 'Closed', tone: 'neutral' }],
    ]);
  });

  it('says a Max ask waits for a place while none is open for it, and for the money once one is', () => {
    const pill = (view: ReturnType<typeof maxAsk>) => askPill(toHousePlanAsk(view));

    expect(pill(maxAsk())).toEqual({ label: 'Waiting for a place', tone: 'info' });
    expect(pill(maxAsk({ placeOpen: true, placeInLine: 1 }))).toEqual({
      label: 'Waiting for the money',
      tone: 'warm',
    });
    // Said sent, booked or closed: the pill says so whatever Max's places.
    expect(pill(maxAsk({ state: 'MoneySent', placeInLine: null }))).toEqual({
      label: 'Says it’s sent',
      tone: 'info',
    });
    expect(pill(maxAsk({ state: 'Closed', placeOpen: null, placeInLine: null })).label).toBe(
      'Closed',
    );
    // An older answer without Max's places reads as before.
    expect(pill(maxAsk({ placeOpen: undefined, placeInLine: undefined })).label).toBe(
      'Waiting for the money',
    );
  });

  describe('a Max ask’s place (N9c5a)', () => {
    const line = (view: ReturnType<typeof maxAsk>, former = false) =>
      placeLine(toHousePlanAsk(view), { ...CONTEXT, former });

    it('says where a current trainee’s open Max ask stands in line, and whether they can pay', () => {
      expect(line(maxAsk({ placeOpen: true, placeInLine: 1 }))).toBe(
        'Number 1 in line for Max. A place is open, so Maya can pay.',
      );
      expect(line(maxAsk())).toBe(
        'Number 2 in line for Max. No place is open for this ask yet, so Maya’s page says not to send money.',
      );
      expect(line(maxAsk({ placeInLine: 1200 }))).toBe(
        'Number 1,200 in line for Max. No place is open for this ask yet, so Maya’s page says not to send money.',
      );
    });

    it('says a trainee holds a place, or that Max is closed, once they are out of the line', () => {
      expect(line(maxAsk({ state: 'MoneySent', placeOpen: true, placeInLine: null }))).toBe(
        'Maya holds a Max place.',
      );
      expect(line(maxAsk({ placeOpen: false, placeInLine: null }))).toBe(
        'Max is closed: TB Gym’s settings give it no places.',
      );
    });

    it('says nothing for a Pro+ ask, an ended ask, a former trainee or an older answer', () => {
      expect(line(housePlanAsk({ placeOpen: false, placeInLine: 2 }))).toBeNull();
      expect(line(maxAsk({ state: 'Booked' }))).toBeNull();
      expect(line(maxAsk({ state: 'Closed' }))).toBeNull();
      // A released trainee leaves the line, so their open ask would read as Max closed.
      expect(line(maxAsk({ placeOpen: false, placeInLine: null }), true)).toBeNull();
      expect(line(maxAsk({ placeOpen: true, placeInLine: 1 }), true)).toBeNull();
      expect(line(maxAsk({ placeOpen: undefined, placeInLine: undefined }))).toBeNull();
    });

    it('puts the line on the ask’s row, and none on a former trainee’s', () => {
      const ask = toHousePlanAsk(maxAsk());
      const row = askRow(ask, CONTEXT);
      expect([row.name, row.meta, row.pill.label, row.place, row.open]).toEqual([
        'Max coaching, 4 weeks',
        'USD 120 · asked Tue 29 Sep',
        'Waiting for a place',
        'Number 2 in line for Max. No place is open for this ask yet, so Maya’s page says not to send money.',
        true,
      ]);
      // Book plan stays: the server books by the places free, not by the turn.
      expect(row.bookLabel).toBe('Book plan, Max coaching, 4 weeks');
      expect(askRows([ask], { ...CONTEXT, former: true })[0].place).toBeNull();
    });
  });

  it('names the plan and the option asked for, its price and the day it was asked', () => {
    const row = askRow(toHousePlanAsk(housePlanAsk({ state: 'Asked', moneySent: null })), CONTEXT);

    expect(row).toEqual({
      id: 'ask-1',
      name: 'Pro+ Programs, 4 weeks',
      meta: 'USD 47.50 · asked Tue 29 Sep',
      pill: { label: 'Waiting for the money', tone: 'warm' },
      place: null,
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

    it('warns before booking a Max ask whose trainee was told not to pay yet (N9c5a)', () => {
      expect(bookingNoPlace(toHousePlanAsk(maxAsk()), 'Maya')).toBe(
        'Maya’s ask has no Max place yet, so they were told not to send money. Book it only if the money is there.',
      );
      expect(
        bookingNoPlace(toHousePlanAsk(maxAsk({ placeOpen: true, placeInLine: 1 })), 'Maya'),
      ).toBeNull();
      // Said sent: the money is there to look for, whatever Max's places.
      expect(
        bookingNoPlace(
          toHousePlanAsk(maxAsk({ state: 'MoneySent', placeOpen: false, placeInLine: null })),
          'Maya',
        ),
      ).toBeNull();
      expect(bookingNoPlace(ask, 'Maya')).toBeNull();
    });

    it('says Max’s refusals in the server’s words, in the summary', () => {
      const full = 'Every place on Max is taken. Book this ask once a place opens, or close it.';
      const closed =
        "Max is closed: TB Gym's settings give it no places. Book this ask once Max opens again, or close it.";
      expect(
        bookingRefusal(refusal(409, { code: 'house_max_full', message: full }), 'Maya'),
      ).toEqual({ field: null, message: full });
      expect(
        bookingRefusal(refusal(409, { code: 'house_max_closed', message: closed }), 'Maya'),
      ).toEqual({ field: null, message: closed });
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

  it('knows a booking refused for Max’s places leaves the asks out of date too (N9c5a)', () => {
    const stale = (code: string) => asksOutOfDate(refusal(409, { code, message: 'x' }));

    expect(['house_plan_ask_ended', 'house_max_full', 'house_max_closed'].map(stale)).toEqual([
      true,
      true,
      true,
    ]);
    expect(['entitlement_overlap', 'client_blocked', 'house_max_by_ask'].map(stale)).toEqual([
      false,
      false,
      false,
    ]);
    expect(asksOutOfDate(refusal(400, null))).toBe(false);
    expect(asksOutOfDate(new Error('offline'))).toBe(false);
    // Closing keeps to its own: Max never refuses it.
    expect(askEnded(refusal(409, { code: 'house_max_full', message: 'x' }))).toBe(false);
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
