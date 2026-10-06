import { describe, expect, it } from 'vitest';
import type { WeekProgressionPreviewView } from '../../core/api/generated';
import {
  copiesThatFit,
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

  it('summarises a chart set without guessing a weight', () => {
    expect(setSummary(chartSet())).toBe('5 · Load from RTS chart & effort · RPE 7');
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
    });
    expect(progressionReach(emptyWeek(1)).unit).toBeNull();
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
