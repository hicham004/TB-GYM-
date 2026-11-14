import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import type {
  HousePlanAskView,
  HousePlanOfferView,
  HousePlansView,
} from '../../core/api/generated';
import {
  askPill,
  collapseSpaces,
  earlierAsk,
  earlierAsksOf,
  houseDay,
  houseRefusal,
  openAskCard,
  openAskOf,
  planGroups,
  toHouseAsk,
  toHousePlans,
  whishNameProblems,
  whishNumberProblems,
  whishNumberValue,
  type HouseAsk,
} from './house-plans.models';

const TODAY = '2026-10-15';
const LOCALE = 'en-GB';

function offerView(overrides: Partial<HousePlanOfferView> = {}): HousePlanOfferView {
  return {
    offerId: 'offer-4w',
    productId: 'pro-plus',
    tier: 'ProPlus',
    name: 'Pro+',
    description: '  Your own program, written by TB Gym.  ',
    optionLabel: '4 weeks',
    priceAmount: '47.5',
    priceCurrency: 'USD',
    durationCount: '4',
    durationUnit: 'Week',
    features: ['Training', 'CheckIns'],
    ...overrides,
  };
}

function askView(overrides: Partial<HousePlanAskView> = {}): HousePlanAskView {
  return {
    id: 'ask-1',
    offerId: 'offer-4w',
    tier: 'ProPlus',
    planName: 'Pro+',
    optionLabel: '4 weeks',
    priceAmount: '47.5',
    priceCurrency: 'USD',
    durationCount: 4,
    durationUnit: 'Week',
    askedOn: '2026-10-15',
    state: 'Asked',
    moneySent: null,
    outcome: null,
    ...overrides,
  };
}

const ask = (overrides: Partial<HousePlanAskView> = {}): HouseAsk => toHouseAsk(askView(overrides));

/** A month of Max, as the house sells it: the four features TB Gym coaches (N9c5a). */
const maxOfferView = (overrides: Partial<HousePlanOfferView> = {}): HousePlanOfferView =>
  offerView({
    offerId: 'max-1m',
    productId: 'max',
    tier: 'Max',
    name: 'Max',
    description: null,
    optionLabel: 'A month',
    priceAmount: '120',
    durationCount: 4,
    durationUnit: 'Week',
    features: ['Training', 'Nutrition', 'CheckIns', 'Messaging'],
    ...overrides,
  });

const maxAsk = (overrides: Partial<HousePlanAskView> = {}): HouseAsk =>
  ask({
    offerId: 'max-1m',
    tier: 'Max',
    planName: 'Max',
    optionLabel: 'A month',
    priceAmount: '120',
    durationCount: 4,
    durationUnit: 'Week',
    ...overrides,
  });

const MAX_FULL =
  'Every place on Max is taken right now. You can still ask: your ask waits in line, and you send money only once a place opens for you.';
const MAX_NOT_OPEN =
  'A Max place isn’t open for you yet. Your ask is kept in line; don’t send money until a place opens.';

const offers = (...views: HousePlanOfferView[]) =>
  toHousePlans({ today: TODAY, asksOpen: true, whishNumber: null, plans: views, asks: [] }).plans;

describe('toHousePlans', () => {
  it('reads the server’s numbers as numbers and leaves no blank words', () => {
    const view: HousePlansView = {
      today: TODAY,
      asksOpen: true,
      whishNumber: ' +961 70 123456 ',
      plans: [offerView({ description: '   ' })],
      asks: [askView({ outcome: null })],
    };

    const house = toHousePlans(view);

    expect(house.whishNumber).toBe('+961 70 123456');
    expect(house.plans[0]).toMatchObject({
      tier: 'ProPlus',
      priceAmount: 47.5,
      durationCount: 4,
      description: null,
    });
    expect(house.asks[0]).toMatchObject({ priceAmount: 47.5, durationCount: 4, state: 'Asked' });
  });

  it('reads whether Max has a place for the trainee, on its options and its open asks alone (N9c5a)', () => {
    const house = toHousePlans({
      today: TODAY,
      asksOpen: true,
      whishNumber: null,
      plans: [
        offerView(),
        offerView({ offerId: 'offer-pro', placeOpen: null }),
        maxOfferView({ placeOpen: false }),
        maxOfferView({ offerId: 'max-3m', placeOpen: true }),
      ],
      asks: [
        askView(),
        askView({ id: 'pro-null', placeOpen: null }),
        askView({ id: 'max-waits', tier: 'Max', placeOpen: false, placeInLine: 3 }),
        askView({ id: 'max-open', tier: 'Max', placeOpen: true }),
      ],
    });

    // Pro+ never says, whether the field is left out or null.
    expect(house.plans.map((offer) => [offer.tier, offer.placeOpen])).toEqual([
      ['ProPlus', null],
      ['ProPlus', null],
      ['Max', false],
      ['Max', true],
    ]);
    expect(house.asks.map((ask) => [ask.tier, ask.placeOpen])).toEqual([
      ['ProPlus', null],
      ['ProPlus', null],
      ['Max', false],
      ['Max', true],
    ]);
    // The trainee never reads their turn in line, even if a read carried it.
    expect(Object.keys(house.asks[2])).not.toContain('placeInLine');
  });

  it('keeps no Whish number when the house has none', () => {
    expect(
      toHousePlans({ today: TODAY, asksOpen: false, whishNumber: null, plans: [], asks: [] })
        .whishNumber,
    ).toBeNull();
  });
});

describe('planGroups', () => {
  it('groups the options by plan in the server’s order, each with its length and price', () => {
    const groups = planGroups(
      offers(
        offerView(),
        offerView({
          offerId: 'offer-8w',
          optionLabel: 'Two blocks',
          priceAmount: 89.75,
          durationCount: 8,
        }),
        offerView({
          offerId: 'offer-max',
          productId: 'strength',
          name: 'Strength block',
          description: null,
          optionLabel: '30 days',
          priceAmount: 60,
          durationCount: 30,
          durationUnit: 'Day',
        }),
      ),
      LOCALE,
    );

    expect(groups.map((group) => group.name)).toEqual(['Pro+', 'Strength block']);
    expect(groups[0].description).toBe('Your own program, written by TB Gym.');
    expect(groups[0].includes?.map((chip) => chip.label)).toEqual(['Training', 'Check-ins']);
    expect(groups[0].options).toEqual([
      {
        offerId: 'offer-4w',
        label: '4 weeks',
        length: null,
        price: 'USD 47.50',
        askName: 'Ask for 4 weeks, Pro+',
        includes: null,
      },
      {
        offerId: 'offer-8w',
        label: 'Two blocks',
        length: '8 weeks',
        price: 'USD 89.75',
        askName: 'Ask for Two blocks, Pro+',
        includes: null,
      },
    ]);
    expect(groups[1].options[0]).toMatchObject({ length: null, price: 'USD 60' });
    expect(groups[1].description).toBeNull();
  });

  it('says the length once when the option’s name is the length, whatever its case', () => {
    const [group] = planGroups(offers(offerView({ optionLabel: ' 4 Weeks ' })), LOCALE);

    expect(group.options[0].length).toBeNull();
  });

  it('says what each option includes when the plan’s options differ', () => {
    const [group] = planGroups(
      offers(
        offerView(),
        offerView({ offerId: 'offer-8w', durationCount: 8, features: ['Training'] }),
      ),
      LOCALE,
    );

    expect(group.includes).toBeNull();
    expect(group.options.map((option) => option.includes?.map((chip) => chip.label))).toEqual([
      ['Training', 'Check-ins'],
      ['Training'],
    ]);
  });

  it('has nothing to group when nothing is on sale', () => {
    expect(planGroups([], LOCALE)).toEqual([]);
  });

  it('says once, on the plan, that every place on Max is taken, and asking stays open (N9c5a)', () => {
    const groups = planGroups(
      offers(
        maxOfferView({ placeOpen: false }),
        maxOfferView({
          offerId: 'max-3m',
          optionLabel: '3 months',
          durationCount: 12,
          placeOpen: false,
        }),
        offerView(),
      ),
      LOCALE,
    );

    expect(groups.map((group) => [group.name, group.placeLine])).toEqual([
      ['Max', MAX_FULL],
      ['Pro+', null],
    ]);
    expect(groups[0].includes?.map((chip) => chip.label)).toEqual([
      'Training',
      'Nutrition',
      'Check-ins',
      'Messaging',
    ]);
    // Every option keeps its Ask for, named as before.
    expect(groups[0].options.map((option) => option.askName)).toEqual([
      'Ask for A month, Max',
      'Ask for 3 months, Max',
    ]);
    expect(groups[0].options[0]).not.toHaveProperty('placeLine');
  });

  it('says nothing of places while one is open, or for an answer that does not say', () => {
    for (const placeOpen of [true, null, undefined]) {
      const view = maxOfferView({ placeOpen });
      if (placeOpen === undefined) delete view.placeOpen;
      const [group] = planGroups(offers(view), LOCALE);

      expect(group.placeLine, String(placeOpen)).toBeNull();
    }
  });
});

describe('the asks', () => {
  it('names each state in its pill', () => {
    expect(askPill('Asked')).toEqual({ label: 'Waiting for your payment', tone: 'warm' });
    expect(askPill('MoneySent')).toEqual({ label: 'Money sent', tone: 'info' });
    expect(askPill('Booked')).toEqual({ label: 'Booked', tone: 'success' });
    expect(askPill('Closed')).toEqual({ label: 'Closed', tone: 'neutral' });
  });

  it('says an asked Max ask with no place open waits for a place, never for the payment (N9c5a)', () => {
    expect(askPill('Asked', false)).toEqual({ label: 'Waiting for a place', tone: 'info' });
    expect(askPill('Asked', true)).toEqual({ label: 'Waiting for your payment', tone: 'warm' });
    expect(askPill('Asked', null)).toEqual({ label: 'Waiting for your payment', tone: 'warm' });
    expect(askPill('MoneySent', false)).toEqual({ label: 'Money sent', tone: 'info' });
  });

  it('finds the one ask still waiting on TB Gym, and the ones it booked or closed', () => {
    const asks = [
      ask({ id: 'sent', state: 'MoneySent' }),
      ask({ id: 'booked', state: 'Booked' }),
      ask({ id: 'closed', state: 'Closed' }),
    ];

    expect(openAskOf(asks)?.id).toBe('sent');
    expect(earlierAsksOf(asks).map((item) => item.id)).toEqual(['booked', 'closed']);
    expect(openAskOf(earlierAsksOf(asks))).toBeNull();
  });

  it('words the open ask’s card with its price for its length', () => {
    expect(
      openAskCard(
        ask({ optionLabel: 'Two blocks', priceAmount: 89.75, durationCount: 8 }),
        TODAY,
        LOCALE,
      ),
    ).toEqual({
      id: 'ask-1',
      state: 'Asked',
      planName: 'Pro+',
      optionLabel: 'Two blocks',
      price: 'USD 89.75',
      cost: 'USD 89.75 for 8 weeks',
      pill: { label: 'Waiting for your payment', tone: 'warm' },
      sent: null,
      waitingForPlace: false,
      placeLine: null,
      placeOpenLine: null,
    });
  });

  it('words an asked Max ask with no place open as waiting in line, with nothing to pay yet (N9c5a)', () => {
    expect(openAskCard(maxAsk({ placeOpen: false }), TODAY, LOCALE)).toEqual({
      id: 'ask-1',
      state: 'Asked',
      planName: 'Max',
      optionLabel: 'A month',
      price: 'USD 120',
      cost: 'USD 120 for 4 weeks',
      pill: { label: 'Waiting for a place', tone: 'info' },
      sent: null,
      waitingForPlace: true,
      placeLine: MAX_NOT_OPEN,
      placeOpenLine: null,
    });
  });

  it('words an asked Max ask whose place is open as Pro+’s, saying the place is open', () => {
    const card = openAskCard(maxAsk({ placeOpen: true }), TODAY, LOCALE);

    expect(card.pill).toEqual({ label: 'Waiting for your payment', tone: 'warm' });
    expect(card.waitingForPlace).toBe(false);
    expect(card.placeLine).toBeNull();
    expect(card.placeOpenLine).toBe('A place on Max is open for you now.');
  });

  it('words a Max ask said paid as any ask said paid, whatever its place reads', () => {
    for (const placeOpen of [true, false]) {
      const card = openAskCard(
        maxAsk({
          state: 'MoneySent',
          placeOpen,
          moneySent: { whishName: 'Rima Aboud', whishNumber: '+961 71 234567', sentOn: TODAY },
        }),
        TODAY,
        LOCALE,
      );

      expect(card.pill).toEqual({ label: 'Money sent', tone: 'info' });
      expect(card.waitingForPlace).toBe(false);
      expect(card.placeLine).toBeNull();
      expect(card.placeOpenLine).toBeNull();
      expect(card.sent?.name).toBe('Rima Aboud');
    }
  });

  it('says the length once when the option’s name is the length, as the options on sale do', () => {
    expect(openAskCard(ask(), TODAY, LOCALE).cost).toBe('USD 47.50');
    expect(openAskCard(ask({ optionLabel: ' 4 Weeks ' }), TODAY, LOCALE).cost).toBe('USD 47.50');
    expect(
      openAskCard(
        ask({ optionLabel: '30 days', durationCount: 4, durationUnit: 'Week' }),
        TODAY,
        LOCALE,
      ).cost,
    ).toBe('USD 47.50 for 4 weeks');
  });

  it('says when and from which Whish account the trainee said they sent it', () => {
    const card = openAskCard(
      ask({
        state: 'MoneySent',
        moneySent: { whishName: 'Rima Aboud', whishNumber: '+961 71 234567', sentOn: '2026-10-16' },
      }),
      TODAY,
      LOCALE,
    );

    expect(card.state).toBe('MoneySent');
    expect(card.pill.label).toBe('Money sent');
    expect(card.sent).toEqual({ on: 'Fri 16 Oct', name: 'Rima Aboud', number: '+961 71 234567' });
  });

  it('says a booked ask’s day and the dates its plan runs', () => {
    const item = earlierAsk(
      ask({
        state: 'Booked',
        outcome: {
          kind: 'Booked',
          decidedOn: '2026-10-16',
          reason: null,
          enrollmentId: 'plan-1',
          planStartDate: '2026-10-16',
          planLastDay: '2026-11-12',
          decidedByName: null,
        },
      }),
      TODAY,
      LOCALE,
    );

    expect(item).toEqual({
      id: 'ask-1',
      planName: 'Pro+',
      optionLabel: '4 weeks',
      pill: { label: 'Booked', tone: 'success' },
      asked: 'USD 47.50 · asked Thu 15 Oct',
      outcome: 'Booked Fri 16 Oct: runs Fri 16 Oct – Thu 12 Nov.',
      reason: null,
    });
  });

  it('says a closed ask’s day and TB Gym’s reason, never who closed it', () => {
    const item = earlierAsk(
      ask({
        state: 'Closed',
        askedOn: '2025-12-30',
        outcome: {
          kind: 'Closed',
          decidedOn: '2026-01-05',
          reason: '  No money arrived from that account.  ',
          enrollmentId: null,
          planStartDate: null,
          planLastDay: null,
          decidedByName: 'Nadim',
        },
      }),
      TODAY,
      LOCALE,
    );

    expect(item.pill).toEqual({ label: 'Closed', tone: 'neutral' });
    expect(item.asked).toBe('USD 47.50 · asked 30 Dec 2025');
    expect(item.outcome).toBe('TB Gym closed this ask on Mon 5 Jan.');
    expect(item.reason).toBe('No money arrived from that account.');
    expect(JSON.stringify(item)).not.toContain('Nadim');
  });

  it('writes a day of another year with its year', () => {
    expect(houseDay('2026-10-15', TODAY, LOCALE)).toBe('Thu 15 Oct');
    expect(houseDay('2025-10-15', TODAY, LOCALE)).toBe('15 Oct 2025');
  });
});

describe('the Whish details', () => {
  it('asks for the name on the account, up to 100 characters', () => {
    const needed = ['Enter the name on the Whish account you sent the money from.'];
    expect(whishNameProblems('Rima Aboud')).toEqual([]);
    expect(whishNameProblems('   ')).toEqual(needed);
    expect(whishNameProblems('x'.repeat(101))).toEqual(needed);
    expect(collapseSpaces('  Rima    Aboud ')).toBe('Rima Aboud');
  });

  it('keeps a number in the server’s form, with an optional + and single spaces', () => {
    expect(whishNumberValue('  +961   70 123456 ')).toBe('+961 70 123456');
    expect(whishNumberValue('+ 961 71 234')).toBe('+961 71 234');
    expect(whishNumberValue('70123456')).toBe('70123456');
    expect(whishNumberValue('123456')).toBe('123456');
    expect(whishNumberValue('1'.repeat(20))).toBe('1'.repeat(20));
  });

  it('refuses what the server refuses', () => {
    for (const typed of [
      '',
      '12345',
      '1'.repeat(21),
      '70-123-456',
      '+',
      '961+70123456',
      '++96170123456',
      // Twenty digits, but 41 characters with the space after the +, as the server counts them.
      `+ ${'1 '.repeat(20)}`,
    ]) {
      expect(whishNumberValue(typed), typed).toBeNull();
    }
    expect(whishNumberProblems('70-123-456')).toEqual([
      'Enter the Whish number you sent the money from: 6 to 20 digits, with a + in front if you like.',
    ]);
    expect(whishNumberProblems('+961 70 123456')).toEqual([]);
  });
});

describe('houseRefusal', () => {
  const conflict = (code: string, message: string) =>
    new HttpErrorResponse({ status: 409, error: { code, message } });

  it('says a conflict in the server’s words and marks the page out of date', () => {
    for (const code of [
      'house_plan_asks_closed',
      'house_plan_not_on_sale',
      'house_plan_ask_open',
      'client_blocked',
      'house_plan_money_already_sent',
      'house_plan_ask_ended',
      // Max's places (N9c5a): no place open yet for "I've paid", Max closed, and any other of its codes.
      'house_max_place_not_open',
      'house_max_closed',
      'house_max_full',
      'house_max_by_ask',
    ]) {
      expect(houseRefusal(conflict(code, `The server says ${code}.`), 'Try again.')).toEqual({
        message: `The server says ${code}.`,
        whishName: null,
        whishNumber: null,
        stale: true,
      });
    }
  });

  it('says Max’s refusals of "I’ve paid" in the server’s own words (N9c5a)', () => {
    const notOpen = houseRefusal(conflict('house_max_place_not_open', MAX_NOT_OPEN), 'Try again.');
    const closed = houseRefusal(
      conflict(
        'house_max_closed',
        'Max isn’t taking anyone right now. Your ask is kept; don’t send money until it opens again.',
      ),
      'Try again.',
    );

    expect(notOpen).toMatchObject({ message: MAX_NOT_OPEN, stale: true });
    expect(closed).toMatchObject({
      message:
        'Max isn’t taking anyone right now. Your ask is kept; don’t send money until it opens again.',
      stale: true,
    });
    // A code that only looks like one is not marked out of date.
    expect(houseRefusal(conflict('house_maximum', 'No.'), 'Try again.').stale).toBe(false);
  });

  it('puts a Whish detail the server refused under its field', () => {
    const refusal = houseRefusal(
      new HttpErrorResponse({
        status: 400,
        error: { errors: { whishNumber: ['Enter the Whish number you sent the money from.'] } },
      }),
      'Try again.',
    );

    expect(refusal).toEqual({
      message: null,
      whishName: null,
      whishNumber: 'Enter the Whish number you sent the money from.',
      stale: false,
    });
  });

  it('falls back to the sheet’s own sentence when the server says nothing usable', () => {
    expect(houseRefusal(new HttpErrorResponse({ status: 500 }), 'Try again.').message).toBe(
      'Try again.',
    );
    expect(houseRefusal(new Error('boom'), 'Try again.').message).toBe('Try again.');
    expect(houseRefusal(new HttpErrorResponse({ status: 404 }), 'Try again.')).toEqual({
      message: 'Try again.',
      whishName: null,
      whishNumber: null,
      stale: true,
    });
  });

  it('says a lost connection as the app always does', () => {
    expect(houseRefusal(new HttpErrorResponse({ status: 0 }), 'Try again.').message).toBe(
      'The app couldn’t connect. Check your connection and try again.',
    );
  });
});
