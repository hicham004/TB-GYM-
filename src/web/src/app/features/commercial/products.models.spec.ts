import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { atlasCatalog, features, offer, product } from '../../../testing/product-fixtures';
import {
  catalogSummary,
  clientsLine,
  duration,
  emptyOption,
  optionErrors,
  optionRequest,
  optionRow,
  planCard,
  planCards,
  priceErrors,
  productWriteError,
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
    expect(Object.keys(optionErrors({ ...valid, weeks: 0 }))).toEqual(['weeks']);
    expect(Object.keys(optionErrors({ ...valid, weeks: 2.5 }))).toEqual(['weeks']);
    expect(optionErrors({ ...valid, weeks: 3650 })).toEqual({});
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
        weeks: 6,
        price: 0,
        currency: 'lbp',
        features: ['Messaging', 'Training'],
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
});
