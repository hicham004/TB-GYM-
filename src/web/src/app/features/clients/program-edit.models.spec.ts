import type { ClientSessionState, ProgramEditPreviewView } from '../../core/api/generated';
import {
  chartSet,
  exerciseView,
  pastAndComingProgram as program,
  sessionView,
  setView,
} from '../../../testing/mesocycle-fixtures';
import { moveSession } from '../training/program-builder.models';
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
  it('opens with the sessions still to come, and locks what started or passed in its week', () => {
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

  it('closes the days already gone and names a session put on one', () => {
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
      '1 session changed · 1 session added · 1 session moved · 1 week added',
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
