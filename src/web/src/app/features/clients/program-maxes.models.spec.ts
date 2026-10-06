import { describe, expect, it } from 'vitest';
import type {
  ProgramTemplateVersionView,
  TrainingMaxesPreviewView,
  TrainingMaxesView,
} from '../../core/api/generated';
import {
  changesRequest,
  chartCovers,
  editErrors,
  editRows,
  maxCards,
  previewSummary,
  reasonErrors,
  sourceWords,
  weekOneAnchor,
  withValue,
  withWeekOneWeight,
} from './program-maxes.models';

const entry = (fields: Record<string, unknown>) => ({
  id: 'max-1',
  value: 100,
  unit: 'Kilogram',
  source: 'SavedMax',
  basis: null,
  effectiveFromWeek: 1,
  setOn: '2026-10-03',
  reason: 'Assignment training max.',
  ...fields,
});

function view(lifts: object[] = [], fields: Record<string, unknown> = {}): TrainingMaxesView {
  return {
    mesocycleId: 'block-1',
    version: 4,
    loadUnit: 'Kilogram',
    isClosed: false,
    maxes: lifts,
    ...fields,
  } as unknown as TrainingMaxesView;
}

const squat = (fields: Record<string, unknown> = {}) => ({
  exerciseId: 'squat',
  exerciseName: 'Back squat',
  current: entry({}),
  weekOneSet: { repetitions: 5, rpe: 8, load: 80 },
  earlier: [],
  ...fields,
});

describe('the panel’s lifts', () => {
  it('says each max with its source and the day it was set, never a system word', () => {
    const [card] = maxCards(view([squat()]), 'Maya', 'en-US');

    expect(card).toMatchObject({
      name: 'Back squat',
      value: '100 kg',
      source: 'From Maya’s recorded max · Sat 3 Oct',
      basis: null,
      change: null,
      appliesFrom: null,
      earlier: [],
    });
    expect(sourceWords(entry({ source: 'Typed' }) as never, 'Maya')).toBe('Typed by you');
    expect(sourceWords(entry({ source: 'WeekOneWeight' }) as never, 'Maya')).toBe(
      'Worked out from week 1’s weight',
    );
  });

  it('keeps the older maxes, newest first, and says how the number moved', () => {
    const [card] = maxCards(
      view([
        squat({
          current: entry({
            id: 'max-3',
            value: 120,
            source: 'Typed',
            effectiveFromWeek: 3,
            setOn: '2026-10-20',
            reason: 'New test result',
          }),
          earlier: [
            entry({ id: 'max-2', value: 110, source: 'Typed', setOn: '2026-10-12' }),
            entry({ id: 'max-1' }),
          ],
        }),
      ]),
      'Maya',
      'en-US',
    );

    expect(card.value).toBe('120 kg');
    expect(card.change).toBe('Up 10 kg from 110 kg');
    expect(card.appliesFrom).toBe('Applies from week 3. Earlier weeks keep 110 kg.');
    // The oldest is told as what it was, whatever the engine wrote beside it; the later keeps the coach's words.
    expect(card.earlier.map((row) => [row.value, row.words, row.reason])).toEqual([
      ['110 kg', 'Typed by you · Mon 12 Oct', 'Assignment training max.'],
      ['100 kg', 'From Maya’s recorded max · Sat 3 Oct', 'When the program was assigned'],
    ]);
  });

  it('says a lower max went down, in the unit it was set in, and tells where week 1’s weight came from', () => {
    const [card] = maxCards(
      view([
        squat({
          current: entry({
            id: 'max-2',
            value: 220.5,
            unit: 'Pound',
            source: 'WeekOneWeight',
            basis: {
              load: 175,
              repetitions: 5,
              rpe: 7.5,
              methodKey: 'RpeChart',
              methodVersion: '1.0',
            },
          }),
          earlier: [entry({ value: 225, unit: 'Pound' })],
        }),
      ]),
      'Maya',
      'en-US',
    );

    expect(card.value).toBe('220.5 lb');
    expect(card.change).toBe('Down 4.5 lb from 225 lb');
    expect(card.basis).toBe('175 lb for 5 reps at RPE 7.5 in week 1');
  });
});

describe('updating the maxes', () => {
  const rows = () =>
    editRows(
      view([
        squat(),
        squat({ exerciseId: 'bench', exerciseName: 'Bench press', weekOneSet: null }),
      ]),
    );

  it('starts with nothing changed, and says the one thing to do', () => {
    expect(
      rows().map((row) => [row.exerciseId, row.current, row.value, row.weekOneWeight]),
    ).toEqual([
      ['squat', 100, null, null],
      ['bench', 100, null, null],
    ]);
    expect(rows()[1].weekOneSet).toBeNull();
    expect(editErrors(rows())).toEqual({ form: ['Change at least one training max.'] });
    // Typing the number already in use is not a change.
    expect(editErrors([withValue(rows()[0], 100), rows()[1]])).toEqual({
      form: ['Change at least one training max.'],
    });
  });

  it('sends only the lifts that change, a typed number or week 1’s weight, never both', () => {
    const [first, second] = rows();
    const typed = withValue(first, 120);
    const worked = withWeekOneWeight(second, 105);

    expect(changesRequest([typed, rows()[1]])).toEqual([
      { exerciseId: 'squat', value: 120, weekOneWeight: null },
    ]);
    expect(changesRequest([typed, worked])).toEqual([
      { exerciseId: 'squat', value: 120, weekOneWeight: null },
      { exerciseId: 'bench', value: null, weekOneWeight: 105 },
    ]);
    // Typing one clears the other, so both can never be sent for a lift.
    expect(withWeekOneWeight(typed, 110)).toMatchObject({ value: null, weekOneWeight: 110 });
    expect(withValue(withWeekOneWeight(first, 110), 125)).toMatchObject({
      value: 125,
      weekOneWeight: null,
    });
    // Emptying a field leaves the other as it was.
    expect(withValue(withWeekOneWeight(first, 110), null)).toMatchObject({ weekOneWeight: 110 });
  });

  it('refuses a number that is zero or too big, field by field', () => {
    const [first, second] = rows();

    expect(editErrors([withValue(first, 0), second])).toEqual({
      'max:squat': ['Enter a number above 0, up to 2000.'],
    });
    expect(editErrors([withValue(first, 2001), second])).toEqual({
      'max:squat': ['Enter a number above 0, up to 2000.'],
    });
    expect(editErrors([withWeekOneWeight(first, -5), second])).toEqual({
      'week1:squat': ['Enter a weight above 0, up to 2000.'],
    });
    expect(editErrors([withValue(first, 120), second])).toEqual({});
    expect(editErrors([first, withWeekOneWeight(second, 90)])).toEqual({});
  });

  it('keeps the reason within its limit', () => {
    expect(reasonErrors('New test result')).toEqual([]);
    expect(reasonErrors('x'.repeat(501))).toEqual(['Keep the reason to 500 characters or fewer.']);
  });
});

describe('what an update would change', () => {
  const set = (fields: Record<string, unknown>) => ({
    setId: 'set-1',
    weekNumber: 2,
    scheduledDate: '2026-10-12',
    sessionId: 'session-2',
    sessionName: 'Lower A',
    exerciseId: 'squat',
    exerciseName: 'Back squat',
    setPosition: 0,
    repetitions: 5,
    targetRpe: 8,
    percentageWorkingMax: null,
    previousLoad: 80,
    newLoad: 97.5,
    explanation: 'WorkingMaxLoad v2: 120 kg / (1 + (5 reps + 2 in reserve) / 30) = 97.297 kg.',
    ...fields,
  });

  const preview = (fields: Record<string, unknown> = {}): TrainingMaxesPreviewView =>
    ({
      previewHash: 'hash-1',
      loadUnit: 'Kilogram',
      effectiveFromWeek: 2,
      lifts: [
        {
          exerciseId: 'squat',
          exerciseName: 'Back squat',
          previousValue: 100,
          newValue: 120,
          unit: 'Kilogram',
          source: 'Typed',
          basis: null,
          explanation: 'Typed by the coach: 120 kg.',
        },
      ],
      sets: [
        set({}),
        set({
          setId: 'set-2',
          setPosition: 1,
          previousLoad: 82.5,
          newLoad: 80,
          percentageWorkingMax: 70,
          targetRpe: null,
        }),
        set({ setId: 'set-3', weekNumber: 3, scheduledDate: '2026-10-19', sessionId: 'session-3' }),
      ],
      changedSetCount: 3,
      unchangedSetCount: 0,
      sessionCount: 2,
      keptSessionCount: 1,
      ...fields,
    }) as unknown as TrainingMaxesPreviewView;

  it('groups the weights by week, day and lift, each with where it came from', () => {
    const shown = previewSummary(preview(), 'en-US');

    expect(shown.lifts).toEqual([
      {
        id: 'squat',
        name: 'Back squat',
        change: '100 kg to 120 kg',
        explanation: 'Typed by the coach: 120 kg.',
      },
    ]);
    expect(shown.weeks.map((week) => [week.title, week.sessions.map((s) => s.title)])).toEqual([
      ['Week 2', ['Mon 12 Oct · Lower A']],
      ['Week 3', ['Mon 19 Oct · Lower A']],
    ]);
    const lines = shown.weeks[0].sessions[0].exercises[0];
    expect(lines.name).toBe('Back squat');
    expect(lines.sets.map((line) => [line.label, line.to, line.from, line.delta])).toEqual([
      ['Set 1 · 5 reps · RPE 8', '97.5 kg', '80 kg', '+17.5 kg'],
      ['Set 2 · 5 reps · 70% of the max', '80 kg', '82.5 kg', '−2.5 kg'],
    ]);
    expect(lines.sets[0].explanation).toContain('97.297 kg');
  });

  it('counts what changes and what is kept, in the singular too', () => {
    expect(previewSummary(preview(), 'en-US')).toMatchObject({
      counts: '3 weights change in 2 sessions.',
      kept: '1 session has started or is already past, so it keeps its weights.',
      appliesFrom: 'The new max applies from week 2.',
      changedSets: 3,
    });
    expect(
      previewSummary(
        preview({ changedSetCount: 1, unchangedSetCount: 2, sessionCount: 1, keptSessionCount: 3 }),
        'en-US',
      ),
    ).toMatchObject({
      counts: '1 weight changes in 1 session. 2 more stay the same once rounded.',
      kept: '3 sessions have started or are already past, so they keep their weights.',
    });
    expect(previewSummary(preview({ keptSessionCount: 0 }), 'en-US').kept).toBeNull();
  });

  it('says plainly when no weight changes yet', () => {
    expect(
      previewSummary(preview({ sets: [], changedSetCount: 0, sessionCount: 0 }), 'en-US').counts,
    ).toBe(
      'No session still to come uses this max, so no weight changes now. The new max is kept for weeks you add later.',
    );
    expect(
      previewSummary(preview({ sets: [], changedSetCount: 0, sessionCount: 2 }), 'en-US').counts,
    ).toBe('Once rounded, the new max gives the same weights as before.');
  });
});

describe('week 1’s weight before the program exists', () => {
  it('covers what the RTS chart covers: 1 to 12 reps at RPE 6.5 to 10 in half steps', () => {
    expect(chartCovers(5, 7)).toBe(true);
    expect(chartCovers(1, 10)).toBe(true);
    expect(chartCovers(12, 6.5)).toBe(true);
    expect(chartCovers(13, 8)).toBe(false);
    expect(chartCovers(0, 8)).toBe(false);
    expect(chartCovers(5, 6)).toBe(false);
    expect(chartCovers(5, 7.25)).toBe(false);
    expect(chartCovers(2.5, 8)).toBe(false);
  });

  const version = (weeks: object[]) => ({ weeks }) as unknown as ProgramTemplateVersionView;
  const week = (number: number, sessions: object[]) => ({ weekNumber: number, sessions });
  const day = (dayOffset: number, sets: object[], exerciseId = 'squat', position = 1) => ({
    dayOffset,
    exercises: [{ exerciseId, position, sets }],
  });
  const set = (position: number, fields: object = {}) => ({
    position,
    setType: 'Normal',
    repetitionsMaximum: 5,
    targetRpe: 7,
    ...fields,
  });

  it('reads week 1 only, the earliest day first, and skips warm-ups and sets without reps or RPE', () => {
    expect(
      weekOneAnchor(
        version([
          week(2, [day(0, [set(1, { repetitionsMaximum: 3, targetRpe: 9 })])]),
          week(1, [
            day(3, [set(1, { repetitionsMaximum: 8, targetRpe: 8 })]),
            day(0, [
              set(1, { setType: 'WarmUp' }),
              set(2, { targetRpe: null }),
              set(3, { repetitionsMaximum: null }),
              set(4, { repetitionsMaximum: 4, targetRpe: 8.5 }),
            ]),
          ]),
        ]),
        'squat',
      ),
    ).toEqual({ repetitions: 4, rpe: 8.5 });
  });

  it('has none for a lift week 1 does not train, or trains outside the chart', () => {
    expect(weekOneAnchor(version([week(1, [day(0, [set(1)])])]), 'bench')).toBeNull();
    expect(
      weekOneAnchor(version([week(1, [day(0, [set(1, { targetRpe: 6 })])])]), 'squat'),
    ).toBeNull();
    expect(weekOneAnchor(version([]), 'squat')).toBeNull();
  });
});
