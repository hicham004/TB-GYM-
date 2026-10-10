import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import {
  BENCH,
  DEADLIFT,
  mayaMaxes,
  maxView,
  performance,
  SQUAT,
  squatHistory,
  TODAY,
} from '../../../testing/client-strength-fixtures';
import {
  changeWords,
  groupLifts,
  liftSummary,
  mapMax,
  mapPerformance,
  maxErrors,
  maxProblems,
  recordRefusal,
  recordRequest,
  summarize,
  valueWords,
  type MaxValues,
} from './client-strength.models';

const LOCALE = 'en-US';
const lifts = () => groupLifts(mayaMaxes().map(mapMax));

function values(overrides: Partial<MaxValues> = {}): MaxValues {
  return {
    exerciseId: SQUAT,
    kind: 'CoachWorkingMax',
    value: 100,
    unit: 'Kilogram',
    date: TODAY,
    note: '',
    ...overrides,
  };
}

describe('the maxes on record', () => {
  it('words each max with its kind and where it came from', () => {
    const entries = mayaMaxes().map(mapMax);
    const tested = entries.find((item) => item.id === 'max-tested')!;
    const program = entries.find((item) => item.id === 'max-squat-2')!;

    expect(tested).toMatchObject({ kindLabel: 'Tested 1RM', source: 'Tested', value: 92.5 });
    expect(program).toMatchObject({
      kindLabel: 'Training max',
      source: 'Lean & Strong · Phase 2, from week 1, typed',
      value: 62.5,
    });
  });

  it('reads a max that arrives as text', () => {
    expect(mapMax(maxView({ value: '62.50' })).value).toBe(62.5);
  });

  it('groups the lifts, the one that changed last first', () => {
    expect(lifts().map((lift) => lift.name)).toEqual(['Back Squat', 'Deadlift', 'Bench Press']);
    expect(lifts().map((lift) => lift.exerciseId)).toEqual([SQUAT, DEADLIFT, BENCH]);
  });

  it('headlines a lift by its training max, with the tested max beside it', () => {
    const squat = lifts()[0];

    expect(squat.latest).toMatchObject({ id: 'max-squat-2', value: 62.5, kind: 'CoachWorkingMax' });
    expect(squat.also.map((item) => [item.kindLabel, item.value])).toEqual([['Tested 1RM', 92.5]]);
    expect(squat.entries.map((item) => item.id)).toEqual([
      'max-tested',
      'max-squat-2',
      'max-squat-1',
    ]);
    expect(squat.previous?.value).toBe(60);
    expect(squat.series).toEqual([60, 62.5]);
  });

  it('falls back to the newest max of any kind when a lift has no training max', () => {
    const only = groupLifts([
      mapMax(
        maxView({ id: 'a', kind: 'TestedOneRepMax', value: 100, effectiveDate: '2026-09-01' }),
      ),
      mapMax(
        maxView({ id: 'b', kind: 'EstimatedOneRepMax', value: 95, effectiveDate: '2026-10-01' }),
      ),
    ]);
    expect(only[0].latest.id).toBe('b');
    expect(only[0].also.map((item) => item.id)).toEqual(['a']);
    expect(only[0].series).toBeNull();
  });

  it('draws no line, and compares nothing, across two units', () => {
    const mixed = groupLifts([
      mapMax(maxView({ id: 'a', value: 135, unit: 'Pound', effectiveDate: '2026-09-01' })),
      mapMax(maxView({ id: 'b', value: 62.5, unit: 'Kilogram', effectiveDate: '2026-10-01' })),
    ])[0];
    expect(mixed.series).toBeNull();
    expect(mixed.previous).toBeNull();
    expect(changeWords(mixed, TODAY, LOCALE)).toBeNull();
  });

  it('breaks a tie on the day by when each was recorded', () => {
    const tie = groupLifts([
      mapMax(maxView({ id: 'a', value: 60, createdAtUtc: '2026-09-15T08:00:00Z' })),
      mapMax(maxView({ id: 'b', value: 65, createdAtUtc: '2026-09-15T09:00:00Z' })),
    ])[0];
    expect(tie.latest.id).toBe('b');
    expect(tie.previous?.id).toBe('a');
  });

  it('says how a lift has moved, in the unit it is kept in', () => {
    const [squat, deadlift, bench] = lifts();
    expect(changeWords(squat, TODAY, LOCALE)).toBe('+2.5 kg since Wed 5 Aug');
    expect(changeWords(bench, TODAY, LOCALE)).toBe('+2.5 kg since Wed 5 Aug');
    expect(changeWords(deadlift, TODAY, LOCALE)).toBeNull();

    const down = groupLifts([
      mapMax(maxView({ id: 'a', value: 70, effectiveDate: '2026-09-01' })),
      mapMax(maxView({ id: 'b', value: 65, effectiveDate: '2026-10-01' })),
    ])[0];
    expect(changeWords(down, TODAY, LOCALE)).toBe('−5 kg since Tue 1 Sep');
    const same = groupLifts([
      mapMax(maxView({ id: 'a', value: 70, effectiveDate: '2026-09-01' })),
      mapMax(maxView({ id: 'b', value: 70, effectiveDate: '2026-10-01' })),
    ])[0];
    expect(changeWords(same, TODAY, LOCALE)).toBe('Unchanged since Tue 1 Sep');
  });

  it('describes the chart in words for anyone who cannot see it', () => {
    const [squat, deadlift] = lifts();
    expect(liftSummary(squat, TODAY, LOCALE)).toBe(
      'Back Squat Training max has moved from 60 kg on Wed 5 Aug to 62.5 kg.',
    );
    expect(liftSummary(deadlift, TODAY, LOCALE)).toBe('Deadlift Training max is 77.5 kg.');
  });

  it('writes a load with its unit and no more decimals than two', () => {
    expect(valueWords(62.5, 'Kilogram')).toBe('62.5 kg');
    expect(valueWords(135, 'Pound')).toBe('135 lb');
    expect(valueWords(62.125, 'Kilogram')).toBe('62.13 kg');
  });
});

describe('recording a max', () => {
  it('asks for nothing it does not need, and says what is missing in words', () => {
    expect(maxProblems(maxErrors(values(), TODAY))).toBe(0);
    const errors = maxErrors(values({ exerciseId: null, value: null, date: '' }), TODAY);
    expect(errors.exercise).toEqual(['Choose the exercise.']);
    expect(errors.value).toEqual(['Enter the weight.']);
    expect(errors.date).toEqual(['Choose the day it was true.']);
  });

  it('tells the server’s limit in the unit chosen', () => {
    expect(maxErrors(values({ value: 0 }), TODAY).value).toEqual([
      'A max has to be more than 0 and at most 2,000 kg.',
    ]);
    expect(maxErrors(values({ value: 2001, unit: 'Pound' }), TODAY).value).toEqual([
      'A max has to be more than 0 and at most 2,000 lb.',
    ]);
    expect(maxErrors(values({ value: 2000 }), TODAY).value).toEqual([]);
  });

  it('records a number for today or a day gone, never one to come', () => {
    expect(maxErrors(values({ date: '2026-10-11' }), TODAY).date).toEqual([
      'A max can be recorded for today or a day that has passed.',
    ]);
    expect(maxErrors(values({ date: TODAY }), TODAY).date).toEqual([]);
  });

  it('sends a coach’s entry, leaving its method to the server', () => {
    expect(recordRequest(values({ kind: 'TestedOneRepMax', note: '  Felt heavy.  ' }))).toEqual({
      exerciseId: SQUAT,
      kind: 'TestedOneRepMax',
      value: 100,
      unit: 'Kilogram',
      effectiveDate: TODAY,
      source: 'Manual',
      methodKey: null,
      methodVersion: null,
      sourceWorkoutExecutionId: null,
      note: 'Felt heavy.',
    });
    expect(recordRequest(values()).note).toBeNull();
  });

  it('explains a refusal, and falls back when it is not one', () => {
    const fallback = 'Try again.';
    expect(recordRefusal(new HttpErrorResponse({ status: 404 }), fallback)).toContain(
      'no longer in your library',
    );
    expect(
      recordRefusal(
        new HttpErrorResponse({
          status: 400,
          error: {
            errors: {
              max: ["Load must be greater than zero and at most 2,000. (Parameter 'value')"],
            },
          },
        }),
        fallback,
      ),
    ).toBe('A max has to be more than 0 and at most 2,000.');
    expect(
      recordRefusal(
        new HttpErrorResponse({
          status: 400,
          error: { errors: { max: ["Something odd. (Parameter 'x')"] } },
        }),
        fallback,
      ),
    ).toBe('Something odd.');
    expect(recordRefusal(new HttpErrorResponse({ status: 500 }), fallback)).toBe(fallback);
    expect(recordRefusal(new Error('x'), fallback)).toBe(fallback);
  });
});

describe('how they have performed one exercise', () => {
  const rows = () => squatHistory().items.map(mapPerformance);

  it('words each set with its load, effort and estimated max', () => {
    const [top, , substituted, bodyweight] = rows();

    expect(top).toMatchObject({
      date: '2026-10-08',
      set: '60 kg × 5',
      effort: 'RPE 8',
      estimate: 70,
      volume: 300,
      note: 'Felt fast.',
      substituted: false,
    });
    expect(substituted.substituted).toBe(true);
    expect(bodyweight).toMatchObject({ set: '8 reps', effort: 'RIR 2', estimate: null });
    expect(
      mapPerformance(performance('2026-10-01', null, null, null, { rpe: null }), 9),
    ).toMatchObject({
      set: '—',
      effort: null,
    });
  });

  it('finds the best estimated max and draws the others oldest first', () => {
    expect(summarize(rows())).toEqual({
      best: { value: 70, unit: 'Kilogram', date: '2026-10-08' },
      series: [65.5, 67.1, 70],
      last: '2026-10-08',
      count: 4,
    });
  });

  it('draws nothing when there are fewer than two estimates, or two units', () => {
    expect(summarize(rows().slice(0, 1)).series).toBeNull();
    const mixed = [
      ...rows(),
      mapPerformance(performance('2026-09-01', 135, 5, 160, { loadUnit: 'Pound' }), 7),
    ];
    const summary = summarize(mixed);
    expect(summary.series).toBeNull();
    expect(summary.best).toEqual({ value: 70, unit: 'Kilogram', date: '2026-10-08' });
  });

  it('says nothing for an exercise that was never done', () => {
    expect(summarize([])).toEqual({ best: null, series: null, last: null, count: 0 });
  });
});
