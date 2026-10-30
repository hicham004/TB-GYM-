import { describe, expect, it } from 'vitest';
import { prescription, setView, versionView } from '../../../testing/program-builder-fixtures';
import { draftFromVersion } from './training-builder.models';
import { liftsNeedingMax, maxFormulaOf, maxReason, weekListWords } from './training-max-needs';

describe('which lifts need a training max', () => {
  it('lists the lifts a published program works out from a max, in the order they come', () => {
    const lifts = liftsNeedingMax(versionView().weeks);
    expect(lifts.map((lift) => lift.name)).toEqual(['Back squat', 'Bench press']);
    expect(lifts[0].sets.get('PercentageWorkingMax')).toBe(6);
    expect(lifts[0].weeks).toEqual([1, 2]);
  });

  it('reads the builder’s draft by the same rule, where a typed weight needs no max', () => {
    const draft = draftFromVersion(versionView());
    for (const exercise of draft.weeks
      .flatMap((week) => week.sessions)
      .flatMap((s) => s.exercises)) {
      if (exercise.exerciseId === 'bench') {
        for (const set of exercise.sets) set.manualLoadOverride = 60;
      }
    }
    expect(liftsNeedingMax(draft.weeks).map((lift) => lift.name)).toEqual(['Back squat']);
    expect(maxFormulaOf({ loadStrategy: 'RpeChart' })).toBe('RpeChart');
    expect(maxFormulaOf({ loadStrategy: 'RpeChart', manualLoadOverride: 80 })).toBeNull();
    expect(maxFormulaOf({ loadStrategy: 'Direct', isManualLoadOverride: true })).toBeNull();
    expect(maxFormulaOf({ loadStrategy: 'None' })).toBeNull();
  });

  it('says why a lift is listed: its sets, by formula, and the weeks that hold them', () => {
    const version = versionView();
    version.weeks[1].sessions[0].exercises[0] = prescription('squat', 'Back squat', {
      sets: [setView({ loadStrategy: 'RpeChart', percentageWorkingMax: null, targetRpe: 8 })],
    });
    const [squat, bench] = liftsNeedingMax(version.weeks);
    expect(maxReason(squat)).toBe(
      '3 sets use % of training max and 1 set uses the RTS chart in weeks 1 and 2',
    );
    expect(maxReason(bench)).toBe('6 sets use % of training max in weeks 1 and 2');
    expect(maxReason({ ...bench, sets: new Map([['RpeBasedEpley', 1]]), weeks: [3] })).toBe(
      '1 set uses the Epley curve in week 3',
    );
  });

  it('writes week numbers the way a coach reads them', () => {
    expect(weekListWords([2])).toBe('week 2');
    expect(weekListWords([1, 2])).toBe('weeks 1 and 2');
    expect(weekListWords([4, 1, 2, 3])).toBe('weeks 1 to 4');
    expect(weekListWords([1, 3, 5])).toBe('weeks 1, 3 and 5');
    expect(weekListWords([1, 2, 3, 6])).toBe('weeks 1 to 3 and 6');
    expect(weekListWords([1, 2, 3, 5, 6, 7])).toBe('weeks 1 to 3 and 5 to 7');
  });
});
