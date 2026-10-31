import { describe, expect, it } from 'vitest';
import {
  attentionItem,
  COACH_NOW,
  COACH_TODAY,
  coachMonth,
  coachOwnTodayView,
  coachTodayView,
  ELIE,
  LEA_ID,
  MAYA,
  OWNER_ID,
  plansEndedNotRenewed,
  plansEndingSoon,
  RAMI,
  SARA,
} from '../../../testing/coach-today-fixtures';
import {
  activeClients,
  activityRow,
  ago,
  attentionRow,
  attentionTarget,
  daysBetween,
  mapCoachToday,
  moneyLine,
  partOfDay,
  planEndedRow,
  planEndingRow,
  thisMonth,
  type CoachTodayContext,
} from './coach-today.models';

const context: CoachTodayContext = { locale: 'en-US', now: new Date(COACH_NOW), userId: OWNER_ID };

describe('Coach Today view model', () => {
  it('reads the day and the people waiting from the server', () => {
    const today = mapCoachToday(coachTodayView(), context);

    expect(today.dateLabel).toBe('Thursday 1 October');
    expect(today.partOfDay).toBe('afternoon');
    expect([today.clientCount, today.needsCount]).toEqual([12, 7]);
    // The week's sessions left Today (critique B4b); a client's page keeps its own week.
    expect(today).not.toHaveProperty('week');
  });

  describe('1-on-1 sessions (critique B10c, SES-008)', () => {
    const running = (fields: Parameters<typeof attentionItem>[2]) =>
      attentionRow(attentionItem('SessionsRunningOut', SARA, fields), COACH_TODAY, context);

    it('says how many are left and the last day, and renews the pack ending last', () => {
      expect(running({ sessionsLeft: 2, date: '2026-10-29', subjectId: 'pack-1' })).toMatchObject({
        heading: 'Sara Mansour has 2 sessions left',
        detail: 'Last day Thu 29 Oct',
        tag: 'Sessions',
        tone: 'ending',
        action: {
          label: 'Renew pack',
          link: '/clients/c-sara/service',
          queryParams: { renew: 'pack-1' },
        },
      });
    });

    it('words one session left and none', () => {
      expect(running({ sessionsLeft: 1 }).heading).toBe('Sara Mansour has 1 session left');
      expect(running({ sessionsLeft: 0 }).heading).toBe('Sara Mansour has no sessions left');
    });

    it('asks for the payment of a pack booked and unpaid, which holds nothing yet', () => {
      expect(
        running({ sessionsLeft: 1, date: '2026-10-29', count: 1, subjectId: 'pack-2' }),
      ).toMatchObject({
        detail: 'Last day Thu 29 Oct · The next pack isn’t paid yet',
        action: { label: 'Record payment', queryParams: { pay: 'pack-2' } },
      });
    });

    it('opens from the Clients table where Today opens it', () => {
      expect(
        attentionTarget(attentionItem('SessionsRunningOut', SARA, { subjectId: 'pack-1' })),
      ).toEqual({ link: '/clients/c-sara/service', queryParams: { renew: 'pack-1' } });
    });

    it('adds what is left to a pack ending as the client’s plan, and to nothing else', () => {
      const ending = (fields: Parameters<typeof attentionItem>[2]) =>
        attentionRow(
          attentionItem('PlanEndingSoon', SARA, { date: '2026-10-09', ...fields }),
          COACH_TODAY,
          context,
        ).detail;

      expect(ending({ sessionsLeft: 3 })).toBe('3 sessions left · Last day Fri 9 Oct');
      expect(ending({ sessionsLeft: 0 })).toBe('No sessions left · Last day Fri 9 Oct');
      expect(ending({})).toBe('Last day Fri 9 Oct');
    });

    it('counts the sessions held for whoever reads them, and only once there is something to count', () => {
      expect(thisMonth(coachMonth({ sessionsHeld: 12 }), 12, 'en-US').sessions).toEqual({
        held: '12',
        by: 'Held by your coaching space',
      });
      expect(
        thisMonth(coachMonth({ sessionsHeld: 0, coaches: null }), 2, 'en-US').sessions,
      ).toEqual({ held: '0', by: 'Held by you' });
      expect(thisMonth(coachMonth({ sessionsHeld: null }), 12, 'en-US').sessions).toBeNull();
      expect(thisMonth(coachMonth(), 12, 'en-US').sessions).toBeNull();
    });
  });

  describe('This month (SUB-016, CLI-020)', () => {
    it('gives each currency its own line with its exact amount, never one total', () => {
      const month = mapCoachToday(coachTodayView(), context).month;

      expect(month.name).toBe('October');
      expect(month.money).toEqual([
        { currency: 'LBP', amount: 'LBP 4,500,000', payments: '1 payment' },
        { currency: 'USD', amount: 'USD 2,340', payments: '7 payments' },
      ]);
      // Cents are kept, the code first, as every amount in the app reads; a decimal sent as text too.
      expect(
        [
          { currency: 'USD', amount: 82.5, paymentCount: 2 },
          { currency: 'USD', amount: '1234.05', paymentCount: '3' },
          { currency: 'EUR', amount: '330.00', paymentCount: 1 },
        ].map((total) => moneyLine(total, 'en-US')),
      ).toEqual([
        { currency: 'USD', amount: 'USD 82.50', payments: '2 payments' },
        { currency: 'USD', amount: 'USD 1,234.05', payments: '3 payments' },
        { currency: 'EUR', amount: 'EUR 330', payments: '1 payment' },
      ]);
    });

    it('says whose money it is: the whole coaching space for the owner, their own clients for a coach', () => {
      expect(thisMonth(coachMonth(), 12, 'en-US').moneyFrom).toBe(
        'Received by your coaching space',
      );
      expect(thisMonth(coachMonth({ coaches: null }), 2, 'en-US').moneyFrom).toBe(
        'Received from your clients',
      );
    });

    it('leaves money empty when nothing arrived, with no line in any currency', () => {
      const month = thisMonth(coachMonth({ moneyReceived: [] }), 12, 'en-US');

      expect(month.money).toEqual([]);
    });

    it('says how many clients are active out of every current client', () => {
      expect(mapCoachToday(coachTodayView(), context).month.active).toBe('9 of 12 clients');
      expect([activeClients(1, 1), activeClients(0, 1), activeClients(0, 3)]).toEqual([
        '1 of 1 client',
        '0 of 1 client',
        '0 of 3 clients',
      ]);
    });

    it('lists the owner’s team, the owner first as You, with each one’s active clients', () => {
      const staff = mapCoachToday(coachTodayView(), context).month.staff;

      expect(staff?.map((member) => [member.name, member.initials, member.clients])).toEqual([
        ['You', 'KH', '7 of 10 clients active'],
        ['Lea Khoury', 'LK', '2 of 2 clients active'],
        ['Omar Saleh', 'OS', 'No clients yet'],
      ]);
      const one = thisMonth(
        coachMonth({
          coaches: [
            {
              coachUserId: LEA_ID,
              name: 'Lea Khoury',
              isYou: false,
              activeClientCount: 0,
              clientCount: 1,
            },
          ],
        }),
        1,
        'en-US',
      );
      expect(one.staff?.[0].clients).toBe('0 of 1 client active');
    });

    it('gives a coach no team: the server sends it to the owner alone', () => {
      const month = mapCoachToday(coachOwnTodayView(), { ...context, userId: LEA_ID }).month;

      expect(month.staff).toBeNull();
      expect(month.money.map((line) => line.amount)).toEqual(['USD 82.50']);
      expect(month.active).toBe('2 of 2 clients');
    });
  });

  describe('Plans ending soon', () => {
    const [rita, sara, maya] = plansEndingSoon();

    it('names the plan and its last day, soonest first, with Renew opening the renew sheet', () => {
      const rows = mapCoachToday(coachTodayView(), context).plansEnding;

      expect(rows.map((row) => [row.name, row.plan, row.detail])).toEqual([
        ['Rita Daher', 'Strength coaching', 'Ends tomorrow'],
        ['Sara Mansour', 'Online coaching', 'Ends Wed 7 Oct'],
        [
          'Maya Fakhoury',
          'Fat loss · 12 weeks',
          'Paid until Fri 9 Oct · The renewal isn’t paid yet',
        ],
      ]);
      expect(rows[0].action).toEqual({
        label: 'Renew',
        forWhom: 'for Rita Daher',
        link: '/clients/c-rita/service',
        queryParams: { renew: 'e-rita' },
        startsChatWith: null,
      });
      expect(planEndingRow({ ...rita, lastDay: COACH_TODAY }, COACH_TODAY, context).detail).toBe(
        'Ends today',
      );
    });

    it('records the payment of a renewal already booked and unpaid instead of renewing again (BEB-7)', () => {
      const row = planEndingRow(maya, COACH_TODAY, context);

      expect(row.action).toMatchObject({
        label: 'Record payment',
        forWhom: 'for Maya Fakhoury',
        link: '/clients/c-maya/service',
        queryParams: { pay: 'e-maya-next' },
      });
      // Lea coaches Maya: the owner is told so, and may not message her (CLI-013).
      expect([row.coach, row.message, row.release]).toEqual(['Lea Khoury', null, null]);
    });

    it('offers Message only when the caller may message the client, starting a chat if none exists', () => {
      expect(planEndingRow(rita, COACH_TODAY, context).message).toEqual({
        label: 'Message',
        forWhom: 'Rita Daher',
        link: '/messages',
        queryParams: { conversation: 'conv-rita' },
        startsChatWith: null,
      });
      expect(planEndingRow(sara, COACH_TODAY, context).message).toMatchObject({
        label: 'Message',
        queryParams: null,
        startsChatWith: SARA.clientProfileId,
      });
      expect(
        planEndingRow({ ...rita, canMessage: false }, COACH_TODAY, context).message,
      ).toBeNull();
    });

    it('leaves out a plan name the server does not have', () => {
      expect(planEndingRow({ ...rita, planName: '' }, COACH_TODAY, context).plan).toBe('');
    });
  });

  describe('Ended, not renewed', () => {
    const [elie, hadi] = plansEndedNotRenewed();

    it('says when the plan ended and when the client asked to renew, with Renew', () => {
      const rows = mapCoachToday(coachTodayView(), context).plansEnded;

      expect(rows.map((row) => [row.name, row.plan, row.detail])).toEqual([
        ['Elie Azar', 'Strength coaching', 'Ended Sun 27 Sep · Asked to renew on Tue 29 Sep'],
        ['Hadi Nassar', 'Online coaching', 'Ended Sun 20 Sep · The next plan isn’t paid yet'],
      ]);
      expect(rows[0].action).toMatchObject({
        label: 'Renew',
        link: `/clients/${ELIE.clientProfileId}/service`,
        queryParams: { renew: 'e-elie' },
      });
      expect(planEndedRow({ ...elie, lastDay: '2026-09-30' }, COACH_TODAY, context).detail).toBe(
        'Ended yesterday · Asked to renew on Tue 29 Sep',
      );
    });

    it('records the payment of the next plan booked and unpaid instead of renewing', () => {
      expect(planEndedRow(hadi, COACH_TODAY, context).action).toMatchObject({
        label: 'Record payment',
        forWhom: 'for Hadi Nassar',
        queryParams: { pay: 'e-hadi-next' },
      });
    });

    it('lets the owner alone end coaching, with the version the owner saw, and never offers Message', () => {
      const owner = planEndedRow(elie, COACH_TODAY, context);
      expect(owner.release).toEqual({
        id: ELIE.clientProfileId,
        firstName: 'Elie',
        lastName: 'Azar',
        version: 4,
        forWhom: 'with Elie Azar',
      });
      expect(owner.message).toBeNull();
      expect(
        planEndedRow({ ...elie, clientVersion: '12' }, COACH_TODAY, context).release?.version,
      ).toBe(12);

      // A coach's rows carry no version: Renew only (ADR 0027).
      const coach = mapCoachToday(coachOwnTodayView(), { ...context, userId: LEA_ID }).plansEnded;
      expect(coach.map((row) => [row.action.label, row.release, row.message])).toEqual([
        ['Record payment', null, null],
      ]);
    });
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
        'Jad Karam missed 3 workouts in a row',
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

  describe('an overdue check-in (CHK-015, critique B4a)', () => {
    const overdue = (fields: Parameters<typeof attentionItem>[2]) =>
      attentionRow(attentionItem('CheckInOverdue', SARA, fields), COACH_TODAY, context);

    it('says how many are overdue and when the oldest was due', () => {
      const two = overdue({
        count: 2,
        date: '2026-09-19',
        canMessage: true,
        subjectId: 'conv-sara',
      });
      expect([two.heading, two.detail, two.tag, two.tone]).toEqual([
        'Sara Mansour has 2 check-ins overdue',
        'The oldest was due Sat 19 Sep',
        'Overdue',
        'missed',
      ]);
      const one = overdue({
        count: 1,
        date: '2026-09-28',
        canMessage: true,
        subjectId: 'conv-sara',
      });
      expect([one.heading, one.detail]).toEqual([
        "Sara Mansour's check-in is overdue",
        'It was due Mon 28 Sep',
      ]);
    });

    it('reminds in the coach’s own chat, starting it when there is none yet', () => {
      expect(
        overdue({ count: 1, date: '2026-09-28', canMessage: true, subjectId: 'conv-sara' }).action,
      ).toEqual({
        label: 'Remind',
        forWhom: 'Sara Mansour',
        link: '/messages',
        queryParams: { conversation: 'conv-sara' },
        startsChatWith: null,
      });
      expect(overdue({ count: 1, date: '2026-09-28', canMessage: true }).action).toMatchObject({
        label: 'Remind',
        startsChatWith: SARA.clientProfileId,
      });
    });

    it('opens the client’s check-ins for anyone who may not message them (CLI-013)', () => {
      const owner = overdue({ count: 1, date: '2026-09-28', canMessage: false });
      expect(owner.action).toEqual({
        label: 'See check-ins',
        forWhom: 'for Sara Mansour',
        link: `/clients/${SARA.clientProfileId}/checkins`,
        queryParams: null,
        startsChatWith: null,
      });
      // A team coach's client names its coach to the owner, beside it.
      const theirs = attentionRow(
        attentionItem('CheckInOverdue', MAYA, { count: 1, date: '2026-09-28', canMessage: false }),
        COACH_TODAY,
        context,
      );
      expect([theirs.coach, theirs.action.label]).toEqual(['Lea Khoury', 'See check-ins']);
    });
  });

  it('links every reason to where it is handled, as the Clients table’s tags do', () => {
    const target = (kind: Parameters<typeof attentionItem>[0], fields = {}) =>
      attentionTarget(attentionItem(kind, SARA, fields));
    const page = `/clients/${SARA.clientProfileId}`;

    expect([
      target('CheckInToReview', { count: 1, subjectId: 'a-1' }),
      target('CheckInToReview', { count: 3, subjectId: 'a-1' }),
      target('UnreadMessages', { subjectId: 'conv-1' }),
      target('RenewalRequested', { subjectId: 'e-1' }),
      target('PlanEndingSoon', { subjectId: 'e-1' }),
      target('PlanEndingSoon', { count: 1, subjectId: 'renewal-1' }),
      target('WeekNotShared'),
      target('MissedSessions', { count: 2 }),
      target('CheckInOverdue', { count: 2, subjectId: 'conv-1' }),
      target('NoProgram'),
      target('MaxesToReview'),
      target('NoPlan'),
    ]).toEqual([
      { link: `${page}/checkins/a-1`, queryParams: null },
      { link: `${page}/checkins`, queryParams: null },
      { link: '/messages', queryParams: { conversation: 'conv-1' } },
      { link: `${page}/service`, queryParams: { renew: 'e-1' } },
      { link: `${page}/service`, queryParams: { renew: 'e-1' } },
      { link: `${page}/service`, queryParams: { pay: 'renewal-1' } },
      { link: `${page}/training`, queryParams: null },
      { link: `${page}/training`, queryParams: null },
      // What it names: the client's check-ins, whoever may message them.
      { link: `${page}/checkins`, queryParams: null },
      { link: `${page}/training`, queryParams: { action: 'assign' } },
      { link: `${page}/training`, queryParams: { action: 'maxes' } },
      { link: `${page}/service`, queryParams: { action: 'start' } },
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
