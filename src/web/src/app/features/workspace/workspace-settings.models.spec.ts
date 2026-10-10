import { describe, expect, it } from 'vitest';
import type { WorkspaceDetails } from '../../core/api/api.models';
import {
  draftChanged,
  draftCurrency,
  draftErrors,
  draftFrom,
  isKnownCurrency,
  searchTimeZones,
  timeZoneIds,
  timeZoneOption,
} from './workspace-settings.models';

function workspace(overrides: Partial<WorkspaceDetails> = {}): WorkspaceDetails {
  return {
    id: 'tenant-1',
    name: 'Atlas Performance',
    slug: 'atlas-performance',
    timeZoneId: 'Asia/Beirut',
    defaultCulture: 'en-LB',
    defaultCurrencyCode: 'USD',
    weekStartsOn: 'Monday',
    currentDate: '2026-10-09',
    version: 4,
    ...overrides,
  } as WorkspaceDetails;
}

// A fixed instant: 9 October 2026, 16:00 UTC, when Beirut is on summer time (GMT+3).
const AT = new Date('2026-10-09T16:00:00Z');

describe('Name and region helpers', () => {
  it('offers USD and LBP as choices and keeps any other code under Another', () => {
    expect(draftFrom(workspace()).currencyChoice).toBe('USD');
    expect(draftFrom(workspace({ defaultCurrencyCode: 'LBP' })).currencyChoice).toBe('LBP');
    const euro = draftFrom(workspace({ defaultCurrencyCode: 'EUR' }));
    expect(euro).toMatchObject({ currencyChoice: 'other', otherCurrency: 'EUR' });
    expect(draftCurrency(euro)).toBe('EUR');
    expect(draftCurrency({ ...euro, otherCurrency: ' aed ' })).toBe('AED');
  });

  it('sees a change only where saving would change something', () => {
    const saved = workspace();
    const draft = draftFrom(saved);
    expect(draftChanged(draft, saved)).toBe(false);
    // Spaces around the name are not a change: the server trims them too.
    expect(draftChanged({ ...draft, name: ' Atlas Performance ' }, saved)).toBe(false);
    expect(draftChanged({ ...draft, name: 'Atlas Strength' }, saved)).toBe(true);
    expect(draftChanged({ ...draft, timeZoneId: 'Europe/Paris' }, saved)).toBe(true);
    expect(draftChanged({ ...draft, weekStartsOn: 'Sunday' }, saved)).toBe(true);
    expect(draftChanged({ ...draft, currencyChoice: 'LBP' }, saved)).toBe(true);
    // Another currency typed as the one already saved is no change.
    expect(draftChanged({ ...draft, currencyChoice: 'other', otherCurrency: 'usd' }, saved)).toBe(
      false,
    );
  });

  it('asks for a name and a real currency code, in words', () => {
    const draft = draftFrom(workspace());
    expect(draftErrors(draft)).toEqual({ name: [], currency: [] });
    expect(draftErrors({ ...draft, name: '   ' }).name).toEqual([
      'Give your coaching space a name.',
    ]);
    expect(draftErrors({ ...draft, name: 'x'.repeat(201) }).name).toEqual([
      'Keep the name to 200 characters.',
    ]);
    const other = { ...draft, currencyChoice: 'other' as const };
    expect(draftErrors({ ...other, otherCurrency: '' }).currency).toEqual([
      'Type the currency’s three-letter code, like EUR.',
    ]);
    expect(draftErrors({ ...other, otherCurrency: 'ZZQ' }).currency).toEqual([
      'ZZQ isn’t a currency code. Try one like EUR or AED.',
    ]);
    expect(draftErrors({ ...other, otherCurrency: 'eur' }).currency).toEqual([]);
    expect(isKnownCurrency('EUR')).toBe(true);
    expect(isKnownCurrency('EU')).toBe(false);
  });

  it('names a zone by its city and area, with its offset and the time there now', () => {
    const beirut = timeZoneOption('Asia/Beirut', AT, 'en-US');
    expect(beirut).toMatchObject({
      id: 'Asia/Beirut',
      city: 'Beirut',
      area: 'Asia',
      offset: 'GMT+3',
      offsetMinutes: 180,
      now: '7:00 PM',
    });
    const newYork = timeZoneOption('America/New_York', AT, 'en-US');
    expect(newYork).toMatchObject({ city: 'New York', offset: 'GMT-4', offsetMinutes: -240 });
    expect(timeZoneOption('Asia/Kolkata', AT, 'en-US').offsetMinutes).toBe(330);
    expect(timeZoneOption('UTC', AT, 'en-US')).toMatchObject({ city: 'UTC', area: '' });
  });

  it('always lists UTC and the saved zone, even one the browser does not', () => {
    const ids = timeZoneIds('Etc/GMT-3');
    expect(ids).toContain('Asia/Beirut');
    expect(ids).toContain('UTC');
    expect(ids).toContain('Etc/GMT-3');
  });

  it('finds zones by city, area or offset, the cities that start with it first', () => {
    const options = ['Asia/Beirut', 'Europe/Berlin', 'Asia/Dubai', 'America/Bahia', 'UTC'].map(
      (id) => timeZoneOption(id, AT, 'en-US'),
    );
    expect(searchTimeZones(options, 'be').map((option) => option.city)).toEqual([
      'Berlin',
      'Beirut',
    ]);
    expect(searchTimeZones(options, 'asia').map((option) => option.city)).toEqual([
      'Beirut',
      'Dubai',
    ]);
    expect(searchTimeZones(options, 'gmt+4').map((option) => option.city)).toEqual(['Dubai']);
    expect(searchTimeZones(options, 'nowhere')).toEqual([]);
    // With nothing typed, the list runs west to east, as a world clock does.
    expect(searchTimeZones(options, '').map((option) => option.city)).toEqual([
      'Bahia',
      'UTC',
      'Berlin',
      'Beirut',
      'Dubai',
    ]);
  });
});
