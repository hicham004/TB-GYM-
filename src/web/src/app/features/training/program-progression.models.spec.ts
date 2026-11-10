import { describe, expect, it } from 'vitest';
import type { WeekProgressionPreviewView } from '../../core/api/generated';
import {
  copiesThatFit,
  impossiblePercentage,
  insertProgression,
  isRpeLoaded,
  MAX_COPIES,
  MAX_WEEKS,
  outsideChartCount,
  programFormula,
  progressionReach,
  progressionRequest,
  rpeLoadedSetCount,
  setIssue,
  setSummary,
  setWayOuts,
  takeWayOut,
  withProgramFormula,
} from './program-builder.models';
import {
  type DraftSet,
  emptyExercise,
  emptyProgram,
  emptySet,
  emptyWeek,
  type ProgramDraft,
  toWeekRequest,
} from './training-builder.models';

function set(overrides: Partial<DraftSet> = {}): DraftSet {
  return { ...emptySet(), ...overrides };
}

/** One week, one session, one exercise holding these sets. */
function draftWith(...sets: DraftSet[]): ProgramDraft {
  const draft = emptyProgram();
  const exercise = emptyExercise('squat', true, 'Back squat');
  exercise.sets = sets;
  draft.weeks[0].sessions[0].exercises = [exercise];
  draft.weeks[0].label = 'Week 1';
  return draft;
}

const chartSet = (overrides: Partial<DraftSet> = {}) =>
  set({ loadStrategy: 'RpeChart', exertionTarget: 7, repetitionsMaximum: 5, ...overrides });

describe('the RTS chart in the builder', () => {
  it('flags a chart set the chart cannot cover, in RPE or RIR, and leaves the Epley curve alone', () => {
    expect(setIssue(chartSet({ exertionTarget: 6 }))?.field).toBe('exertionTarget');
    expect(setIssue(chartSet({ exertionTarget: 6 }))?.message).toContain('RPE 6.5');
    expect(setIssue(chartSet({ exertionTarget: 6.5 }))).toBeNull();
    expect(setIssue(chartSet({ repetitionsMaximum: 13 }))?.field).toBe('repetitionsMaximum');
    expect(setIssue(chartSet({ repetitionsMaximum: 12 }))).toBeNull();
    // RIR 4 is RPE 6, and RIR 3 is RPE 7.
    const rir = { exertionDisplayPreference: 'Rir' as const };
    expect(setIssue(chartSet({ ...rir, exertionTarget: 4 }))?.field).toBe('exertionTarget');
    expect(setIssue(chartSet({ ...rir, exertionTarget: 3 }))).toBeNull();
    expect(setIssue(chartSet({ exertionTarget: null }))?.field).toBe('exertionTarget');

    // The Epley curve keeps its own rule: reps plus RIR up to 12, from RPE 5.
    const epley = set({
      loadStrategy: 'RpeBasedEpley',
      repetitionsMaximum: 10,
      exertionTarget: 7.5,
    });
    expect(setIssue(epley)?.field).toBe('repetitionsMaximum');
    expect(setIssue({ ...epley, exertionTarget: 8 })).toBeNull();
    expect(setIssue({ ...epley, exertionTarget: 5, repetitionsMaximum: 6 })).toBeNull();
  });

  it('summarises a chart set with the chart’s share of the training max, never a weight', () => {
    // 5 reps at RPE 7 is 78.6% on the chart, said in whole percents after the effort it comes from.
    expect(setSummary(chartSet())).toBe('5 · RPE 7 · 79% of training max');
    expect(setSummary(chartSet({ exertionTarget: 8 }))).toBe('5 · RPE 8 · 81% of training max');
    // A range takes its top reps, as the server works the weight out: 10 at RPE 8 is 68%.
    expect(
      setSummary(chartSet({ repetitionsMinimum: 8, repetitionsMaximum: 10, exertionTarget: 8 })),
    ).toBe('8–10 · RPE 8 · 68% of training max');
    // RIR 2 is RPE 8.
    expect(setSummary(chartSet({ exertionDisplayPreference: 'Rir', exertionTarget: 2 }))).toBe(
      '5 · RIR 2 · 81% of training max',
    );
    expect(setSummary(chartSet({ exertionTarget: 6 }))).toBe('5 · RPE 6 · outside the RTS chart');
    expect(setSummary(chartSet({ exertionTarget: null }))).toBe('5 · Load from RTS chart & effort');
  });

  it('summarises an Epley set with the curve’s share of the training max, never a weight', () => {
    const epley = (overrides: Partial<DraftSet> = {}) =>
      chartSet({ loadStrategy: 'RpeBasedEpley', ...overrides });
    // 5 reps plus 3 in reserve is 8 along the curve: 78.9%.
    expect(setSummary(epley())).toBe('5 · RPE 7 · 79% of training max');
    expect(setSummary(epley({ exertionTarget: 8 }))).toBe('5 · RPE 8 · 81% of training max');
    // A range takes its top reps, as the server works the weight out.
    expect(
      setSummary(epley({ repetitionsMinimum: 8, repetitionsMaximum: 10, exertionTarget: 8 })),
    ).toBe('8–10 · RPE 8 · 71% of training max');
    // The chart stops at RPE 6.5; the curve goes on while reps plus reserve fit.
    expect(setSummary(epley({ exertionTarget: 5 }))).toBe('5 · RPE 5 · 75% of training max');
    expect(
      setSummary(epley({ repetitionsMinimum: 8, repetitionsMaximum: 8, exertionTarget: 5 })),
    ).toBe('8 · RPE 5 · outside the Epley curve');
  });

  it('says why a formula refuses a set, and offers ways out that keep its reps', () => {
    // Too far from failure for the chart: the Epley curve takes it while reps plus RIR fit.
    expect(setIssue(chartSet({ exertionTarget: 6 }))).toEqual({
      field: 'exertionTarget',
      limit: 'chartEffort',
      message:
        'the RTS chart starts at RPE 6.5 (RIR 3.5): four or more reps from failure, its percentages no longer hold.',
    });
    expect(setWayOuts(chartSet({ exertionTarget: 6 }))).toEqual(['epley', 'direct']);
    expect(
      setWayOuts(chartSet({ exertionTarget: 5, repetitionsMinimum: 10, repetitionsMaximum: 10 })),
    ).toEqual(['direct', 'none']);

    // Past 12 reps the formulas stop; 20-rep sets stay possible by a %, a typed weight or the client.
    const twenty = chartSet({ repetitionsMinimum: 20, repetitionsMaximum: 20, exertionTarget: 8 });
    expect(setIssue(twenty)).toEqual({
      field: 'repetitionsMaximum',
      limit: 'chartReps',
      message: 'the formulas stop at 12 reps, so the RTS chart has no weight for 20 reps.',
    });
    expect(setWayOuts(twenty)).toEqual(['percentage', 'direct', 'none']);

    // The Epley curve counts the reps in reserve; the chart takes 10 at RPE 6.5 where it cannot.
    const epley = set({
      loadStrategy: 'RpeBasedEpley',
      repetitionsMinimum: 10,
      repetitionsMaximum: 10,
      exertionTarget: 6.5,
    });
    expect(setIssue(epley)?.message).toBe(
      'the formulas stop at 12 reps, and the Epley curve counts the reps left in reserve too: 10 + 3.5 = 13.5.',
    );
    expect(setWayOuts(epley)).toEqual(['chart', 'percentage', 'direct', 'none']);
    expect(setWayOuts({ ...epley, exertionTarget: 6 })).toEqual(['percentage', 'direct', 'none']);

    // Nothing is offered for any other problem, or a set with none.
    expect(setWayOuts(chartSet({ exertionTarget: null }))).toEqual([]);
    expect(setWayOuts(chartSet())).toEqual([]);
  });

  it('takes a way out by moving only where the weight comes from', () => {
    const twenty = chartSet({ repetitionsMinimum: 20, repetitionsMaximum: 20, exertionTarget: 8 });
    for (const [way, strategy] of [
      ['percentage', 'PercentageWorkingMax'],
      ['direct', 'Direct'],
      ['none', 'None'],
    ] as const) {
      const taken = { ...twenty };
      takeWayOut(taken, way);
      expect(taken.loadStrategy).toBe(strategy);
      expect([taken.repetitionsMinimum, taken.repetitionsMaximum, taken.exertionTarget]).toEqual([
        20, 20, 8,
      ]);
    }
    const none = { ...twenty };
    takeWayOut(none, 'none');
    expect(setIssue(none)).toBeNull();
    const epley = chartSet({ exertionTarget: 6 });
    takeWayOut(epley, 'epley');
    expect(epley.loadStrategy).toBe('RpeBasedEpley');
    expect(setIssue(epley)).toBeNull();
  });
});

describe('a % set the chart says cannot be done', () => {
  const percent = (overrides: Partial<DraftSet>) =>
    set({
      loadStrategy: 'PercentageWorkingMax',
      loadValue: 85,
      repetitionsMinimum: 10,
      repetitionsMaximum: 10,
      ...overrides,
    });

  it('warns past the chart’s RPE 10 cell for its fewest reps, and only then', () => {
    expect(impossiblePercentage(percent({}))).toBe(
      '85% × 10 reps is heavier than the chart allows for 10 reps (74%). Most lifters can’t do it.',
    );
    // A range is possible when its fewest reps are: 8 at RPE 10 is 78.6%.
    expect(impossiblePercentage(percent({ repetitionsMinimum: 8, repetitionsMaximum: 12 }))).toBe(
      '85% × 8–12 reps is heavier than the chart allows for 8 reps (79%). Most lifters can’t do it.',
    );
    expect(impossiblePercentage(percent({ loadValue: 70 }))).toBeNull();
    // 5 at RPE 10 is 86.3%, so 85% × 5–12 can be done at its low end.
    expect(
      impossiblePercentage(percent({ repetitionsMinimum: 5, repetitionsMaximum: 12 })),
    ).toBeNull();
    // The share is read as the sentence says it: 74% is not past the chart's 73.9%.
    expect(impossiblePercentage(percent({ loadValue: 74 }))).toBeNull();
    expect(impossiblePercentage(percent({ loadValue: 74.5 }))).toContain('(74%)');
  });

  it('bounds sets past 12 reps by the chart’s last column, and a single by 100%', () => {
    expect(
      impossiblePercentage(
        percent({ loadValue: 70, repetitionsMinimum: 15, repetitionsMaximum: 20 }),
      ),
    ).toBe(
      '70% × 15–20 reps is heavier than the chart allows even for 12 reps (68%). Most lifters can’t do it.',
    );
    expect(
      impossiblePercentage(
        percent({ loadValue: 65, repetitionsMinimum: 20, repetitionsMaximum: 20 }),
      ),
    ).toBeNull();
    expect(impossiblePercentage(percent({ loadValue: 105, repetitionsMinimum: null }))).toBe(
      '105% × up to 10 reps is heavier than the chart allows for 1 rep (100%). Most lifters can’t do it.',
    );
  });

  it('never ties the % to the set’s RPE, and leaves every other set alone', () => {
    expect(impossiblePercentage(percent({ exertionTarget: 6 }))).toBe(
      impossiblePercentage(percent({ exertionTarget: 10 })),
    );
    expect(impossiblePercentage(percent({ manualLoadOverride: 60 }))).toBeNull();
    expect(impossiblePercentage(percent({ loadValue: null }))).toBeNull();
    expect(
      impossiblePercentage(percent({ repetitionsMinimum: null, repetitionsMaximum: null })),
    ).toBeNull();
    expect(impossiblePercentage(chartSet({ exertionTarget: 10 }))).toBeNull();
    expect(impossiblePercentage(set({ loadStrategy: 'Direct', loadValue: 200 }))).toBeNull();
  });
});

describe('the formula a program uses for loads from RPE', () => {
  it('reads one formula, a mixture, or none', () => {
    expect(
      programFormula(draftWith(set(), set({ loadStrategy: 'Direct', loadValue: 100 }))),
    ).toBeNull();
    expect(programFormula(draftWith(chartSet(), chartSet()))).toBe('RpeChart');
    expect(programFormula(draftWith(set({ loadStrategy: 'RpeBasedEpley' })))).toBe('RpeBasedEpley');
    expect(programFormula(draftWith(chartSet(), set({ loadStrategy: 'RpeBasedEpley' })))).toBe(
      'mixed',
    );
    expect(isRpeLoaded(set({ loadStrategy: 'PercentageWorkingMax' }))).toBe(false);
  });

  it('moves every RPE-loaded set to a formula and nothing else, without touching the draft it was given', () => {
    const before = draftWith(
      chartSet(),
      set({ loadStrategy: 'RpeBasedEpley', exertionTarget: 8, repetitionsMaximum: 3 }),
      set({ loadStrategy: 'PercentageWorkingMax', loadValue: 75 }),
      set({ loadStrategy: 'Direct', loadValue: 100 }),
    );

    const after = withProgramFormula(before, 'RpeBasedEpley');

    expect(after.weeks[0].sessions[0].exercises[0].sets.map((item) => item.loadStrategy)).toEqual([
      'RpeBasedEpley',
      'RpeBasedEpley',
      'PercentageWorkingMax',
      'Direct',
    ]);
    expect(before.weeks[0].sessions[0].exercises[0].sets[0].loadStrategy).toBe('RpeChart');
    expect(rpeLoadedSetCount(before)).toBe(2);
    expect(programFormula(after)).toBe('RpeBasedEpley');
  });

  it('counts the chart sets that sit outside the chart, for the note that follows a switch', () => {
    const draft = draftWith(
      chartSet({ exertionTarget: 6 }),
      chartSet({ repetitionsMaximum: 15 }),
      chartSet(),
      set({ loadStrategy: 'RpeBasedEpley', exertionTarget: 6 }),
    );

    expect(outsideChartCount(draft)).toBe(2);
  });
});

describe('duplicate with progression', () => {
  const steps = { rpe: 0.5, reps: 1, percentage: 2.5, load: 2.5 };

  it('asks for the week as the draft holds it, with the steps the server names', () => {
    const draft = draftWith(
      set({ loadStrategy: 'PercentageWorkingMax', loadValue: 70, exertionTarget: 6.5 }),
    );
    draft.weeks[0].sessions[0].name = '  Squat day ';

    const request = progressionRequest(draft, draft.weeks[0].key, 3, steps);

    expect(request).toEqual({
      sourceWeek: toWeekRequest(draft.weeks[0]),
      copies: 3,
      steps: { rpeStep: 0.5, repetitionsStep: 1, percentageStep: 2.5, loadStep: 2.5 },
      weeksInProgram: 1,
    });
    expect(request?.sourceWeek.sessions[0].name).toBe('Squat day');
    expect(progressionRequest(draft, 'no-such-week', 3, steps)).toBeNull();
  });

  it('says what each step would move in a week, leaving warm-ups out', () => {
    const draft = draftWith(
      set({ setType: 'WarmUp', loadStrategy: 'Direct', loadValue: 60, exertionTarget: 5 }),
      set({ loadStrategy: 'PercentageWorkingMax', loadValue: 70, exertionTarget: 6 }),
      set({ loadStrategy: 'Direct', loadValue: 100, loadUnit: 'Pound', exertionTarget: null }),
      set({ loadStrategy: 'RpeChart', manualLoadOverride: 102.5, exertionTarget: 7 }),
      set({ loadStrategy: 'None', repetitionsMinimum: null, repetitionsMaximum: null }),
    );

    expect(progressionReach(draft.weeks[0])).toEqual({
      rpe: 2,
      reps: 3,
      percentage: 1,
      load: 2,
      unit: 'kg / lb',
      stepSets: 0,
    });
    expect(progressionReach(emptyWeek(1)).unit).toBeNull();
  });

  it('counts a last time + step set’s starting weight among the weights the weight step moves (N6a)', () => {
    const step = { loadStrategy: 'LastTimeStep' as const, loadStep: 2, repetitionsMaximum: 10 };
    const draft = draftWith(
      set({ ...step, loadValue: 5, loadUnit: 'Pound' }),
      // No starting weight: nothing for the weight step to move, as on the server.
      set({ ...step, loadValue: null }),
      // A leftover fixed load is never sent on a step set, so it moves nothing either.
      set({ ...step, loadValue: null, manualLoadOverride: 80 }),
      set({ ...step, setType: 'WarmUp', loadValue: 20 }),
      set({ loadStrategy: 'Direct', loadValue: 100 }),
    );

    expect(progressionReach(draft.weeks[0])).toEqual({
      rpe: 0,
      reps: 4,
      percentage: 0,
      load: 2,
      unit: 'kg / lb',
      stepSets: 3,
    });
  });

  it('keeps the copies to what the program can hold', () => {
    const draft = emptyProgram();
    expect(copiesThatFit(draft)).toBe(MAX_COPIES);
    draft.weeks = Array.from({ length: 45 }, (_, index) => emptyWeek(index + 1));
    expect(copiesThatFit(draft)).toBe(7);
    draft.weeks = Array.from({ length: MAX_WEEKS }, (_, index) => emptyWeek(index + 1));
    expect(copiesThatFit(draft)).toBe(0);
  });

  describe('adding the weeks the coach has read', () => {
    function previewOf(draft: ProgramDraft, count: number): WeekProgressionPreviewView {
      const source = toWeekRequest(draft.weeks[0]);
      return {
        transformKey: 'WeekStep',
        transformVersion: '1.0',
        weeks: Array.from({ length: count }, (_, index) => ({
          ...source,
          sessions: source.sessions.map((session) => ({
            ...session,
            exercises: session.exercises.map((exercise) => ({
              ...exercise,
              sets: exercise.sets.map((requested) => ({
                ...requested,
                targetRpe: 7 + 0.5 * (index + 1),
              })),
            })),
          })),
        })),
      };
    }

    it('puts them straight after the source, renumbers "Week" labels and keeps the exercise names', () => {
      const draft = draftWith(set({ exertionTarget: 7, loadStrategy: 'RpeChart' }));
      draft.weeks.push(emptyWeek(2));
      const before = structuredClone(draft);

      const next = insertProgression(draft, draft.weeks[0].key, previewOf(draft, 2));

      expect(next.weeks.map((week) => week.label)).toEqual([
        'Week 1',
        'Week 2',
        'Week 3',
        'Week 4',
      ]);
      expect(next.weeks[1].sessions[0].exercises[0].exerciseName).toBe('Back squat');
      expect(next.weeks[1].sessions[0].exercises[0].sets[0].exertionTarget).toBe(7.5);
      expect(next.weeks[2].sessions[0].exercises[0].sets[0].exertionTarget).toBe(8);
      expect(next.weeks[1].key).not.toBe(draft.weeks[0].key);
      expect(draft).toEqual(before);
    });

    it('keeps a last time + step set’s step and takes its moved starting weight (N6a)', () => {
      const draft = draftWith(
        set({ loadStrategy: 'LastTimeStep', loadStep: 2, loadValue: 5, repetitionsMaximum: 10 }),
      );
      const source = toWeekRequest(draft.weeks[0]);
      // The server moves the start by the weight step and copies the set's own step as it is.
      const preview: WeekProgressionPreviewView = {
        transformKey: 'WeekStep',
        transformVersion: '1.0',
        weeks: [1, 2].map((copy) => ({
          ...source,
          sessions: source.sessions.map((session) => ({
            ...session,
            exercises: session.exercises.map((exercise) => ({
              ...exercise,
              sets: exercise.sets.map((requested) => ({
                ...requested,
                directLoad: 5 + 2.5 * copy,
              })),
            })),
          })),
        })),
      };
      expect(source.sessions[0].exercises[0].sets[0]).toMatchObject({ directLoad: 5, loadStep: 2 });

      const next = insertProgression(draft, draft.weeks[0].key, preview);

      expect(
        next.weeks.map((week) => {
          const { loadStrategy, loadStep, loadValue } = week.sessions[0].exercises[0].sets[0];
          return [loadStrategy, loadStep, loadValue];
        }),
      ).toEqual([
        ['LastTimeStep', 2, 5],
        ['LastTimeStep', 2, 7.5],
        ['LastTimeStep', 2, 10],
      ]);
    });

    it('numbers a label the coach wrote, so copies are told apart', () => {
      const draft = draftWith(chartSet());
      draft.weeks[0].label = 'Accumulation';

      const next = insertProgression(draft, draft.weeks[0].key, previewOf(draft, 2));

      expect(next.weeks.map((week) => week.label)).toEqual([
        'Accumulation',
        'Accumulation 2',
        'Accumulation 3',
      ]);
    });

    it('changes nothing when the week is gone or the program would pass 52 weeks', () => {
      const draft = draftWith(chartSet());
      expect(insertProgression(draft, 'no-such-week', previewOf(draft, 1))).toBe(draft);
      draft.weeks = Array.from({ length: 51 }, (_, index) => emptyWeek(index + 1));
      draft.weeks[0].sessions[0].exercises = [emptyExercise('squat', false, 'Back squat')];
      expect(insertProgression(draft, draft.weeks[0].key, previewOf(draft, 2))).toBe(draft);
    });
  });
});
