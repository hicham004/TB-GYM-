import { describe, expect, it } from 'vitest';
import type { CheckInAssignmentListItem, ClientWorkoutView } from '../../core/api/generated';
import type { Conversation } from '../messaging/messaging.models';
import type { NutritionDay } from '../nutrition/nutrition.models';
import { day, decision, TODAY, upcoming, workout } from '../../../testing/today-fixtures';
import { checkInRow, coachMessage, nutritionRow, trainingCard } from './today.models';

describe('Today training card', () => {
  it('schedules today’s session with its exercise and set counts', () => {
    const card = trainingCard(day([workout()]), upcoming(), false);
    expect(card).toMatchObject({ kind: 'scheduled', moreToday: 0 });
    expect(card.kind === 'scheduled' && card.summary).toEqual({
      exercises: 3,
      sets: 10,
      setsLogged: 0,
    });
  });

  it('continues a session started today and counts the logged sets', () => {
    const started = workout({
      workoutExecutionId: 'execution-1',
      status: 'InProgress',
      exercises: [
        { sets: [{ isCompleted: true }, { isCompleted: true }, { isCompleted: false }] },
      ] as ClientWorkoutView['exercises'],
    });
    const card = trainingCard(day([started]), upcoming(), false);
    expect(card).toMatchObject({ kind: 'in-progress', startedOn: null, alsoToday: null });
    expect(card.kind === 'in-progress' && card.summary).toEqual({
      exercises: 1,
      sets: 3,
      setsLogged: 2,
    });
  });

  it('puts an earlier unfinished workout first and offers today’s session as a link', () => {
    const earlier = workout({
      sessionId: 'session-a',
      name: 'Lower A',
      status: 'InProgress',
      workoutExecutionId: 'x',
    });
    const card = trainingCard(
      day([workout()]),
      upcoming({
        unfinishedWorkouts: [{ date: '2026-09-19', workout: earlier, hasMoreNotes: false }],
      }),
      false,
    );
    expect(card).toMatchObject({ kind: 'in-progress', startedOn: '2026-09-19', moreToday: 0 });
    expect(card.kind === 'in-progress' && card.workout.name).toBe('Lower A');
    expect(card.kind === 'in-progress' && card.alsoToday?.name).toBe('Upper Body — Strength B');
  });

  it('says the day is done once every session today is completed', () => {
    const done = workout({ status: 'Completed', workoutExecutionId: 'execution-1' });
    expect(trainingCard(day([done]), upcoming(), false)).toMatchObject({ kind: 'completed' });
  });

  it('shows the first unfinished session of several and counts the rest', () => {
    const done = workout({ sessionId: 'a', status: 'Completed', workoutExecutionId: 'x' });
    const second = workout({ sessionId: 'b', name: 'Conditioning' });
    const third = workout({ sessionId: 'c', name: 'Mobility' });
    const card = trainingCard(day([done, second, third]), upcoming(), false);
    expect(card).toMatchObject({ kind: 'scheduled', moreToday: 1 });
    expect(card.kind === 'scheduled' && card.workout.name).toBe('Conditioning');
  });

  it('calls it a rest day only inside a block whose week is shared, with the next session', () => {
    const next = { sessionId: 'next', date: '2026-09-22', name: 'Lower B' };
    expect(trainingCard(day(), upcoming({ nextSession: next }), false)).toEqual({
      kind: 'rest-day',
      next: { date: '2026-09-22', name: 'Lower B' },
    });
  });

  it('says this week’s plan is on its way when the current week is not published', () => {
    const coverage = upcoming().todayCoverage!;
    const hidden = {
      ...coverage,
      activeBlock: { ...coverage.activeBlock!, isCurrentWeekPublished: false },
    };
    // The old flags (assigned + visible sessions) would have called this a rest day.
    expect(trainingCard(day(), upcoming({ todayCoverage: hidden }), false)).toEqual({
      kind: 'week-not-shared',
    });
  });

  it('gives the next start date between programs, even when that block is already visible', () => {
    const between = upcoming({
      nextSession: { sessionId: 'next', date: '2026-10-05', name: 'Week 1' },
      todayCoverage: { activeBlock: null, nextBlockStartDate: '2026-10-05' },
    });
    expect(trainingCard(day(), between, false)).toEqual({
      kind: 'between-programs',
      startsOn: '2026-10-05',
    });
  });

  it('says nothing is assigned when no block covers today or later', () => {
    const none = upcoming({
      hasAssignedProgram: false,
      todayCoverage: { activeBlock: null, nextBlockStartDate: null },
    });
    expect(trainingCard(day(), none, false)).toEqual({ kind: 'nothing-assigned' });
  });

  it('explains closed access with the deciding reason', () => {
    expect(trainingCard(day([], false, 'Paused'), upcoming(), false)).toEqual({
      kind: 'access-closed',
      reason: 'Paused',
    });
    expect(
      trainingCard(day(), upcoming({ isAllowed: false, accessReason: 'Expired' }), false),
    ).toEqual({
      kind: 'access-closed',
      reason: 'Expired',
    });
  });

  it('hides training outside the plan when something else is in it, and says nothing is assigned otherwise', () => {
    const outside = day([], false, 'NoEntitlement');
    expect(trainingCard(outside, upcoming(), true)).toEqual({ kind: 'hidden' });
    expect(trainingCard(outside, upcoming(), false)).toEqual({ kind: 'nothing-assigned' });
  });
});

describe('Today nutrition row', () => {
  const plan = (logStatus: NutritionDay['logStatus'], selected: (string | null)[]): NutritionDay =>
    ({
      logStatus,
      slots: selected.map((selectedChoiceId, order) => ({ id: `${order}`, selectedChoiceId })),
    }) as NutritionDay;

  it('reads the day’s meals and how many are logged', () => {
    const allowed = decision('Nutrition');
    expect(
      nutritionRow(allowed, 'loaded', { kind: 'ok', value: plan(null, [null, null, null, null]) }),
    ).toEqual({
      kind: 'ready',
      value: { kind: 'planned', total: 4 },
    });
    expect(
      nutritionRow(allowed, 'loaded', {
        kind: 'ok',
        value: plan('InProgress', ['a', 'b', null, null]),
      }),
    ).toEqual({
      kind: 'ready',
      value: { kind: 'logging', logged: 2, total: 4 },
    });
    expect(
      nutritionRow(allowed, 'loaded', {
        kind: 'ok',
        value: plan('Completed', ['a', 'b', 'c', 'd']),
      }),
    ).toEqual({
      kind: 'ready',
      value: { kind: 'completed', logged: 4, total: 4 },
    });
  });

  it('reads a 404 as "no plan today" only when nutrition is allowed', () => {
    const missing = { kind: 'missing' } as const;
    expect(nutritionRow(decision('Nutrition'), 'loaded', missing)).toEqual({
      kind: 'ready',
      value: { kind: 'no-plan' },
    });
    expect(nutritionRow(null, 'loading', missing)).toEqual({ kind: 'loading' });
    expect(nutritionRow(null, 'failed', missing)).toEqual({ kind: 'failed' });
  });

  it('has no row outside the plan, and a reason when closed', () => {
    expect(
      nutritionRow(decision('Nutrition', 'NoEntitlement'), 'loaded', { kind: 'missing' }),
    ).toEqual({ kind: 'hidden' });
    expect(nutritionRow(decision('Nutrition', 'Paused'), 'loaded', { kind: 'missing' })).toEqual({
      kind: 'closed',
      reason: 'Paused',
    });
  });

  it('fails on its own', () => {
    expect(nutritionRow(decision('Nutrition'), 'loaded', { kind: 'failed' })).toEqual({
      kind: 'failed',
    });
  });
});

describe('Today check-in row', () => {
  const item = (
    dueDate: string,
    response: CheckInAssignmentListItem['response'] = null,
    title = 'Weekly check-in',
  ) => ({ assignment: { formTitle: title, dueDate }, response }) as CheckInAssignmentListItem;
  const list = (...items: CheckInAssignmentListItem[]) =>
    ({ kind: 'ok', value: { clientProfileId: 'c', total: items.length, items } }) as const;
  const allowed = decision('CheckIns');

  it('picks the open assignment due first and says when it is due', () => {
    const rows = list(item('2026-09-27', null, 'Later'), item('2026-09-20', null, 'Now'));
    expect(checkInRow(allowed, rows, TODAY)).toMatchObject({
      value: { kind: 'due', title: 'Now', when: 'today' },
    });
    expect(checkInRow(allowed, list(item('2026-09-22')), TODAY)).toMatchObject({
      value: { when: 'later' },
    });
    expect(checkInRow(allowed, list(item('2026-09-18')), TODAY)).toMatchObject({
      value: { when: 'overdue' },
    });
  });

  it('counts a draft as still open and says so', () => {
    const draft = item('2026-09-20', { status: 'Draft' } as CheckInAssignmentListItem['response']);
    expect(checkInRow(allowed, list(draft), TODAY)).toMatchObject({
      value: { kind: 'due', draft: true },
    });
  });

  it('shows one sent today, submitted or reviewed', () => {
    const sent = (status: 'Submitted' | 'Reviewed') =>
      item('2026-09-20', { status, submittedDate: TODAY } as CheckInAssignmentListItem['response']);
    expect(checkInRow(allowed, list(sent('Submitted')), TODAY)).toMatchObject({
      value: { kind: 'submitted-today' },
    });
    expect(checkInRow(allowed, list(sent('Reviewed')), TODAY)).toMatchObject({
      value: { kind: 'reviewed-today' },
    });
  });

  it('says nothing is due otherwise, and the reason when closed', () => {
    expect(checkInRow(allowed, list(), TODAY)).toEqual({
      kind: 'ready',
      value: { kind: 'nothing-due' },
    });
    expect(checkInRow(decision('CheckIns', 'Expired'), list(), TODAY)).toEqual({
      kind: 'closed',
      reason: 'Expired',
    });
    expect(checkInRow(decision('CheckIns', 'NoEntitlement'), list(), TODAY)).toEqual({
      kind: 'hidden',
    });
  });
});

describe('Today coach message', () => {
  const conversation = (lastMessage: Conversation['lastMessage']) =>
    ({ lastMessage }) as Conversation;

  it('shows the latest conversation only when it has a message', () => {
    const message = { body: 'Hi' } as NonNullable<Conversation['lastMessage']>;
    expect(
      coachMessage(decision('Messaging'), { kind: 'ok', value: conversation(message) }),
    ).toMatchObject({ kind: 'ready' });
    expect(coachMessage(decision('Messaging'), { kind: 'ok', value: conversation(null) })).toEqual({
      kind: 'hidden',
    });
    expect(coachMessage(decision('Messaging'), { kind: 'ok', value: null })).toEqual({
      kind: 'hidden',
    });
  });

  it('keeps a closed conversation, but shows nothing when messaging is outside the plan', () => {
    const message = { body: 'Hi' } as NonNullable<Conversation['lastMessage']>;
    expect(
      coachMessage(decision('Messaging', 'Expired'), { kind: 'ok', value: conversation(message) }),
    ).toMatchObject({
      kind: 'ready',
    });
    expect(
      coachMessage(decision('Messaging', 'NoEntitlement'), {
        kind: 'ok',
        value: conversation(message),
      }),
    ).toEqual({
      kind: 'hidden',
    });
    expect(coachMessage(null, { kind: 'failed' })).toEqual({ kind: 'failed' });
  });
});
