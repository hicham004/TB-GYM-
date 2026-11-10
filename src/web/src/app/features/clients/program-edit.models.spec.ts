import type { ClientSessionState, ProgramEditPreviewView } from '../../core/api/generated';
import {
  chartSet,
  exerciseView,
  pastAndComingProgram as program,
  sessionView,
  setView,
} from '../../../testing/mesocycle-fixtures';
import { copySession, gridLines, moveSession } from '../training/program-builder.models';
import { type DraftExercise, withExertionPreference } from '../training/training-builder.models';
import {
  canMoveWeek,
  canRemoveWeek,
  duplicateEditWeek,
  editProblem,
  editRequest,
  editReview,
  hasEdits,
  isClosedDay,
  programEdit,
  savedLoadOf,
} from './program-edit.models';

// The program starts Mon 28 Sep and the workspace's today is Wed 7 Oct, in week 2.
const TODAY = '2026-10-07';

const states = new Map<string, ClientSessionState | null>([
  ['w1-mon', 'Completed'],
  ['w1-wed', 'Missed'],
  ['w1-fri', null],
  ['w2-mon', 'Missed'],
]);

describe('editing a client’s weeks: the grid', () => {
  it('opens with the workouts still to come, and locks what started or passed in its week', () => {
    const edit = programEdit(program(), TODAY, states);

    // Week 2 holds Monday's missed session, so weeks 1 and 2 keep their place.
    expect(edit.frozen).toBe(2);
    expect(edit.locked.get('w1')?.map((item) => [item.name, item.label])).toEqual([
      ['Lower A', 'Done'],
      ['Upper', 'Missed'],
      ['Lower B', 'Past'],
    ]);
    expect(edit.locked.get('w2')?.map((item) => item.id)).toEqual(['w2-mon']);
    expect(edit.locked.has('w3')).toBe(false);

    // Today's session is still open; only the open sessions are in the grid, with their ids.
    expect(edit.draft.weeks.map((week) => week.sessions.map((item) => item.sourceId))).toEqual([
      [],
      ['w2-wed', 'w2-fri'],
      ['w3-mon', 'w3-wed', 'w3-fri'],
    ]);
    expect(edit.draft.weeks.map((week) => week.sourceId)).toEqual(['w1', 'w2', 'w3']);
  });

  it('sends back what the server stored, so an untouched grid is no edit', () => {
    const view = program();
    const typed = view.weeks[2].sessions[0];
    typed.exercises[0].sets = [
      setView({
        position: 1,
        loadStrategy: 'Direct',
        loadUnit: 'Kilogram',
        directLoad: 100,
        prescribedLoad: 105,
        isManualLoadOverride: true,
        exertionDisplayPreference: 'Rir',
        targetRpe: 8,
        targetRir: 2,
        tempo: '3-1-1',
      }),
    ];
    const edit = programEdit(view, TODAY, states);
    const request = editRequest(edit.draft);

    expect(request[1]).toMatchObject({ weekId: 'w2', label: null, isPublished: true });
    expect(request[2].sessions[0]).toMatchObject({
      sessionId: 'w3-mon',
      session: { name: 'Lower A', dayOffset: 0 },
    });
    // A typed weight travels as the weight the client was given; reserve stays reserve.
    expect(request[2].sessions[0].session.exercises[0].sets[0]).toMatchObject({
      loadStrategy: 'Direct',
      directLoad: 100,
      manualLoadOverride: 105,
      targetRpe: null,
      targetRir: 2,
      tempo: '3-1-1',
    });
    expect(hasEdits(edit.draft, structuredClone(edit.draft))).toBe(false);

    const renamed = structuredClone(edit.draft);
    renamed.weeks[2].label = 'Deload';
    expect(hasEdits(edit.draft, renamed)).toBe(true);
  });

  it('sends a last time + step set back exactly as stored, start and step, so it is no edit (N6a)', () => {
    const view = program();
    const stored = [
      setView({
        id: 'start',
        position: 1,
        repetitionsMinimum: 10,
        repetitionsMaximum: 10,
        loadStrategy: 'LastTimeStep',
        loadUnit: 'Kilogram',
        directLoad: '5',
        prescribedLoad: '5',
        loadStep: '2',
        calculationStrategyKey: 'CoachStartingWeight',
      }),
      setView({
        id: 'no-start',
        position: 2,
        repetitionsMinimum: 8,
        repetitionsMaximum: 12,
        loadStrategy: 'LastTimeStep',
        loadUnit: 'Pound',
        loadStep: 2.5,
        exertionDisplayPreference: 'Rir',
        targetRpe: 8,
        targetRir: 2,
      }),
    ];
    view.weeks[2].sessions[0].exercises[0].sets = stored;
    const edit = programEdit(view, TODAY, states);
    const sent = editRequest(edit.draft)[2].sessions[0].session.exercises[0].sets;

    // Every field the server compares (SameSet) is what it stored.
    expect(sent).toEqual([
      expect.objectContaining({
        setType: 'Normal',
        repetitionsMinimum: 10,
        repetitionsMaximum: 10,
        loadStrategy: 'LastTimeStep',
        directLoad: 5,
        loadUnit: 'Kilogram',
        percentageWorkingMax: null,
        loadStep: 2,
        targetRpe: null,
        targetRir: null,
        manualLoadOverride: null,
      }),
      expect.objectContaining({
        repetitionsMinimum: 8,
        repetitionsMaximum: 12,
        loadStrategy: 'LastTimeStep',
        directLoad: null,
        loadUnit: 'Pound',
        percentageWorkingMax: null,
        loadStep: 2.5,
        targetRpe: null,
        targetRir: 2,
        manualLoadOverride: null,
      }),
    ]);
    expect(hasEdits(edit.draft, structuredClone(edit.draft))).toBe(false);

    // No max works it out, so no saved weight stands in for its words on the grid.
    const [first, second] = edit.draft.weeks[2].sessions[0].exercises[0].sets;
    expect([edit.savedLoads.has(first.key), edit.savedLoads.has(second.key)]).toEqual([
      false,
      false,
    ]);
    expect(
      gridLines(edit.draft.weeks[2].sessions[0].exercises[0], savedLoadOf(edit, 'en-US')),
    ).toEqual(['1 × 10 · last time + 2 kg · start 5 kg', '1 × 8–12 · last time + 2.5 lb · RIR 2']);

    // A changed step is an edit.
    const stepped = structuredClone(edit.draft);
    stepped.weeks[2].sessions[0].exercises[0].sets[0].loadStep = 2.5;
    expect(hasEdits(edit.draft, stepped)).toBe(true);
  });

  describe('the weight a set shows (critique B15)', () => {
    /** Week 3's Monday: 3 × 5 on the chart at 110 kg, 2 × 5 at 81% saved at 162.5 kg, one Epley set. */
    function opened() {
      const view = program();
      view.weeks[2].sessions[0].exercises = [
        exerciseView('squat', 'Back squat', [
          chartSet(1, { targetRpe: 8, prescribedLoad: 110 }),
          chartSet(2, { targetRpe: 8, prescribedLoad: 110 }),
          chartSet(3, { targetRpe: 8, prescribedLoad: 110 }),
        ]),
        exerciseView('deadlift', 'Deadlift', [
          setView({
            position: 1,
            loadStrategy: 'PercentageWorkingMax',
            loadUnit: 'Kilogram',
            percentageWorkingMax: 81,
            prescribedLoad: 162.5,
            targetRpe: 8,
          }),
          setView({
            position: 2,
            loadStrategy: 'PercentageWorkingMax',
            loadUnit: 'Kilogram',
            percentageWorkingMax: 81,
            prescribedLoad: 162.5,
            targetRpe: 8,
          }),
        ]),
        exerciseView('press', 'Overhead press', [
          setView({
            position: 1,
            loadStrategy: 'RpeBasedEpley',
            loadUnit: 'Pound',
            prescribedLoad: 81.25,
            targetRpe: 8,
          }),
        ]),
      ];
      const edit = programEdit(view, TODAY, states);
      const session = edit.draft.weeks[2].sessions[0];
      const lines = (exercise: DraftExercise) => gridLines(exercise, savedLoadOf(edit, 'en-US'));
      return { edit, session, lines };
    }

    it('reads the saved, rounded load of every set worked out from a max', () => {
      const { session, lines } = opened();

      expect(lines(session.exercises[0])).toEqual(['3 × 5 · 110 kg · RPE 8']);
      // The program's rounded load: 81% of 200 kg is 162 kg, 162.5 kg on a 2.5 kg step.
      expect(lines(session.exercises[1])).toEqual(['2 × 5 · 162.5 kg · RPE 8']);
      expect(lines(session.exercises[2])).toEqual(['1 × 5 · 81.25 lb · RPE 8']);
    });

    it('has nothing to say for a set no max worked out, whose line was the weight already', () => {
      const view = program();
      view.weeks[2].sessions[0].exercises[0].sets = [
        setView({
          position: 1,
          loadStrategy: 'Direct',
          loadUnit: 'Kilogram',
          directLoad: 100,
          prescribedLoad: 100,
          targetRpe: 7,
        }),
        setView({
          position: 2,
          loadStrategy: 'Direct',
          loadUnit: 'Kilogram',
          directLoad: 105,
          prescribedLoad: 105,
          isManualLoadOverride: true,
        }),
        setView({ position: 3 }),
      ];
      const edit = programEdit(view, TODAY, states);
      const [typed, fixed, open] = edit.draft.weeks[2].sessions[0].exercises[0].sets;

      expect(edit.savedLoads.size).toBeGreaterThan(0);
      for (const set of [typed, fixed, open]) expect(edit.savedLoads.has(set.key)).toBe(false);
      expect(
        gridLines(edit.draft.weeks[2].sessions[0].exercises[0], savedLoadOf(edit, 'en-US')),
      ).toEqual(['1 × 5 · 100 kg · RPE 7', '1 × 5 · 105 kg', '1 × 5']);
    });

    it('goes back to the share once what the weight came from changes, until the change is undone', () => {
      const { session, lines } = opened();
      const chart = session.exercises[0];
      const percent = session.exercises[1];

      chart.sets[2].exertionTarget = 9;
      expect(lines(chart)).toEqual([
        '2 × 5 · 110 kg · RPE 8',
        '1 × 5 · RPE 9 · 84% of training max',
      ]);
      chart.sets[2].exertionTarget = 8;
      expect(lines(chart)).toEqual(['3 × 5 · 110 kg · RPE 8']);

      // A chart set's top reps are read by the chart, its lowest are not.
      chart.sets[0].repetitionsMaximum = 6;
      expect(lines(chart)[0]).toBe('1 × 5–6 · RPE 8 · 79% of training max');
      chart.sets[0].repetitionsMaximum = 5;
      chart.sets[0].repetitionsMinimum = 3;
      expect(lines(chart)[0]).toBe('1 × 3–5 · 110 kg · RPE 8');

      percent.sets[0].loadValue = 85;
      expect(lines(percent)).toEqual([
        '1 × 5 · 85% of training max · RPE 8',
        '1 × 5 · 162.5 kg · RPE 8',
      ]);

      // Another formula is another weight, and a typed weight wins.
      chart.sets[1].loadStrategy = 'RpeBasedEpley';
      expect(lines(chart)[1]).toBe('1 × 5 · RPE 8 · 81% of training max');
      chart.sets[1].loadStrategy = 'RpeChart';
      chart.sets[1].manualLoadOverride = 112.5;
      expect(lines(chart)[1]).toBe('1 × 5 · 112.5 kg · RPE 8');
    });

    it('keeps the weight through what does not touch it: a % set’s reps, RIR for RPE, the rest', () => {
      const { session, lines } = opened();
      const percent = session.exercises[1];
      const chart = session.exercises[0];

      percent.sets[0].repetitionsMinimum = 8;
      percent.sets[0].repetitionsMaximum = 8;
      expect(lines(percent)).toEqual(['1 × 8 · 162.5 kg · RPE 8', '1 × 5 · 162.5 kg · RPE 8']);

      chart.sets = chart.sets.map((set) => withExertionPreference(set, 'Rir'));
      chart.sets[0].restSeconds = 240;
      chart.sets[0].setType = 'Top';
      expect(lines(chart)).toEqual(['3 × 5 · 110 kg · RIR 2']);
    });

    it('survives a move, while a copy or a new set waits for the server', () => {
      const { edit, session, lines } = opened();
      const week = edit.draft.weeks[2];
      const ref = { weekKey: week.key, sessionKey: session.key };

      // Moved, the session keeps what is stored, weights and all (TRN-028).
      const moved = moveSession(edit.draft, ref, { weekKey: week.key, day: 5 }, 0);
      const movedSession = moved.weeks[2].sessions.find((item) => item.key === session.key)!;
      expect(movedSession.dayOffset).toBe(5);
      expect(lines(movedSession.exercises[0])).toEqual(['3 × 5 · 110 kg · RPE 8']);

      const { draft, sessionKey } = copySession(edit.draft, ref);
      const copy = draft.weeks[2].sessions.find((item) => item.key === sessionKey)!;
      expect(lines(copy.exercises[0])).toEqual(['3 × 5 · RPE 8 · 81% of training max']);

      // As the set editor's Add a set like the last makes one: the same set under a new key.
      session.exercises[0].sets.push({ ...session.exercises[0].sets[2], key: 'added' });
      expect(lines(session.exercises[0])).toEqual([
        '3 × 5 · 110 kg · RPE 8',
        '1 × 5 · RPE 8 · 81% of training max',
      ]);
    });

    it('shows nothing it was not given, so a set with no saved load keeps its share', () => {
      const view = program();
      view.weeks[2].sessions[0].exercises[0].sets = [chartSet(1, { prescribedLoad: null })];
      const edit = programEdit(view, TODAY, states);

      expect(
        gridLines(edit.draft.weeks[2].sessions[0].exercises[0], savedLoadOf(edit, 'en-US')),
      ).toEqual(['1 × 5 · RPE 7 · 79% of training max']);
    });
  });

  it('keeps the weeks that hold the past in place, and puts a copy of one after them', () => {
    const edit = programEdit(program(), TODAY, states);
    const weeks = edit.draft.weeks;

    expect(canMoveWeek(edit, 3, 1, 1)).toBe(false);
    expect(canMoveWeek(edit, 3, 2, -1)).toBe(false);
    expect(canMoveWeek(edit, 4, 2, 1)).toBe(true);
    expect(canRemoveWeek(edit, 3, 1)).toBe(false);
    expect(canRemoveWeek(edit, 3, 2)).toBe(true);

    // A copy of week 1 cannot sit between weeks 1 and 2; it goes after week 2.
    const copied = duplicateEditWeek(edit, edit.draft, weeks[0].key);
    expect(copied.weeks.map((week) => week.sourceId)).toEqual(['w1', 'w2', null, 'w3']);
    // A copy of week 3 lands straight after it, its sessions new.
    const last = duplicateEditWeek(edit, edit.draft, weeks[2].key);
    expect(last.weeks.map((week) => week.sourceId)).toEqual(['w1', 'w2', 'w3', null]);
    expect(last.weeks[3].sessions.every((item) => item.sourceId === null)).toBe(true);
  });

  it('closes the days already gone and names a workout put on one', () => {
    const edit = programEdit(program(), TODAY, states);

    expect(isClosedDay(edit, 1, 1)).toBe(true);
    expect(isClosedDay(edit, 1, 2)).toBe(false);
    expect(editProblem(edit, edit.draft, 'en-US')).toBeNull();

    const week2 = edit.draft.weeks[1];
    const moved = moveSession(
      edit.draft,
      { weekKey: week2.key, sessionKey: week2.sessions[0].key },
      { weekKey: week2.key, day: 1 },
      0,
    );
    expect(editProblem(edit, moved, 'en-US')).toMatchObject({
      weekKey: week2.key,
      message: 'Week 2, Upper: Tue 6 Oct has passed. Move it to today or a later day.',
    });
  });
});

describe('editing a client’s weeks: the review', () => {
  function preview(overrides: Partial<ProgramEditPreviewView> = {}): ProgramEditPreviewView {
    return {
      previewHash: 'a'.repeat(64),
      ruleKey: 'GridEdit',
      ruleVersion: '1.0',
      today: TODAY,
      frozenWeekCount: 2,
      resultingWeekCount: 4,
      currentEndDateExclusive: '2026-10-19',
      resultingEndDateExclusive: '2026-10-26',
      isInsideTrainingCoverage: true,
      problems: [],
      weeksAdded: 1,
      weeksMoved: 0,
      weeksRemoved: 0,
      sessionsAdded: 1,
      sessionsEdited: 1,
      sessionsMoved: 1,
      sessionsRemoved: 0,
      weekChanges: [
        {
          kind: 'Added',
          weekNumber: 4,
          previousWeekNumber: null,
          label: 'Test week',
          isShared: false,
        },
      ],
      sessionChanges: [
        {
          kind: 'Edited',
          sessionId: 'w3-mon',
          weekNumber: 3,
          date: '2026-10-12',
          previousWeekNumber: null,
          previousDate: null,
          name: 'Lower A',
          weekIsShared: true,
          after: {
            ...sessionView('w3-mon', 'Lower A', [
              exerciseView('sq', 'Back squat', [
                chartSet(1, {
                  repetitionsMinimum: 3,
                  repetitionsMaximum: 3,
                  targetRpe: 8,
                  prescribedLoad: 87.5,
                }),
                chartSet(2, {
                  repetitionsMinimum: 3,
                  repetitionsMaximum: 3,
                  targetRpe: 8,
                  prescribedLoad: 87.5,
                }),
              ]),
            ]),
          },
        },
        {
          kind: 'Moved',
          sessionId: 'w3-wed',
          weekNumber: 3,
          date: '2026-10-15',
          previousWeekNumber: 3,
          previousDate: '2026-10-14',
          name: 'Upper',
          weekIsShared: true,
          after: null,
        },
        {
          kind: 'Added',
          sessionId: null,
          weekNumber: 4,
          date: '2026-10-19',
          previousWeekNumber: null,
          previousDate: null,
          name: 'Max day',
          weekIsShared: false,
          after: sessionView('new', 'Max day', []),
        },
      ],
      ...overrides,
    };
  }

  it('says what changes in a line, when the program now ends, and each weight it works out', () => {
    const review = editReview(preview(), 'Kilogram', 'en-US', 'Maya');

    expect(review.headline).toBe(
      '1 workout changed · 1 workout added · 1 workout moved · 1 week added',
    );
    expect(review.endLine).toBe('The program now ends Sun 25 Oct. It ended Sun 18 Oct before.');
    expect(review.hasChanges).toBe(true);
    expect(review.weeks).toEqual([
      expect.objectContaining({
        kind: 'New',
        title: 'Week 4 · Test week',
        hidden: 'Not shared with Maya',
      }),
    ]);
    const [edited, moved, added] = review.sessions;
    expect(edited).toMatchObject({
      kind: 'Changed',
      title: 'Week 3 · Mon 12 Oct · Lower A',
      from: null,
    });
    expect(edited.lines).toEqual([
      expect.objectContaining({ name: 'Back squat', sets: ['2 × 3 reps · 87.5 kg · RPE 8'] }),
    ]);
    expect(moved).toMatchObject({ kind: 'Moved', from: 'Was week 3, Wed 14 Oct', lines: [] });
    expect(added).toMatchObject({ kind: 'New', hidden: 'Not shared with Maya' });
  });

  it('reads a changed last time + step set as the grid does, its step after its weight (N6a)', () => {
    const step = {
      repetitionsMinimum: 10,
      repetitionsMaximum: 10,
      loadStrategy: 'LastTimeStep' as const,
      loadUnit: 'Kilogram' as const,
      loadStep: 2,
    };
    const [edited] = editReview(
      preview({
        sessionChanges: [
          {
            ...preview().sessionChanges[0],
            after: sessionView('w3-mon', 'Lower A', [
              exerciseView('goblet', 'Goblet squat', [
                setView({ ...step, position: 1, directLoad: 9, prescribedLoad: 9 }),
                setView({ ...step, position: 2, directLoad: 9, prescribedLoad: 9 }),
              ]),
              exerciseView('lunge', 'Walking lunge', [setView({ ...step, loadStep: 2.5 })]),
            ]),
          },
        ],
      }),
      'Kilogram',
      'en-US',
      'Maya',
    ).sessions;

    expect(edited.lines.map((line) => [line.name, line.sets])).toEqual([
      ['Goblet squat', ['2 × 10 reps · 9 kg · last time + 2 kg']],
      ['Walking lunge', ['10 reps · last time + 2.5 kg']],
    ]);
  });

  it('says whether a week that kept its place was renamed or shared differently', () => {
    const opened = programEdit(program(), TODAY, states).draft;
    opened.weeks[2].label = 'Week 3 · Heavy';
    const week = (label: string | null, isShared: boolean) =>
      editReview(
        preview({
          weekChanges: [{ kind: 'Edited', weekNumber: 3, previousWeekNumber: 3, label, isShared }],
          sessionChanges: [],
        }),
        'Kilogram',
        'en-US',
        'Maya',
        opened,
      ).weeks[0];

    // A label that names its own week is the title as it is.
    expect(week('Week 3 · Heavy singles', true)).toMatchObject({
      kind: 'Renamed',
      title: 'Week 3 · Heavy singles',
    });
    expect(week('Week 3 · Heavy', false)).toMatchObject({
      kind: 'No longer shared with Maya',
      tone: 'warning',
      hidden: 'Not shared with Maya',
    });
    expect(week('Deload', false)).toMatchObject({
      kind: 'Renamed · No longer shared with Maya',
      title: 'Week 3 · Deload',
    });
  });

  it('passes on what stops the edit, and says when nothing changes', () => {
    const blocked = editReview(
      preview({
        problems: [
          'The program would run until Sun 25 Oct 2026, but the plan it belongs to ends Sun 18 Oct 2026. Remove a week, or renew the plan first.',
        ],
      }),
      'Kilogram',
      'en-US',
      'Maya',
    );
    expect(blocked.problems).toHaveLength(1);

    const none = editReview(
      preview({
        weeksAdded: 0,
        sessionsAdded: 0,
        sessionsEdited: 0,
        sessionsMoved: 0,
        weekChanges: [],
        sessionChanges: [],
        resultingEndDateExclusive: '2026-10-19',
      }),
      'Kilogram',
      'en-US',
      'Maya',
    );
    expect(none).toMatchObject({ headline: 'Nothing changes', endLine: null, hasChanges: false });
  });
});
