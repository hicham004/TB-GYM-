import { describe, expect, it } from 'vitest';
import type { DashboardStart as ContractStart } from '../../core/api/generated';
import { mapStartingWeight, startWords, type DashboardStart } from './progress-dashboard.models';

function start(overrides: Partial<DashboardStart> = {}): DashboardStart {
  return {
    lines: [
      { clientProfileId: 'old', kind: 'Started', date: '2025-10-15', displayValue: 97.386 },
      { clientProfileId: 'new', kind: 'CameBack', date: '2026-03-03', displayValue: 99 },
    ],
    sinceStart: {
      methodKey: 'BodyweightSinceStartWeeklyMean',
      methodVersion: '1.0',
      startWeekStart: '2025-10-13',
      latestWeekStart: '2026-10-26',
      displayDelta: -5.286,
      percent: -5.4,
    },
    current: null,
    ...overrides,
  };
}

describe('where a client started (critique B6)', () => {
  it('names the first start and each comeback with the day, oldest first', () => {
    const words = startWords(start(), 'Kilogram', 'en')!;

    expect(words.lines).toEqual([
      { key: 'old', text: 'Started at 97.4 kg · Wed 15 Oct 2025' },
      { key: 'new', text: 'Came back at 99.0 kg · Tue 3 Mar 2026' },
    ]);
  });

  it('says the change since the first start with a true minus sign, or a plus', () => {
    expect(startWords(start(), 'Kilogram', 'en')!.sinceStart).toBe('Since start −5.3 kg (−5.4%)');
    const gain = start({
      sinceStart: { ...start().sinceStart!, displayDelta: 1.6, percent: 1.6 },
    });
    expect(startWords(gain, 'Kilogram', 'en')!.sinceStart).toBe('Since start +1.6 kg (+1.6%)');
  });

  it('rounds a change half away from zero, as the server does', () => {
    const half = start({
      sinceStart: { ...start().sinceStart!, displayDelta: -3.85, percent: -5.6 },
    });
    expect(startWords(half, 'Kilogram', 'en')!.sinceStart).toBe('Since start −3.9 kg (−5.6%)');
    const up = start({ sinceStart: { ...start().sinceStart!, displayDelta: 0.05, percent: 0.1 } });
    expect(startWords(up, 'Kilogram', 'en')!.sinceStart).toBe('Since start +0.1 kg (+0.1%)');
  });

  it('says no change when the change rounds to nothing, and nothing while there is none to say', () => {
    const level = start({ sinceStart: { ...start().sinceStart!, displayDelta: 0.04, percent: 0 } });
    expect(startWords(level, 'Kilogram', 'en')!.sinceStart).toBe('No change since start');
    expect(startWords(start({ sinceStart: null }), 'Kilogram', 'en')!.sinceStart).toBeNull();
  });

  it('reads in pounds when the page does', () => {
    const pounds = start({
      lines: [{ clientProfileId: 'old', kind: 'Started', date: '2025-10-15', displayValue: 214.7 }],
      sinceStart: { ...start().sinceStart!, displayDelta: -11.654, percent: -5.4 },
    });
    const words = startWords(pounds, 'Pound', 'en')!;

    expect(words.lines[0].text).toBe('Started at 214.7 lb · Wed 15 Oct 2025');
    expect(words.sinceStart).toBe('Since start −11.7 lb (−5.4%)');
  });

  it('shows nothing for a client with no start yet, or on the client’s own page', () => {
    expect(startWords(start({ lines: [], sinceStart: null }), 'Kilogram', 'en')).toBeNull();
    expect(startWords(null, 'Kilogram', 'en')).toBeNull();
  });

  it('keeps the start a correction changes, with what it was before each one', () => {
    const view: NonNullable<ContractStart['current']> = {
      id: 'start-1',
      clientProfileId: 'new',
      measurementDate: '2026-03-03',
      valueKilograms: '99',
      enteredValue: '99',
      enteredUnit: 'Kilogram',
      origin: 'Intake',
      version: '12',
      corrections: [
        {
          id: 'c-1',
          measurementDate: '2026-03-02',
          valueKilograms: '90',
          enteredValue: '90',
          enteredUnit: 'Kilogram',
          reason: 'Typed the wrong number',
          supersededByUserId: 'user-1',
          supersededByName: 'Lea Haddad',
          supersededAtUtc: '2026-03-04T08:00:00Z',
        },
      ],
    };

    expect(mapStartingWeight(view)).toEqual({
      id: 'start-1',
      date: '2026-03-03',
      valueKilograms: 99,
      enteredValue: 99,
      enteredUnit: 'Kilogram',
      version: 12,
      corrections: [
        {
          id: 'c-1',
          date: '2026-03-02',
          valueKilograms: 90,
          enteredValue: 90,
          enteredUnit: 'Kilogram',
          reason: 'Typed the wrong number',
          byName: 'Lea Haddad',
          atUtc: '2026-03-04T08:00:00Z',
        },
      ],
    });
  });
});
