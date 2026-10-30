import { describe, expect, it } from 'vitest';
import {
  energyModelView,
  previewView,
  RANA_WORDS,
} from '../../../testing/client-nutrition-fixtures';
import {
  emptyTargets,
  mapEnergyModel,
  targetErrors,
  type TargetsValues,
} from './client-nutrition.models';
import { goalLine, mapPreview, pickSentence, previewRequest } from './energy-preview.models';

const two = mapEnergyModel(energyModelView(2));

function rana(overrides: Partial<TargetsValues> = {}): TargetsValues {
  return {
    ...emptyTargets(),
    weight: 70,
    height: 168,
    age: 30,
    sex: 'Female',
    work: 'Seated',
    steps: 8000,
    workouts: 4,
    goal: -300,
    protein: 140,
    fat: 25,
    ...overrides,
  };
}

const ask = (values: TargetsValues) => previewRequest(values, targetErrors(values, two));

describe('the targets sheet’s preview (critique B8b)', () => {
  it('asks about what is typed, with the goal picks and the goal in the box', () => {
    expect(ask(rana())).toEqual({
      bmrMethodKey: 'MifflinStJeor',
      weightKilograms: 70,
      heightCentimeters: 168,
      ageYears: 30,
      sex: 'Female',
      bodyFatPercentage: null,
      occupationType: 'Seated',
      averageDailySteps: 8000,
      workoutsPerWeek: 4,
      chosenPal: null,
      goalAdjustments: [-500, -300, 0, 250, 400],
    });
    expect(ask(rana({ goal: -400 })).goalAdjustments).toEqual([-500, -300, 0, 250, 400, -400]);
  });

  it('leaves out every number the sheet would refuse, so the server never answers with a refusal', () => {
    const half = ask(rana({ weight: 12, steps: null, workouts: 9, goal: 5000, age: 17 }));
    expect(half).toMatchObject({
      weightKilograms: null,
      ageYears: null,
      averageDailySteps: null,
      workoutsPerWeek: null,
      goalAdjustments: [-500, -300, 0, 250, 400],
    });
    // Body fat is asked only for the formula that needs it.
    expect(ask(rana({ bodyFat: 28 })).bodyFatPercentage).toBeNull();
    expect(ask(rana({ formula: 'KatchMcArdle', bodyFat: 28 })).bodyFatPercentage).toBe(28);
  });

  it('asks for the coach’s own multiplier once it is one, and for none while it is still being typed', () => {
    expect(ask(rana({ palMode: 'pick', chosenPal: 1.55 }))).toMatchObject({
      occupationType: 'Seated',
      chosenPal: 1.55,
    });
    expect(ask(rana({ palMode: 'typed', chosenPal: 1.3 }))).toMatchObject({
      occupationType: null,
      chosenPal: null,
    });
    // A multiplier typed but no longer chosen asks the table's.
    expect(ask(rana({ palMode: 'table', chosenPal: 1.62 })).chosenPal).toBeNull();
  });

  it('keeps the server’s words, each goal by its calories a day', () => {
    const preview = mapPreview(previewView(), 'en-US');
    expect(preview.activity).toBe(RANA_WORDS.activity);
    expect(preview.walking).toBe(RANA_WORDS.walking);
    expect(preview.goals.get(-300)).toEqual({
      words: RANA_WORDS.goal,
      pace: '≈ 0.3 kg a week',
      share: 87,
    });
    expect(preview.goals.get(0)?.pace).toBe('no change');
    const empty = mapPreview(previewView({ activity: null, walking: null, goals: [] }), 'en-US');
    expect([empty.activity, empty.walking, empty.goals.size]).toEqual([null, null, 0]);
  });

  it('says a goal’s pace from the server’s figures', () => {
    const rate = (goalAdjustment: number, kilogramsPerWeek: number, share: number | null) =>
      goalLine(
        {
          goalAdjustment,
          kilogramsPerWeek,
          shareOfMaintenance: share,
          words: 'words',
          methodKey: 'WeeklyWeightChange',
          methodVersion: '1.0',
        },
        'en-US',
      );
    expect(rate(-500, -0.5, 79)).toEqual({ words: 'words', pace: '≈ 0.5 kg a week', share: 79 });
    expect(rate(400, 0.4, null)).toEqual({ words: 'words', pace: '≈ 0.4 kg a week', share: null });
    expect(rate(50, 0, 102).pace).toBe('under 0.1 kg a week');
    expect(rate(0, 0, 100).pace).toBe('no change');
  });

  it('turns a pick’s words into a sentence', () => {
    expect(pickSentence('little movement, no exercise')).toBe('Little movement, no exercise.');
    expect(pickSentence('Already a sentence.')).toBe('Already a sentence.');
    expect(pickSentence('  ')).toBe('');
  });
});
