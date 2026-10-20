import { describe, expect, it } from 'vitest';
import {
  attentionItem,
  COACH_NOW,
  COACH_TODAY,
  coachTodayView,
  MAYA,
  OWNER_ID,
  RAMI,
  SARA,
} from '../../../testing/coach-today-fixtures';
import {
  activityRow,
  ago,
  attentionRow,
  daysBetween,
  mapCoachToday,
  partOfDay,
  type CoachTodayContext,
} from './coach-today.models';

const context: CoachTodayContext = { locale: 'en-US', now: new Date(COACH_NOW), userId: OWNER_ID };

describe('Coach Today view model', () => {
  it('reads the day, the people waiting and the week from the server', () => {
    const today = mapCoachToday(coachTodayView(), context);

    expect(today.dateLabel).toBe('Thursday 1 October');
    expect(today.partOfDay).toBe('afternoon');
    expect([
      today.clientCount,
      today.needsCount,
      today.plansEndingSoon,
      today.renewalRequests,
    ]).toEqual([12, 7, 3, 1]);
    expect([today.week.completed, today.week.scheduled, today.week.dueSoFar]).toEqual([10, 27, 15]);
    const thursday = today.week.bars[3];
    expect(thursday).toMatchObject({
      label: 'Thu',
      isToday: true,
      isFuture: false,
      height: 67,
      done: 25,
    });
    expect(today.week.bars[4]).toMatchObject({
      label: 'Fri',
      isFuture: true,
      height: 100,
      done: 0,
    });
    expect(today.week.bars[0].longLabel).toBe('Monday 28 September');
  });

  it('counts a client once however many things they are waiting on', () => {
    const view = coachTodayView({
      attention: [
        attentionItem('CheckInToReview', SARA, { count: 1, since: COACH_NOW }),
        attentionItem('UnreadMessages', SARA, { count: 1, since: COACH_NOW }),
      ],
    });

    expect(mapCoachToday(view, context).needsCount).toBe(1);
  });

  it('phrases each kind in coach words, with the action that answers it', () => {
    const rows = mapCoachToday(coachTodayView(), context).attention;
    const read = rows.map((row) => [
      row.heading,
      row.detail,
      row.tag,
      row.tone,
      row.action.label,
      row.action.link,
      row.action.queryParams,
    ]);

    expect(read).toEqual([
      [
        'Maya Fakhoury sent a check-in',
        'Sent 1 hour ago',
        'Check-in',
        'review',
        'Review',
        '/clients/c-maya/checkins/a-maya',
        null,
      ],
      [
        'Sara Mansour sent you 2 messages',
        'The first came 3 hours ago',
        'Message',
        'message',
        'Reply',
        '/messages',
        { conversation: 'conv-sara' },
      ],
      [
        'Elie Azar asked to renew',
        'Plan ended Sun 27 Sep',
        'Renewal',
        'renew',
        'Renew plan',
        '/clients/c-elie/service',
        { renew: 'e-elie' },
      ],
      [
        "Rita Daher's plan ends tomorrow",
        'Last day Fri 2 Oct',
        'Ending soon',
        'ending',
        'Renew plan',
        '/clients/c-rita/service',
        { renew: 'e-rita' },
      ],
      [
        "Nour Hamdan's week 2 isn't shared yet",
        'It starts today',
        'Program',
        'share',
        'Share week',
        '/clients/c-nour/training',
        null,
      ],
      [
        'Jad Karam missed 3 sessions in a row',
        'Last trained Thu 24 Sep',
        'Missed',
        'missed',
        'See training',
        '/clients/c-jad/training',
        null,
      ],
      [
        'Lynn Bou Khalil has no program yet',
        'Joined Sun 27 Sep',
        'New',
        'new',
        'Assign program',
        '/clients/c-lynn/training',
        { action: 'assign' },
      ],
    ]);
    expect(rows[0].action.forWhom).toBe('for Maya Fakhoury');
    expect(rows[0].initials).toBe('MF');
  });

  it("names the coach only on a team member's client", () => {
    const rows = mapCoachToday(coachTodayView(), context).attention;

    expect(rows[0].coach).toBe('Lea Khoury');
    expect(rows.slice(1).every((row) => row.coach === null)).toBe(true);
    const asLea = mapCoachToday(coachTodayView(), { ...context, userId: MAYA.assignedCoachUserId });
    expect(asLea.attention[0].coach).toBeNull();
  });

  it('says when a week started or starts, and when a plan ends, from the workspace date', () => {
    const week = (date: string) =>
      attentionRow(
        attentionItem('WeekNotShared', SARA, { date, weekNumber: 3 }),
        COACH_TODAY,
        context,
      ).detail;
    expect([week('2026-10-02'), week('2026-10-03'), week('2026-09-28')]).toEqual([
      'It starts tomorrow',
      'It starts Sat 3 Oct',
      'It started Mon 28 Sep',
    ]);
    const ends = (date: string) =>
      attentionRow(attentionItem('PlanEndingSoon', SARA, { date }), COACH_TODAY, context).heading;
    expect([ends('2026-10-01'), ends('2026-10-09')]).toEqual([
      "Sara Mansour's plan ends today",
      "Sara Mansour's plan ends Fri 9 Oct",
    ]);
  });

  it('asks for the payment of a renewal still waiting for it, not for another renewal (BEB-7)', () => {
    const unpaid = attentionRow(
      attentionItem('PlanEndingSoon', SARA, {
        date: '2026-10-09',
        count: 1,
        subjectId: 'renewal-7',
      }),
      COACH_TODAY,
      context,
    );

    expect(unpaid.heading).toBe("Sara Mansour's plan ends Fri 9 Oct");
    expect(unpaid.detail).toBe("Paid until Fri 9 Oct · The renewal isn't paid yet");
    expect(unpaid.action).toMatchObject({
      label: 'Record payment',
      link: `/clients/${SARA.clientProfileId}/service`,
      queryParams: { pay: 'renewal-7' },
    });
    const paid = attentionRow(
      attentionItem('PlanEndingSoon', SARA, { date: '2026-10-09', subjectId: 'enrollment-7' }),
      COACH_TODAY,
      context,
    );
    expect(paid.action).toMatchObject({
      label: 'Renew plan',
      queryParams: { renew: 'enrollment-7' },
    });
  });

  it('keeps one check-in, one message and a never-trained client in the singular', () => {
    const one = (kind: 'CheckInToReview' | 'UnreadMessages') =>
      attentionRow(attentionItem(kind, SARA, { count: 1, since: COACH_NOW }), COACH_TODAY, context);
    expect(one('CheckInToReview').heading).toBe('Sara Mansour sent a check-in');
    expect(one('UnreadMessages').heading).toBe('Sara Mansour sent you a message');
    expect(one('UnreadMessages').detail).toBe('Sent just now');
    const never = attentionRow(
      attentionItem('MissedSessions', SARA, { count: 2, date: null }),
      COACH_TODAY,
      context,
    );
    expect(never.detail).toBe('No workout logged yet');
    const settled = attentionRow(
      attentionItem('NoProgram', SARA, { date: '2026-08-01' }),
      COACH_TODAY,
      context,
    );
    expect(settled.tag).toBe('Program');
  });

  it('names when the newest of several check-ins came, not only the oldest (CLIENT-19)', () => {
    const several = attentionRow(
      attentionItem('CheckInToReview', SARA, {
        count: 2,
        since: '2026-09-25T12:00:00Z',
        newestAt: '2026-10-01T11:55:00Z',
        subjectId: 'a-oldest',
      }),
      COACH_TODAY,
      context,
    );
    expect(several.heading).toBe('Sara Mansour sent 2 check-ins');
    expect(several.detail).toBe('The newest came 5 minutes ago, the first 6 days ago');
    // Several open the list of check-ins, where each can be read.
    expect(several.action.link).toBe(`/clients/${SARA.clientProfileId}/checkins`);
    // An older server that sends no newest keeps the one time it has.
    const older = attentionRow(
      attentionItem('CheckInToReview', SARA, { count: 2, since: '2026-09-25T12:00:00Z' }),
      COACH_TODAY,
      context,
    );
    expect(older.detail).toBe('Sent 6 days ago');
  });

  it('asks to start a plan for a new client who has none (COACH-9)', () => {
    const joined = (date: string | null) =>
      attentionRow(attentionItem('NoPlan', SARA, { date }), COACH_TODAY, context);

    const today = joined(COACH_TODAY);
    expect(today.heading).toBe('Sara Mansour joined');
    expect(today.detail).toBe('Today · no plan yet');
    expect([today.tag, today.tone]).toEqual(['New', 'new']);
    expect(today.action).toMatchObject({
      label: 'Start a plan',
      link: `/clients/${SARA.clientProfileId}/service`,
      queryParams: { action: 'start' },
    });
    expect(joined('2026-09-30').detail).toBe('Yesterday · no plan yet');
    expect(joined('2026-09-24').detail).toBe('Thu 24 Sep · no plan yet');
  });

  it('names the lifts whose logged sets suggest a new max, with both numbers', () => {
    const lift = (
      exerciseName: string,
      current: number,
      suggested: number,
      unit = 'Kilogram',
      loadIncrement = unit === 'Pound' ? 5 : 2.5,
    ) => ({
      exerciseId: exerciseName.toLowerCase(),
      exerciseName,
      current,
      suggested,
      unit: unit as 'Kilogram' | 'Pound',
      loadIncrement,
    });
    const one = attentionRow(
      attentionItem('MaxesToReview', SARA, {
        count: 1,
        subjectId: 'block-1',
        maxes: [lift('Deadlift', 77.5, 80.749)],
      }),
      COACH_TODAY,
      context,
    );
    expect(one).toMatchObject({
      heading: "Sara Mansour's logged sets suggest a new Deadlift max",
      // Said in the program's 2.5 kg steps; the exact 80.749 kg stays on the client's Training (R5.4c).
      detail: 'About 80\u00a0kg, up from 77.5\u00a0kg',
      tag: 'Maxes',
      tone: 'share',
      action: {
        label: 'Review maxes',
        link: `/clients/${SARA.clientProfileId}/training`,
        queryParams: { action: 'maxes' },
      },
    });

    const several = attentionRow(
      attentionItem('MaxesToReview', SARA, {
        count: 2,
        maxes: [lift('Back squat', 385, 400, 'Pound'), lift('Bench press', 100, 96.2)],
      }),
      COACH_TODAY,
      context,
    );
    expect(several.heading).toBe("Sara Mansour's logged sets suggest new maxes for 2 lifts");
    // Pounds stay pounds, each lift in its own program's steps; a lower suggestion is shown as it is.
    expect(several.detail).toBe('Back squat about 400\u00a0lb, Bench press about 95\u00a0kg');
    const lower = attentionRow(
      attentionItem('MaxesToReview', SARA, { count: 1, maxes: [lift('Bench press', 100, 96.2)] }),
      COACH_TODAY,
      context,
    );
    expect(lower.detail).toBe('About 95\u00a0kg, down from 100\u00a0kg');
    const finer = attentionRow(
      attentionItem('MaxesToReview', SARA, {
        count: 1,
        maxes: [lift('Deadlift', 77.5, 80.749, 'Kilogram', 0.5)],
      }),
      COACH_TODAY,
      context,
    );
    expect(finer.detail).toBe('About 80.5\u00a0kg, up from 77.5\u00a0kg');
  });

  it('says a client between programs has none running, with what the last one suggests', () => {
    const deadlift = {
      exerciseId: 'deadlift',
      exerciseName: 'Deadlift',
      current: 77.5,
      suggested: 80.749,
      unit: 'Kilogram' as const,
      loadIncrement: 2.5,
    };
    const between = attentionRow(
      attentionItem('NoProgram', SARA, {
        date: '2026-03-01',
        subjectId: 'block-ended',
        maxes: [deadlift],
      }),
      COACH_TODAY,
      context,
    );
    expect(between).toMatchObject({
      heading: 'Sara Mansour has no program running',
      detail: 'Last program’s sets suggest Deadlift about 80\u00a0kg, up from 77.5\u00a0kg',
      action: {
        label: 'Assign program',
        link: `/clients/${SARA.clientProfileId}/training`,
        queryParams: { action: 'assign' },
      },
    });

    // An ended program with nothing to suggest still says the client had one.
    const quiet = attentionRow(
      attentionItem('NoProgram', SARA, { date: '2026-03-01', subjectId: 'block-ended' }),
      COACH_TODAY,
      context,
    );
    expect([quiet.heading, quiet.detail]).toEqual([
      'Sara Mansour has no program running',
      'Joined Sun 1 Mar',
    ]);
  });

  it('turns a finished workout into a sentence with its first two records', () => {
    const [rami, maya, rita] = mapCoachToday(coachTodayView(), context).activity;

    expect(rami.sentence).toBe('Rami Tabet finished Lower A in 58 min');
    expect(rami.records).toEqual(['Back squat 140 kg × 3', 'Romanian deadlift 107.5 kg × 8']);
    expect(rami.moreRecords).toBe(1);
    expect([rami.ago, rami.link]).toEqual(['35 minutes ago', '/clients/c-rami/training']);
    expect(maya.sentence).toBe('Maya Fakhoury sent a check-in: Weekly check-in');
    expect(maya.link).toBe('/clients/c-maya/checkins/a-maya');
    expect([rita.records, rita.moreRecords, rita.ago]).toEqual([[], 0, 'yesterday']);
  });

  it('keeps pounds as pounds and leaves out a duration under a minute', () => {
    const row = activityRow(
      {
        kind: 'WorkoutCompleted',
        client: RAMI,
        occurredAtUtc: COACH_NOW,
        subjectId: 'w-1',
        title: 'Upper B',
        durationSeconds: 20,
        personalRecords: [
          { exerciseName: 'Bench press', repetitions: 5, load: '225.000', unit: 'Pound' },
        ],
      },
      context,
    );

    expect(row.sentence).toBe('Rami Tabet finished Upper B');
    expect(row.records).toEqual(['Bench press 225 lb × 5']);
  });

  it('measures elapsed time on the device clock and dates on the workspace calendar', () => {
    const at = (minutesAgo: number) =>
      ago(new Date(Date.parse(COACH_NOW) - minutesAgo * 60_000).toISOString(), context);
    expect([at(0), at(5), at(150), at(60 * 30), at(60 * 72)]).toEqual([
      'just now',
      '5 minutes ago',
      '2 hours ago',
      'yesterday',
      '3 days ago',
    ]);
    expect(ago(null, context)).toBe('');
    expect([
      daysBetween('2026-10-01', '2026-10-03'),
      daysBetween('2026-10-01', '2026-09-24'),
    ]).toEqual([2, -7]);
  });

  it("greets by the workspace's own hour, not the device's", () => {
    expect(partOfDay(new Date('2026-10-01T05:00:00Z'), 'Asia/Beirut')).toBe('morning');
    expect(partOfDay(new Date('2026-10-01T12:00:00Z'), 'Asia/Beirut')).toBe('afternoon');
    expect(partOfDay(new Date('2026-10-01T16:00:00Z'), 'Asia/Beirut')).toBe('evening');
    expect(partOfDay(new Date('2026-10-01T16:00:00Z'), 'America/New_York')).toBe('afternoon');
  });
});
