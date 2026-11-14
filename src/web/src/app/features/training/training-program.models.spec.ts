import { describe, expect, it } from 'vitest';
import {
  historyItem,
  historyPage,
  nextProgramView,
  PROGRAM_TODAY,
  programSession,
  programView,
} from '../../../testing/training-program-fixtures';
import {
  addDays,
  focusWeek,
  mapTrainingProgram,
  mapWorkoutHistory,
  programAction,
  weekFill,
  type TrainingProgram,
} from './training-program.models';

function program(view = programView()): TrainingProgram {
  return mapTrainingProgram(view).program!;
}

function withWeek3(...sessions: ReturnType<typeof programSession>[]) {
  const view = programView();
  view.program!.weeks[2] = { ...view.program!.weeks[2], sessions };
  return program(view);
}

describe('mapTrainingProgram', () => {
  it('keeps the server’s states and counts, and ends on the last calendar day', () => {
    const plan = program();
    expect(plan.lastDate).toBe('2026-10-11');
    expect([plan.currentWeek, plan.weekCount, plan.completedCount, plan.missedCount]).toEqual([
      3, 4, 4, 1,
    ]);
    expect(plan.weeks.map((week) => [week.number, week.done, week.missed, week.isCurrent])).toEqual(
      [
        [1, 2, 0, false],
        [2, 1, 1, false],
        [3, 1, 0, true],
        [4, 0, 0, false],
      ],
    );
    expect(plan.weeks[3].visible).toBe(false);
  });

  it('reads a next program shown early beside the one that runs (critique B18)', () => {
    const read = mapTrainingProgram(programView({ nextProgram: nextProgramView() }));

    expect(read.program?.name).toBe('Strength Foundations');
    expect(read.nextProgram).toMatchObject({
      name: 'Summer Strength',
      phase: 'Upcoming',
      lastDate: '2026-10-25',
      currentWeek: null,
    });
    const sessions = read.nextProgram!.weeks.flatMap((week) => week.sessions);
    expect(sessions.map((session) => session.state)).toEqual(['Upcoming', 'Upcoming', 'Upcoming']);
    expect(sessions.some((session) => session.opensPlayer || session.canDoNow)).toBe(false);
    expect(mapTrainingProgram(programView()).nextProgram).toBeNull();
  });

  it('gives each week its last day, seven days from its first (CLIENT-4)', () => {
    expect(program().weeks.map((week) => [week.startDate, week.lastDate])).toEqual([
      ['2026-09-14', '2026-09-20'],
      ['2026-09-21', '2026-09-27'],
      ['2026-09-28', '2026-10-04'],
      ['2026-10-05', '2026-10-11'],
    ]);
  });

  it('offers "Do it now" only for a missed session of the program running now (CLIENT-12)', () => {
    const running = program().weeks.flatMap((week) => week.sessions);
    expect(
      running.filter((session) => session.canDoNow).map((session) => session.sessionId),
    ).toEqual(['s4']);
    const finished = programView();
    finished.program = { ...finished.program!, phase: 'Finished', currentWeekNumber: null };
    expect(
      program(finished)
        .weeks.flatMap((week) => week.sessions)
        .some((session) => session.canDoNow),
    ).toBe(false);
  });

  it('carries the day a workout was started and whether that was late (TRN-020 v2)', () => {
    const sessions = withWeek3(
      {
        ...programSession('late', 'Upper A', '2026-09-28', 'Completed'),
        startedOn: '2026-09-30',
        isLate: true,
      },
      {
        ...programSession('kept', 'Lower A', '2026-09-29', 'Completed'),
        startedOn: '2026-09-29',
        isLate: false,
      },
      programSession('older', 'Upper B', '2026-09-30', 'Today'),
    ).weeks[2].sessions;
    expect(sessions.map((session) => [session.startedOn, session.isLate])).toEqual([
      ['2026-09-30', true],
      ['2026-09-29', false],
      [null, false],
    ]);
  });

  it('offers an early start only where the server says so, on a session still to come (notes plan N9c4)', () => {
    const sessions = withWeek3(
      { ...programSession('early', 'Upper B', '2026-10-02', 'Upcoming'), canStartEarly: true },
      { ...programSession('kept', 'Lower B', '2026-10-03', 'Upcoming'), canStartEarly: false },
      // A read from before early starts carries no flag.
      programSession('old', 'Upper C', '2026-10-04', 'Upcoming'),
      // Once started it is no longer to come.
      { ...programSession('begun', 'Lower C', '2026-10-01', 'InProgress'), canStartEarly: true },
    ).weeks[2].sessions;
    expect(sessions.map((session) => [session.sessionId, session.canStartEarly])).toEqual([
      ['early', true],
      ['kept', false],
      ['old', false],
      ['begun', false],
    ]);
    expect(sessions[0]).toMatchObject({ opensPlayer: false, canDoNow: false });
  });

  it('opens the player only for today’s sessions and unfinished ones', () => {
    const sessions = withWeek3(
      programSession('a', 'Earlier', '2026-09-28', 'Completed'),
      programSession('b', 'Done today', PROGRAM_TODAY, 'Completed'),
      programSession('c', 'Left open', '2026-09-29', 'InProgress'),
      programSession('d', 'Missed', '2026-09-29', 'Missed'),
      programSession('e', 'Later', '2026-10-02', 'Upcoming'),
    ).weeks[2].sessions;
    expect(sessions.map((session) => session.opensPlayer)).toEqual([
      false,
      true,
      true,
      false,
      false,
    ]);
  });
});

describe('programAction', () => {
  it('starts today’s session', () => {
    const action = programAction(program(), PROGRAM_TODAY);
    expect(action.kind).toBe('start');
    expect(action.kind === 'start' && action.session.sessionId).toBe('s6');
  });

  it('continues today’s started session before one left open on an earlier day', () => {
    const plan = withWeek3(
      programSession('old', 'Left open', '2026-09-28', 'InProgress'),
      programSession('now', 'Lower A', PROGRAM_TODAY, 'InProgress'),
    );
    const action = programAction(plan, PROGRAM_TODAY);
    expect(action.kind === 'continue' && action.session.sessionId).toBe('now');
  });

  it('continues a session started early today before today’s own (TRN-020, notes plan N9c4)', () => {
    const plan = withWeek3(programSession('due', 'Lower A', PROGRAM_TODAY, 'Today'), {
      ...programSession('early', 'Upper B', '2026-10-02', 'InProgress'),
      startedOn: PROGRAM_TODAY,
    });
    const action = programAction(plan, PROGRAM_TODAY);
    expect(action.kind === 'continue' && action.session.sessionId).toBe('early');

    // Started early on an earlier day, it waits behind today's session.
    const earlier = withWeek3(programSession('due', 'Lower A', PROGRAM_TODAY, 'Today'), {
      ...programSession('early', 'Upper B', '2026-10-02', 'InProgress'),
      startedOn: '2026-09-29',
    });
    expect(programAction(earlier, PROGRAM_TODAY).kind).toBe('start');
  });

  it('then an unfinished earlier session, today’s finished one, and what comes next', () => {
    const open = withWeek3(programSession('old', 'Left open', '2026-09-28', 'InProgress'));
    expect(programAction(open, PROGRAM_TODAY).kind).toBe('continue');

    const done = withWeek3(programSession('t', 'Lower A', PROGRAM_TODAY, 'Completed'));
    expect(programAction(done, PROGRAM_TODAY).kind).toBe('view');

    const later = withWeek3(programSession('n', 'Lower B', '2026-10-01', 'Upcoming'));
    const next = programAction(later, PROGRAM_TODAY);
    expect(next.kind === 'next' && next.session.name).toBe('Lower B');

    expect(programAction(withWeek3(), PROGRAM_TODAY).kind).toBe('none');
  });
});

describe('focusWeek and weekFill', () => {
  it('focuses this week, the first week before the start, and nothing once finished', () => {
    expect(focusWeek(program())?.number).toBe(3);
    const upcoming = programView();
    upcoming.program!.phase = 'Upcoming';
    upcoming.program!.currentWeekNumber = null;
    expect(focusWeek(program(upcoming))?.number).toBe(1);
    const finished = programView();
    finished.program!.phase = 'Finished';
    finished.program!.currentWeekNumber = null;
    expect(focusWeek(program(finished))).toBeNull();
  });

  it('fills a week by the share of its sessions done', () => {
    expect(program().weeks.map(weekFill)).toEqual([100, 50, 50, 0]);
  });
});

describe('mapWorkoutHistory', () => {
  it('turns seconds into whole minutes and keeps records with their units', () => {
    const history = mapWorkoutHistory(historyPage([historyItem()], 10));
    const [item] = history.items;
    expect(item.minutes).toBe(52);
    expect(item.records).toEqual([
      { id: 'set-9', exercise: 'Bench press', reps: 6, load: 62.5, unit: 'Kilogram' },
    ]);
    expect(item.volume).toEqual([{ unit: 'Kilogram', amount: 4250 }]);
    expect(history.nextSkip).toBe(10);
  });

  it('shows no duration for a workout opened and finished within a minute', () => {
    expect(
      mapWorkoutHistory(historyPage([historyItem({ durationSeconds: 40 })])).items[0].minutes,
    ).toBeNull();
  });

  it('tells a workout of one’s own from a program’s, and reads an item with no flag as a program’s (TRN-033)', () => {
    const items = mapWorkoutHistory(
      historyPage([
        historyItem({
          workoutExecutionId: 'own-1',
          name: 'Workout',
          programName: '',
          isOwnWorkout: true,
        }),
        historyItem({ workoutExecutionId: 'w-s3', isOwnWorkout: false }),
        // A read from before workouts of one's own carries no flag.
        historyItem({ workoutExecutionId: 'w-s1' }),
      ]),
    ).items;

    expect(items.map((item) => [item.id, item.isOwn])).toEqual([
      ['own-1', true],
      ['w-s3', false],
      ['w-s1', false],
    ]);
    expect(items[0]).toMatchObject({ name: 'Workout', programName: '', isOwn: true });
    expect(items[1].programName).toBe('Strength Foundations');
  });
});

describe('addDays', () => {
  it('moves across month ends without a time zone', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
