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
        '/clients/c-maya/checkins',
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
        null,
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

  it('turns a finished workout into a sentence with its first two records', () => {
    const [rami, maya, rita] = mapCoachToday(coachTodayView(), context).activity;

    expect(rami.sentence).toBe('Rami Tabet finished Lower A in 58 min');
    expect(rami.records).toEqual(['Back squat 140 kg × 3', 'Romanian deadlift 107.5 kg × 8']);
    expect(rami.moreRecords).toBe(1);
    expect([rami.ago, rami.link]).toEqual(['35 minutes ago', '/clients/c-rami/training']);
    expect(maya.sentence).toBe('Maya Fakhoury sent a check-in: Weekly check-in');
    expect(maya.link).toBe('/clients/c-maya/checkins');
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
