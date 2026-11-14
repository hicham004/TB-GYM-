import { describe, expect, it } from 'vitest';
import type { CoachAttentionKind } from '../../core/api/generated';
import {
  attentionItem,
  COACH_NOW,
  COACH_TODAY,
  coachMonth,
  coachOwnTodayView,
  coachTodayView,
  coachTodayWaitingView,
  DANA,
  ELIE,
  HADI_BUSINESS,
  LEA_ID,
  MAYA,
  MAYA_BUSINESS,
  OWNER_ID,
  plansEndedNotRenewed,
  plansEndingSoon,
  RAMI,
  SARA,
  waitingForCoach,
  ZIAD,
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
  waitingRow,
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
      // Lea coaches Maya: the check-in is withheld, so the owner reads who reviews it and opens her page (N9d2).
      [
        'Maya Fakhoury sent a check-in',
        'Sent 1 hour ago · Lea Khoury reviews it.',
        'Check-in',
        'review',
        'See client',
        '/clients/c-maya',
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
    expect(rows[1].action.forWhom).toBe('for Sara Mansour');
    expect(rows[0].action.forWhom).toBe('Maya Fakhoury');
    expect(rows[0].initials).toBe('MF');
  });

  it("names the coach only on a team member's client", () => {
    const renewal = (client: typeof MAYA, userId: string | null) =>
      attentionRow(
        attentionItem('RenewalRequested', client, { date: '2026-09-27', subjectId: 'e-1' }),
        COACH_TODAY,
        { ...context, userId },
      );

    expect(renewal(MAYA_BUSINESS, OWNER_ID).coach).toBe('Lea Khoury');
    expect(renewal(SARA, OWNER_ID).coach).toBeNull();
    // Lea reads her own client with no coach named.
    expect(renewal(MAYA, LEA_ID).coach).toBeNull();
    const rows = mapCoachToday(coachTodayView(), context).attention;
    expect(rows.slice(1).every((row) => row.coach === null && !row.waiting)).toBe(true);
    // A withheld item names Lea in its detail instead (N9d2), never twice.
    expect([rows[0].coach, rows[0].detail]).toEqual([
      null,
      'Sent 1 hour ago · Lea Khoury reviews it.',
    ]);
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

  it('says a client between programs has none running, and when they joined (N10a)', () => {
    const between = attentionRow(
      attentionItem('NoProgram', SARA, { date: '2026-03-01', subjectId: 'block-ended' }),
      COACH_TODAY,
      context,
    );
    expect(between).toMatchObject({
      heading: 'Sara Mansour has no program running',
      detail: 'Joined Sun 1 Mar',
      tag: 'Program',
      tone: 'new',
      action: {
        label: 'Assign program',
        link: `/clients/${SARA.clientProfileId}/training`,
        queryParams: { action: 'assign' },
      },
    });
  });

  it('names lifts ready to step up, or weights to apply when one keeps its weight, and the next workout (N6d)', () => {
    const row = (fields: Parameters<typeof attentionItem>[2]) =>
      attentionRow(attentionItem('WeightsToApply', SARA, fields), COACH_TODAY, context);

    expect(row({ count: 3, stepUps: 3, date: COACH_TODAY })).toMatchObject({
      key: `WeightsToApply:${SARA.clientProfileId}`,
      heading: 'Sara Mansour has 3 lifts ready to step up',
      detail: 'Next workout today',
      tag: 'Weights',
      tone: 'share',
      action: {
        label: 'Review weights',
        forWhom: 'for Sara Mansour',
        link: `/clients/${SARA.clientProfileId}/training`,
        queryParams: { action: 'weights' },
        startsChatWith: null,
      },
    });
    const one = row({ count: 1, stepUps: 1, date: '2026-10-02' });
    expect([one.heading, one.detail]).toEqual([
      'Sara Mansour has a lift ready to step up',
      'Next workout tomorrow',
    ]);
    // A weight kept from last time is applied as well (STR-020), so the words promise no step.
    const kept = row({ count: 2, stepUps: 1, date: '2026-10-06' });
    expect([kept.heading, kept.detail]).toEqual([
      'Sara Mansour has 2 weights to apply',
      'Next workout Tue 6 Oct',
    ]);
    expect(row({ count: 1, stepUps: 0, date: '2026-10-06' }).heading).toBe(
      'Sara Mansour has a weight to apply',
    );
    // A program's day behind the workspace's (after it moved its zone) is still that program's today.
    expect(row({ count: 1, stepUps: 1, date: '2026-09-30' }).detail).toBe('Next workout today');
    // The server reads weights only for the clients the caller coaches (N9d1a); one reaching another coach's client
    // would open nothing, so it opens their page (N9d2).
    const theirs = attentionRow(
      attentionItem('WeightsToApply', MAYA_BUSINESS, { count: 1, stepUps: 1, date: '2026-10-02' }),
      COACH_TODAY,
      context,
    );
    expect([theirs.coach, theirs.detail, theirs.action.label, theirs.action.link]).toEqual([
      null,
      'Next workout tomorrow · Lea Khoury follows up.',
      'See client',
      '/clients/c-maya',
    ]);
  });

  it('lets no row of any kind say that logged sets suggest a max, or offer Review maxes (N10a)', () => {
    // One item of every kind the server sends, keyed by kind: leaving one out, or naming one the
    // server no longer sends, does not compile.
    const every = {
      CheckInToReview: { count: 1, since: COACH_NOW, subjectId: 'a-1' },
      UnreadMessages: { count: 2, since: COACH_NOW, subjectId: 'conv-1' },
      RenewalRequested: { date: '2026-09-27', subjectId: 'e-1' },
      NoPlan: { date: COACH_TODAY },
      PlanEndingSoon: { date: '2026-10-09', subjectId: 'e-1' },
      SessionsRunningOut: { sessionsLeft: 1, date: '2026-10-29', subjectId: 'pack-1' },
      WeekNotShared: { date: '2026-10-02', weekNumber: 3 },
      MissedSessions: { count: 2, date: '2026-09-24' },
      CheckInOverdue: { count: 1, date: '2026-09-28', canMessage: true },
      NoProgram: { date: '2026-03-01', subjectId: 'block-ended' },
      WeightsToApply: { count: 3, stepUps: 3, date: '2026-10-02' },
    } satisfies Record<CoachAttentionKind, Parameters<typeof attentionItem>[2]>;
    const rows = (Object.keys(every) as CoachAttentionKind[]).map((kind) =>
      attentionRow(attentionItem(kind, SARA, every[kind]), COACH_TODAY, context),
    );
    const words = rows.flatMap((row) => [row.heading, row.detail, row.tag, row.action.label]);

    expect(rows).toHaveLength(11);
    expect(words.filter((text) => /suggest|review maxes|\bmax(es)?\b/i.test(text))).toEqual([]);
    expect(rows.filter((row) => row.action.queryParams?.['action'] === 'maxes')).toEqual([]);
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
      // Another coach's client: their check-ins are the private side (N9d1a), so the owner reads who follows up and
      // opens the client's page (N9d2).
      const theirs = attentionRow(
        attentionItem('CheckInOverdue', MAYA_BUSINESS, {
          count: 1,
          date: '2026-09-28',
          canMessage: false,
        }),
        COACH_TODAY,
        context,
      );
      expect([theirs.heading, theirs.detail, theirs.coach]).toEqual([
        "Maya Fakhoury's check-in is overdue",
        'It was due Mon 28 Sep · Lea Khoury follows up.',
        null,
      ]);
      expect(theirs.action).toEqual({
        label: 'See client',
        forWhom: 'Maya Fakhoury',
        link: '/clients/c-maya',
        queryParams: null,
        startsChatWith: null,
      });
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
      target('NoPlan'),
      target('WeightsToApply', { count: 2, stepUps: 2 }),
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
      { link: `${page}/service`, queryParams: { action: 'start' } },
      { link: `${page}/training`, queryParams: { action: 'weights' } },
    ]);
  });

  it('opens a client’s page, not their private side, for a client the caller does not coach (N9d2)', () => {
    const theirs = (kind: Parameters<typeof attentionItem>[0], fields = {}) =>
      attentionTarget(attentionItem(kind, MAYA_BUSINESS, fields));
    const page = '/clients/c-maya';

    // The check-ins and the training are the private side; a waiting client is nobody's yet.
    for (const kind of [
      'CheckInToReview',
      'MissedSessions',
      'CheckInOverdue',
      'WeekNotShared',
      'NoProgram',
      'WeightsToApply',
    ] as const) {
      expect(theirs(kind, { count: 1 })).toEqual({ link: page, queryParams: null });
      expect(attentionTarget(attentionItem(kind, ZIAD, { count: 1 }))).toEqual({
        link: '/clients/c-ziad',
        queryParams: null,
      });
    }
    // The business side opens where it did.
    expect(theirs('RenewalRequested', { subjectId: 'e-1' })).toEqual({
      link: `${page}/service`,
      queryParams: { renew: 'e-1' },
    });
    expect(theirs('SessionsRunningOut', { count: 1, subjectId: 'pack-2' })).toEqual({
      link: `${page}/service`,
      queryParams: { pay: 'pack-2' },
    });
    expect(theirs('NoPlan')).toEqual({ link: `${page}/service`, queryParams: { action: 'start' } });
    // A missing mayCoach (an older answer) reads as the caller's own client.
    expect(
      attentionTarget(attentionItem('CheckInToReview', MAYA, { count: 1, subjectId: 'a-1' })),
    ).toEqual({ link: `${page}/checkins/a-1`, queryParams: null });
  });

  describe('a client the caller does not coach (C8, notes plan N9d2)', () => {
    const row = (
      kind: Parameters<typeof attentionItem>[0],
      client = MAYA_BUSINESS,
      fields: Parameters<typeof attentionItem>[2] = {},
    ) => attentionRow(attentionItem(kind, client, fields), COACH_TODAY, context);

    it('keeps the sentence, says who reviews or follows up, and offers See client', () => {
      const review = row('CheckInToReview', MAYA_BUSINESS, {
        count: 2,
        since: '2026-09-25T12:00:00Z',
        newestAt: '2026-10-01T11:55:00Z',
      });
      // Several check-ins are "them", as the client's page says (whoActs).
      expect([review.heading, review.detail, review.tag, review.withheld]).toEqual([
        'Maya Fakhoury sent 2 check-ins',
        'The newest came 5 minutes ago, the first 6 days ago · Lea Khoury reviews them.',
        'Check-in',
        true,
      ]);
      expect(review.action).toMatchObject({ label: 'See client', link: '/clients/c-maya' });
      const one = row('CheckInToReview', MAYA_BUSINESS, {
        count: 1,
        since: '2026-10-01T11:00:00Z',
      });
      expect(one.detail).toBe('Sent 1 hour ago · Lea Khoury reviews it.');
      // A coach the answer leaves unnamed is still their coach, one check-in or several.
      const unnamed = { ...MAYA_BUSINESS, assignedCoachName: null };
      expect([
        row('CheckInToReview', unnamed, { count: 1, since: '2026-10-01T11:00:00Z' }).detail,
        row('CheckInToReview', unnamed, {
          count: 3,
          since: '2026-09-25T12:00:00Z',
          newestAt: '2026-10-01T11:55:00Z',
        }).detail,
      ]).toEqual([
        'Sent 1 hour ago · Their coach reviews it.',
        'The newest came 5 minutes ago, the first 6 days ago · Their coach reviews them.',
      ]);
      // The caller's own rows and a business row about Lea's client are theirs to act on.
      expect([row('UnreadMessages', SARA, { count: 1 }).withheld, row('NoPlan').withheld]).toEqual([
        false,
        false,
      ]);
    });

    it('says nothing of the last workout the server withheld, never “No workout logged yet”', () => {
      const missed = row('MissedSessions', MAYA_BUSINESS, { count: 3, date: null });
      expect([missed.heading, missed.detail, missed.coach]).toEqual([
        'Maya Fakhoury missed 3 workouts in a row',
        'Lea Khoury follows up.',
        null,
      ]);
      expect(missed.action).toMatchObject({
        label: 'See client',
        forWhom: 'Maya Fakhoury',
        link: '/clients/c-maya',
        queryParams: null,
      });
      // The caller's own client who never trained still says so.
      expect(row('MissedSessions', SARA, { count: 2, date: null }).detail).toBe(
        'No workout logged yet',
      );
    });

    it('tells the owner a waiting client’s new coach follows up, for each private kind', () => {
      const waiting = (kind: 'CheckInToReview' | 'MissedSessions' | 'CheckInOverdue') => {
        const read = row(kind, ZIAD, {
          count: 1,
          since: '2026-10-01T11:00:00Z',
          date: kind === 'CheckInOverdue' ? '2026-09-28' : null,
        });
        return [read.detail, read.coach, read.waiting, read.action.label];
      };

      expect([
        waiting('CheckInToReview'),
        waiting('MissedSessions'),
        waiting('CheckInOverdue'),
      ]).toEqual([
        [
          'Sent 1 hour ago · Their new coach follows up once you choose one.',
          null,
          false,
          'See client',
        ],
        ['Their new coach follows up once you choose one.', null, false, 'See client'],
        [
          'It was due Mon 28 Sep · Their new coach follows up once you choose one.',
          null,
          false,
          'See client',
        ],
      ]);
    });

    it('marks a waiting client’s business rows as waiting, where a team member’s client names its coach', () => {
      const joined = row('NoPlan', DANA, { date: COACH_TODAY });
      expect([joined.coach, joined.waiting, joined.action.label, joined.action.link]).toEqual([
        null,
        true,
        'Start a plan',
        '/clients/c-dana/service',
      ]);
      expect([row('NoPlan', MAYA_BUSINESS).waiting, row('NoPlan', SARA).waiting]).toEqual([
        false,
        false,
      ]);
      const plans = mapCoachToday(coachTodayWaitingView(), context).plansEnding;
      expect(plans.map((plan) => [plan.name, plan.coach, plan.waiting])).toEqual([
        ['Rita Daher', null, false],
        ['Sara Mansour', null, false],
        ['Maya Fakhoury', 'Lea Khoury', false],
        ['Ziad Khalil', null, true],
      ]);
      expect(
        planEndedRow({ ...plansEndedNotRenewed()[0], client: ZIAD }, COACH_TODAY, context).waiting,
      ).toBe(true);
      expect(planEndedRow(plansEndedNotRenewed()[1], COACH_TODAY, context)).toMatchObject({
        name: 'Hadi Nassar',
        coach: 'Lea Khoury',
        waiting: false,
      });
      expect(plansEndedNotRenewed()[1].client).toEqual(HADI_BUSINESS);
    });
  });

  describe('clients waiting for a coach (notes plan N9d1b, N9d2)', () => {
    it('lists them longest first, since the day on the workspace’s clock, and who coached them before', () => {
      const today = mapCoachToday(coachTodayWaitingView(), context);

      expect(today.waiting.map((row) => [row.name, row.initials, row.detail])).toEqual([
        ['Ziad Khalil', 'ZK', 'Since Mon 28 Sep · Coached by Rana Saad before'],
        // 21:30 UTC on Wed 30 Sep is past midnight in Beirut: Thu 1 Oct, not the UTC day.
        ['Dana Aoun', 'DA', 'Since Thu 1 Oct · No coach yet'],
      ]);
      expect(today.waiting[0]).toMatchObject({ key: 'c-ziad', clientId: 'c-ziad' });
      // Choose a coach opens the client's Service & access with the coach dialog open.
      expect(today.waiting[0].action).toEqual({
        label: 'Choose a coach',
        forWhom: 'for Ziad Khalil',
        link: '/clients/c-ziad/service',
        queryParams: { action: 'coach' },
        startsChatWith: null,
      });
      // Their items are in Needs you as any client's, counted once each.
      expect(today.needsCount).toBe(9);
    });

    it('names an earlier year, and treats a blank previous coach as nobody', () => {
      const [ziad] = waitingForCoach();
      const view = { today: COACH_TODAY, timeZoneId: 'Asia/Beirut' };

      expect(
        waitingRow({ ...ziad, waitingSinceUtc: '2025-12-20T10:00:00Z' }, view, 'en-US').detail,
      ).toBe('Since 20 Dec 2025 · Coached by Rana Saad before');
      expect(waitingRow({ ...ziad, previousCoachName: '  ' }, view, 'en-US').detail).toBe(
        'Since Mon 28 Sep · No coach yet',
      );
    });

    it('has none for a coach, whose answer has no list, nor while nobody waits', () => {
      expect(mapCoachToday(coachOwnTodayView(), { ...context, userId: LEA_ID }).waiting).toEqual(
        [],
      );
      expect(mapCoachToday(coachTodayView(), context).waiting).toEqual([]);
      const older = coachTodayView();
      delete older.waitingForCoach;
      expect(mapCoachToday(older, context).waiting).toEqual([]);
    });

    it('adds a No coach line to This month while clients sit in no member’s row, so the rows add up', () => {
      expect(mapCoachToday(coachTodayWaitingView(), context).month.noCoach).toBe(
        '1 of 2 clients active',
      );
      expect(mapCoachToday(coachTodayView(), context).month.noCoach).toBeNull();
      expect(thisMonth(coachMonth({ activeClientCount: 9 }), 13, 'en-US').noCoach).toBe(
        '0 of 1 client active',
      );
      // A coach has no team rows, so nothing to add up.
      expect(thisMonth(coachMonth({ coaches: null }), 5, 'en-US').noCoach).toBeNull();
    });
  });

  it('turns a finished workout into a sentence with its first two records', () => {
    const [rami, nour, rita] = mapCoachToday(coachTodayView(), context).activity;

    expect(rami.sentence).toBe('Rami Tabet finished Lower A in 58 min');
    expect(rami.records).toEqual(['Back squat 140 kg × 3', 'Romanian deadlift 107.5 kg × 8']);
    expect(rami.moreRecords).toBe(1);
    expect([rami.ago, rami.link]).toEqual(['35 minutes ago', '/clients/c-rami/training']);
    expect(nour.sentence).toBe('Nour Hamdan sent a check-in: Weekly check-in');
    expect(nour.link).toBe('/clients/c-nour/checkins/a-nour');
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
