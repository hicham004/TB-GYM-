import { describe, expect, it } from 'vitest';
import type { WorkspaceDetails } from '../../core/api/api.models';
import {
  draftChanged,
  draftCurrency,
  draftErrors,
  draftFrom,
  languageLine,
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
    expect(draftChanged({ ...draft, language: 'ar-LB' }, saved)).toBe(true);
    // Another currency typed as the one already saved is no change.
    expect(draftChanged({ ...draft, currencyChoice: 'other', otherCurrency: 'usd' }, saved)).toBe(
      false,
    );
  });

  it('takes the language as stored and says what Arabic means while only English is written', () => {
    expect(draftFrom(workspace()).language).toBe('en-LB');
    expect(draftFrom(workspace({ defaultCulture: 'ar-LB' })).language).toBe('ar-LB');
    expect(languageLine('en-LB')).toBe('Notices and emails go out in English.');
    expect(languageLine('ar-LB')).toBe(
      'Notices and emails aren’t written in Arabic yet, so they go out in English until they are.',
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
  });
});
