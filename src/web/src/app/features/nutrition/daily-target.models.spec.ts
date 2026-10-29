import { describe, expect, it } from 'vitest';
import type { ClientTargetsItem } from '../../core/api/generated';
import {
  clientTargetsRow,
  fillErrors,
  fillSentence,
  fromClientLine,
  mapSplit,
  matchesClient,
} from './daily-target.models';

const CONTEXT = { today: '2026-10-29', timeZone: 'Asia/Beirut', locale: 'en', userId: 'user-lea' };

function item(overrides: Partial<ClientTargetsItem> = {}): ClientTargetsItem {
  return {
    clientProfileId: 'client-maya',
    firstName: 'Maya',
    lastName: 'Fakhoury',
    coachUserId: 'user-lea',
    coachName: 'Lea Khoury',
    calculationId: 'calculation-1',
    calculatedAtUtc: '2026-10-26T09:30:00Z',
    calorieTarget: 2150.4,
    proteinGrams: 120,
    carbohydrateGrams: 248.2,
    fatGrams: 59.73,
    fatPercentage: 25,
    bodyweightKilograms: 62.5,
    isEnergyDeficit: true,
    warnings: [],
    ...overrides,
  };
}

describe('the daily target (critique B5c2)', () => {
  describe('Fill in fat and carbs', () => {
    it('asks for the calories, the protein and fat’s share, within the server’s limits', () => {
      expect(fillErrors({ calories: 2000, protein: 150, fat: 25 })).toEqual({
        calories: [],
        protein: [],
        fat: [],
      });
      // A share under 20 % is worked out and flagged afterwards, never refused here.
      expect(fillErrors({ calories: 2000, protein: 150, fat: 12 }).fat).toEqual([]);
      expect(fillErrors({ calories: null, protein: null, fat: null })).toEqual({
        calories: ['Enter the calories a day.'],
        protein: ['Enter the grams of protein a day.'],
        fat: ['Enter the share of calories that comes from fat.'],
      });
      expect(fillErrors({ calories: 0, protein: -1, fat: 101 })).toEqual({
        calories: ['Calories have to be more than 0 and at most 100,000.'],
        protein: ['Protein can’t be below 0 grams.'],
        fat: ['Fat has to be between 0 and 100 percent of calories.'],
      });
      expect(fillErrors({ calories: 100_001, protein: 0, fat: 0 }).calories).toHaveLength(1);
    });

    it('takes the server’s grams as they are, with its warnings in a coach’s words', () => {
      const split = mapSplit({
        calorieTarget: 2000,
        proteinGrams: 150,
        fatPercentage: 15,
        fatGrams: '33.333333333333333333333333333',
        carbohydrateGrams: 275,
        methodKey: 'Nut008MacroSplit',
        methodVersion: '1.0',
        warnings: [
          'Fat is 15% of calories, under the coaching review floor of 20%. This is a warning, not a clinical determination.',
          'Fat is 0.42 g/kg/day, under the coaching review floor of 0.5 g/kg/day. This is a warning, not a clinical determination.',
        ],
      });

      expect(split).toEqual({
        calories: 2000,
        protein: 150,
        carbs: 275,
        fat: 33.333333333333336,
        share: 15,
        warnings: [
          'Fat is 15% of the calories, under the usual 20%. This is a flag for you to look at, not a rule.',
          'Fat works out at 0.42 g for each kilogram a day, under the usual 0.5 g. This is a flag for you to look at, not a rule.',
        ],
      });
    });

    it('says the arithmetic in one sentence, in whole grams', () => {
      expect(fillSentence(25, 55.555555, 225, 'en')).toBe(
        'Fat is 25% of the calories, 56 g, and carbs are the rest, 225 g.',
      );
      expect(fillSentence(27.5, 61.1, 1237.5, 'en')).toBe(
        'Fat is 27.5% of the calories, 61 g, and carbs are the rest, 1,238 g.',
      );
    });
  });

  describe('Start from a client’s targets', () => {
    it('lists a client with their latest targets and when they were worked out', () => {
      const row = clientTargetsRow(item(), CONTEXT);

      expect(row).toEqual(
        expect.objectContaining({
          id: 'client-maya',
          name: 'Maya Fakhoury',
          initials: 'MF',
          macros: '2,150 kcal · protein 120 g · carbs 248 g · fat 60 g',
          when: 'Worked out Mon 26 Oct',
          coach: null,
          spoken: '2,150 kcal · protein 120 g · carbs 248 g · fat 60 g, Worked out Mon 26 Oct',
        }),
      );
      expect(row.pick).toEqual({
        name: 'Maya Fakhoury',
        calories: 2150.4,
        protein: 120,
        carbs: 248.2,
        fat: 59.73,
        share: 25,
        weight: 62.5,
        isEnergyDeficit: true,
        warnings: [],
        on: 'Mon 26 Oct',
      });
      expect(fromClientLine(row.pick)).toBe('From Maya Fakhoury’s targets, worked out Mon 26 Oct.');
    });

    it('says a coach’s own macros are theirs, and today as today', () => {
      const row = clientTargetsRow(
        item({ fatPercentage: null, calculatedAtUtc: '2026-10-29T06:00:00Z' }),
        CONTEXT,
      );

      expect(row.when).toBe('Your macros, set today');
      expect(row.pick.share).toBeNull();
      expect(fromClientLine(row.pick)).toBe(
        'From Maya Fakhoury’s targets: your macros, set today.',
      );
    });

    it('names the coach of a team coach’s client for the owner, and never the reader’s own', () => {
      const owner = { ...CONTEXT, userId: 'user-karim' };
      expect(clientTargetsRow(item(), owner).coach).toBe('Coached by Lea Khoury');
      expect(clientTargetsRow(item(), owner).spoken).toContain(', Coached by Lea Khoury');
      expect(clientTargetsRow(item(), CONTEXT).coach).toBeNull();
      expect(clientTargetsRow(item(), { ...CONTEXT, userId: null }).coach).toBeNull();
    });

    it('finds a client by every word of their name, any case, accents aside', () => {
      const row = clientTargetsRow(item({ firstName: 'Zoé', lastName: 'Haddad' }), CONTEXT);

      expect(matchesClient(row, 'zoe')).toBe(true);
      expect(matchesClient(row, 'HADD zo')).toBe(true);
      expect(matchesClient(row, 'maya')).toBe(false);
    });
  });
});
