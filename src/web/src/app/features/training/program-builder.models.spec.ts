import { describe, expect, it } from 'vitest';
import type {
  ExerciseView,
  ProgramTemplateSummary,
  SavedSessionView,
} from '../../core/api/generated';
import {
  accepts,
  applyDrop,
  copySession,
  daySessions,
  draftProblem,
  duplicateWeekAfter,
  setSummary,
  setIssue,
  gridColumns,
  gridLines,
  groupPatterns,
  libraryChips,
  libraryExercise,
  type LibraryExercise,
  libraryFilterKey,
  libraryNames,
  moveWeek,
  parseReps,
  programLibraryIds,
  draftCard,
  programCard,
  removeWeek,
  repsText,
  versionRows,
  versionToOpen,
} from './program-builder.models';
import { draftSummary, draftView } from '../../../testing/program-builder-fixtures';
import {
  type DraftSession,
  draftFromContent,
  emptyExercise,
  emptyProgram,
  emptySession,
  emptySet,
  emptyWeek,
  type ProgramDraft,
  toDraftContent,
} from './training-builder.models';

function exerciseView(overrides: Partial<ExerciseView> = {}): ExerciseView {
  return {
    id: 'squat',
    name: 'Back squat',
    instructions: null,
    equipment: 'Barbell',
    movementPattern: 'Squat',
    classification: 'Strength',
    isArchived: false,
    muscles: [{ muscle: 'Quadriceps', role: 'Primary' }],
    tags: ['competition'],
    alternatives: [
      { exerciseId: 'safety-bar', exerciseName: 'Safety-bar squat', note: null, isArchived: false },
    ],
    mediaAssetIds: [],
    version: 1,
    ...overrides,
  } as ExerciseView;
}

const squat: LibraryExercise = libraryExercise(exerciseView());
const row: LibraryExercise = libraryExercise(
  exerciseView({
    id: 'row',
    name: 'Chest-supported row',
    equipment: 'Dumbbell',
    movementPattern: 'HorizontalPull',
    alternatives: [],
    mediaAssetIds: ['media-1', 'media-2'],
  }),
);

function session(name: string, day: number, exercises: string[] = []): DraftSession {
  const value = emptySession(day);
  value.name = name;
  value.exercises = exercises.map((id) => emptyExercise(id, false, id));
  return value;
}

/** Week 1: Lower A on day 1 (squat, row), Upper A on day 3 (row). Week 2: Lower B on day 1. */
function program(): ProgramDraft {
  const draft = emptyProgram();
  draft.name = 'Strength base';
  draft.weeks[0].sessions = [
    session('Lower A', 0, ['squat', 'row']),
    session('Upper A', 2, ['row']),
  ];
  const second = emptyWeek(2);
  second.sessions = [session('Lower B', 0, ['squat'])];
  draft.weeks.push(second);
  return draft;
}

const names = (draft: ProgramDraft, week = 0) =>
  draft.weeks[week].sessions.map((item) => `${item.name}@${item.dayOffset}`);

describe('program builder grid', () => {
  it('widens the day being edited while keeping the same aligned columns across weeks', () => {
    expect(gridColumns(program(), 0).split('minmax(20rem, 1.8fr)')).toHaveLength(2);
  });

  it('describes exact per-set targets and preserves a fixed override’s unit', () => {
    const set = {
      ...emptySet(),
      loadStrategy: 'PercentageWorkingMax' as const,
      loadValue: 75,
      repetitionsMinimum: 3,
      repetitionsMaximum: 6,
      exertionTarget: 8,
    };
    expect(setSummary(set)).toBe('3–6 · 75% of training max · RPE 8');
    expect(setSummary({ ...set, manualLoadOverride: 80, loadUnit: 'Pound' })).toBe(
      '3–6 · 80 lb fixed load · RPE 8',
    );
    // 6 reps plus 2 in reserve is 8 along the Epley curve: 78.9%, in whole percents.
    expect(setSummary({ ...set, loadStrategy: 'RpeBasedEpley' })).toBe(
      '3–6 · RPE 8 · 79% of training max',
    );
  });

  it('reads the one Reps box as one number or a range and says a set’s reps back the same way', () => {
    expect(parseReps('10')).toEqual({ repetitionsMinimum: 10, repetitionsMaximum: 10 });
    for (const typed of ['8-12', '8–12', '8 — 12', ' 8 to 12 ', '8TO12']) {
      expect(parseReps(typed)).toEqual({ repetitionsMinimum: 8, repetitionsMaximum: 12 });
    }
    expect(parseReps('')).toEqual({ repetitionsMinimum: null, repetitionsMaximum: null });
    expect(parseReps('up to 10')).toEqual({ repetitionsMinimum: null, repetitionsMaximum: 10 });
    expect(parseReps('at least 8')).toEqual({ repetitionsMinimum: 8, repetitionsMaximum: null });
    // Out-of-order and out-of-range numbers are read, so setIssue can say what is wrong with them.
    expect(parseReps('12-8')).toEqual({ repetitionsMinimum: 12, repetitionsMaximum: 8 });
    expect(parseReps('0')).toEqual({ repetitionsMinimum: 0, repetitionsMaximum: 0 });
    for (const typed of ['ten', '8-', '-12', '8-10-12', '8.5', '8 or 9', '10 reps']) {
      expect(parseReps(typed)).toBeNull();
    }

    expect(repsText({ repetitionsMinimum: 10, repetitionsMaximum: 10 })).toBe('10');
    expect(repsText({ repetitionsMinimum: 8, repetitionsMaximum: 12 })).toBe('8–12');
    expect(repsText({ repetitionsMinimum: null, repetitionsMaximum: null })).toBe('');
    // Sets saved before the box with one end: the client's app says "up to 10 reps" too.
    expect(repsText({ repetitionsMinimum: null, repetitionsMaximum: 10 })).toBe('up to 10');
    expect(repsText({ repetitionsMinimum: 8, repetitionsMaximum: null })).toBe('at least 8');
    for (const reps of [
      { repetitionsMinimum: 10, repetitionsMaximum: 10 },
      { repetitionsMinimum: 8, repetitionsMaximum: 12 },
      { repetitionsMinimum: null, repetitionsMaximum: 10 },
      { repetitionsMinimum: 8, repetitionsMaximum: null },
    ]) {
      expect(parseReps(repsText(reps))).toEqual(reps);
    }

    const set = { ...emptySet(), repetitionsEntry: '8 or 9' };
    expect(setIssue(set)).toEqual({
      field: 'repetitionsMinimum',
      message: 'type the reps as one number, like 10, or a range, like 8-12.',
    });
    expect(setIssue({ ...set, repetitionsEntry: '8-12' })).toBeNull();
    expect(setSummary({ ...emptySet(), repetitionsMinimum: null, repetitionsMaximum: 10 })).toBe(
      'up to 10 · No prescribed load',
    );
  });

  it('lets a fixed coach load win over a calculated target while still validating its effort', () => {
    const set = {
      ...emptySet(),
      loadStrategy: 'RpeBasedEpley' as const,
      repetitionsMaximum: 20,
      exertionTarget: 8,
      manualLoadOverride: 80,
    };
    expect(setIssue(set)).toBeNull();
    expect(setIssue({ ...set, manualLoadOverride: 0 })?.field).toBe('manualLoadOverride');
    expect(setIssue({ ...set, exertionTarget: 11 })?.field).toBe('exertionTarget');
  });
  it('gives room to days that hold a workout in any week and keeps rest days a thin strip', () => {
    expect(gridColumns(program())).toBe(
      [0, 1, 2, 3, 4, 5, 6]
        .map((day) => (day === 0 || day === 2 ? 'minmax(9rem, 1fr)' : '2.5rem'))
        .join(' '),
    );
  });

  it('tells an exercise’s working sets once when they are equal, as sets × reps', () => {
    const exercise = emptyExercise('squat');
    const warmUp = { ...emptySet(), setType: 'WarmUp' as const, loadStrategy: 'Direct' as const };
    warmUp.repetitionsMinimum = warmUp.repetitionsMaximum = 3;
    warmUp.loadValue = 40;
    const working = {
      ...emptySet(),
      repetitionsMinimum: 5,
      repetitionsMaximum: 5,
      loadStrategy: 'PercentageWorkingMax' as const,
      loadValue: 75,
      exertionTarget: 7,
    };
    // A warm-up is not a working set, whatever its reps (TRAIN-2).
    exercise.sets = [warmUp, working, { ...working }, { ...working }];
    expect(gridLines(exercise)).toEqual(['3 × 5 · 75% of training max · RPE 7']);

    const range = { ...emptySet(), repetitionsMinimum: 8, repetitionsMaximum: 10 };
    range.loadStrategy = 'Direct';
    range.loadValue = 60;
    range.exertionDisplayPreference = 'Rir';
    range.exertionTarget = 2;
    exercise.sets = [range, { ...range }];
    expect(gridLines(exercise)).toEqual(['2 × 8–10 · 60 kg · RIR 2']);

    // The audit's case: a warm-up with the working set's reps once read "2 × 8–10".
    exercise.sets = [{ ...range, setType: 'WarmUp' as const, loadValue: 40 }, range];
    expect(gridLines(exercise)).toEqual(['1 × 8–10 · 60 kg · RIR 2']);

    // A chart set says the chart's share after the effort it comes from (5 at RPE 8 is 81.1%).
    const chart = {
      ...working,
      loadStrategy: 'RpeChart' as const,
      loadValue: null,
      exertionTarget: 8,
    };
    exercise.sets = [chart, { ...chart }];
    expect(gridLines(exercise)).toEqual(['2 × 5 · RPE 8 · 81% of training max']);

    // Warm-ups alone say what they are.
    exercise.sets = [warmUp, { ...warmUp }];
    expect(gridLines(exercise)).toEqual(['2 × 3 warm-up · 40 kg']);
    expect(gridLines(emptyExercise('squat', false, 'Squat'))).toEqual(['1 × 5']);
    exercise.sets = [];
    expect(gridLines(exercise)).toEqual(['No sets yet']);
  });

  it('gives an Epley set its own share on a template, read like a chart set’s (critique B15)', () => {
    const exercise = emptyExercise('squat');
    const epley = {
      ...emptySet(),
      loadStrategy: 'RpeBasedEpley' as const,
      exertionTarget: 8,
    };
    exercise.sets = [epley, { ...epley }, { ...epley }];
    expect(gridLines(exercise)).toEqual(['3 × 5 · RPE 8 · 81% of training max']);

    // RIR 2 is the same point of the curve; only the words follow the coach's choice.
    exercise.sets = [{ ...epley, exertionDisplayPreference: 'Rir', exertionTarget: 2 }];
    expect(gridLines(exercise)).toEqual(['1 × 5 · RIR 2 · 81% of training max']);

    // Past the curve's limit it says so, and a typed weight beats the curve at any reps.
    const past = { ...epley, repetitionsMinimum: 11, repetitionsMaximum: 11 };
    exercise.sets = [past];
    expect(gridLines(exercise)).toEqual(['1 × 11 · RPE 8 · outside the Epley curve']);
    expect(setSummary(past)).toBe('11 · RPE 8 · outside the Epley curve');
    exercise.sets = [{ ...past, manualLoadOverride: 80 }];
    expect(gridLines(exercise)).toEqual(['1 × 11 · 80 kg · RPE 8']);

    // Until it has an effort the set's summary still says where the load will come from.
    expect(setSummary({ ...epley, exertionTarget: null })).toBe(
      '5 · Load from training max & effort',
    );
  });

  it('puts a client’s saved weight where the share stood, the weight first (critique B15)', () => {
    const exercise = emptyExercise('squat');
    const chart = { ...emptySet(), loadStrategy: 'RpeChart' as const, exertionTarget: 8 };
    const percent = {
      ...emptySet(),
      loadStrategy: 'PercentageWorkingMax' as const,
      loadValue: 81,
      exertionTarget: 8,
    };
    const saved = (load: string) => () => load;

    exercise.sets = [chart, { ...chart }, { ...chart }];
    expect(gridLines(exercise, saved('81 kg'))).toEqual(['3 × 5 · 81 kg · RPE 8']);
    exercise.sets = [percent, { ...percent }];
    expect(gridLines(exercise, saved('162.5 kg'))).toEqual(['2 × 5 · 162.5 kg · RPE 8']);

    // Equal saved weights are told once; a set with no saved weight keeps its share beside them.
    const changed = { ...chart, key: 'changed', exertionTarget: 9 };
    exercise.sets = [chart, { ...chart }, changed];
    expect(gridLines(exercise, (set) => (set.key === 'changed' ? null : '110 kg'))).toEqual([
      '2 × 5 · 110 kg · RPE 8',
      '1 × 5 · RPE 9 · 84% of training max',
    ]);

    // A warm-up reads the same way, and the same exercise without a client keeps its share.
    const warmUp = { ...percent, setType: 'WarmUp' as const };
    exercise.sets = [warmUp, { ...warmUp }];
    expect(gridLines(exercise, saved('60 kg'))).toEqual(['2 × 5 warm-up · 60 kg · RPE 8']);
    expect(gridLines(exercise)).toEqual(['2 × 5 warm-up · 81% of training max · RPE 8']);
  });

  it('names a last time + step set’s step and any starting weight, then its effort (N6a)', () => {
    const exercise = emptyExercise('goblet', false, 'Goblet squat');
    const step = {
      ...emptySet(),
      loadStrategy: 'LastTimeStep' as const,
      repetitionsMinimum: 10,
      repetitionsMaximum: 10,
      loadStep: 2,
      loadValue: 5,
    };
    exercise.sets = [step, { ...step }, { ...step }];
    expect(gridLines(exercise)).toEqual(['3 × 10 · last time + 2 kg · start 5 kg']);
    expect(setSummary(step)).toBe('10 · last time + 2 kg · start 5 kg');

    // No starting weight: the client picks it, and only the step is named.
    exercise.sets = [
      { ...step, loadValue: null },
      { ...step, loadValue: null },
      { ...step, loadValue: null },
    ];
    expect(gridLines(exercise)).toEqual(['3 × 10 · last time + 2 kg']);

    // Pounds stay pounds, the effort follows as on any set, and a step still to type says what it is.
    const pounds = {
      ...step,
      loadUnit: 'Pound' as const,
      loadStep: 5,
      loadValue: 45,
      exertionTarget: 8,
    };
    expect(setSummary(pounds)).toBe('10 · last time + 5 lb · start 45 lb · RPE 8');
    expect(setSummary({ ...step, loadStep: null })).toBe('10 · Last time + step · start 5 kg');
    exercise.sets = [{ ...step, loadStep: null, loadValue: null }];
    expect(gridLines(exercise)).toEqual(['1 × 10']);

    // No max works it out: a saved weight or a leftover fixed load never stands for its words.
    exercise.sets = [{ ...step, manualLoadOverride: 80 }];
    expect(gridLines(exercise, () => '81 kg')).toEqual(['1 × 10 · last time + 2 kg · start 5 kg']);
  });

  it('gives each run of sets that differ a line of its own, never one set’s effort for all', () => {
    const exercise = emptyExercise('squat');
    const set = (reps: number, rpe: number | null) => ({
      ...emptySet(),
      repetitionsMinimum: reps,
      repetitionsMaximum: reps,
      loadStrategy: 'PercentageWorkingMax' as const,
      loadValue: 70,
      exertionTarget: rpe,
    });
    // Toufic's case: two sets of ten at RPE 5 and RPE 10 once read "2 sets · RPE 5".
    exercise.sets = [set(10, 5), set(10, 10)];
    expect(gridLines(exercise)).toEqual([
      '1 × 10 · 70% of training max · RPE 5',
      '1 × 10 · 70% of training max · RPE 10',
    ]);

    // A top set and its back-offs: equal neighbours stay together, in the coach's order.
    const top = { ...set(3, 8), loadStrategy: 'RpeChart' as const, loadValue: null };
    exercise.sets = [top, set(5, null), set(5, null), set(5, null), set(3, 8)];
    expect(gridLines(exercise)).toEqual([
      '1 × 3 · RPE 8 · 86% of training max',
      '3 × 5 · 70% of training max',
      '1 × 3 · 70% of training max · RPE 8',
    ]);

    // Sets with no reps are counted as sets.
    const open = { ...set(5, 7), repetitionsMinimum: null, repetitionsMaximum: null };
    exercise.sets = [open, { ...open }];
    expect(gridLines(exercise)).toEqual(['2 sets · 70% of training max · RPE 7']);
  });
});

describe('program builder drops', () => {
  it('takes exercises into workouts, workouts onto days, and an exercise onto an empty day only', () => {
    const ref = { weekKey: 'w', sessionKey: 's' };
    const at = { weekKey: 'w', day: 3 };
    const library = { kind: 'library' as const, exercise: squat };
    const moving = { kind: 'exercise' as const, ref: { ...ref, exerciseKey: 'e' } };
    const sessionItem = { kind: 'session' as const, ref };

    expect(accepts(library, { kind: 'session', ref })).toBe(true);
    expect(accepts(moving, { kind: 'session', ref })).toBe(true);
    expect(accepts(sessionItem, { kind: 'session', ref })).toBe(false);
    expect(accepts(sessionItem, { kind: 'day', at, empty: false })).toBe(true);
    expect(accepts(library, { kind: 'day', at, empty: false })).toBe(false);
    expect(accepts(library, { kind: 'day', at, empty: true })).toBe(true);
    expect(accepts(moving, { kind: 'day', at, empty: true })).toBe(true);
  });

  it('adds a library exercise where it is dropped, with the swaps the library approves', () => {
    const draft = program();
    const lower = { weekKey: draft.weeks[0].key, sessionKey: draft.weeks[0].sessions[0].key };

    const next = applyDrop(
      draft,
      { kind: 'library', exercise: squat },
      { kind: 'session', ref: lower },
      1,
      'Training day',
    );

    const exercises = next.weeks[0].sessions[0].exercises;
    expect(exercises.map((item) => item.exerciseId)).toEqual(['squat', 'squat', 'row']);
    expect(exercises[1].exerciseName).toBe('Back squat');
    expect(exercises[1].approvedAlternativeExerciseIds).toEqual(['safety-bar']);
    expect(draft.weeks[0].sessions[0].exercises).toHaveLength(2);
  });

  it('moves an exercise within a workout and between workouts', () => {
    const draft = program();
    const week = draft.weeks[0];
    const lower = { weekKey: week.key, sessionKey: week.sessions[0].key };
    const upper = { weekKey: week.key, sessionKey: week.sessions[1].key };
    const squatKey = week.sessions[0].exercises[0].key;

    const reordered = applyDrop(
      draft,
      { kind: 'exercise', ref: { ...lower, exerciseKey: squatKey } },
      { kind: 'session', ref: lower },
      1,
      'Training day',
    );
    expect(reordered.weeks[0].sessions[0].exercises.map((item) => item.exerciseId)).toEqual([
      'row',
      'squat',
    ]);

    const moved = applyDrop(
      draft,
      { kind: 'exercise', ref: { ...lower, exerciseKey: squatKey } },
      { kind: 'session', ref: upper },
      0,
      'Training day',
    );
    expect(moved.weeks[0].sessions[0].exercises.map((item) => item.exerciseId)).toEqual(['row']);
    expect(moved.weeks[0].sessions[1].exercises.map((item) => item.exerciseId)).toEqual([
      'squat',
      'row',
    ]);
  });

  it('starts a workout on an empty day from an exercise, and refuses a day that has one', () => {
    const draft = program();
    const week = draft.weeks[0];

    const started = applyDrop(
      draft,
      { kind: 'library', exercise: row },
      { kind: 'day', at: { weekKey: week.key, day: 4 }, empty: true },
      0,
      'Training day',
    );
    expect(names(started)).toEqual(['Lower A@0', 'Upper A@2', 'Training day@4']);
    expect(started.weeks[0].sessions[2].exercises[0].exerciseName).toBe('Chest-supported row');

    const refused = applyDrop(
      draft,
      { kind: 'library', exercise: row },
      { kind: 'day', at: { weekKey: week.key, day: 0 }, empty: false },
      0,
      'Training day',
    );
    expect(refused).toBe(draft);
  });

  it('moves a workout to another day and week, keeping each week in day order', () => {
    const draft = program();
    const upper = { weekKey: draft.weeks[0].key, sessionKey: draft.weeks[0].sessions[1].key };

    const earlier = applyDrop(
      draft,
      { kind: 'session', ref: upper },
      { kind: 'day', at: { weekKey: draft.weeks[0].key, day: 0 }, empty: false },
      0,
      'Training day',
    );
    expect(names(earlier)).toEqual(['Upper A@0', 'Lower A@0']);

    const otherWeek = applyDrop(
      draft,
      { kind: 'session', ref: upper },
      { kind: 'day', at: { weekKey: draft.weeks[1].key, day: 5 }, empty: true },
      0,
      'Training day',
    );
    expect(names(otherWeek)).toEqual(['Lower A@0']);
    expect(names(otherWeek, 1)).toEqual(['Lower B@0', 'Upper A@5']);
  });

  it('drops a fresh copy of a saved workout, never the saved one itself', () => {
    const draft = program();
    const savedSession = {
      id: 'saved-1',
      name: 'Conditioning',
      sourceTemplateVersionId: 'version-1',
      sourceTemplateSessionId: 'session-1',
      session: {
        id: 'session-1',
        position: 1,
        dayOffset: 0,
        scheduledDate: null,
        name: 'Conditioning',
        coachNotes: null,
        hasStarted: false,
        isCompleted: false,
        workoutExecutionId: null,
        exercises: [],
      },
    } as SavedSessionView;

    const next = applyDrop(
      draft,
      { kind: 'saved', saved: savedSession },
      { kind: 'day', at: { weekKey: draft.weeks[0].key, day: 6 }, empty: true },
      0,
      'Training day',
    );
    const added = next.weeks[0].sessions[2];
    expect(added.name).toBe('Conditioning');
    expect(added.dayOffset).toBe(6);
    expect(added.sourceId).toBeNull();
  });
});

describe('program builder menus', () => {
  it('copies a workout to the next free day, or beside it when the week is full', () => {
    const draft = program();
    const lower = { weekKey: draft.weeks[0].key, sessionKey: draft.weeks[0].sessions[0].key };

    const copied = copySession(draft, lower);
    expect(names(copied.draft)).toEqual(['Lower A@0', 'Lower A@1', 'Upper A@2']);
    expect(copied.sessionKey).not.toBe(lower.sessionKey);

    const full = emptyProgram();
    full.weeks[0].sessions = [0, 1, 2, 3, 4, 5, 6].map((day) => session(`S${day}`, day));
    const last = { weekKey: full.weeks[0].key, sessionKey: full.weeks[0].sessions[6].key };
    expect(daySessions(copySession(full, last).draft.weeks[0], 6)).toHaveLength(2);
  });

  it('numbers default week labels by place and keeps a label the coach wrote', () => {
    const draft = program();
    draft.weeks[1].label = 'Deload';

    const duplicated = duplicateWeekAfter(draft, draft.weeks[0].key);
    expect(duplicated.weeks.map((week) => week.label)).toEqual(['Week 1', 'Week 2', 'Deload']);
    expect(duplicated.weeks[1].sessions[0].key).not.toBe(draft.weeks[0].sessions[0].key);

    const moved = moveWeek(duplicated, duplicated.weeks[2].key, -1);
    expect(moved.weeks.map((week) => week.label)).toEqual(['Week 1', 'Deload', 'Week 3']);

    const single = emptyProgram();
    expect(removeWeek(single, single.weeks[0].key)).toBe(single);
  });
});

describe('program builder save checks', () => {
  it('says where the first problem is', () => {
    const draft = program();
    draft.name = ' ';
    expect(draftProblem(draft)?.message).toBe('Give the program a name.');

    draft.name = 'Strength base';
    const second = draft.weeks[1].sessions[0];
    second.exercises[0].sets[0].exertionTarget = 11;
    expect(draftProblem(draft)).toEqual({
      weekKey: draft.weeks[1].key,
      sessionKey: second.key,
      exerciseKey: second.exercises[0].key,
      setKey: second.exercises[0].sets[0].key,
      message: 'Week 2, Lower B: RPE must be between 5 and 10 in 0.5 steps.',
    });

    second.exercises[0].sets[0].exertionTarget = 8;
    second.name = '';
    expect(draftProblem(draft)?.message).toBe('Week 2, Day 1: give the workout a name.');
  });

  it('checks a last time + step set by the server’s limits: its step, its start, its reps (N6a)', () => {
    const step = {
      ...emptySet(),
      loadStrategy: 'LastTimeStep' as const,
      repetitionsMinimum: 10,
      repetitionsMaximum: 10,
      loadStep: 2,
      loadValue: null,
    };
    expect(setIssue(step)).toBeNull();
    for (const fine of [0.01, 2.25, 50]) expect(setIssue({ ...step, loadStep: fine })).toBeNull();
    expect(setIssue({ ...step, loadValue: 2000 })).toBeNull();

    const refusal = {
      field: 'loadStep',
      message: 'a step must be more than 0 and at most 50 kg, with at most two decimals.',
    };
    for (const wrong of [null, 0, -2, 50.5, 2.555]) {
      expect(setIssue({ ...step, loadStep: wrong })).toEqual(refusal);
    }
    expect(setIssue({ ...step, loadStep: 0, loadUnit: 'Pound' })?.message).toBe(
      'a step must be more than 0 and at most 50 lb, with at most two decimals.',
    );
    // 0.0004 is kept as 0 by the server's three decimals, so it is no start above 0 either.
    expect(setIssue({ ...step, loadValue: 0.0005 })).toBeNull();
    for (const wrong of [0, -5, 2000.5, 0.0004]) {
      expect(setIssue({ ...step, loadValue: wrong })).toEqual({
        field: 'loadValue',
        message: 'a starting weight must be more than 0 and at most 2000, or left empty.',
      });
    }
    const noReps = { field: 'repetitionsMaximum' };
    expect(setIssue({ ...step, repetitionsMinimum: null, repetitionsMaximum: null })).toMatchObject(
      noReps,
    );
    expect(setIssue({ ...step, repetitionsMaximum: null })).toMatchObject({
      ...noReps,
      message:
        'a last time + step set needs its reps: type one number, like 10, or a range, like 8-12.',
    });
    // The reps' own limits still come first, and a leftover fixed load never hides the step's.
    expect(setIssue({ ...step, repetitionsMinimum: 0 })?.field).toBe('repetitionsMinimum');
    expect(setIssue({ ...step, loadStep: null, manualLoadOverride: 80 })?.field).toBe('loadStep');
    expect(setIssue({ ...step, manualLoadOverride: -1 })).toBeNull();

    // Publish names where it is.
    const draft = program();
    const set = draft.weeks[0].sessions[0].exercises[1].sets[0];
    Object.assign(set, { ...step, key: set.key, loadStep: 0 });
    expect(draftProblem(draft)).toMatchObject({
      setKey: set.key,
      message:
        'Week 1, Lower A: a step must be more than 0 and at most 50 kg, with at most two decimals.',
    });
  });
});

describe('program builder library', () => {
  it('describes an exercise with its swaps and demos', () => {
    expect(squat).toMatchObject({
      detail: 'Barbell · Squat',
      group: 'squat',
      initials: 'BS',
      mediaId: null,
      alternatives: [{ id: 'safety-bar', name: 'Safety-bar squat', isArchived: false }],
    });
    expect(row.mediaId).toBe('media-1');
    // Every demo stays, in order, for the grid's Watch demo (P4).
    expect(row.mediaIds).toEqual(['media-1', 'media-2']);
    expect(squat.mediaIds).toEqual([]);
  });

  it('offers a chip only for the movements the library has, from the server counts', () => {
    const chips = libraryChips([
      { pattern: 'Squat', count: 4 },
      { pattern: 'HorizontalPull', count: '2' },
      { pattern: 'VerticalPull', count: 1 },
    ]);
    expect(chips.map((chip) => `${chip.label} ${chip.count}`)).toEqual([
      'All 7',
      'Squat 4',
      'Pull 3',
    ]);
    expect(libraryChips([]).map((chip) => chip.value)).toEqual(['all']);
  });

  it('asks the server for every pattern of a chip', () => {
    expect(groupPatterns('push')).toEqual(['HorizontalPush', 'VerticalPush']);
    expect(groupPatterns('other')).toEqual([
      'Carry',
      'Rotation',
      'Locomotion',
      'Mobility',
      'Other',
    ]);
    expect(groupPatterns('single')).toEqual(['Isolation']);
  });

  it('names the lifts a program needs read by id: its own and their approved swaps', () => {
    const draft = program();
    draft.weeks[0].sessions[0].exercises[1].approvedAlternativeExerciseIds = ['cable-row'];
    draft.weeks[1].sessions[0].exercises.push(emptyExercise(''));

    expect(programLibraryIds(draft).sort()).toEqual(['cable-row', 'row', 'squat']);
  });

  it('names a swap from the lift that offers it, and an archived one not at all', () => {
    const front = libraryExercise(
      exerciseView({
        id: 'front',
        name: 'Front squat',
        alternatives: [
          {
            exerciseId: 'safety-bar',
            exerciseName: 'Safety-bar squat',
            note: null,
            isArchived: false,
          },
          { exerciseId: 'old-squat', exerciseName: 'Old squat', note: null, isArchived: true },
        ],
      }),
    );
    const names = libraryNames([front, squat, row]);
    expect(names.get('safety-bar')).toBe('Safety-bar squat');
    expect(names.has('old-squat')).toBe(false);
    expect([names.get('squat'), names.get('row')]).toEqual(['Back squat', 'Chest-supported row']);
  });

  it('reads two filters the server answers alike as one search', () => {
    expect(libraryFilterKey({ query: ' Bench  Press ', group: 'all' })).toBe(
      libraryFilterKey({ query: 'bench press', group: 'all' }),
    );
    expect(libraryFilterKey({ query: '', group: 'all' })).not.toBe(
      libraryFilterKey({ query: '', group: 'push' }),
    );
  });
});

describe('program list and versions', () => {
  const template = {
    id: 'template-1',
    name: 'Strength base',
    currentVersionNumber: 3,
    isArchived: false,
    version: 7,
    versions: [
      {
        id: 'v3',
        versionNumber: 3,
        name: 'Strength base',
        isPublished: false,
        weekCount: 4,
        createdAtUtc: '2026-10-03T09:00:00Z',
      },
      {
        id: 'v2',
        versionNumber: 2,
        name: 'Strength base',
        isPublished: true,
        weekCount: 4,
        createdAtUtc: '2026-09-28T09:00:00Z',
      },
    ],
  } as ProgramTemplateSummary;

  it('shows a program that can be assigned, with newer changes not published yet', () => {
    expect(programCard(template, 'en-US')).toEqual({
      id: 'template-1',
      name: 'Strength base',
      link: ['/training/programs', 'template-1'],
      query: null,
      weeks: '4 weeks',
      status: 'Ready to assign',
      tone: 'success',
      note: 'Newest changes not published',
      changed: 'Changed Sat 3 Oct',
    });
    const draftOnly = { ...template, versions: [template.versions[0]] };
    expect(programCard(draftOnly, 'en-US')).toMatchObject({
      status: 'Draft',
      tone: 'neutral',
      note: null,
    });
  });

  it('shows the coach’s own changes on their program’s card, by their own length and date', () => {
    const changed = { ...template, draft: draftSummary({ weekCount: 6 }) };
    expect(programCard(changed, 'en-US')).toMatchObject({
      weeks: '6 weeks',
      note: 'Your changes are not published yet',
      changed: 'Changed Sun 4 Oct',
    });
  });

  it('shows a new program not published yet as the coach’s own, opening its draft', () => {
    expect(draftCard(draftSummary({ id: 'd-9', templateId: null, name: ' ' }), 'en-US')).toEqual({
      id: 'd-9',
      name: 'Untitled program',
      link: ['/training/programs', 'new'],
      query: { draft: 'd-9' },
      weeks: '1 week',
      status: 'Draft',
      tone: 'neutral',
      note: 'Only you can see it until you publish it',
      changed: 'Changed Sun 4 Oct',
    });
  });

  it('opens the newest version unless the address names an older one of this program', () => {
    expect(versionToOpen(template, null)).toBe('v3');
    expect(versionToOpen(template, 'v2')).toBe('v2');
    expect(versionToOpen(template, 'another-programs-version')).toBe('v3');
    expect(
      versionRows(template, 'v2', 'en-US').map((item) => [
        item.title,
        item.openLabel,
        item.state,
        item.isOpen,
      ]),
    ).toEqual([
      ['Version 3', 'Open version 3', 'Draft', false],
      ['Version 2', 'Open version 2', 'Published', true],
    ]);
  });
});

describe('program drafts', () => {
  it('keeps what the coach typed mid-edit and reads it back the same, names from the library', () => {
    const draft = draftFromContent(draftView());
    const week = draft.weeks[0];
    const squat = week.sessions[0].exercises[0];
    expect([draft.templateId, draft.sourceVersionId, draft.name]).toEqual([
      'template-1',
      'version-2',
      'Strength base',
    ]);
    expect([week.label, week.sessions[0].name, squat.exerciseName]).toEqual([
      'Week 1',
      'Lower A, heavier',
      'Back squat',
    ]);
    expect(squat.sets[0]).toMatchObject({
      repetitionsMinimum: 3,
      loadStrategy: 'PercentageWorkingMax',
      loadValue: 80,
      exertionTarget: 8,
      restSeconds: 180,
      tempo: '',
    });

    // Half-typed values travel as they are: the server checks them only on Publish.
    squat.sets[0].repetitionsMinimum = 0;
    week.sessions[0].name = '';
    const content = toDraftContent(draft);
    expect(content.weeks[0].sessions[0].name).toBe('');
    expect(content.weeks[0].sessions[0].exercises[0].sets[0].repetitionsMinimum).toBe(0);
    expect(Object.keys(content)).toEqual(['name', 'description', 'weeks']);

    const again = draftFromContent(draftView({ content }));
    expect(again.weeks[0].sessions[0].exercises[0].sets[0]).toMatchObject({
      repetitionsMinimum: 0,
      loadValue: 80,
    });
  });

  it('keeps a last time + step set’s step, start and unit whole through a save and a read (N6a)', () => {
    const draft = draftFromContent(draftView());
    const set = draft.weeks[0].sessions[0].exercises[0].sets[0];
    Object.assign(set, {
      loadStrategy: 'LastTimeStep',
      loadStep: 2.5,
      loadValue: 45,
      loadUnit: 'Pound',
      manualLoadOverride: null,
    });

    const content = toDraftContent(draft);
    expect(content.weeks[0].sessions[0].exercises[0].sets[0]).toMatchObject({
      loadStrategy: 'LastTimeStep',
      directLoad: 45,
      loadUnit: 'Pound',
      percentageWorkingMax: null,
      loadStep: 2.5,
      manualLoadOverride: null,
    });
    const again = draftFromContent(draftView({ content }));
    expect(again.weeks[0].sessions[0].exercises[0].sets[0]).toMatchObject({
      loadStrategy: 'LastTimeStep',
      loadStep: 2.5,
      loadValue: 45,
      loadUnit: 'Pound',
    });
    // Read again, it saves the same as it was read.
    expect(toDraftContent(again)).toEqual(content);
  });

  it('reads an RIR target back as RIR, and an exercise the library no longer has without a name', () => {
    const view = draftView();
    const set = view.content.weeks[0].sessions[0].exercises[0].sets[0];
    view.content.weeks[0].sessions[0].exercises[0].sets[0] = {
      ...set,
      exertionDisplayPreference: 'Rir',
      targetRpe: null,
      targetRir: 2,
    };
    view.exercises = [];
    const exercise = draftFromContent(view).weeks[0].sessions[0].exercises[0];
    expect([exercise.exerciseName, exercise.sets[0].exertionTarget]).toEqual(['', 2]);
  });
});
