import { describe, expect, it } from 'vitest';
import {
  finishedProfile,
  halfwayProfile,
  newProfile,
  TODAY,
} from '../../../testing/intake-fixtures';
import {
  allErrors,
  answerRows,
  firstOpenStep,
  followSaved,
  groupTitle,
  hasChanges,
  heightCentimeters,
  isStepDone,
  listWords,
  mergeSteps,
  missingForSetup,
  setupItemLabel,
  stepErrors,
  stepLede,
  stepName,
  toCompleteRequest,
  toUpdateRequest,
  valuesFromProfile,
  weightKilograms,
  type IntakeValues,
} from './intake.models';

const LOCALE = 'en-US';
const DEFAULTS = { today: TODAY, weightUnit: 'Kilogram' } as const;
const STRICT = { today: TODAY, required: true } as const;
const LENIENT = { today: TODAY, required: false } as const;

const blank = () => valuesFromProfile(newProfile(), DEFAULTS);
const finished = () => valuesFromProfile(finishedProfile(), DEFAULTS);
const typed = (patch: Partial<IntakeValues>, base: IntakeValues = finished()): IntakeValues => ({
  ...base,
  ...patch,
});

describe('the boxes of a profile', () => {
  it('starts a new client empty, in centimeters and their own weight unit, weighed today', () => {
    expect(valuesFromProfile(newProfile(), { today: TODAY, weightUnit: 'Pound' })).toEqual({
      firstName: 'Rana',
      lastName: 'Haddad',
      phoneNumber: '',
      birthDate: '',
      birthStatus: 'empty',
      heightValue: null,
      heightUnit: 'Centimeter',
      workType: '',
      averageDailySteps: null,
      goals: '',
      trainingBackground: '',
      foodPreferences: '',
      foodAversions: '',
      allergies: '',
      medications: '',
      previousInjuries: '',
      weightValue: null,
      weightUnit: 'Pound',
      weighedOn: TODAY,
    });
  });

  it('holds what a finished client answered, height in the unit they typed it in', () => {
    const values = valuesFromProfile(
      finishedProfile({
        heightEnteredValue: 66,
        heightEnteredUnit: 'Inch',
        heightCentimeters: 167.64,
      }),
      DEFAULTS,
    );

    expect(values.birthDate).toBe('1996-04-02');
    expect(values.birthStatus).toBe('valid');
    expect(values.heightValue).toBe(66);
    expect(values.heightUnit).toBe('Inch');
    expect(values.averageDailySteps).toBe(6500);
    expect(values.trainingBackground).toBe(
      'Ran on and off for years.\nGym twice a week since January.',
    );
  });
});

describe('what has changed', () => {
  it('ignores a stray space and notices a real change, step by step', () => {
    const saved = finished();

    expect(hasChanges(saved, saved)).toBe(false);
    expect(hasChanges(typed({ goals: '  Run a 10k in under an hour by June.  ' }), saved)).toBe(
      false,
    );
    expect(hasChanges(typed({ goals: 'Run a half marathon.' }), saved)).toBe(true);
    expect(hasChanges(typed({ goals: 'Run a half marathon.' }), saved, ['about'])).toBe(false);
    expect(hasChanges(typed({ goals: 'Run a half marathon.' }), saved, ['goal'])).toBe(true);
  });

  it('counts a half-typed date of birth, a number and the weight as typing', () => {
    const saved = blank();

    expect(hasChanges(typed({ birthStatus: 'incomplete' }, saved), saved, ['about'])).toBe(true);
    expect(hasChanges(typed({ averageDailySteps: 8000 }, saved), saved, ['life'])).toBe(true);
    expect(hasChanges(typed({ weightValue: 70 }, saved), saved, ['start'])).toBe(true);
  });

  it('sends one step’s answers on top of what the server holds, nothing else', () => {
    const saved = finished();
    const typedAll = typed({ goals: 'A new goal.', allergies: 'Shellfish', workType: 'Teacher' });

    const sent = mergeSteps(saved, typedAll, ['goal']);

    expect(sent.goals).toBe('A new goal.');
    expect(sent.allergies).toBe('Peanuts');
    expect(sent.workType).toBe(saved.workType);
  });

  it('lets a fresh profile reach the steps nobody has typed in, and keeps the typing', () => {
    const before = finished();
    const after = typed({ phoneNumber: '+96171000000', allergies: 'Shellfish' }, before);
    const current = typed({ goals: 'Typing right now' }, before);

    const merged = followSaved(current, before, after);

    expect(merged.goals).toBe('Typing right now');
    expect(merged.phoneNumber).toBe('+96171000000');
    expect(merged.allergies).toBe('Shellfish');
  });
});

describe('where a person picks up', () => {
  it('starts a new client at the first step, and a half-done one at the first step not done', () => {
    expect(firstOpenStep(newProfile())).toBe('about');
    expect(firstOpenStep(halfwayProfile())).toBe('life');
    expect(firstOpenStep(halfwayProfile({ workType: 'Teacher' }))).toBe('health');
    expect(firstOpenStep(halfwayProfile({ workType: 'Teacher', allergies: 'None' }))).toBe('start');
    expect(firstOpenStep(newProfile({ birthDate: '1996-04-02' }))).toBe('about');
    expect(firstOpenStep(halfwayProfile({ goals: '   ' }))).toBe('goal');
  });

  it('says a step is done by what the saved profile holds', () => {
    const halfway = halfwayProfile();

    expect(isStepDone('about', halfway)).toBe(true);
    expect(isStepDone('goal', halfway)).toBe(true);
    expect(isStepDone('life', halfway)).toBe(false);
    expect(isStepDone('health', halfway)).toBe(false);
    expect(isStepDone('start', halfway)).toBe(false);
    expect(isStepDone('start', finishedProfile())).toBe(true);
  });

  it('lists what is still needed to finish, and nothing once it is finished', () => {
    expect(missingForSetup(newProfile())).toEqual(['birthDate', 'height', 'goals', 'weight']);
    expect(missingForSetup(halfwayProfile())).toEqual(['weight']);
    expect(missingForSetup(finishedProfile())).toEqual([]);
    expect(missingForSetup(halfwayProfile({ goals: ' ' }))).toEqual(['goals', 'weight']);
    expect(listWords(['date of birth', 'a goal', 'starting weight'], LOCALE)).toBe(
      'date of birth, a goal, and starting weight',
    );
    expect(setupItemLabel('weight')).toBe('starting weight');
  });
});

describe('what each step says', () => {
  it('names a step for the person and for their coach', () => {
    expect(groupTitle('about', { kind: 'self' })).toBe('About you');
    expect(groupTitle('life', { kind: 'self' })).toBe('Your day and food');
    expect(groupTitle('about', { kind: 'client', name: 'Rana' })).toBe('About Rana');
    expect(groupTitle('goal', { kind: 'client', name: 'Rana' })).toBe('Rana’s goal');
    expect(groupTitle('start', { kind: 'client', name: 'Rana' })).toBe('Starting weight');
    expect(stepName('life')).toBe('Day and food');
    expect(stepLede('health')).toContain('Leave a box empty if nothing applies.');
  });
});

describe('checking the first step', () => {
  it('asks for names, the date of birth and the height when they are required', () => {
    const errors = stepErrors('about', typed({ firstName: ' ', lastName: '' }, blank()), STRICT);

    expect(errors['firstName']).toEqual(['Enter a first name.']);
    expect(errors['lastName']).toEqual(['Enter a last name.']);
    expect(errors['birthDate']).toEqual(['Enter a date of birth: day, month and year.']);
    expect(errors['heightValue']).toEqual(['Enter a height.']);
  });

  it('lets a coach save what they know of a client who is still setting up', () => {
    expect(stepErrors('about', blank(), LENIENT)).toEqual({});
    // A half-typed date is wrong whoever types it.
    expect(
      stepErrors('about', typed({ birthStatus: 'incomplete' }, blank()), LENIENT)['birthDate'],
    ).toEqual(['Enter the day, month and year, or leave all three empty.']);
  });

  it('holds the date of birth to an adult of a possible age', () => {
    const born = (birthDate: string) =>
      stepErrors('about', typed({ birthDate, birthStatus: 'valid' }), STRICT)['birthDate'];

    expect(born('2008-10-10')).toBeUndefined();
    expect(born('2008-10-11')).toEqual(['Clients have to be 18 or older.']);
    expect(born('1906-10-10')).toBeUndefined();
    expect(born('1906-10-09')).toEqual(['Check the year: that is more than 120 years ago.']);
    expect(
      stepErrors('about', typed({ birthStatus: 'invalid', birthDate: '' }), STRICT)['birthDate'],
    ).toEqual(['That day does not exist. Check the day and the month.']);
  });

  it('holds the height to the server’s 50 to 300 cm, whichever unit it is typed in', () => {
    const tall = (heightValue: number, heightUnit: 'Centimeter' | 'Inch') =>
      stepErrors('about', typed({ heightValue, heightUnit }), STRICT)['heightValue'];

    expect(tall(50, 'Centimeter')).toBeUndefined();
    expect(tall(300, 'Centimeter')).toBeUndefined();
    expect(tall(49.9, 'Centimeter')).toEqual(['Height has to be between 50 and 300 cm.']);
    expect(tall(301, 'Centimeter')).toEqual(['Height has to be between 50 and 300 cm.']);
    expect(tall(19.7, 'Inch')).toBeUndefined();
    expect(tall(118.1, 'Inch')).toBeUndefined();
    expect(tall(19.68, 'Inch')).toEqual(['Height has to be between 19.7 and 118.1 inches.']);
    expect(tall(118.2, 'Inch')).toEqual(['Height has to be between 19.7 and 118.1 inches.']);
    expect(heightCentimeters(66, 'Inch')).toBeCloseTo(167.64, 2);
  });

  it('keeps names, the phone number and the text within the server’s limits', () => {
    const errors = stepErrors(
      'about',
      typed({ firstName: 'a'.repeat(101), lastName: 'b'.repeat(101), phoneNumber: '7'.repeat(33) }),
      STRICT,
    );

    expect(errors['firstName']).toEqual(['Keep it to 100 characters.']);
    expect(errors['lastName']).toEqual(['Keep it to 100 characters.']);
    expect(errors['phoneNumber']).toEqual(['Keep it to 32 characters.']);
    expect(
      stepErrors('about', typed({ phoneNumber: '7'.repeat(32) }), STRICT)['phoneNumber'],
    ).toBeUndefined();
  });
});

describe('checking the other steps', () => {
  it('asks for a goal only when one is required, and limits the text', () => {
    expect(stepErrors('goal', blank(), STRICT)['goals']).toEqual([
      'Write at least one goal, even a short one.',
    ]);
    expect(stepErrors('goal', blank(), LENIENT)).toEqual({});
    expect(stepErrors('goal', typed({ goals: 'x'.repeat(4001) }), STRICT)['goals']).toEqual([
      'Keep it to 4,000 characters.',
    ]);
    expect(
      stepErrors('goal', typed({ trainingBackground: 'x'.repeat(4001) }), STRICT)[
        'trainingBackground'
      ],
    ).toEqual(['Keep it to 4,000 characters.']);
  });

  it('takes daily steps as a whole number from 0 to 100,000, or nothing', () => {
    const steps = (averageDailySteps: number | null) =>
      stepErrors('life', typed({ averageDailySteps }), STRICT)['averageDailySteps'];

    expect(steps(null)).toBeUndefined();
    expect(steps(0)).toBeUndefined();
    expect(steps(100000)).toBeUndefined();
    expect(steps(100001)).toEqual(['Use a whole number from 0 to 100,000, or leave it empty.']);
    expect(steps(-1)).toEqual(['Use a whole number from 0 to 100,000, or leave it empty.']);
    expect(steps(7.5)).toEqual(['Use a whole number from 0 to 100,000, or leave it empty.']);
    expect(stepErrors('life', typed({ workType: 'w'.repeat(201) }), STRICT)['workType']).toEqual([
      'Keep it to 200 characters.',
    ]);
  });

  it('asks for nothing on the health step but keeps each answer to 4,000 characters', () => {
    expect(stepErrors('health', blank(), STRICT)).toEqual({});
    expect(
      stepErrors('health', typed({ medications: 'm'.repeat(4001) }), STRICT)['medications'],
    ).toEqual(['Keep it to 4,000 characters.']);
  });

  it('asks for the starting weight within 20 to 500 kg, and a real day that has happened', () => {
    const weighed = (patch: Partial<IntakeValues>) => stepErrors('start', typed(patch), STRICT);

    expect(weighed({ weightValue: null })['weightValue']).toEqual(['Enter a weight.']);
    expect(weighed({ weightValue: 70 })).toEqual({});
    expect(weighed({ weightValue: 19.9 })['weightValue']).toEqual([
      'Weight has to be between 20 and 500 kg.',
    ]);
    expect(weighed({ weightValue: 501 })['weightValue']).toEqual([
      'Weight has to be between 20 and 500 kg.',
    ]);
    expect(weighed({ weightValue: 44.1, weightUnit: 'Pound' })['weightValue']).toBeUndefined();
    expect(weighed({ weightValue: 1102.3, weightUnit: 'Pound' })['weightValue']).toBeUndefined();
    expect(weighed({ weightValue: 44, weightUnit: 'Pound' })['weightValue']).toEqual([
      'Weight has to be between 44.1 and 1,102.3 lb.',
    ]);
    expect(weighed({ weightValue: 1102.4, weightUnit: 'Pound' })['weightValue']).toEqual([
      'Weight has to be between 44.1 and 1,102.3 lb.',
    ]);
    expect(weightKilograms(100, 'Pound')).toBeCloseTo(45.359237, 6);

    expect(weighed({ weightValue: 70, weighedOn: TODAY })).toEqual({});
    expect(weighed({ weightValue: 70, weighedOn: '2026-10-11' })['weighedOn']).toEqual([
      'That day has not happened yet. Choose today or an earlier day.',
    ]);
    expect(weighed({ weightValue: 70, weighedOn: '' })['weighedOn']).toEqual([
      'Choose the day you weighed.',
    ]);
  });

  it('checks every step of a sheet or a whole profile at once', () => {
    const errors = allErrors(['about', 'goal'], blank(), STRICT);

    expect(Object.keys(errors).sort()).toEqual(['birthDate', 'goals', 'heightValue']);
  });
});

describe('what is sent', () => {
  it('sends the whole intake with blanks as nothing, names trimmed and the version it read', () => {
    const request = toUpdateRequest(
      typed({
        firstName: ' Rana ',
        phoneNumber: '   ',
        medications: '',
        goals: ' Run a 10k. ',
      }),
      9,
    );

    expect(request).toEqual({
      firstName: 'Rana',
      lastName: 'Haddad',
      phoneNumber: null,
      birthDate: '1996-04-02',
      heightValue: 168,
      heightUnit: 'Centimeter',
      workType: 'Desk job, two days a week on site',
      averageDailySteps: 6500,
      trainingBackground: 'Ran on and off for years.\nGym twice a week since January.',
      foodPreferences: 'Rice, chicken, labneh',
      foodAversions: 'Okra',
      goals: 'Run a 10k.',
      allergies: 'Peanuts',
      medications: null,
      previousInjuries: 'Left knee, 2023',
      version: 9,
    });
  });

  it('sends the height value and unit together or not at all, and no date for an empty one', () => {
    const request = toUpdateRequest(blank(), 4);

    expect(request.heightValue).toBeNull();
    expect(request.heightUnit).toBeNull();
    expect(request.birthDate).toBeNull();
    expect(request.averageDailySteps).toBeNull();
  });

  it('finishes setting up only with a weight, and sends it with its unit and day', () => {
    expect(toCompleteRequest(finished(), 9)).toBeNull();

    const request = toCompleteRequest(
      typed({ weightValue: 154.5, weightUnit: 'Pound', weighedOn: '2026-10-09' }),
      9,
    );

    expect(request).toEqual({
      intake: expect.objectContaining({ firstName: 'Rana', version: 9 }),
      initialBodyweightValue: 154.5,
      initialBodyweightUnit: 'Pound',
      measurementDate: '2026-10-09',
    });
  });
});

describe('the answers as a person reads them', () => {
  it('lists a finished profile in plain words, long answers on their own line', () => {
    const rows = (group: 'about' | 'goal' | 'life' | 'health') =>
      answerRows(finishedProfile(), group, LOCALE).map((row) => [row.label, row.value]);

    expect(rows('about')).toEqual([
      ['Name', 'Rana Haddad'],
      ['Email', 'rana@example.test'],
      ['Phone number', '+96170123456'],
      ['Date of birth', '2 Apr 1996'],
      ['Height', '168 cm'],
    ]);
    expect(rows('life')).toEqual([
      ['Work', 'Desk job, two days a week on site'],
      ['Average daily steps', '6,500'],
      ['Favorite foods', 'Rice, chicken, labneh'],
      ['Foods to avoid', 'Okra'],
    ]);
    expect(rows('health')).toEqual([
      ['Allergies', 'Peanuts'],
      ['Medications', null],
      ['Previous injuries', 'Left knee, 2023'],
    ]);
    expect(answerRows(finishedProfile(), 'goal', LOCALE).map((row) => row.longText)).toEqual([
      true,
      true,
    ]);
    expect(answerRows(finishedProfile(), 'about', LOCALE)[0].longText).toBe(false);
  });

  it('shows a height in the unit it was typed in, and nothing as nothing', () => {
    const inches = answerRows(
      finishedProfile({ heightEnteredValue: 66.5, heightEnteredUnit: 'Inch' }),
      'about',
      LOCALE,
    );

    expect(inches.find((row) => row.key === 'height')?.value).toBe('66.5 in');
    expect(answerRows(newProfile(), 'about', LOCALE).map((row) => row.value)).toEqual([
      'Rana Haddad',
      'rana@example.test',
      null,
      null,
      null,
    ]);
  });
});
