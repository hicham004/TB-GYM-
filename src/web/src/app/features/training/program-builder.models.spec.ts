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
  exerciseSummary,
  setSummary,
  setIssue,
  filterLibrary,
  gridColumns,
  libraryChips,
  libraryExercise,
  type LibraryExercise,
  moveWeek,
  draftCard,
  programCard,
  removeWeek,
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
    alternatives: [{ exerciseId: 'safety-bar', exerciseName: 'Safety-bar squat', note: null }],
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
    expect(setSummary({ ...set, loadStrategy: 'RpeBasedEpley' })).toBe(
      '3–6 · Load from training max & effort · RPE 8',
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
  it('gives room to days that hold a session in any week and keeps rest days a thin strip', () => {
    expect(gridColumns(program())).toBe(
      [0, 1, 2, 3, 4, 5, 6]
        .map((day) => (day === 0 || day === 2 ? 'minmax(9rem, 1fr)' : '2.5rem'))
        .join(' '),
    );
  });

  it('sums an exercise up in one line, from its working sets', () => {
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
    expect(exerciseSummary(exercise)).toBe('3 × 5 · 75% · RPE 7');

    exercise.sets = [working, { ...working }, { ...working }];
    expect(exerciseSummary(exercise)).toBe('3 × 5 · 75% · RPE 7');

    const range = { ...emptySet(), repetitionsMinimum: 8, repetitionsMaximum: 10 };
    range.loadStrategy = 'Direct';
    range.loadValue = 60;
    range.exertionDisplayPreference = 'Rir';
    range.exertionTarget = 2;
    exercise.sets = [range, { ...range }];
    expect(exerciseSummary(exercise)).toBe('2 × 8–10 · 60 kg · RIR 2');

    // The audit's case: a warm-up with the working set's reps once read "2 × 8–10".
    exercise.sets = [{ ...range, setType: 'WarmUp' as const, loadValue: 40 }, range];
    expect(exerciseSummary(exercise)).toBe('1 × 8–10 · 60 kg · RIR 2');

    // Working sets that disagree on reps are counted alone too.
    exercise.sets = [warmUp, working, { ...working, repetitionsMinimum: 3, repetitionsMaximum: 3 }];
    expect(exerciseSummary(exercise)).toBe('2 sets · 75% · RPE 7');

    // Warm-ups alone say what they are.
    exercise.sets = [warmUp, { ...warmUp }];
    expect(exerciseSummary(exercise)).toBe('2 × 3 warm-up · 40 kg');
    exercise.sets = [warmUp, { ...warmUp, repetitionsMinimum: 5, repetitionsMaximum: 5 }];
    expect(exerciseSummary(exercise)).toBe('2 warm-up sets · 40 kg');
  });
});

describe('program builder drops', () => {
  it('takes exercises into sessions, sessions onto days, and an exercise onto an empty day only', () => {
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

  it('moves an exercise within a session and between sessions', () => {
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

  it('starts a session on an empty day from an exercise, and refuses a day that has one', () => {
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

  it('moves a session to another day and week, keeping each week in day order', () => {
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

  it('drops a fresh copy of a saved session, never the saved one itself', () => {
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
  it('copies a session to the next free day, or beside it when the week is full', () => {
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
    expect(draftProblem(draft)?.message).toBe('Week 2, Day 1: give the session a name.');
  });
});

describe('program builder library', () => {
  it('describes an exercise and finds it ignoring case and accents', () => {
    expect(squat).toMatchObject({
      detail: 'Barbell · Squat',
      group: 'squat',
      initials: 'BS',
      mediaId: null,
    });
    expect(row.mediaId).toBe('media-1');
    // Every demo stays, in order, for the grid's Watch demo (P4).
    expect(row.mediaIds[0]).toBe('media-1');
    expect(squat.mediaIds).toEqual([]);

    const presse = libraryExercise(exerciseView({ id: 'press', name: 'Développé couché' }));
    const items = [squat, row, presse];
    expect(filterLibrary(items, 'DEVELOPPE', 'all').map((item) => item.id)).toEqual(['press']);
    expect(filterLibrary(items, 'dumbbell', 'all').map((item) => item.id)).toEqual(['row']);
    expect(filterLibrary(items, '', 'pull').map((item) => item.id)).toEqual(['row']);
  });

  it('offers a chip only for the movements the library has', () => {
    expect(libraryChips([squat, row]).map((chip) => `${chip.label} ${chip.count}`)).toEqual([
      'All 2',
      'Squat 1',
      'Pull 1',
    ]);
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
