import { describe, expect, it } from 'vitest';
import type {
  LiftStanding,
  LiftStandingReasonDetail,
  LiftStandingView,
  LoggedSet,
  SetStanding,
} from '../../core/api/generated';
import {
  standingBelongsTo,
  standingFor,
  standingLine,
  standingsByExercise,
} from './standing-words';

// The server's day: Tuesday 10 Nov 2026. Words name days from it, never from the device's clock.
const TODAY = '2026-11-10';

function logged(setNumber: number, weight: number | null, repetitions: number | null): LoggedSet {
  return {
    setNumber,
    setType: 'Normal',
    repetitionsAsked: 10,
    targetRpe: null,
    prescribedWeight: null,
    prescribedUnit: null,
    isCompleted: true,
    repetitions,
    weight,
    unit: weight === null ? null : 'Kilogram',
    rpe: null,
  };
}

function set(setNumber: number, overrides: Partial<SetStanding> = {}): SetStanding {
  return {
    setPrescriptionId: `set-${setNumber}`,
    setNumber,
    move: 'StepUp',
    weight: 17,
    currentWeight: 15,
    unit: 'Kilogram',
    step: 2,
    note: 'None',
    ...overrides,
  };
}

function reason(overrides: Partial<LiftStandingReasonDetail>): LiftStandingReasonDetail {
  return {
    kind: 'EverySetDone',
    day: '2026-11-05',
    setNumber: null,
    repetitions: null,
    repetitionsAsked: null,
    rpe: null,
    targetRpe: null,
    weight: null,
    earlierWeight: null,
    unit: null,
    workoutExecutionId: null,
    ...overrides,
  };
}

function view(
  standing: Partial<LiftStanding>,
  overrides: Partial<LiftStandingView> = {},
): LiftStandingView {
  return {
    ruleKey: 'LastTimeStep',
    ruleVersion: 1,
    mesocycleId: 'block-1',
    sessionId: 'session-2',
    sessionName: 'Lower A',
    sessionDate: '2026-11-12',
    exercisePrescriptionId: 'prescription-1',
    exerciseId: 'leg-curl',
    exerciseName: 'Seated Leg Curl',
    occurrence: 1,
    exertionDisplay: 'Rpe',
    standing: {
      outcome: 'StepUp',
      reason: reason({}),
      lastTime: {
        workoutExecutionId: 'workout-1',
        day: '2026-11-05',
        sets: [logged(1, 15, 10), logged(2, 15, 10), logged(3, 15, 10)],
      },
      sets: [set(1), set(2), set(3)],
      judgedOn: TODAY,
      ...standing,
    },
    ...overrides,
  };
}

const line = (value: LiftStandingView) => standingLine(value, 'en-US').text;

describe('standingLine (LastTimeStep v1, STR-019)', () => {
  it('names last time’s sets, why the lift steps and the weight next time', () => {
    const result = standingLine(view({}), 'en-US');
    expect(result.text).toBe('Last 15 kg × 10, 10, 10 on Thu · every set done · next time 17 kg');
    expect(result.outcome).toBe('StepUp');
    // What happens next is the part in ink.
    expect(result.parts.filter((part) => part.strong).map((part) => part.text)).toEqual([
      'next time 17 kg',
    ]);
  });

  it('tells each set’s own weight, never rounded, and groups equal weights once', () => {
    const value = view({
      lastTime: {
        workoutExecutionId: 'workout-1',
        day: '2026-11-09',
        sets: [logged(1, 20, 10), logged(2, 22.125, 10), logged(3, 22.125, 9)],
      },
      sets: [
        set(1, { weight: 22.5, currentWeight: 20 }),
        set(2, { weight: '24.625', currentWeight: 22.125 }),
        set(3, { weight: '24.625', currentWeight: 22.125 }),
      ],
    });
    // Weights that differ are told set by set, so the coach sees which set gets which.
    expect(line(value)).toBe(
      'Last 20 kg × 10, 22.125 kg × 10, 9 yesterday · every set done · next time 22.5 kg on set 1, 24.625 kg on sets 2–3',
    );
  });

  it('says "every working set done" when a warm-up last time was skipped or had no reps', () => {
    const warmUp = { ...logged(1, 10, null), setType: 'WarmUp' as const };
    const value = view({
      lastTime: {
        workoutExecutionId: 'workout-1',
        day: '2026-11-05',
        sets: [warmUp, logged(2, 15, 10), logged(3, 15, 10)],
      },
      sets: [set(2), set(3)],
    });
    expect(line(value)).toBe(
      'Last 10 kg × –, 15 kg × 10, 10 on Thu · every working set done · next time 17 kg',
    );
  });

  it('names the sets that keep their own weight on a hold as well (line i)', () => {
    const value = view({
      outcome: 'Hold',
      reason: reason({ kind: 'RepsShort', setNumber: 3, repetitions: 8, repetitionsAsked: 10 }),
      sets: [
        set(1, { move: 'SameAsLastTime', weight: 25, currentWeight: null }),
        set(4, { move: 'Unchanged', weight: 20, currentWeight: 20, note: 'NewSet' }),
        set(5, { move: 'SameAsLastTime', weight: 20, currentWeight: 20, note: 'NoRepsTyped' }),
      ],
    });
    expect(line(value)).toBe(
      'Keep 25 kg · set 3 reached 8 of 10 on Thu · set 4 is new since Thu, stays at 20 kg · ' +
        'set 5 was logged without reps, stays at 20 kg',
    );
  });

  it('says when a set keeps its weight while the others step (line i)', () => {
    const value = view({
      sets: [
        set(1),
        set(2, { move: 'Unchanged', weight: 15, currentWeight: 15, note: 'NoWeightLogged' }),
        set(4, { move: 'Unchanged', weight: 12.5, currentWeight: 12.5, note: 'NewSet' }),
        set(5, { move: 'Unchanged', weight: null, currentWeight: null, note: 'NewSet' }),
      ],
    });
    expect(line(value)).toBe(
      'Last 15 kg × 10, 10, 10 on Thu · every set done · next time 17 kg · set 2 had no weight logged, ' +
        'stays at 15 kg · set 4 is new since Thu, stays at 12.5 kg · set 5 is new since Thu',
    );
  });

  it('says a pound lift in pounds and a day today', () => {
    const value = view({
      lastTime: {
        workoutExecutionId: 'workout-1',
        day: TODAY,
        sets: [{ ...logged(1, 45, 10), unit: 'Pound' }],
      },
      sets: [set(1, { weight: 50, currentWeight: 45, unit: 'Pound', step: 5 })],
    });
    expect(line(value)).toBe('Last 45 lb × 10 today · every set done · next time 50 lb');
  });

  it('holds the weight when a set fell short, on the day it happened (line a)', () => {
    const value = view({
      outcome: 'Hold',
      reason: reason({ kind: 'RepsShort', setNumber: 3, repetitions: 8, repetitionsAsked: 10 }),
      sets: [1, 2, 3].map((number) =>
        set(number, { move: 'SameAsLastTime', weight: 15, currentWeight: 15 }),
      ),
    });
    expect(line(value)).toBe('Same weight · set 3 reached 8 of 10 on Thu');
    expect(standingLine(value, 'en-US').parts[0]).toEqual({ text: 'Same weight', strong: true });
  });

  it('names a set logged without reps and one not logged (line a, decision 22)', () => {
    const noReps = view({
      outcome: 'Hold',
      reason: reason({ kind: 'NoRepsTyped', setNumber: 2 }),
      sets: [set(1, { move: 'SameAsLastTime', weight: 15, currentWeight: 15 })],
    });
    expect(line(noReps)).toBe('Same weight · set 2 logged without reps on Thu');
    const notLogged = view({
      outcome: 'Hold',
      reason: reason({ kind: 'SetNotLogged', setNumber: 3 }),
      sets: [set(1, { move: 'SameAsLastTime', weight: 15, currentWeight: 15 })],
    });
    expect(line(notLogged)).toBe('Same weight · set 3 not logged on Thu');
  });

  it('names the weight to keep when it is not the set’s own, as after a new program (line d)', () => {
    const value = view({
      outcome: 'Hold',
      reason: reason({ kind: 'RepsShort', setNumber: 1, repetitions: 9, repetitionsAsked: 10 }),
      sets: [set(1, { move: 'SameAsLastTime', weight: 15, currentWeight: 5 })],
    });
    expect(line(value)).toBe('Keep 15 kg · set 1 reached 9 of 10 on Thu');
  });

  it('holds a lift last done more than 14 days ago with its day (line b)', () => {
    const value = view({
      outcome: 'Hold',
      reason: reason({ kind: 'LastDoneTooLongAgo', day: '2026-10-13' }),
      lastTime: null,
      sets: [set(1, { move: 'Unchanged', weight: 15, currentWeight: 15 })],
    });
    expect(line(value)).toBe('Same weight · last done Tue 13 Oct, more than 14 days ago');
  });

  it('says a set felt harder than planned on the coach’s own scale (line c)', () => {
    const rpe = view({
      outcome: 'Hold',
      reason: reason({ kind: 'HarderThanPlanned', setNumber: 2, rpe: 9, targetRpe: '8' }),
      sets: [set(1, { move: 'SameAsLastTime', weight: 15, currentWeight: 15 })],
    });
    expect(line(rpe)).toBe('Same weight · set 2 felt harder than planned on Thu (RPE 9 of 8)');
    // RIR is kept as 10 minus RPE (STR-003): RPE 9 of 8 is RIR 1 of 2.
    expect(line({ ...rpe, exertionDisplay: 'Rir' })).toBe(
      'Same weight · set 2 felt harder than planned on Thu (RIR 1 of 2)',
    );
  });

  it('says a weight that looks like a typo and what it was compared with (line e)', () => {
    const value = view({
      outcome: 'Hold',
      reason: reason({
        kind: 'LooksLikeTypo',
        setNumber: 1,
        weight: 55,
        earlierWeight: 5.5,
        unit: 'Kilogram',
        day: '2026-11-03',
      }),
      sets: [set(1, { move: 'Unchanged', weight: 5.5, currentWeight: 5.5 })],
    });
    expect(line(value)).toBe(
      'Same weight · 55 kg logged on Tue 3 Nov looks like a typo (5.5 kg before)',
    );
  });

  it('asks for a forgotten Finish, naming the workout’s day (line g)', () => {
    const running = (day: string) =>
      view({
        outcome: 'Hold',
        reason: reason({ kind: 'WorkoutInProgress', day }),
        lastTime: null,
        sets: [set(1, { move: 'Unchanged', weight: 15, currentWeight: 15 })],
      });
    expect(line(running(TODAY))).toBe('Finish today’s workout to go up');
    expect(line(running('2026-11-09'))).toBe('Finish yesterday’s workout to go up');
    expect(line(running('2026-11-05'))).toBe('Finish Thursday’s workout to go up');
    expect(line(running('2026-11-02'))).toBe('Finish the workout from Mon 2 Nov to go up');
    expect(standingLine(running(TODAY), 'en-US').parts).toEqual([
      { text: 'Finish today’s workout to go up', strong: true },
    ]);
  });

  it('says a weight logged in the other unit, a lift never done and nothing to match', () => {
    const otherUnit = view({
      outcome: 'Hold',
      reason: reason({ kind: 'LoggedInOtherUnit', setNumber: 2, weight: 45, unit: 'Pound' }),
      sets: [set(1, { move: 'Unchanged', weight: 15, currentWeight: 15 })],
    });
    expect(line(otherUnit)).toBe('Same weight · set 2 logged in lb on Thu');
    const never = view({
      outcome: 'Hold',
      reason: reason({ kind: 'NeverDone', day: null }),
      lastTime: null,
      sets: [set(1, { move: 'Unchanged', weight: null, currentWeight: null })],
    });
    expect(line(never)).toBe('First time · nothing logged yet to step from');
    const noMatch = view({
      outcome: 'Hold',
      reason: reason({ kind: 'NoMatchLastTime' }),
      lastTime: null,
      sets: [set(1, { move: 'Unchanged', weight: 15, currentWeight: 15 })],
    });
    expect(line(noMatch)).toBe('Same weight · nothing to match on Thu');
  });

  it('leads with the weight a set carries on when no set could step', () => {
    // Set 2 had no weight last time; the rule carried on its 15 kg from earlier (within 14 days).
    const value = view({
      outcome: 'Hold',
      reason: reason({ kind: 'NoWeightLogged', setNumber: 2 }),
      sets: [
        set(2, { move: 'SameAsLastTime', weight: 15, currentWeight: 14, note: 'NoWeightLogged' }),
      ],
    });
    expect(line(value)).toBe('Keep 15 kg · set 2 had no weight logged on Thu');
  });

  it('says each set without a weight, not only the one the hold names', () => {
    const value = view({
      outcome: 'Hold',
      reason: reason({ kind: 'NoWeightLogged', setNumber: 1 }),
      sets: [1, 2, 3].map((place) =>
        set(place, {
          move: 'Unchanged',
          weight: null,
          currentWeight: null,
          note: 'NoWeightLogged',
        }),
      ),
    });
    expect(line(value)).toBe(
      'Same weight · set 1 had no weight logged on Thu · set 2 had no weight logged · ' +
        'set 3 had no weight logged',
    );
  });

  it('says a lift with no weight logged and one at the limit', () => {
    const noWeight = view({
      outcome: 'Hold',
      reason: reason({ kind: 'NoWeightLogged', setNumber: 1 }),
      sets: [set(1, { move: 'Unchanged', weight: 15, currentWeight: 15, note: 'NoWeightLogged' })],
    });
    expect(line(noWeight)).toBe('Same weight · set 1 had no weight logged on Thu');
    const limit = view({
      outcome: 'Hold',
      reason: reason({ kind: 'AboveLimit', setNumber: 1 }),
      sets: [
        set(1, { move: 'SameAsLastTime', weight: 1999, currentWeight: 1999, note: 'AboveLimit' }),
      ],
    });
    expect(line(limit)).toBe('Same weight · a step would pass 2,000 kg');
    // One set at the limit while the others step: it says why it stays.
    const oneAtLimit = view({
      sets: [
        set(1),
        set(2, { move: 'SameAsLastTime', weight: 1999, currentWeight: 1999, note: 'AboveLimit' }),
      ],
    });
    expect(line(oneAtLimit)).toBe(
      'Last 15 kg × 10, 10, 10 on Thu · every set done · next time 17 kg · ' +
        'set 2 stays at 1,999 kg, as a step would pass 2,000 kg',
    );
  });
});

describe('which line goes where', () => {
  it('finds the coming session’s writing by its exercise on the session sheet', () => {
    const standings = [view({}), view({}, { exercisePrescriptionId: 'prescription-2' })];
    expect(standingFor(standings, 'prescription-2')).toBe(standings[1]);
    expect(standingFor(standings, 'prescription-3')).toBeNull();
    expect(standingFor(null, 'prescription-1')).toBeNull();
  });

  it('matches a logged workout’s exercises by the lift written there and its writing (line f)', () => {
    const top = view({}, { exerciseId: 'squat', occurrence: 1 });
    const backOff = view({}, { exerciseId: 'squat', occurrence: '2' });
    const curl = view({}, { exerciseId: 'leg-curl', occurrence: 1 });
    const done = (id: string, lift: string, performed = lift) => ({
      prescriptionId: id,
      prescribedExerciseId: lift,
      actualExerciseId: performed,
    });
    const found = standingsByExercise(
      [done('p-1', 'squat'), done('p-2', 'press'), done('p-3', 'squat'), done('p-4', 'squat')],
      [curl, backOff, top],
    );
    expect([...found.entries()]).toEqual([
      ['p-1', top],
      ['p-3', backOff],
    ]);
    // A top set swapped for another lift keeps its place: the back-off is still the second writing.
    const swapped = standingsByExercise(
      [done('p-1', 'squat', 'leg-press'), done('p-2', 'squat')],
      [top, backOff],
    );
    expect([...swapped.entries()]).toEqual([['p-2', backOff]]);
    expect(standingsByExercise([done('p-1', 'squat')], null).size).toBe(0);
  });

  it('belongs under the workout the answer read, or the running one it waits on', () => {
    const value = view({});
    const workout = (id: string) => ({ workoutExecutionId: id });
    expect(standingBelongsTo(value, workout('workout-1'))).toBe(true);
    expect(standingBelongsTo(value, workout('workout-0'))).toBe(false);
    const running = view({
      outcome: 'Hold',
      reason: reason({
        kind: 'WorkoutInProgress',
        day: '2026-11-09',
        workoutExecutionId: 'workout-2',
      }),
      lastTime: null,
    });
    // The running workout the hold names by its id, never another one started the same day.
    expect(standingBelongsTo(running, workout('workout-2'))).toBe(true);
    expect(standingBelongsTo(running, workout('workout-3'))).toBe(false);
    expect(standingBelongsTo(running, workout('workout-1'))).toBe(false);
  });
});
