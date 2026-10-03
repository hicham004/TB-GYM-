import { describe, expect, it } from 'vitest';
import type { SetPrescriptionView, TrainingSessionView } from '../../core/api/generated';
import { COACH_TODAY } from '../../../testing/coach-today-fixtures';
import {
  cancelledBlock,
  completedBlock,
  endedBlock,
  plannedBlock,
  programBlock,
  programWeek,
  runningBlock,
} from '../../../testing/client-program-fixtures';
import {
  blockCard,
  exerciseLines,
  focusBlockId,
  otherBlocks,
  programMenu,
  setLines,
  type ProgramContext,
} from './client-program.models';

const context: ProgramContext = { locale: 'en-US', today: COACH_TODAY, firstName: 'Maya' };

describe('which program the page opens on', () => {
  it('opens on the one running, whatever order they come in', () => {
    const blocks = [plannedBlock(), runningBlock(), completedBlock()];

    expect(focusBlockId(blocks)).toBe('block-lean');
  });

  it('opens on the one starting soonest when none is running', () => {
    const later = plannedBlock({ id: 'later', start: '2026-12-07' });
    const sooner = plannedBlock({ id: 'sooner', start: '2026-10-26' });

    expect(focusBlockId([later, completedBlock(), sooner])).toBe('sooner');
  });

  it('does not take a program past its last day for the one running', () => {
    // The server sends newest first; an old program that never closed is still "active" on paper.
    expect(focusBlockId([runningBlock(), endedBlock()])).toBe('block-lean');
    expect(focusBlockId([endedBlock(), completedBlock()])).toBe('block-phase-1');
  });

  it('opens on the newest that ended when nothing is running or coming', () => {
    // The server sends newest first, so the first is the newest.
    expect(focusBlockId([completedBlock(), cancelledBlock()])).toBe('block-first');
    expect(focusBlockId([])).toBeNull();
  });
});

describe('the running program in coach words', () => {
  const card = blockCard(runningBlock(), context);

  it('says where it stands: the week, the dates, the sessions done and the misses', () => {
    expect(card).toMatchObject({
      name: 'Lean & Strong · Phase 2',
      eyebrow: 'Week 3 of 6',
      pill: { label: 'Week 3 of 6', tone: 'success' },
      currentWeek: 3,
      openWeek: 3,
      weekCount: 6,
      sessionCount: 24,
      doneCount: 9,
      missedCount: 1,
      terminal: false,
    });
    expect(card.facts).toEqual([
      { text: 'Mon 14 Sep – Sun 25 Oct', warm: false },
      { text: '9 of 24 sessions done', warm: false },
      { text: '1 missed', warm: true },
    ]);
  });

  it('carries the token its changes send back, and never shows a raw date', () => {
    expect(card.version).toBe(4);
    const text = JSON.stringify([card.eyebrow, card.facts, card.weeks.map((week) => week.range)]);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('names a week, its days and how far it has got', () => {
    const [first, second, third, fourth] = card.weeks;

    expect(first).toMatchObject({
      title: 'Week 1',
      range: '14–20 Sep',
      summary: '4 of 4 done',
      fill: 100,
    });
    expect(second).toMatchObject({ summary: '3 of 4 done', missed: 1, fill: 75 });
    // A range that crosses a month says both.
    expect(third).toMatchObject({
      title: 'Week 3',
      range: '28 Sep – 4 Oct',
      isCurrent: true,
      summary: '2 of 4 done',
      done: 2,
    });
    // A week that has not begun counts its sessions instead of "0 of 4 done".
    expect(fourth).toMatchObject({ range: '5–11 Oct', isCurrent: false, summary: '4 sessions' });
    expect(card.weeks.filter((week) => week.isCurrent).map((week) => week.number)).toEqual([3]);
  });

  it('marks each session by what the server says, in words as well as marks', () => {
    const week = card.weeks[2];

    expect(
      week.sessions.map((session) => [session.name, session.day, session.mark, session.markLabel]),
    ).toEqual([
      ['Lower A', 'Mon 28 Sep', 'done', 'Done'],
      ['Upper A', 'Tue 29 Sep', 'done', 'Done'],
      ['Lower B', 'Thu 1 Oct', 'today', 'Today'],
      ['Upper B', 'Fri 2 Oct', 'upcoming', 'Upcoming'],
    ]);
    expect(week.sessions[0].detail).toBe('4 exercises · 12 sets');
    expect(card.weeks[1].sessions[2]).toMatchObject({ mark: 'missed', markLabel: 'Missed' });
  });

  it('keeps the workout of a session that was started, and none for one that was not', () => {
    const sessions = card.weeks[2].sessions;

    expect(sessions[0].workoutId).toBe('block-lean-w31');
    expect(sessions[2].workoutId).toBeNull();
    expect(card.started).toBe(true);
    expect(card.inProgress).toBe(false);
  });

  it('tells a week shared but still locked from one the coach has not shared', () => {
    const [, , , locked, unshared] = card.weeks;

    expect(locked).toMatchObject({ share: 'locked', shareLabel: 'Shared · opens Mon 5 Oct' });
    expect(card.weeks[0]).toMatchObject({ share: 'shared', shareLabel: 'Shared' });
    expect(unshared).toMatchObject({
      share: 'unshared',
      shareLabel: 'Not shared',
      range: '12–18 Oct',
    });
    // Nobody could train it, so its sessions are neither missed nor upcoming.
    expect(unshared.sessions.map((session) => [session.mark, session.markLabel])).toEqual(
      Array(4).fill(['unshared', 'Not shared']),
    );
  });

  it('notices a workout that is open right now', () => {
    const open = programBlock(
      [programWeek('b', '2026-09-14', 1, ['Completed', 'InProgress', 'Upcoming', 'Upcoming'])],
      { id: 'b', currentWeekNumber: 1 },
    );

    expect(blockCard(open, context)).toMatchObject({ inProgress: true, started: true });
    expect(blockCard(open, context).weeks[0].sessions[1]).toMatchObject({
      mark: 'progress',
      markLabel: 'In progress',
    });
  });
});

describe('a program that has not started, or has ended', () => {
  it('says when a planned program starts and how big it is', () => {
    const card = blockCard(plannedBlock(), context);

    expect(card).toMatchObject({
      name: 'Strength Base',
      eyebrow: 'Starts Mon 26 Oct',
      pill: { label: 'Starts Mon 26 Oct', tone: 'info' },
      currentWeek: null,
      openWeek: 1,
      started: false,
    });
    expect(card.facts.map((fact) => fact.text)).toEqual([
      'Mon 26 Oct – Sun 8 Nov',
      '2 weeks · 8 sessions',
    ]);
    // Nothing has begun, so no week claims to be this one.
    expect(card.weeks.some((week) => week.isCurrent)).toBe(false);
    expect(card.weeks[0].summary).toBe('4 sessions');
  });

  it('says a completed program is complete, with the dates it ran', () => {
    const card = blockCard(completedBlock(), context);

    expect(card).toMatchObject({
      eyebrow: 'Completed',
      pill: { label: 'Completed', tone: 'neutral' },
      terminal: true,
      currentWeek: null,
    });
    expect(card.facts.map((fact) => fact.text)).toEqual([
      'Mon 20 Jul – Sun 16 Aug',
      '16 of 16 sessions done',
    ]);
    expect(card.facts.some((fact) => fact.warm)).toBe(false);
  });

  it('says a cancelled program is cancelled, and counts only the sessions that were done', () => {
    const card = blockCard(cancelledBlock(), context);

    expect(card).toMatchObject({
      eyebrow: 'Cancelled',
      terminal: true,
      doneCount: 2,
      missedCount: 0,
    });
    expect(card.facts.map((fact) => fact.text)).toEqual([
      'Mon 4 May – Sun 17 May',
      '2 of 8 sessions done',
    ]);
    const left = card.weeks[1].sessions[0];
    expect(left).toMatchObject({ mark: 'closed', markLabel: 'Cancelled' });
  });

  it('puts the year on dates that are not this year’s', () => {
    const lastYear = blockCard(completedBlock({ id: 'old', start: '2025-12-22' }), context);

    expect(lastYear.facts[0].text).toBe('22 Dec 2025 – 18 Jan 2026');
  });

  it('says a single session in the singular', () => {
    const one = programBlock([programWeek('one', '2026-09-14', 1, ['Completed'])], {
      id: 'one',
      status: 'Completed',
    });
    const card = blockCard(one, context);

    expect(card.facts[1].text).toBe('1 of 1 session done');
  });
});

describe('a program past its last day that never closed', () => {
  const card = blockCard(endedBlock(), context);

  it('says it ended, not that it is in its last week', () => {
    expect(card).toMatchObject({
      eyebrow: 'Ended Fri 11 Sep',
      pill: { label: 'Ended', tone: 'neutral' },
      ended: true,
      terminal: false,
      currentWeek: null,
      doneCount: 22,
      missedCount: 2,
    });
    expect(card.facts.map((fact) => fact.text)).toEqual([
      'Sat 1 Aug – Fri 11 Sep',
      '22 of 24 sessions done',
      '2 missed',
    ]);
    expect(card.weeks.some((week) => week.isCurrent)).toBe(false);
    expect(card.openWeek).toBe(1);
  });

  it('can only be closed, or replaced by another program', () => {
    const items = programMenu(card, true, context);

    expect(items.map((item) => item.label)).toEqual([
      'Assign program',
      'Mark complete',
      'Cancel program',
    ]);
    // Two sessions were missed, so it cannot be marked complete.
    expect(items[1]).toMatchObject({ disabled: true, hint: 'Needs every session finished' });
    expect(items[2].disabled).toBeFalsy();
  });
});

describe('the other programs', () => {
  const blocks = [
    plannedBlock({ id: 'next-1', start: '2026-12-07', name: 'Hypertrophy' }),
    plannedBlock(),
    runningBlock(),
    completedBlock(),
    cancelledBlock(),
  ];

  it('lists the ones coming soonest first and the earlier ones newest first, without the open one', () => {
    const others = otherBlocks(blocks, 'block-lean', context);

    expect(others.coming.map((row) => row.name)).toEqual(['Strength Base', 'Hypertrophy']);
    expect(others.earlier.map((row) => row.name)).toEqual(['Foundations', 'Summer Reset']);
  });

  it('files a program that ended without closing under the earlier ones, with "Ended"', () => {
    const others = otherBlocks(
      [runningBlock(), endedBlock(), completedBlock()],
      'block-lean',
      context,
    );

    expect(others.coming).toEqual([]);
    // Newest first: Phase 1 began on 1 Aug, Foundations on 20 Jul.
    expect(others.earlier.map((row) => [row.name, row.pill.label])).toEqual([
      ['Lean & Strong · Phase 1', 'Ended'],
      ['Foundations', 'Completed'],
    ]);
  });

  it('gives each row enough to recognise it', () => {
    const others = otherBlocks(blocks, 'block-lean', context);

    expect(others.coming[0]).toMatchObject({
      pill: { label: 'Starts Mon 26 Oct', tone: 'info' },
      range: 'Mon 26 Oct – Sun 8 Nov',
      summary: '8 sessions',
    });
    expect(others.earlier[0]).toMatchObject({
      pill: { label: 'Completed', tone: 'neutral' },
      range: 'Mon 20 Jul – Sun 16 Aug',
      summary: '16 of 16 sessions done',
    });
  });

  it('drops the program that is open, whichever one it is', () => {
    const others = otherBlocks(blocks, 'block-first', context);

    expect(others.earlier.map((row) => row.name)).toEqual(['Summer Reset']);
    expect(others.coming).toHaveLength(3);
  });
});

describe('what a coach can do about a program', () => {
  const labels = (items: ReturnType<typeof programMenu>) => items.map((item) => item.label);

  it('offers the whole menu for a running program, with the unavailable ones saying why', () => {
    const items = programMenu(blockCard(runningBlock(), context), true, context);

    expect(labels(items)).toEqual([
      'Assign program',
      'Build next block',
      'Reschedule',
      'Open every shared week now',
      'Mark complete',
      'Cancel program',
    ]);
    // Workouts were done, so the dates can no longer move; sessions remain, so it cannot be closed.
    expect(items[2]).toMatchObject({
      action: 'reschedule',
      disabled: true,
      hint: 'Not possible once a workout has started',
    });
    expect(items[4]).toMatchObject({
      action: 'complete',
      disabled: true,
      hint: 'Needs every session finished',
    });
    expect(items[5].disabled).toBeFalsy();
    expect(items[3].hint).toBe(
      'Maya sees every shared week now, not only the ones that have started',
    );
  });

  it('lets a program that has not started be rescheduled, and does not offer to complete it', () => {
    const items = programMenu(blockCard(plannedBlock(), context), true, context);

    expect(labels(items)).toEqual([
      'Assign program',
      'Build next block',
      'Reschedule',
      'Open every shared week now',
      'Cancel program',
    ]);
    expect(items[2]).toMatchObject({ hint: 'Move the start date' });
    expect(items[2].disabled).toBeFalsy();
  });

  it('turns the weekly opening back on when every shared week is already open', () => {
    const items = programMenu(
      blockCard(plannedBlock({ revealAllWeeks: true }), context),
      false,
      context,
    );

    expect(items.find((item) => item.action === 'reveal-weekly')).toMatchObject({
      label: 'Open weeks as they start',
    });
    expect(items.some((item) => item.action === 'reveal-all')).toBe(false);
    expect(items.some((item) => item.action === 'assign')).toBe(false);
  });

  it('will not cancel a program with a workout open', () => {
    const open = programBlock(
      [programWeek('b', '2026-09-14', 1, ['InProgress', 'Upcoming', 'Upcoming', 'Upcoming'])],
      { id: 'b', currentWeekNumber: 1 },
    );

    const cancel = programMenu(blockCard(open, context), false, context).find(
      (item) => item.action === 'cancel',
    );

    expect(cancel).toMatchObject({ disabled: true, hint: 'A workout is in progress' });
  });

  it('closes everything but a new program once a program is over, or when there is none', () => {
    expect(labels(programMenu(blockCard(completedBlock(), context), true, context))).toEqual([
      'Assign program',
    ]);
    expect(labels(programMenu(blockCard(cancelledBlock(), context), true, context))).toEqual([
      'Assign program',
    ]);
    expect(labels(programMenu(null, true, context))).toEqual(['Assign program']);
    expect(programMenu(null, false, context)).toEqual([]);
  });

  it('can mark a running program complete only when every session is done', () => {
    const done = programBlock(
      [programWeek('d', '2026-09-14', 1, ['Completed', 'Completed', 'Completed', 'Completed'])],
      { id: 'd', status: 'Active', currentWeekNumber: 1 },
    );

    const complete = programMenu(blockCard(done, context), false, context).find(
      (item) => item.action === 'complete',
    );

    expect(complete).toMatchObject({ hint: 'Close the program' });
    expect(complete?.disabled).toBeFalsy();
  });
});

describe('what a session prescribes', () => {
  function set(fields: Partial<SetPrescriptionView>): SetPrescriptionView {
    return {
      id: 'set',
      position: 1,
      setType: 'Normal',
      repetitionsMinimum: null,
      repetitionsMaximum: null,
      loadStrategy: 'Direct',
      directLoad: null,
      loadUnit: null,
      percentageWorkingMax: null,
      targetRpe: null,
      targetRir: null,
      exertionDisplayPreference: 'Rpe',
      restSeconds: null,
      tempo: null,
      coachNotes: null,
      workingMaxSnapshotId: null,
      unroundedRecommendedLoad: null,
      prescribedLoad: null,
      calculationStrategyKey: null,
      calculationStrategyVersion: null,
      calculationExplanation: null,
      isManualLoadOverride: false,
      ...fields,
    } as SetPrescriptionView;
  }

  const working = {
    repetitionsMinimum: 8,
    repetitionsMaximum: 10,
    prescribedLoad: 60,
    targetRpe: 8,
  };

  it('tells equal neighbouring sets once, with how many', () => {
    expect(setLines([set(working), set(working), set(working)], 'Kilogram', 'en-US')).toEqual([
      '3 × 8–10 reps · 60 kg · RPE 8',
    ]);
  });

  it('keeps sets that differ apart, in order', () => {
    const lines = setLines(
      [
        set(working),
        set(working),
        set({ repetitionsMinimum: 5, repetitionsMaximum: 5, prescribedLoad: 70 }),
      ],
      'Kilogram',
      'en-US',
    );

    expect(lines).toEqual(['2 × 8–10 reps · 60 kg · RPE 8', '5 reps · 70 kg']);
  });

  it('reads pounds as pounds and falls back to the block’s unit for a set with none', () => {
    expect(
      setLines(
        [set({ repetitionsMinimum: 5, repetitionsMaximum: 5, directLoad: 135, loadUnit: 'Pound' })],
        'Kilogram',
        'en-US',
      ),
    ).toEqual(['5 reps · 135 lb']);
    expect(
      setLines(
        [set({ repetitionsMinimum: 5, repetitionsMaximum: 5, prescribedLoad: 62.5 })],
        'Pound',
        'en-US',
      ),
    ).toEqual(['5 reps · 62.5 lb']);
  });

  it('says a load that is a share of the training max when no weight was worked out', () => {
    expect(
      setLines(
        [set({ repetitionsMinimum: 5, repetitionsMaximum: 5, percentageWorkingMax: 75 })],
        'Kilogram',
        'en-US',
      ),
    ).toEqual(['5 reps · 75% of training max']);
  });

  it('names a set with nothing prescribed rather than leaving it blank', () => {
    expect(setLines([set({})], 'Kilogram', 'en-US')).toEqual(['Set']);
  });

  it('lists the exercises of a session with their notes', () => {
    const session = {
      id: 's1',
      exercises: [
        {
          id: 'e1',
          exerciseName: 'Back squat',
          coachNotes: 'Brace before every rep.',
          sets: [set(working), set(working)],
        },
        {
          id: 'e2',
          exerciseName: 'Leg curl',
          coachNotes: null,
          sets: [set({ repetitionsMinimum: 12, repetitionsMaximum: 12 })],
        },
      ],
    } as unknown as TrainingSessionView;

    expect(exerciseLines(session, 'Kilogram', 'en-US')).toEqual([
      {
        id: 'e1',
        name: 'Back squat',
        sets: ['2 × 8–10 reps · 60 kg · RPE 8'],
        notes: 'Brace before every rep.',
      },
      { id: 'e2', name: 'Leg curl', sets: ['12 reps'], notes: null },
    ]);
  });
});
