import { describe, expect, it } from 'vitest';
import {
  chosenCurrency,
  currencyChoiceOf,
  currencyName,
  currencyReasons,
  isKnownCurrency,
} from './currencies';

describe('the currency new plans are priced in', () => {
  it('shows USD and LBP as choices and any other code under Another', () => {
    expect(currencyChoiceOf('USD')).toEqual({ choice: 'USD', other: '' });
    expect(currencyChoiceOf('lbp')).toEqual({ choice: 'LBP', other: '' });
    expect(currencyChoiceOf('eur')).toEqual({ choice: 'other', other: 'EUR' });
    expect(chosenCurrency('LBP', 'EUR')).toBe('LBP');
    expect(chosenCurrency('other', ' aed ')).toBe('AED');
  });

  it('asks for a real three-letter code under Another, in words', () => {
    expect(currencyReasons('USD', '')).toEqual([]);
    expect(currencyReasons('other', '  ')).toEqual([
      'Type the currency’s three-letter code, like EUR.',
    ]);
    expect(currencyReasons('other', 'zzq')).toEqual([
      'ZZQ isn’t a currency code. Try one like EUR or AED.',
    ]);
    expect(currencyReasons('other', 'eur')).toEqual([]);
    expect(isKnownCurrency('EUR')).toBe(true);
    expect(isKnownCurrency('EU')).toBe(false);
  });

  it('names a currency in words where the browser knows it', () => {
    expect(currencyName('USD', 'en-US')).toBe('US Dollar');
    expect(currencyName('EUR', 'en-US')).toBe('Euro');
  });
});
