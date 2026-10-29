import { describe, expect, it } from 'vitest';
import { NutritionChoiceDrafts } from './nutrition-choice-drafts';
import { NutritionDay } from './nutrition.models';

function day(selectedA: string | null = null, servingsA: number | null = null): NutritionDay {
  return {
    planId: 'plan',
    planDayId: 'day',
    date: '2026-08-22',
    targetCalories: 2000,
    targetProtein: 150,
    targetCarbohydrate: 220,
    targetFat: 60,
    dailyLogId: selectedA ? 'log' : null,
    logStatus: selectedA ? 'InProgress' : null,
    selectedCalories: 0,
    selectedProtein: 0,
    selectedCarbohydrate: 0,
    selectedFat: 0,
    logVersion: selectedA ? 2 : null,
    safetyNotice: 'No safety claim.',
    customFoods: [],
    slots: [
      {
        id: 'slot-a',
        name: 'Breakfast',
        order: 0,
        selectedChoiceId: selectedA,
        actualServings: servingsA,
        loggedCalories: null,
        choices: [
          {
            id: 'choice-a1',
            recipeName: 'A1',
            recipeId: null,
            photoId: null,
            servings: 1,
            calories: 300,
            protein: 20,
            carbohydrate: 30,
            fat: 10,
          },
          {
            id: 'choice-a2',
            recipeName: 'A2',
            recipeId: null,
            photoId: null,
            servings: 1,
            calories: 400,
            protein: 25,
            carbohydrate: 40,
            fat: 12,
          },
        ],
      },
      {
        id: 'slot-b',
        name: 'Lunch',
        order: 1,
        selectedChoiceId: null,
        actualServings: null,
        loggedCalories: null,
        choices: [
          {
            id: 'choice-b1',
            recipeName: 'B1',
            recipeId: null,
            photoId: null,
            servings: 1,
            calories: 500,
            protein: 35,
            carbohydrate: 50,
            fat: 15,
          },
        ],
      },
    ],
  };
}

describe('NutritionChoiceDrafts', () => {
  it('initializes one local draft per prescribed slot', () => {
    const drafts = new NutritionChoiceDrafts();
    drafts.reconcile(day());

    expect(drafts.values()).toHaveLength(2);
    expect(drafts.get('slot-a')?.choiceId).toBe('choice-a1');
  });

  it('preserves dirty user input during a read-model refresh', () => {
    const drafts = new NutritionChoiceDrafts();
    drafts.reconcile(day());
    drafts.update('slot-b', { choiceId: 'choice-b1', servings: '1.75' });

    drafts.reconcile(day('choice-a2', 2));

    expect(drafts.get('slot-b')?.servings).toBe('1.75');
    expect(drafts.get('slot-b')?.dirty).toBe(true);
  });

  it('saving one slot does not erase another dirty slot', () => {
    const drafts = new NutritionChoiceDrafts();
    drafts.reconcile(day());
    drafts.update('slot-a', { choiceId: 'choice-a2', servings: '2' });
    drafts.update('slot-b', { servings: '1.5' });

    drafts.saved('slot-a', day('choice-a2', 2));

    expect(drafts.get('slot-a')?.dirty).toBe(false);
    expect(drafts.get('slot-b')?.servings).toBe('1.5');
    expect(drafts.get('slot-b')?.dirty).toBe(true);
  });

  it('a failed save retains the exact edited values', () => {
    const drafts = new NutritionChoiceDrafts();
    drafts.reconcile(day());
    drafts.update('slot-a', { choiceId: 'choice-a2', servings: '0.75' });
    drafts.beginSave('slot-a');

    drafts.failed('slot-a', 'Network failed');

    expect(drafts.get('slot-a')).toMatchObject({
      choiceId: 'choice-a2',
      servings: '0.75',
      dirty: true,
      saving: false,
      error: 'Network failed',
    });
  });

  it('restores a meal as it stands: the option logged at its servings, or option 1 as planned (B5a)', () => {
    const drafts = new NutritionChoiceDrafts();
    const logged = day('choice-a2', 1.5);
    drafts.reconcile(logged);
    drafts.update('slot-a', { choiceId: 'choice-a1', servings: '1' });
    drafts.update('slot-b', { servings: '3' });

    drafts.restore(logged.slots[0]);

    expect(drafts.get('slot-a')).toMatchObject({
      choiceId: 'choice-a2',
      servings: '1.5',
      dirty: false,
      error: null,
    });
    expect(drafts.get('slot-b')?.dirty).toBe(true);
    const fresh = day();
    drafts.reconcile(fresh);
    drafts.update('slot-a', { choiceId: 'choice-a2', servings: '1' });
    drafts.restore(fresh.slots[0]);
    expect(drafts.get('slot-a')).toMatchObject({
      choiceId: 'choice-a1',
      servings: '1',
      dirty: false,
    });
    expect(() => drafts.restore({ ...fresh.slots[0], id: 'slot-z' })).toThrow();
  });

  it('removes only drafts whose prescribed slot disappeared', () => {
    const drafts = new NutritionChoiceDrafts();
    const current = day();
    drafts.reconcile(current);

    drafts.reconcile({ ...current, slots: current.slots.slice(0, 1) });

    expect(drafts.get('slot-a')).toBeDefined();
    expect(drafts.get('slot-b')).toBeUndefined();
  });
});
