import { describe, expect, it } from 'vitest';
import { attentionItem, COACH_NOW, COACH_TODAY, MAYA } from '../../../testing/coach-today-fixtures';
import {
  checkInItem,
  MAYA_WEEK,
  personalRecords,
  programBlock,
  progressDashboard,
  progressDashboardView,
  record,
  weekDays,
} from '../../../testing/client-profile-fixtures';
import {
  checkInCard,
  needRows,
  nutritionWeek,
  planStateReason,
  programLine,
  recordRows,
  trainingClosed,
  weekStory,
  weightStory,
  type ProfileContext,
} from './client-profile.models';
import { mapProgressDashboard } from '../progress/progress-dashboard.models';

const context: ProfileContext = {
  locale: 'en-US',
  now: new Date(COACH_NOW),
  clientId: MAYA.clientProfileId,
  firstName: 'Maya',
};

const page = `/clients/${MAYA.clientProfileId}`;

describe('what needs the coach on a client’s page', () => {
  const rows = (...items: Parameters<typeof attentionItem>[2][]) =>
    needRows(
      items.map((fields, index) => attentionItem(KINDS[index], MAYA, fields)),
      COACH_TODAY,
      context,
    );
  const KINDS = [
    'CheckInToReview',
    'UnreadMessages',
    'RenewalRequested',
    'PlanEndingSoon',
    'WeekNotShared',
    'MissedSessions',
    'NoProgram',
  ] as const;

  it('keeps the server order and gives each item one action with its target', () => {
    const list = needRows(
      [
        attentionItem('CheckInToReview', MAYA, {
          count: 1,
          since: '2026-10-01T10:00:00Z',
          subjectId: 'assignment-9',
        }),
        attentionItem('UnreadMessages', MAYA, {
          count: 3,
          since: '2026-10-01T08:00:00Z',
          subjectId: 'conversation-4',
        }),
        attentionItem('NoProgram', MAYA, { date: '2026-09-14' }),
      ],
      COACH_TODAY,
      context,
    );

    expect(list.map((row) => row.kind)).toEqual(['CheckInToReview', 'UnreadMessages', 'NoProgram']);
    // One check-in opens straight at its review; messages open that conversation.
    expect(list[0]).toMatchObject({
      heading: 'Check-in ready to review',
      detail: 'Sent 2 hours ago',
      tag: 'Check-in',
      action: {
        label: 'Review',
        link: `/clients/${MAYA.clientProfileId}/checkins/assignment-9`,
        queryParams: null,
      },
    });
    expect(list[1]).toMatchObject({
      heading: '3 unread messages',
      detail: 'The first came 4 hours ago',
      action: {
        label: 'Reply',
        link: '/messages',
        queryParams: { conversation: 'conversation-4' },
      },
    });
    expect(list[2]).toMatchObject({
      heading: 'No program yet',
      detail: 'Joined Mon 14 Sep',
      action: {
        label: 'Assign program',
        link: `${page}/training`,
        queryParams: { action: 'assign' },
      },
    });
  });

  it('says one unread message and several check-ins in the right number', () => {
    const [one] = rows({ count: 1, subjectId: 'assignment-1' });
    expect(one.action).toEqual({
      label: 'Review',
      link: `/clients/${MAYA.clientProfileId}/checkins/assignment-1`,
      queryParams: null,
    });

    const [many] = needRows(
      [attentionItem('CheckInToReview', MAYA, { count: 2, subjectId: 'assignment-1' })],
      COACH_TODAY,
      context,
    );
    expect(many.heading).toBe('2 check-ins to review');
    // Several waiting open the list, where each can be reviewed.
    expect(many.action).toEqual({ label: 'Review', link: `${page}/checkins`, queryParams: null });

    const [single] = needRows(
      [attentionItem('UnreadMessages', MAYA, { count: 1, since: '2026-10-01T11:30:00Z' })],
      COACH_TODAY,
      context,
    );
    expect(single).toMatchObject({ heading: '1 unread message', detail: 'Sent 30 minutes ago' });
  });

  it('names the newest of several check-ins as well as the first (CLIENT-19)', () => {
    const [many] = needRows(
      [
        attentionItem('CheckInToReview', MAYA, {
          count: 2,
          since: '2026-09-25T12:00:00Z',
          newestAt: '2026-10-01T11:00:00Z',
          subjectId: 'assignment-1',
        }),
      ],
      COACH_TODAY,
      context,
    );
    expect(many.detail).toBe('The newest was sent 1 hour ago, the first 6 days ago');
  });

  it('asks to start a plan for a new client who has none, on Service & access (COACH-9)', () => {
    const [joined] = needRows(
      [attentionItem('NoPlan', MAYA, { date: '2026-09-29' })],
      COACH_TODAY,
      context,
    );
    expect(joined).toMatchObject({
      tone: 'new',
      tag: 'New',
      heading: 'No plan yet',
      detail: 'Joined Tue 29 Sep. Start a plan so Maya can use what it includes.',
      action: { label: 'Start a plan', link: `${page}/service`, queryParams: { action: 'start' } },
    });
  });

  it('names a plan ending today, tomorrow and in days, and renews the plan that ends', () => {
    const ends = (date: string) =>
      needRows(
        [attentionItem('PlanEndingSoon', MAYA, { date, subjectId: 'enrollment-3' })],
        COACH_TODAY,
        context,
      )[0];

    expect(ends('2026-10-01').heading).toBe('Plan ends today');
    expect(ends('2026-10-02').heading).toBe('Plan ends tomorrow');
    expect(ends('2026-10-06')).toMatchObject({
      heading: 'Plan ends in 5 days',
      detail: 'Last day Tue 6 Oct',
      tag: 'Ending soon',
      action: {
        label: 'Renew plan',
        link: `${page}/service`,
        queryParams: { renew: 'enrollment-3' },
      },
    });
  });

  it('asks for the payment of a renewal still waiting for it, which covers nothing yet (BEB-7)', () => {
    const [row] = needRows(
      [
        attentionItem('PlanEndingSoon', MAYA, {
          date: '2026-10-06',
          count: 1,
          subjectId: 'renewal-4',
        }),
      ],
      COACH_TODAY,
      context,
    );

    expect(row).toMatchObject({
      heading: 'Plan ends in 5 days',
      detail: 'Paid until Tue 6 Oct · The renewal isn’t paid yet',
      action: {
        label: 'Record payment',
        link: `${page}/service`,
        queryParams: { pay: 'renewal-4' },
      },
    });
  });

  it('asks about a renewal request, an unshared week and missed sessions in coach words', () => {
    const [renewal, share, missed, never] = needRows(
      [
        attentionItem('RenewalRequested', MAYA, { date: '2026-09-27', subjectId: 'enrollment-2' }),
        attentionItem('WeekNotShared', MAYA, { weekNumber: 3, date: '2026-10-03' }),
        attentionItem('MissedSessions', MAYA, { count: 3, date: '2026-09-24' }),
        attentionItem('MissedSessions', MAYA, { count: 2, date: null }),
      ],
      COACH_TODAY,
      context,
    );

    expect(renewal).toMatchObject({
      heading: 'Maya asked to renew',
      detail: 'Plan ended Sun 27 Sep',
      action: { label: 'Renew plan', queryParams: { renew: 'enrollment-2' } },
    });
    expect(share).toMatchObject({
      heading: 'Week 3 isn’t shared with Maya yet',
      detail: 'It starts Sat 3 Oct',
      action: { label: 'Share week', link: `${page}/training` },
    });
    expect(missed).toMatchObject({
      heading: 'Missed 3 sessions in a row',
      detail: 'Last trained Thu 24 Sep',
      action: { label: 'See training', link: `${page}/training` },
    });
    expect(never.detail).toBe('No workout logged yet');
  });

  it('names the lift whose logged sets suggest a new max, and opens the maxes to review it', () => {
    const [maxes] = needRows(
      [
        attentionItem('MaxesToReview', MAYA, {
          count: 1,
          maxes: [
            {
              exerciseId: 'deadlift',
              exerciseName: 'Deadlift',
              current: 77.5,
              suggested: 80.749,
              unit: 'Kilogram',
              loadIncrement: 2.5,
            },
          ],
        }),
      ],
      COACH_TODAY,
      context,
    );

    expect(maxes).toMatchObject({
      tone: 'share',
      tag: 'Maxes',
      heading: 'Logged sets suggest a new Deadlift max',
      detail: 'About 80\u00a0kg, up from 77.5\u00a0kg',
      action: { label: 'Review maxes', link: `${page}/training`, queryParams: { action: 'maxes' } },
    });
  });

  it('carries what the last program suggests onto No program, for Assign program', () => {
    const [between] = needRows(
      [
        attentionItem('NoProgram', MAYA, {
          date: '2026-03-01',
          subjectId: 'block-ended',
          maxes: [
            {
              exerciseId: 'squat',
              exerciseName: 'Back squat',
              current: 385,
              suggested: 400,
              unit: 'Pound',
              loadIncrement: 5,
            },
            {
              exerciseId: 'deadlift',
              exerciseName: 'Deadlift',
              current: 77.5,
              suggested: 80.749,
              unit: 'Kilogram',
              loadIncrement: 2.5,
            },
          ],
        }),
      ],
      COACH_TODAY,
      context,
    );

    expect(between).toMatchObject({
      heading: 'No program running',
      detail: 'Last program’s sets suggest Back squat about 400\u00a0lb, Deadlift about 80\u00a0kg',
      action: { label: 'Assign program', queryParams: { action: 'assign' } },
    });
  });

  it('says when an unshared week starts today, tomorrow or already started', () => {
    const starts = (date: string) =>
      needRows(
        [attentionItem('WeekNotShared', MAYA, { weekNumber: 2, date })],
        COACH_TODAY,
        context,
      )[0].detail;
    expect(starts('2026-10-01')).toBe('It starts today');
    expect(starts('2026-10-02')).toBe('It starts tomorrow');
    expect(starts('2026-09-29')).toBe('It started Tue 29 Sep');
  });
});

describe('why training is closed', () => {
  it('reads the reason from where the plan stands', () => {
    expect(
      (['Running', 'None', 'Paused', 'PaymentDue', 'NotStarted', 'Ended', 'Blocked'] as const).map(
        planStateReason,
      ),
    ).toEqual([
      'NoEntitlement',
      'NoEntitlement',
      'Paused',
      'PaymentRequired',
      'NotStarted',
      'Expired',
      'RelationshipBlocked',
    ]);
  });

  it('says a plan that ended or paused is that, not “not part of the plan”', () => {
    expect(trainingClosed('NoEntitlement', 'Maya')).toBe('Training isn’t part of Maya’s plan.');
    expect(trainingClosed('Expired', 'Maya')).toBe(
      'Maya’s plan has ended, so their training isn’t shown.',
    );
    expect(trainingClosed('Paused', 'Maya')).toBe(
      'Maya’s plan is paused, so their training isn’t shown.',
    );
    expect(trainingClosed('PaymentRequired', 'Maya')).toContain('waiting for payment');
    expect(trainingClosed('NotStarted', 'Maya')).toBe('Maya’s plan hasn’t started yet.');
    expect(trainingClosed('RelationshipBlocked', 'Maya')).toBe(
      'You have blocked Maya, so their training isn’t shown.',
    );
    expect(trainingClosed('Cancelled', 'Maya')).toContain('was cancelled');
    expect(trainingClosed('MembershipInactive', 'Maya')).toContain('no longer with you');
    expect(trainingClosed('PlatformBlocked', 'Maya')).toContain('access is blocked');
    // A reason this screen does not know says so plainly rather than guessing.
    expect(trainingClosed('Granted', 'Maya')).toBe('Maya’s training isn’t available right now.');
    expect(trainingClosed('SomethingNew' as never, 'Maya')).toBe(
      'Maya’s training isn’t available right now.',
    );
  });
});

describe('this week', () => {
  it('draws the workspace week as seven marks and counts what was done', () => {
    const story = weekStory(MAYA_WEEK, COACH_TODAY, 'en-US');

    expect(story.range).toBe('Mon 28 Sep – Sun 4 Oct');
    expect([story.done, story.scheduled]).toEqual([2, 5]);
    expect(story.summary).toBe('2 of 5 sessions done this week');
    expect(story.days.map((day) => day.label)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
    // One letter each where the strip is too narrow for "Mon", as at 200% text on a phone (UIQ-3).
    expect(story.days.map((day) => day.narrowLabel).join('')).toBe('MTWTFSS');
    expect(story.days.map((day) => day.mark)).toEqual([
      'done',
      'rest',
      'partial',
      // Today's session is to do, not missed; so is every later day with one.
      'due',
      'due',
      'rest',
      'rest',
    ]);
    expect(story.days.filter((day) => day.isToday).map((day) => day.date)).toEqual([COACH_TODAY]);
  });

  it('marks a session before today that was not done as missed, and says so in words', () => {
    const story = weekStory(
      weekDays([
        [1, 0],
        [2, 0],
        [2, 2],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ]),
      COACH_TODAY,
      'en-US',
    );

    expect(story.days.slice(0, 3).map((day) => day.mark)).toEqual(['missed', 'missed', 'done']);
    expect(story.days.slice(0, 3).map((day) => `${day.longLabel}: ${day.state}`)).toEqual([
      'Monday 28 September: missed',
      'Tuesday 29 September: 2 sessions missed',
      'Wednesday 30 September: all 2 sessions done',
    ]);
    expect(story.days[5].state).toBe('no session');
  });

  it('says nothing is scheduled when the week is empty', () => {
    const story = weekStory(
      weekDays(Array.from({ length: 7 }, () => [0, 0] as const)),
      COACH_TODAY,
      'en-US',
    );
    expect([story.scheduled, story.summary]).toEqual([0, 'No sessions scheduled this week']);
  });

  it('never counts more done than scheduled on a day', () => {
    const story = weekStory(
      weekDays([
        [1, 3],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ]),
      COACH_TODAY,
      'en-US',
    );
    expect(story.days[0]).toMatchObject({ completed: 1, mark: 'done' });
  });

  it('names the program block and the week the client is in', () => {
    expect(programLine([programBlock()], COACH_TODAY)).toBe(
      'Lean & Strong · Phase 2 · Week 3 of 6',
    );
    // The first day of a block is week 1; its last day is its last week.
    expect(
      programLine(
        [programBlock({ startDate: COACH_TODAY, endDateExclusive: '2026-11-12' })],
        COACH_TODAY,
      ),
    ).toBe('Lean & Strong · Phase 2 · Week 1 of 6');
    expect(programLine([programBlock({ endDateExclusive: '2026-10-02' })], COACH_TODAY)).toBe(
      'Lean & Strong · Phase 2 · Week 3 of 3',
    );
    expect(programLine([programBlock({ status: 'Cancelled' })], COACH_TODAY)).toBeNull();
    expect(programLine([], COACH_TODAY)).toBeNull();
  });

  it('counts days logged only up to today, and not at all when nutrition is not in the plan', () => {
    const dashboard = progressDashboard();
    expect(nutritionWeek(dashboard.nutrition, 4)).toEqual({
      logged: 4,
      elapsed: 4,
      text: '4 of 4 days logged so far',
    });
    expect(nutritionWeek(dashboard.nutrition, 7)?.text).toBe('6 of 7 days logged so far');
    expect(
      nutritionWeek({ available: false, reason: 'NoEntitlement', context: null }, 4),
    ).toBeNull();
  });
});

describe('weight', () => {
  it('reads the window the server sends as the page’s fixture, so the two stay one window', () => {
    expect(mapProgressDashboard(progressDashboardView())).toEqual(progressDashboard());
  });

  it('shows the latest weekly average, its change on last week and the last weigh-in', () => {
    const story = weightStory(progressDashboard(), 'en-US', 8);

    expect(story).toMatchObject({
      value: '71.4',
      unit: 'kg',
      context: '↓ 0.4 kg vs last week',
      lastWeighed: 'Last weighed Thu 1 Oct',
      values: [72.6, 72.2, 71.8, 71.4],
    });
    expect(story?.summary).toBe(
      'Weekly average weight over the last 8 weeks, from 72.6 to 71.4 kg',
    );
  });

  it('states a rise, no change and a lone average as facts, not as good or bad', () => {
    const weeks = (...means: (number | null)[]) =>
      progressDashboard({
        bodyweight: {
          ...progressDashboard().bodyweight,
          weeks: means.map((displayMean, index) => ({
            weekStart: `2026-09-${String(7 + index * 7).padStart(2, '0')}`,
            displayMean,
            observedDayCount: 5,
          })),
        },
      });

    expect(weightStory(weeks(71.4, 72), 'en-US', 8)?.context).toBe('↑ 0.6 kg vs last week');
    expect(weightStory(weeks(71.4, 71.4), 'en-US', 8)?.context).toBe('No change on last week');
    expect(weightStory(weeks(71.4), 'en-US', 8)?.context).toBe('One week of weigh-ins so far');
    // A week without a weigh-in is skipped, so the comparison is between two weeks that have one.
    expect(weightStory(weeks(72, null, 71.5), 'en-US', 8)?.context).toBe('↓ 0.5 kg vs last week');
  });

  it('keeps pounds as pounds and says nothing when there is no weigh-in in the window', () => {
    expect(weightStory(progressDashboard({ displayUnit: 'Pound' }), 'en-US', 8)?.unit).toBe('lb');
    expect(
      weightStory(
        progressDashboard({
          bodyweight: { ...progressDashboard().bodyweight, weeks: [], latestDate: null },
        }),
        'en-US',
        8,
      ),
    ).toBeNull();
  });
});

describe('strength records', () => {
  it('phrases each record in the unit it was lifted in and flags the recent ones', () => {
    const rows = recordRows(
      [
        record('Back Squat', 5, 60, '2026-09-28'),
        record('Bench Press', 8, 132.5, '2026-09-10', 'Pound'),
        record('Deadlift', 3, 100, '2025-12-02'),
      ],
      COACH_TODAY,
      'en-US',
    );

    expect(rows.map((row) => [row.exercise, row.amount, row.date, row.recent])).toEqual([
      ['Back Squat', '60 kg × 5', 'Mon 28 Sep', true],
      // Pounds stay pounds: nothing is converted.
      ['Bench Press', '132.5 lb × 8', 'Thu 10 Sep', false],
      // A date in another year says the year.
      ['Deadlift', '100 kg × 3', '2 Dec 2025', false],
    ]);
    expect(rows[0].isoDate).toBe('2026-09-28');
  });

  it('keeps two records of one exercise apart by their repetitions and unit', () => {
    const rows = recordRows(
      [record('Back Squat', 5, 60, '2026-09-28'), record('Back Squat', 8, 50, '2026-09-21')],
      COACH_TODAY,
      'en-US',
    );
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
  });

  it('is empty without records', () => {
    expect(recordRows(personalRecords().items, COACH_TODAY, 'en-US')).toEqual([]);
  });
});

describe('the check-in card (workflow facts only, CHK-012)', () => {
  const card = (items: Parameters<typeof checkInCard>[0]) =>
    checkInCard(items, COACH_TODAY, context);

  it('puts a submission awaiting review first, with the review as the one action', () => {
    const result = card([
      checkInItem('old', '2026-09-24', 'Submitted', '2026-09-24T07:00:00Z'),
      checkInItem('new', '2026-09-27', 'Submitted', '2026-10-01T09:00:00Z', null, true),
      checkInItem('next', '2026-10-08', null),
    ]);

    expect(result).toMatchObject({
      heading: 'Weekly check-in',
      detail: 'Sent 3 hours ago, after its due date',
      pill: { label: 'Needs review', tone: 'warning' },
      next: { text: 'Next one due Thu 8 Oct', late: false },
      action: {
        label: 'Review',
        link: `/clients/${MAYA.clientProfileId}/checkins/new`,
        queryParams: null,
      },
    });
  });

  it('says a reviewed check-in was reviewed, with nothing left to do about it', () => {
    const result = card([
      checkInItem('last', '2026-09-24', 'Reviewed', '2026-09-24T07:00:00Z', '2026-09-26T12:00:00Z'),
      checkInItem('next', '2026-10-08', null),
    ]);

    expect(result).toMatchObject({
      detail: 'Sent 7 days ago. Reviewed 5 days ago',
      pill: { label: 'Reviewed', tone: 'success' },
      action: null,
    });
  });

  it('tells a missed check-in from the next one due, and an unsent one from none assigned', () => {
    // The most recent past-due one is the one named, not the oldest.
    const late = card([
      checkInItem('a', '2026-09-17', null),
      checkInItem('b', '2026-09-24', 'Draft'),
      checkInItem('c', '2026-10-08', null),
      checkInItem('done', '2026-09-10', 'Reviewed', '2026-09-10T07:00:00Z', '2026-09-11T07:00:00Z'),
    ]);
    expect(late.next).toEqual({ text: 'Was due Thu 24 Sep, not sent', late: true });

    const unsent = card([checkInItem('c', '2026-10-08', null)]);
    expect(unsent).toMatchObject({
      heading: 'No check-in sent yet',
      pill: null,
      next: { text: 'Next one due Thu 8 Oct', late: false },
      action: null,
    });

    expect(card([])).toMatchObject({
      heading: 'No check-ins yet',
      detail: 'Once one is assigned, Maya reports in here.',
      next: null,
      action: { label: 'Open check-ins', link: `${page}/checkins` },
    });
  });

  it('treats a check-in due today as upcoming, not overdue', () => {
    expect(card([checkInItem('t', COACH_TODAY, null)]).next).toEqual({
      text: 'Next one due Thu 1 Oct',
      late: false,
    });
  });
});
