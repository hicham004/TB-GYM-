import { describe, expect, it } from 'vitest';
import {
  allergens,
  calculationRecord,
  clientPlan,
  earlierRecord,
  TODAY,
} from '../../../testing/client-nutrition-fixtures';
import { enrollment } from '../../../testing/client-service-fixtures';
import {
  addDaysIso,
  ageOn,
  allergenList,
  assignRefusal,
  calculationRefusal,
  calculationRequest,
  dayInZone,
  emptyTargets,
  inListOrder,
  inputsLine,
  macroShares,
  mapPlan,
  mapWorkedOut,
  nutritionClosed,
  nutritionCovers,
  perKilogram,
  planDates,
  planStateWords,
  problemCount,
  proteinFor,
  refusalText,
  runsWords,
  sameAllergens,
  signedKcal,
  splitPlans,
  startingTargets,
  startIssue,
  targetErrors,
  warningWords,
  workedOutOn,
  type TargetsValues,
} from './client-nutrition.models';

const LOCALE = 'en-US';

function valid(overrides: Partial<TargetsValues> = {}): TargetsValues {
  return {
    ...emptyTargets(),
    weight: 70,
    height: 168,
    age: 30,
    sex: 'Female',
    work: 'Seated',
    steps: 8000,
    goal: -300,
    protein: 140,
    fat: 25,
    ...overrides,
  };
}

describe('the calculation sheet', () => {
  it('turns what was typed into the server request, without a default for sex or work', () => {
    expect(calculationRequest(valid())).toEqual({
      bmrMethodKey: 'MifflinStJeor',
      weightKilograms: 70,
      heightCentimeters: 168,
      ageYears: 30,
      sex: 'Female',
      bodyFatPercentage: null,
      occupationType: 'Seated',
      averageDailySteps: 8000,
      coachGoalAdjustment: -300,
      calorieTarget: null,
      proteinGrams: 140,
      fatPercentage: 25,
      isEnergyDeficit: true,
    });
    const empty = emptyTargets();
    expect([empty.sex, empty.work, empty.weight, empty.height, empty.age]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('marks eating below what they burn as a deficit, and holding or gaining as not', () => {
    expect(calculationRequest(valid({ goal: -1 })).isEnergyDeficit).toBe(true);
    expect(calculationRequest(valid({ goal: 0 })).isEnergyDeficit).toBe(false);
    expect(calculationRequest(valid({ goal: 250 })).isEnergyDeficit).toBe(false);
  });

  it('sends the body fat only for the formula that uses it', () => {
    const own = valid({ formula: 'KatchMcArdle', bodyFat: 28 });
    expect(calculationRequest(own).bodyFatPercentage).toBe(28);
    expect(calculationRequest({ ...own, formula: 'MifflinStJeor' }).bodyFatPercentage).toBeNull();
  });

  it('says nothing about a complete set, and says each missing thing in words', () => {
    expect(problemCount(targetErrors(valid()))).toBe(0);
    const errors = targetErrors(emptyTargets());
    expect(errors.weight).toEqual(['Enter their weight.']);
    expect(errors.height).toEqual(['Enter their height.']);
    expect(errors.age).toEqual(['Enter their age in whole years.']);
    expect(errors.sex).toEqual(['Choose female or male: the formulas ask for one.']);
    expect(errors.work).toEqual(['Choose the kind of work they do.']);
    expect(errors.steps).toEqual(['Enter their steps a day. A rough number is fine.']);
    expect(errors.protein).toEqual(['Enter the grams of protein a day.']);
    expect(errors.goal).toEqual([]);
    expect(errors.fat).toEqual([]);
    expect(errors.bodyFat).toEqual([]);
  });

  it('tells a number outside the server’s limits in the units shown', () => {
    const errors = targetErrors(
      valid({
        weight: 19,
        height: 301,
        age: 17,
        steps: 100_001,
        goal: 2500,
        protein: 700,
        fat: 120,
      }),
    );
    expect(errors.weight).toEqual(['Weight has to be between 20 and 500 kg.']);
    expect(errors.height).toEqual(['Height has to be between 50 and 300 cm.']);
    expect(errors.age).toEqual(['Age has to be between 18 and 120. The formulas are for adults.']);
    expect(errors.steps).toEqual(['Steps a day have to be between 0 and 100,000.']);
    expect(errors.goal).toEqual(['Between −2,000 and +2,000 calories a day.']);
    expect(errors.protein).toEqual(['Protein has to be between 0 and 600 grams.']);
    expect(errors.fat).toEqual(['Fat has to be between 0 and 100 percent of calories.']);
    expect(targetErrors(valid({ age: 29.5 })).age).toEqual(['Enter their age in whole years.']);
    expect(targetErrors(valid({ weight: 20, height: 50, age: 18, steps: 0 })).weight).toEqual([]);
  });

  it('asks for body fat only when the formula that needs it is chosen', () => {
    expect(targetErrors(valid({ formula: 'KatchMcArdle' })).bodyFat).toEqual([
      'This formula needs their body fat.',
    ]);
    expect(targetErrors(valid({ formula: 'KatchMcArdle', bodyFat: 71 })).bodyFat).toEqual([
      'Body fat has to be between 1 and 70 percent.',
    ]);
    expect(targetErrors(valid({ formula: 'KatchMcArdle', bodyFat: 28 })).bodyFat).toEqual([]);
    expect(targetErrors(valid({ formula: 'HarrisBenedictRevised' })).bodyFat).toEqual([]);
  });

  it('starts from what the record knows, saying nothing it does not', () => {
    const starting = {
      weight: { value: 69.4, on: '2026-10-08' },
      height: 168,
      age: 30,
      steps: 8000,
    };
    const first = startingTargets(starting, null);
    expect([first.weight, first.height, first.age, first.steps]).toEqual([69.4, 168, 30, 8000]);
    expect([first.sex, first.work, first.protein]).toEqual([null, null, null]);
    expect([first.goal, first.fat, first.formula]).toEqual([0, 25, 'MifflinStJeor']);

    // The next calculation keeps the coach's own choices, and protein follows the weight.
    const next = startingTargets(starting, mapWorkedOut(calculationRecord()));
    expect([next.sex, next.work, next.goal, next.fat, next.formula]).toEqual([
      'Female',
      'Seated',
      -300,
      25,
      'MifflinStJeor',
    ]);
    expect(next.weight).toBe(69.4);
    expect(next.protein).toBe(139);

    // Today's facts are never filled from an old calculation: a missing one is left to be typed.
    const none = startingTargets(
      { weight: null, height: null, age: null, steps: null },
      mapWorkedOut(calculationRecord()),
    );
    expect([none.weight, none.height, none.age, none.steps]).toEqual([null, null, null, null]);
    expect(none.protein).toBe(140);
  });

  it('counts whole years from a birth date, and not a birthday not yet reached', () => {
    expect(ageOn('1996-04-02', '2026-10-10')).toBe(30);
    expect(ageOn('1996-10-10', '2026-10-10')).toBe(30);
    expect(ageOn('1996-10-11', '2026-10-10')).toBe(29);
    expect(ageOn('2026-10-11', '2026-10-10')).toBeNull();
    expect(ageOn(null, '2026-10-10')).toBeNull();
    expect(ageOn('not a date', '2026-10-10')).toBeNull();
  });

  it('works out grams from grams for each kilogram, and back', () => {
    expect(proteinFor(70, 2)).toBe(140);
    expect(proteinFor(72.4, 1.8)).toBe(130);
    expect(perKilogram(140, 70)).toBe(2);
    expect(perKilogram(145, 72.4)).toBe(2);
    expect(perKilogram(100, 0)).toBeNull();
  });
});

describe('what was worked out', () => {
  it('reads the server’s numbers, whether they arrive as numbers or as text', () => {
    const record = mapWorkedOut(
      calculationRecord({
        result: { ...calculationRecord().result, calorieTarget: '2154.8', proteinGrams: '140' },
      }),
    );
    expect(record).toMatchObject({
      id: 'calc-2',
      calories: 2154.8,
      protein: 140,
      restingNeed: 1444,
      activity: 1.7,
      maintenance: 2454.8,
      goalAdjustment: -300,
      formula: 'MifflinStJeor',
    });
    expect(record.inputs).toEqual({
      formula: 'MifflinStJeor',
      weight: 70,
      height: 168,
      age: 30,
      sex: 'Female',
      bodyFat: null,
      work: 'Seated',
      steps: 8000,
      fatPercent: 25,
    });
  });

  it('lists a result whose numbers could not be read back, without them', () => {
    const record = mapWorkedOut(calculationRecord({ inputs: null }));
    expect(record.inputs).toBeNull();
    expect(record.calories).toBe(2154.8);
  });

  it('gives each macro its share of the calories in whole percents that add up to 100', () => {
    const shares = macroShares(mapWorkedOut(calculationRecord()));
    expect(shares).toEqual({ protein: 26, carbohydrate: 49, fat: 25 });
    expect(shares.protein + shares.carbohydrate + shares.fat).toBe(100);
    for (const record of [earlierRecord(), calculationRecord()]) {
      const parts = macroShares(mapWorkedOut(record));
      expect(parts.protein + parts.carbohydrate + parts.fat).toBe(100);
    }
    expect(macroShares({ protein: 0, carbohydrate: 0, fat: 0 })).toEqual({
      protein: 0,
      carbohydrate: 0,
      fat: 0,
    });
  });

  it('puts the server’s protein warning in words, with the server’s own numbers', () => {
    expect(
      warningWords(
        'Protein is 2.38 g/kg/day, outside the Phase 4 coaching review range of 1.4-2 g/kg/day. This is a warning, not a clinical determination.',
      ),
    ).toBe(
      'Protein works out at 2.38 g for each kilogram a day, outside the usual 1.4 to 2 range. This is a flag for you to look at, not a rule.',
    );
    expect(warningWords('Something else the server said.')).toBe('Something else the server said.');
  });

  it('names the day in the workspace’s time zone, not the browser’s', () => {
    expect(dayInZone('2026-10-10T22:30:00Z', 'Asia/Beirut')).toBe('2026-10-11');
    expect(dayInZone('2026-10-10T22:30:00Z', 'UTC')).toBe('2026-10-10');
    expect(workedOutOn('2026-10-09T08:30:00Z', 'Asia/Beirut', TODAY, LOCALE)).toBe('Fri 9 Oct');
    expect(workedOutOn('2026-10-10T05:00:00Z', 'Asia/Beirut', TODAY, LOCALE)).toBe('today');
  });

  it('writes a calorie change with its sign, and what it came from on one line', () => {
    expect(signedKcal(-300)).toBe('−300');
    expect(signedKcal(250)).toBe('+250');
    expect(signedKcal(0)).toBe('0');
    expect(signedKcal(-1250.4)).toBe('−1,250');
    expect(inputsLine(mapWorkedOut(calculationRecord()).inputs!)).toBe(
      '70 kg, 168 cm, 30 years, female, seated work, 8,000 steps a day',
    );
  });
});

describe('the meal plans', () => {
  it('says whether a plan is running, coming, ended or stopped', () => {
    const state = (start: string, end: string, status: 'Active' | 'Cancelled' = 'Active') =>
      mapPlan(clientPlan({ startDate: start, endDateExclusive: end, status }), TODAY).state;
    expect(state('2026-10-05', '2026-10-19')).toBe('running');
    expect(state('2026-10-10', '2026-10-11')).toBe('running');
    expect(state('2026-10-11', '2026-10-18')).toBe('coming');
    expect(state('2026-10-01', '2026-10-10')).toBe('ended');
    expect(state('2026-10-05', '2026-10-19', 'Cancelled')).toBe('stopped');
  });

  it('keeps the targets the client sees and counts the days it runs', () => {
    const row = mapPlan(clientPlan(), TODAY);
    expect(row).toMatchObject({
      name: 'Spring cut',
      start: '2026-10-05',
      lastDay: '2026-10-18',
      days: 14,
      calories: 2154.8,
      protein: 140,
      calculationId: 'calc-2',
    });
    expect(planDates(row, TODAY, LOCALE)).toBe('Mon 5 Oct – Sun 18 Oct');
    expect(planStateWords(row, TODAY, LOCALE)).toBe('Day 6 of 14');
    expect(
      planStateWords(
        mapPlan(clientPlan({ startDate: '2026-10-12', endDateExclusive: '2026-10-19' }), TODAY),
        TODAY,
        LOCALE,
      ),
    ).toBe('Starts Mon 12 Oct');
  });

  it('puts the running plan in front, then the next coming, and every other newest first', () => {
    const running = mapPlan(clientPlan({ id: 'a' }), TODAY);
    const coming = mapPlan(
      clientPlan({ id: 'b', startDate: '2026-10-19', endDateExclusive: '2026-10-26' }),
      TODAY,
    );
    const ended = mapPlan(
      clientPlan({ id: 'c', startDate: '2026-09-01', endDateExclusive: '2026-09-15' }),
      TODAY,
    );
    const stopped = mapPlan(
      clientPlan({
        id: 'd',
        startDate: '2026-09-20',
        endDateExclusive: '2026-10-04',
        status: 'Cancelled',
      }),
      TODAY,
    );
    const split = splitPlans([ended, coming, stopped, running]);
    expect(split.current?.id).toBe('a');
    expect(split.others.map((row) => row.id)).toEqual(['b', 'd', 'c']);
    // With nothing running, the next one coming leads.
    expect(splitPlans([ended, coming]).current?.id).toBe('b');
    expect(splitPlans([ended, stopped]).current).toBeNull();
    expect(splitPlans([])).toEqual({ current: null, others: [] });
  });

  it('adds days to a calendar day without the browser’s zone', () => {
    expect(addDaysIso('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
    expect(runsWords('2026-10-12', 14, TODAY, LOCALE)).toBe('Runs Mon 12 Oct – Sun 25 Oct');
  });

  it('lists the plans a meal plan may sit under: Nutrition included, not ended or cancelled', () => {
    const covers = nutritionCovers([
      enrollment({ id: 'a', startDate: '2026-07-21', lastActiveDate: '2026-10-12' }),
      enrollment({ id: 'b', features: ['Training'] }),
      enrollment({ id: 'c', storedStatus: 'Cancelled' }),
      enrollment({ id: 'd', storedStatus: 'Expired' }),
      enrollment({ id: 'e', startDate: '2026-10-13', lastActiveDate: '2027-01-04' }),
    ]);
    expect(covers.map((item) => item.id)).toEqual(['a', 'e']);
    expect(covers[0]).toEqual({
      id: 'a',
      label: 'Online Coaching',
      start: '2026-07-21',
      last: '2026-10-12',
    });
  });

  describe('where a meal plan may start', () => {
    const cover = { id: 'e-1', label: 'Online Coaching', start: '2026-07-21', last: '2026-10-28' };
    const running = mapPlan(clientPlan(), TODAY);
    const issue = (start: string, days = 14, covering = cover, plans = [running]) =>
      startIssue(covering, plans, start, days, TODAY, LOCALE, 'Rana');

    it('allows a start inside their Nutrition that overlaps no plan of theirs', () => {
      expect(issue('2026-10-19', 7)).toBeNull();
      // The last day it covers is the last day of the meal plan.
      expect(issue('2026-10-15', 14, cover, [])).toBeNull();
    });

    it('says when the plan would run past the end of their Nutrition, and the latest start', () => {
      expect(issue('2026-10-20', 14, cover, [])).toBe(
        'Rana’s Nutrition covers Tue 21 Jul – Wed 28 Oct, so a 14-day meal plan can start Tue 21 Jul to Thu 15 Oct.',
      );
      expect(issue('2026-07-01', 14, cover, [])).toContain('Nutrition covers');
    });

    it('says when the meal plan is longer than their whole Nutrition', () => {
      expect(issue('2026-10-10', 120, { ...cover, last: '2026-10-28' }, [])).toBe(
        'This meal plan is 120 days long, longer than Rana’s Nutrition (Tue 21 Jul – Wed 28 Oct). Renew their plan first.',
      );
    });

    it('names the plan in the way and the first day free', () => {
      expect(issue('2026-10-15', 7)).toBe(
        'Rana already has Spring cut from Mon 5 Oct to Sun 18 Oct. A new one can start on Mon 19 Oct or later.',
      );
      // A stopped or ended plan frees its days.
      const stopped = mapPlan(clientPlan({ status: 'Cancelled' }), TODAY);
      expect(issue('2026-10-15', 7, cover, [stopped])).toBeNull();
    });

    it('says there is nowhere to assign under when no plan has Nutrition', () => {
      expect(startIssue(null, [], '2026-10-10', 7, TODAY, LOCALE, 'Rana')).toBe(
        'Rana’s plan has no Nutrition to assign this under.',
      );
    });
  });
});

describe('the server’s refusals', () => {
  it('explains a closed feature for each reason', () => {
    expect(nutritionClosed('NoEntitlement', 'Rana')).toBe('Nutrition isn’t part of Rana’s plan.');
    expect(nutritionClosed('Expired', 'Rana')).toBe(
      'Rana’s plan has ended, so their nutrition isn’t shown.',
    );
    expect(nutritionClosed('Paused', 'Rana')).toContain('paused');
    expect(nutritionClosed('PaymentRequired', 'Rana')).toContain('waiting for payment');
    expect(nutritionClosed('NotStarted', 'Rana')).toContain('hasn’t started yet');
    expect(nutritionClosed('RelationshipBlocked', 'Rana')).toBe(
      'You have blocked Rana, so their nutrition isn’t shown.',
    );
    expect(nutritionClosed('Granted', 'Rana')).toBe('Rana’s nutrition isn’t available right now.');
  });

  it('takes .NET’s parameter note off a refusal', () => {
    expect(refusalText("Weight must be between 20 and 500 kg. (Parameter 'input')")).toBe(
      'Weight must be between 20 and 500 kg.',
    );
    expect(refusalText('Nothing to strip.')).toBe('Nothing to strip.');
  });

  it('explains a refused calculation in coach words', () => {
    expect(
      calculationRefusal(
        "Protein and fat calories cannot exceed the calorie target. (Parameter 'input')",
      ),
    ).toContain('Lower the protein');
    expect(calculationRefusal('Katch-McArdle requires a known body-fat percentage.')).toContain(
      'needs their body fat',
    );
    expect(calculationRefusal('Calorie target must be positive.')).toContain('zero or below');
    expect(calculationRefusal('Something unexpected.')).toBe('Something unexpected.');
  });

  it('explains a refused assignment in coach words', () => {
    const window = 'Tue 21 Jul – Wed 28 Oct';
    expect(
      assignRefusal(
        'nutrition_plan_conflict',
        'The plan conflicts with current nutrition state.',
        'Rana',
        window,
      ),
    ).toBe('Rana already has a meal plan on some of these days. Pick a start after it ends.');
    expect(
      assignRefusal(
        null,
        'The entire nutrition plan must remain inside its nutrition entitlement period.',
        'Rana',
        window,
      ),
    ).toBe(
      'That meal plan would run past Rana’s Nutrition (Tue 21 Jul – Wed 28 Oct). Start it earlier, or renew their plan first.',
    );
    expect(
      assignRefusal(null, 'Only a published meal-plan version can be assigned.', 'Rana', window),
    ).toBe('That meal plan is not published, so it cannot be assigned.');
    expect(assignRefusal(null, 'Anything else.', 'Rana', window)).toBe('Anything else.');
  });
});

describe('the allergens', () => {
  it('lists them in the order the screen names them, whatever order the server sent', () => {
    expect(inListOrder(['Milk', 'Peanuts', 'GlutenCereals'])).toEqual([
      'GlutenCereals',
      'Peanuts',
      'Milk',
    ]);
    expect(allergens('Sesame', 'Eggs').codes).toEqual(['Sesame', 'Eggs']);
  });

  it('compares two sets without their order', () => {
    expect(sameAllergens(['Milk', 'Eggs'], ['Eggs', 'Milk'])).toBe(true);
    expect(sameAllergens(['Milk'], ['Milk', 'Eggs'])).toBe(false);
    expect(sameAllergens([], [])).toBe(true);
  });

  it('writes them as a sentence, in lower case after the first', () => {
    expect(allergenList(['Milk', 'Peanuts', 'Crustaceans'])).toBe('Crustaceans, peanuts and milk');
    expect(allergenList(['Eggs'])).toBe('Eggs');
    expect(allergenList([])).toBe('');
    expect(allergenList(['Molluscs'])).toBe('Molluscs');
  });
});
