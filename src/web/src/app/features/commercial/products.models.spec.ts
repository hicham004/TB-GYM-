import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import {
  atlasCatalog,
  features,
  offer,
  packProduct,
  product,
} from '../../../testing/product-fixtures';
import {
  catalogSummary,
  clientsLine,
  duration,
  emptyOption,
  emptyPackOption,
  offerLength,
  optionErrors,
  optionLength,
  optionRequest,
  optionRow,
  packValidity,
  planCard,
  planCards,
  priceErrors,
  productWriteError,
  sessionsName,
} from './products.models';

describe('Plans you sell, in coach words', () => {
  it('says who is on a plan now and who starts later, never a bare zero', () => {
    expect(clientsLine({ now: 0, starting: 0 })).toBe('No clients yet');
    expect(clientsLine({ now: 1, starting: 0 })).toBe('1 client');
    expect(clientsLine({ now: '3', starting: '2' })).toBe('3 clients · 2 starting');
    expect(clientsLine({ now: 0, starting: 1 })).toBe('1 starting soon');
  });

  it('names an option by its length, and keeps the coach’s own name only when it says more', () => {
    expect(duration({ durationCount: 1, durationUnit: 'Week' })).toBe('1 week');
    expect(duration({ durationCount: 10, durationUnit: 'Day' })).toBe('10 days');
    expect(optionRow(offer({ label: '12 Weeks' }), 'en-US').name).toBeNull();
    expect(optionRow(offer({ label: 'Summer offer' }), 'en-US').name).toBe('Summer offer');
    expect(optionRow(offer({ priceAmount: '1200.5' }), 'en-US').price).toBe('USD 1,200.50');
  });

  it('offers Change price and Stop selling on an option for sale, and Sell again on an old one', () => {
    expect(optionRow(offer(), 'en-US').menu.map((item) => item.action)).toEqual([
      'price',
      'retire',
    ]);
    expect(optionRow(offer({ isActive: false }), 'en-US').menu.map((item) => item.action)).toEqual([
      'restore',
    ]);
  });

  it('splits the plans for sale from those no longer sold, with old prices apart', () => {
    const cards = planCards(atlasCatalog(), 'en-US');
    expect(cards.selling.map((card) => card.name)).toEqual(['Online Coaching', 'Strength Program']);
    expect(cards.stopped.map((card) => card.name)).toEqual(['Summer Shred']);
    expect(cards.selling[0].options.map((row) => row.id)).toEqual(['o-4', 'o-12']);
    expect(cards.selling[0].retired.map((row) => row.id)).toEqual(['o-12-old']);
    expect(cards.stopped[0].menu.map((item) => item.action)).toEqual(['edit', 'restore']);
  });

  it('says what a plan includes once when its options agree, and per option when they differ', () => {
    const same = planCard(atlasCatalog().products[0], 'en-US');
    expect(same.includes?.map((chip) => chip.label)).toEqual([
      'Training',
      'Nutrition',
      'Check-ins',
      'Messaging',
    ]);
    const mixed = planCard(
      product({
        offers: [offer(), offer({ id: 'o-4', durationCount: 4, features: features('Training') })],
      }),
      'en-US',
    );
    expect(mixed.includes).toBeNull();
    expect(mixed.options.map((row) => row.features.length)).toEqual([1, 4]);
  });

  it('sums the clients on the plans for sale for the page’s first line', () => {
    expect(catalogSummary(atlasCatalog())).toBe('2 plans for sale · 8 clients on them now');
    expect(catalogSummary({ workspaceCurrencyCode: 'USD', products: [product()] })).toBe(
      '1 plan for sale',
    );
    expect(catalogSummary({ workspaceCurrencyCode: 'USD', products: [] })).toBe('');
  });

  it('checks an option as the server would, without refusing what it accepts', () => {
    const valid = { ...emptyOption('usd'), price: 99.99 };
    expect(optionErrors(valid)).toEqual({});
    expect(optionErrors({ ...valid, length: 0 })).toEqual({
      length: ['Enter a whole number of weeks, 1 or more.'],
    });
    expect(Object.keys(optionErrors({ ...valid, length: 2.5 }))).toEqual(['length']);
    expect(optionErrors({ ...valid, length: 3650 })).toEqual({});
    expect(optionErrors({ ...valid, length: 3651 })).toEqual({
      length: ['Keep it to 3,650 weeks or fewer.'],
    });
    // A plan sold by the day has the server's same bounds, said in days (INV-7).
    const days = { ...valid, unit: 'Day' as const };
    expect(optionErrors({ ...days, length: 30 })).toEqual({});
    expect(optionErrors({ ...days, length: null })).toEqual({
      length: ['Enter a whole number of days, 1 or more.'],
    });
    expect(optionErrors({ ...days, length: 3651 })).toEqual({
      length: ['Keep it to 3,650 days or fewer.'],
    });
    expect(optionErrors({ ...valid, price: 10.005 })['price']).toEqual([
      'Use at most two decimals.',
    ]);
    expect(optionErrors({ ...valid, price: 0 })).toEqual({});
    expect(Object.keys(optionErrors({ ...valid, currency: 'US' }))).toEqual(['currency']);
    expect(Object.keys(optionErrors({ ...valid, features: [] }))).toEqual(['features']);
  });

  it('sends an unnamed option under its length, in upper-case currency, features in order', () => {
    expect(
      optionRequest({
        label: ' ',
        length: 6,
        unit: 'Week',
        price: 0,
        currency: 'lbp',
        features: ['Messaging', 'Training'],
        sessions: null,
      }),
    ).toEqual({
      label: '6 weeks',
      durationCount: 6,
      durationUnit: 'Week',
      priceAmount: 0,
      priceCurrency: 'LBP',
      features: [
        { feature: 'Training', allowsConcurrentCoverage: false },
        { feature: 'Messaging', allowsConcurrentCoverage: false },
      ],
    });
  });

  it('sells an option by the day under its length in days (INV-7)', () => {
    expect(optionLength({ length: 30, unit: 'Day' })).toBe('30 days');
    expect(optionLength({ length: 1, unit: 'Day' })).toBe('1 day');
    expect(optionLength({ length: 12, unit: 'Week' })).toBe('12 weeks');
    expect(optionLength({ length: null, unit: 'Day' })).toBe('');
    expect(optionLength({ length: 2.5, unit: 'Day' })).toBe('');
    expect(
      optionRequest({ ...emptyOption('USD'), length: 30, unit: 'Day', price: 90 }),
    ).toMatchObject({ label: '30 days', durationCount: 30, durationUnit: 'Day', priceAmount: 90 });
    expect(
      optionRequest({ ...emptyOption('USD'), label: 'Monthly', length: 30, unit: 'Day', price: 90 })
        .label,
    ).toBe('Monthly');
  });

  it('refuses the same price, a negative one and fractions of a cent', () => {
    expect(priceErrors(330, '330')).toEqual(['Choose a different price for this option.']);
    expect(priceErrors(-1, 330)).toEqual(['Enter a price of zero or more.']);
    expect(priceErrors(330.001, 330)).toEqual(['Use at most two decimals.']);
    expect(priceErrors(0, 330)).toEqual([]);
  });

  it('turns a duplicate name into coach words', () => {
    const error = new HttpErrorResponse({ status: 409, error: { code: 'product_conflict' } });
    expect(productWriteError(error)).toBe(
      'You already sell a plan with this name. Choose another name.',
    );
    // BILL-7: a new, renamed or restored plan cannot take the name of another plan for sale.
    const taken = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'product_name_taken',
        message: 'You already sell a plan called "Form check".',
      },
    });
    expect(productWriteError(taken)).toBe(
      'You already sell a plan with this name. Choose another name, or rename that plan first.',
    );
  });

  it('counts an old price’s own clients as still on it, and the price that replaced it all of them (COACH-2)', () => {
    expect(clientsLine({ now: 2, starting: 1 }, true)).toBe('3 clients still on this price');
    expect(clientsLine({ now: 1, starting: 0 }, true)).toBe('1 client still on this price');
    expect(clientsLine({ now: 0, starting: 0 }, true)).toBe('No one on this price');
    const old = optionRow(offer({ isActive: false, clients: { now: 3, starting: 0 } }), 'en-US');
    expect(old.hasClients).toBe(true);
    expect(old.clients).toBe('3 clients still on this price');
    // The server counts the replacement with the options it replaced; it reads as the plan's clients.
    expect(optionRow(offer({ clients: { now: 3, starting: 0 } }), 'en-US').clients).toBe(
      '3 clients',
    );
  });

  describe('session packs (critique B10b)', () => {
    const pack = emptyPackOption('USD');

    it('starts a pack at ten sessions over 90 days, a single session over 30, nothing else ticked', () => {
      expect(pack).toEqual(
        expect.objectContaining({ sessions: 10, length: 90, unit: 'Day', features: [] }),
      );
      expect(packValidity(10)).toBe(90);
      expect(packValidity(1)).toBe(30);
      expect(packValidity(null)).toBe(90);
    });

    it('calls an option by its count until it has a name of its own', () => {
      expect(sessionsName(1)).toBe('Single session');
      expect(sessionsName(10)).toBe('10 sessions');
      expect(optionRequest({ ...pack, price: 300 }, 'SessionPack')).toEqual({
        label: '10 sessions',
        durationCount: 90,
        durationUnit: 'Day',
        priceAmount: 300,
        priceCurrency: 'USD',
        features: [],
        sessionCount: 10,
      });
      expect(
        optionRequest(
          { ...pack, price: 35, sessions: 1, length: 30, label: 'Trial' },
          'SessionPack',
        ).label,
      ).toBe('Trial');
    });

    it('checks the count as the server does, and asks for no ticks', () => {
      const valid = { ...pack, price: 300 };
      expect(optionErrors(valid, 'SessionPack')).toEqual({});
      for (const sessions of [null, 0, 101, 2.5]) {
        expect(optionErrors({ ...valid, sessions }, 'SessionPack')['sessions']).toEqual([
          'Enter a whole number of sessions, 1 to 100.',
        ]);
      }
      expect(optionErrors({ ...valid, sessions: 100 }, 'SessionPack')).toEqual({});
      expect(optionErrors({ ...valid, sessions: 1 }, 'SessionPack')).toEqual({});
      // A coaching plan neither asks for a count nor goes without a tick.
      expect(Object.keys(optionErrors(valid))).toEqual(['features']);
    });

    it('reads an option by its count and how long it runs, with sessions among what it includes', () => {
      const [ten] = packProduct().offers;
      const row = optionRow(ten, 'en-US');
      expect(row.duration).toBe('10 sessions · 90 days');
      expect(row.name).toBeNull();
      expect(row.features.map((chip) => chip.label)).toEqual(['1-on-1 sessions']);
      expect(optionRow({ ...ten, label: 'Student rate' }, 'en-US').name).toBe('Student rate');
      expect(offerLength(offer())).toBe('12 weeks');
    });

    it('marks the card of a pack', () => {
      expect(planCard(packProduct(), 'en-US').isPack).toBe(true);
      expect(planCard(product(), 'en-US').isPack).toBe(false);
    });

    it('words a clash in the slot it clashed on', () => {
      const clash = new HttpErrorResponse({
        status: 409,
        error: { code: 'active_offer_slot_conflict' },
      });
      expect(productWriteError(clash, 'SessionPack')).toBe(
        'This pack already sells that many sessions for that length in that currency. Change its price instead, or stop selling it first.',
      );
      expect(productWriteError(clash)).toContain('an option of that length');
    });
  });
});
