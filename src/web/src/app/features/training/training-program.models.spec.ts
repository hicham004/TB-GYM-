import { describe, expect, it } from 'vitest';
import {
  historyItem,
  historyPage,
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
});

describe('addDays', () => {
  it('moves across month ends without a time zone', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
