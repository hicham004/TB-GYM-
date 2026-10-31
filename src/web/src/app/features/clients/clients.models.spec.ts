import { describe, expect, it } from 'vitest';
import type { FormerClient } from '../../core/api/api.models';
import {
  attentionItem,
  coachClient,
  COACH_NOW,
  COACH_TODAY,
  OWNER_ID,
} from '../../../testing/coach-today-fixtures';
import {
  clientListView,
  overviewRow,
  planSummary,
  recentDays,
} from '../../../testing/client-list-fixtures';
import {
  activityLabel,
  attentionReason,
  clientRow,
  clientWeek,
  coachChip,
  emptyList,
  filterCounts,
  formerClientRow,
  lastCheckIn,
  listSummary,
  mapClientList,
  matches,
  planCell,
  planLabel,
  type ClientListContext,
  type ClientRow,
} from './clients.models';

describe('the owner’s Coach filter (critique B3a)', () => {
  const row = (coachId: string, coach: string | null): ClientRow =>
    ({ coachId, coach, filters: new Set(['all']), searchText: '' }) as unknown as ClientRow;
  const rows = [
    row('me', null),
    row('lea', 'Lea Khoury'),
    row('adam', 'Adam Sabbagh'),
    row('lea', 'Lea Khoury'),
  ];

  it('offers every coach with clients here, you first, then the others by name', () => {
    const chip = coachChip(rows, '', 'me', 'en-US');

    expect(chip?.name).toBe('Coach');
    expect(chip?.active).toBe(false);
    expect(chip?.chosen).toBeNull();
    expect(chip?.items).toEqual([
      { label: 'Every coach', action: '' },
      { label: 'You', action: 'me' },
      { label: 'Adam Sabbagh', action: 'adam' },
      { label: 'Lea Khoury', action: 'lea' },
    ]);
  });

  it('names the chosen coach, and narrows nothing for one the list does not hold', () => {
    expect(coachChip(rows, 'lea', 'me', 'en-US')).toMatchObject({
      name: 'Coach: Lea Khoury',
      active: true,
      chosen: { name: 'Lea Khoury', isYou: false },
    });
    expect(coachChip(rows, 'me', 'me', 'en-US')).toMatchObject({
      name: 'Coach: You',
      active: true,
      chosen: { name: 'You', isYou: true },
    });
    expect(coachChip(rows, 'gone', 'me', 'en-US')).toMatchObject({
      name: 'Coach',
      active: false,
      chosen: null,
    });
  });

  it('has no chip on a list with one coach, as every coach’s own list is', () => {
    expect(coachChip([row('me', null), row('me', null)], '', 'me', 'en-US')).toBeNull();
    expect(coachChip([], '', 'me', 'en-US')).toBeNull();
  });

  it('keeps only the chosen coach’s clients, and every client without a choice', () => {
    expect(matches(rows[1], 'all', '', 'lea')).toBe(true);
    expect(matches(rows[2], 'all', '', 'lea')).toBe(false);
    expect(matches(rows[2], 'all', '')).toBe(true);
  });
});

const context: ClientListContext = {
  locale: 'en-US',
  now: new Date(COACH_NOW),
  userId: OWNER_ID,
};

function rows(): Record<string, ClientRow> {
  const list = mapClientList(clientListView(), context);
  return Object.fromEntries(list.rows.map((row) => [row.name.split(' ')[0], row]));
}

describe('client list (C2, critique B4a)', () => {
  it('keeps the server order and counts each chip over the whole list', () => {
    const list = mapClientList(clientListView(), context);

    expect(list.rows.map((row) => row.name)).toEqual([
      'Elie Azar',
      'Hiba Nasser',
      'Jad Karam',
      'Karl Saade',
      'Lynn Bou Khalil',
      'Maya Fakhoury',
      'Nour Hamdan',
      'Rami Tabet',
      'Rita Daher',
      'Sara Mansour',
      'Tala Rizk',
      'Ziad Chahine',
    ]);
    expect(list.counts).toEqual({ all: 12, attention: 6, ending: 2, paused: 1, new: 2, maxes: 0 });
  });

  it('says the age for the workspace’s today, and nothing without a birth date (CLI-005)', () => {
    const { Maya, Hiba, Tala, Lynn } = rows();

    expect(Maya.age).toBe('Age 29');
    // Born in November: not 38 until then.
    expect(Hiba.age).toBe('Age 37');
    // Born on this very day of 1996.
    expect(Tala.age).toBe('Age 30');
    expect(Lynn.age).toBeNull();
    // The workspace's day decides, not the device's.
    const birthday = overviewRow(coachClient('c-b', 'Ali', 'Fares'), { birthDate: '1996-10-02' });
    expect(clientRow(birthday, COACH_TODAY, context).age).toBe('Age 29');
    expect(clientRow(birthday, '2026-10-02', context).age).toBe('Age 30');
  });

  it('names the plan’s own status beside the reasons, whatever they are (CLI-018 v4)', () => {
    const { Maya, Karl, Rita, Sara, Rami, Ziad } = rows();

    expect(Rami.planPill).toEqual({ label: 'On track', tone: 'success' });
    expect(Karl.planPill).toEqual({ label: 'Plan paused', tone: 'info' });
    expect(Rita.planPill).toEqual({ label: 'Plan ends soon', tone: 'warm' });
    expect(Ziad.planPill).toEqual({ label: 'No active plan', tone: 'neutral' });
    // A plan's end keeps its own status beside a reason that needs the coach.
    expect(Sara.planPill).toEqual({ label: 'Plan ends soon', tone: 'warm' });
    expect(Maya.planPill.label).toBe('On track');
  });

  it('says a blocked client’s access is blocked, beside the plan that still stands (critique B11)', () => {
    const blocked = clientRow(
      overviewRow(coachClient('c-b', 'Ali', 'Fares'), {
        planState: 'Blocked',
        planEndsOn: '2026-12-20',
      }),
      COACH_TODAY,
      context,
    );
    expect(blocked.planPill).toEqual({ label: 'Access blocked', tone: 'danger' });
    expect(blocked.plan.end).toBe('Ends Sun 20 Dec');

    // With no plan to sum up, the cell says why there is nothing in it.
    const noPlan = clientRow(
      overviewRow(coachClient('c-n', 'Nour', 'Fares'), {
        planState: 'Blocked',
        planEndsOn: null,
        plan: null,
      }),
      COACH_TODAY,
      context,
    );
    expect(noPlan.plan).toMatchObject({ name: null, end: 'Access blocked' });
  });

  it('turns each reason into a tag with its count and a link to where it is handled', () => {
    const { Elie, Jad, Lynn, Maya, Nour, Sara, Rita, Rami } = rows();
    const read = (row: ClientRow) => row.tags.map((tag) => [tag.label, tag.link, tag.queryParams]);

    expect(read(Maya)).toEqual([['1 check-in to review', '/clients/c-maya/checkins/a-maya', null]]);
    expect(read(Sara)).toEqual([['2 unread messages', '/messages', { conversation: 'conv-sara' }]]);
    expect(read(Elie)).toEqual([
      ['Asked to renew', '/clients/c-elie/service', { renew: 'e-elie' }],
    ]);
    expect(read(Jad)).toEqual([
      ['3 missed workouts', '/clients/c-jad/training', null],
      // What it names: the client's check-ins, not the chat Remind opens on Today.
      ['2 check-ins overdue', '/clients/c-jad/checkins', null],
    ]);
    expect(read(Lynn)).toEqual([
      ['No program yet', '/clients/c-lynn/training', { action: 'assign' }],
    ]);
    expect(read(Nour)).toEqual([['Week not shared', '/clients/c-nour/training', null]]);
    // The plan's end has its pill, and nothing waits for the coach about Rami.
    expect(read(Rita)).toEqual([]);
    expect(read(Rami)).toEqual([]);
  });

  it('words each kind of reason in the singular and plural, and leaves good news out of the tags', () => {
    const tags = (...items: ReturnType<typeof attentionItem>[]) =>
      clientRow(
        overviewRow(coachClient('c-x', 'Ali', 'Fares'), {
          status: 'NeedsAttention',
          attention: items.map((item) => item.kind),
          attentionItems: items,
        }),
        COACH_TODAY,
        context,
      ).tags.map((tag) => tag.label);
    const ali = coachClient('c-x', 'Ali', 'Fares');

    expect(
      tags(
        attentionItem('CheckInToReview', ali, { count: 3 }),
        attentionItem('UnreadMessages', ali, { count: 1 }),
        attentionItem('NoPlan', ali, { date: COACH_TODAY }),
        attentionItem('CheckInOverdue', ali, { count: 1, date: '2026-09-28' }),
        attentionItem('NoProgram', ali, { subjectId: 'block-ended' }),
      ),
    ).toEqual([
      '3 check-ins to review',
      '1 unread message',
      'Joined, no plan yet',
      '1 check-in overdue',
      'No program running',
    ]);
    // Maxes to review is good news, so it has its chip and no warning tag (P4c).
    const stronger = clientRow(
      overviewRow(ali, {
        attention: ['MaxesToReview'],
        attentionItems: [attentionItem('MaxesToReview', ali, { count: 1 })],
      }),
      COACH_TODAY,
      context,
    );
    expect(stronger.tags).toEqual([]);
    expect(stronger.planPill.label).toBe('On track');
    expect([...stronger.filters]).toEqual(['all', 'maxes']);
  });

  it('sums up the plan whose end it shows: its name, what it includes, its length, its price and its end', () => {
    const { Maya, Rita, Sara, Rami, Hiba, Elie, Ziad } = rows();

    expect(Maya.plan).toEqual({
      name: 'Online coaching',
      includes: 'Training, Nutrition, Check-ins, Messaging',
      terms: '12 weeks · USD 330',
      end: 'Ends Sun 20 Dec',
      soon: false,
      more: '+1 more plan',
    });
    // Ending soon is the server's flag, drawn warm, with its day in words.
    expect(Rita.plan).toMatchObject({
      name: 'Postnatal reset',
      includes: 'Training, Check-ins',
      terms: '28 days · USD 120',
      end: 'Ends tomorrow',
      soon: true,
      more: null,
    });
    // The price is exact, in its own currency.
    expect(Sara.plan).toMatchObject({ terms: '8 weeks · EUR 250.50', end: 'Ends Mon 12 Oct' });
    expect(Rami.plan).toMatchObject({ name: 'Team training', terms: '12 weeks · Free' });
    // Another year gets its year.
    expect(Hiba.plan.end).toBe('Ends 15 Jan 2027');
    // An ended plan, or one waiting for payment, still goes by its name.
    expect(Elie.plan).toMatchObject({ name: 'Meet prep', end: 'Ended Sun 27 Sep' });
    expect(Ziad.plan).toMatchObject({
      name: 'Online coaching',
      includes: 'Training, Nutrition',
      end: 'Payment due',
    });
  });

  it('names the plan as it was booked, whatever script it is written in', () => {
    const name = (planName: string) =>
      planCell(
        overviewRow(coachClient('c-p', 'Ali', 'Fares'), {
          plan: planSummary({ name: planName }),
        }),
        COACH_TODAY,
        'en-US',
      ).name;

    expect(name('  Student rate  ')).toBe('Student rate');
    expect(name('تدريب أونلاين')).toBe('تدريب أونلاين');
    expect(name(' ')).toBeNull();
  });

  it('says since when a plan is paused and when it still ends, a pause having no end of its own', () => {
    const { Karl } = rows();

    expect(Karl.plan.end).toBe('Paused since Sun 20 Sep · ends Sun 20 Dec');
    const cell = (fields: Parameters<typeof overviewRow>[1]) =>
      planCell(overviewRow(coachClient('c-p', 'Ali', 'Fares'), fields), COACH_TODAY, 'en-US');
    expect(cell({ planState: 'Paused', planPausedSince: null }).end).toBe(
      'Paused · ends Sun 20 Dec',
    );
    expect(cell({ planState: 'Paused', planPausedSince: '2026-09-20', planEndsOn: null }).end).toBe(
      'Paused since Sun 20 Sep',
    );
  });

  it('counts the other plans beside it, and never adds their prices', () => {
    const cell = (otherPlanCount: number) =>
      planCell(
        overviewRow(coachClient('c-p', 'Ali', 'Fares'), {
          otherPlanCount,
          plan: planSummary({ priceAmount: 150 }),
        }),
        COACH_TODAY,
        'en-US',
      );

    expect(cell(0).more).toBeNull();
    expect(cell(1)).toMatchObject({ terms: '12 weeks · USD 150', more: '+1 more plan' });
    expect(cell(2)).toMatchObject({ terms: '12 weeks · USD 150', more: '+2 more plans' });
  });

  it('says where a plan stands when none covers today, and names no plan that never was', () => {
    const end = (fields: Parameters<typeof overviewRow>[1]) =>
      planCell(overviewRow(coachClient('c-p', 'Ali', 'Fares'), fields), COACH_TODAY, 'en-US');

    expect(end({ planState: 'NotStarted' }).end).toBe('Not started yet');
    expect(end({ planState: 'Blocked', plan: null, planEndsOn: null }).end).toBe('Access blocked');
    expect(end({ planState: 'Running', planEndsOn: COACH_TODAY }).end).toBe('Ends today');
    expect(end({ planState: 'None', plan: null, planEndsOn: null })).toEqual({
      name: null,
      includes: null,
      terms: null,
      end: 'No plan yet',
      soon: false,
      more: null,
    });
  });

  it('says when the last check-in was sent, or which of none sent and not in the plan holds', () => {
    const { Maya, Nour, Lynn, Elie, Karl, Rami } = rows();

    expect([Maya.checkIn, Maya.checkInAt]).toEqual(['Sent 18 hours ago', '2026-09-30T18:00:00Z']);
    expect(Nour.checkIn).toBe('Sent yesterday');
    expect([Lynn.checkIn, Lynn.checkInAt]).toEqual(['None sent yet', null]);
    // Not in today's plan: an ended plan, a paused one, or a plan without check-ins (CHK-011).
    expect([Elie.checkIn, Karl.checkIn, Rami.checkIn]).toEqual([
      'Not in plan',
      'Not in plan',
      'Not in plan',
    ]);
    expect(
      lastCheckIn(
        { featuresToday: ['Training'], lastCheckInSentAtUtc: '2026-09-30T18:00:00Z' },
        context,
      ),
    ).toBe('Not in plan');
  });

  it('names a finished workout in the last activity, and phrases the rest by what it was', () => {
    const { Maya, Hiba, Jad, Sara, Elie, Lynn, Ziad } = rows();

    expect(Maya.activity).toBe('Trained Lower A · 2 hours ago');
    expect(Hiba.activity).toBe('Trained Upper B · 18 hours ago');
    expect(Jad.activity).toBe('Trained Push day · 6 days ago');
    expect(Sara.activity).toBe('Sent a check-in 19 hours ago');
    expect(Elie.activity).toBe('Weighed in yesterday');
    expect(Lynn.activity).toBe('No activity yet');
    // A lapsed plan hides what it no longer covers, so "yet" would not be true.
    expect(Ziad.activity).toBe('No activity to show');
    // A workout with no name keeps the plain words, as the client's page says it.
    expect(
      activityLabel(
        {
          lastActivityKind: 'WorkoutCompleted',
          lastActivityAtUtc: '2026-10-01T10:00:00Z',
          lastActivityTitle: '  ',
          status: 'OnTrack',
        },
        context,
      ),
    ).toBe('Trained 2 hours ago');
    // A paused or ended plan hides the work it no longer covers, whatever the row's status says.
    for (const planStatus of ['Paused', 'NoActivePlan'] as const) {
      expect(
        activityLabel(
          {
            lastActivityKind: null,
            lastActivityAtUtc: null,
            status: 'NeedsAttention',
            planStatus,
          },
          context,
        ),
      ).toBe('No activity to show');
    }
    expect(
      activityLabel(
        {
          lastActivityKind: null,
          lastActivityAtUtc: null,
          status: 'NeedsAttention',
          planStatus: 'EndingSoon',
        },
        context,
      ),
    ).toBe('No activity yet');
  });

  it('draws the last seven days as done, missed and still due, and says them in words', () => {
    const { Maya, Tala, Lynn, Elie } = rows();

    expect(Maya.week?.days.map((day) => day.mark)).toEqual([
      'done',
      'rest',
      'done',
      'rest',
      'missed',
      'rest',
      'done',
    ]);
    expect(Maya.week?.value).toBe('3 of 4');
    // The marks are hidden from screen readers, so the words say what the × says.
    expect(Maya.week?.summary).toBe('3 of 4 workouts done in the last 7 days, 1 missed');

    // One of two done on a past day reads as missed, the legend having no half mark; today's still due.
    expect(Tala.week?.days.map((day) => day.mark)).toEqual([
      'done',
      'rest',
      'missed',
      'rest',
      'done',
      'rest',
      'due',
    ]);
    expect(Tala.week?.value).toBe('3 of 5');
    expect(Tala.week?.summary).toBe(
      '3 of 5 workouts done in the last 7 days, 1 missed, 1 still due today',
    );

    expect(Lynn.week?.days).toEqual([]);
    expect(Lynn.week?.value).toBe('None scheduled');
    expect(Lynn.week?.summary).toBe('Nothing scheduled in the last 7 days');
    // Training is not in Elie's plan, so there is no strip at all.
    expect(Elie.week).toBeNull();
  });

  it('never counts more done than were scheduled on a day', () => {
    const week = clientWeek(
      recentDays([
        [1, 2],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ]),
      COACH_TODAY,
    );

    expect(week.value).toBe('1 of 1');
    expect(week.days[0].mark).toBe('done');
  });

  it('marks a client who never finished their profile Not set up yet (LOST-12)', () => {
    const row = (onboardingStatus: 'NotStarted' | 'InProgress' | 'Completed') =>
      clientRow(
        overviewRow(coachClient('c-z', 'Rita', 'Daher'), { onboardingStatus }),
        COACH_TODAY,
        context,
      );
    expect(row('NotStarted').notSetUp).toBe(true);
    expect(row('InProgress').notSetUp).toBe(true);
    expect(row('Completed').notSetUp).toBe(false);
    // The fixtures' clients have all finished theirs.
    expect(Object.values(rows()).some((item) => item.notSetUp)).toBe(false);
  });

  it('says a new client with no plan needs one (COACH-9)', () => {
    const rita = coachClient('c-n', 'Rita', 'Daher');
    const joined = clientRow(
      overviewRow(rita, {
        status: 'NeedsAttention',
        planState: 'None',
        planEndsOn: null,
        plan: null,
        isNew: true,
        attention: ['NoPlan'],
        attentionItems: [attentionItem('NoPlan', rita, { date: COACH_TODAY })],
        recentSessions: null,
      }),
      COACH_TODAY,
      context,
    );
    expect(joined.tags.map((tag) => [tag.label, tag.link, tag.queryParams])).toEqual([
      ['Joined, no plan yet', '/clients/c-n/service', { action: 'start' }],
    ]);
    expect(joined.planPill).toEqual({ label: 'No active plan', tone: 'neutral' });
    expect(joined.plan.end).toBe('No plan yet');
    expect([...joined.filters]).toEqual(['all', 'attention', 'new']);
  });

  it("names the coach only on a team member's client", () => {
    const { Maya, Rami } = rows();

    expect(Maya.coach).toBe('Lea Khoury');
    expect(Rami.coach).toBeNull();
    const signedOut = mapClientList(clientListView(), { ...context, userId: null });
    expect(signedOut.rows.every((row) => row.coach === null)).toBe(true);
  });

  it('puts a plan ending soon under Ending soon even when something else needs attention', () => {
    const { Sara, Karl, Nour } = rows();

    expect([...Sara.filters]).toEqual(['all', 'attention', 'ending']);
    expect([...Karl.filters]).toEqual(['all', 'paused']);
    expect([...Nour.filters]).toEqual(['all', 'attention', 'new']);
  });

  it('searches names and goals, ignoring case, accents and word order', () => {
    const { Maya, Nour } = rows();
    const elie = clientRow(overviewRow(coachClient('c-e', 'Élie', 'Azar')), COACH_TODAY, context);

    expect(matches(Maya, 'all', 'wedding MAYA')).toBe(true);
    expect(matches(Maya, 'all', 'maya pull-up')).toBe(false);
    expect(matches(Nour, 'all', '  glutes ')).toBe(true);
    expect(matches(elie, 'all', 'elie')).toBe(true);
    expect(matches(Maya, 'paused', '')).toBe(false);
  });

  it('describes a former client by how and when coaching ended', () => {
    const former: FormerClient = {
      id: 'client-9',
      firstName: 'Omar',
      lastName: 'Nasr',
      email: 'omar@example.test',
      releasedAtUtc: '2026-09-20T10:00:00Z',
      reason: 'Followed his coach to another gym',
      departureKind: 'LeftByClient',
    };

    expect(formerClientRow(former, 'en-US', 'Asia/Beirut')).toEqual({
      id: 'client-9',
      name: 'Omar Nasr',
      initials: 'ON',
      link: '/clients/client-9',
      ended: 'Sun 20 Sep 2026',
      endedAt: '2026-09-20T10:00:00Z',
      how: 'Left by client',
      reason: 'Followed his coach to another gym',
    });
    expect(
      formerClientRow({ ...former, departureKind: 'ReleasedByOwner' }, 'en-US', 'Asia/Beirut').how,
    ).toBe('Ended by owner');
  });

  it('says the day coaching ended on the workspace’s calendar, wherever the device is (audit WEB-17)', () => {
    const former: FormerClient = {
      id: 'client-9',
      firstName: 'Omar',
      lastName: 'Nasr',
      email: 'omar@example.test',
      // 03:00 UTC on Monday is still Sunday evening in Los Angeles.
      releasedAtUtc: '2026-09-21T03:00:00Z',
      reason: 'Moved away',
      departureKind: 'LeftByClient',
    };

    expect(formerClientRow(former, 'en-US', 'America/Los_Angeles').ended).toBe('Sun 20 Sep 2026');
    expect(formerClientRow(former, 'en-US', 'Asia/Beirut').ended).toBe('Mon 21 Sep 2026');
  });
});

describe('the lede over the list (critique B4a)', () => {
  it('says what the chips count: the clients, who needs attention and the plans ending soon', () => {
    const { counts, rows: all } = mapClientList(clientListView(), context);

    expect(listSummary(counts)).toBe('12 clients · 6 need attention · 2 plans end soon');
    // Narrowed to Lea's one client, as the chips are (critique B3a).
    expect(listSummary(filterCounts(all.filter((row) => row.coachId !== OWNER_ID)))).toBe(
      '1 client · 1 needs attention',
    );
    const count = (all: number, attention: number, ending: number) =>
      listSummary({ all, attention, ending, paused: 0, new: 0, maxes: 0 });
    expect(count(3, 0, 1)).toBe('3 clients · nobody needs attention · 1 plan ends soon');
    expect(count(0, 0, 0)).toBe('');
  });
});

describe('an empty filtered list (review of B3a)', () => {
  it('speaks for the whole list without a chosen coach', () => {
    expect(emptyList('paused', '', null)).toEqual({
      heading: 'No plan is paused',
      description: 'Clients will show up here when this changes.',
      action: 'Show all clients',
    });
    expect(emptyList('attention', ' zzz ', null)).toEqual({
      heading: 'No client matches “zzz”',
      description: 'Search looks at names and goals.',
      action: 'Clear search',
    });
  });

  it('speaks for the chosen coach’s clients, whose list its action keeps', () => {
    const lea = { name: 'Lea Khoury', isYou: false };
    expect(emptyList('attention', '', lea)).toMatchObject({
      heading: 'None of Lea Khoury’s clients needs attention right now',
      action: 'Show all of Lea Khoury’s clients',
    });
    expect(emptyList('ending', '', lea).heading).toBe(
      'None of Lea Khoury’s clients has a plan ending in the next 14 days',
    );
    expect(emptyList('paused', '', { name: 'You', isYou: true })).toMatchObject({
      heading: 'None of your clients has a paused plan',
      action: 'Show all your clients',
    });
    expect(emptyList('all', 'zzz', lea)).toMatchObject({
      heading: 'None of Lea Khoury’s clients matches “zzz”',
      action: 'Clear search',
    });
  });
});

describe('the chat panel’s plan line', () => {
  it('flags a plan ending soon only by the server’s flag, counting days only to say how many', () => {
    const row = { planState: 'Running' as const, planEndsOn: '2026-10-10' };

    expect(planLabel(row, COACH_TODAY, 'en-US', true)).toEqual({
      label: 'Plan ends in 9 days',
      soon: true,
    });
    expect(planLabel(row, COACH_TODAY, 'en-US', false)).toEqual({
      label: 'Plan ends Sat 10 Oct',
      soon: false,
    });
  });
});

describe('what is left on a client’s packs (critique B10c, SES-008)', () => {
  const client = coachClient('c-lynn', 'Lynn', 'Bou Khalil');
  const context: ClientListContext = {
    locale: 'en-US',
    now: new Date(COACH_NOW),
    userId: OWNER_ID,
  };
  const row = (fields: Parameters<typeof overviewRow>[1]) =>
    clientRow(overviewRow(client, fields), COACH_TODAY, context);

  it('says the balance while sessions are in today’s plan, and nothing without', () => {
    expect(row({ sessionsLeft: 7 }).sessions).toEqual({
      label: '7 sessions left',
      tone: 'neutral',
    });
    expect(row({ sessionsLeft: 1 }).sessions?.label).toBe('1 session left');
    expect(row({ sessionsLeft: 0 }).sessions?.label).toBe('No sessions left');
    expect(row({ sessionsLeft: null }).sessions).toBeNull();
    expect(row({}).sessions).toBeNull();
  });

  it('warms it on the server’s word alone, never a count of its own', () => {
    const flagged = { attention: ['SessionsRunningOut' as const], attentionItems: [] };

    expect(row({ sessionsLeft: 9, ...flagged }).sessions?.tone).toBe('warm');
    expect(row({ sessionsLeft: 1 }).sessions?.tone).toBe('neutral');
  });

  it('has its own chip, so running out is no tag on the row', () => {
    const item = attentionItem('SessionsRunningOut', client, { sessionsLeft: 2 });

    expect(
      row({ sessionsLeft: 2, attention: ['SessionsRunningOut'], attentionItems: [item] }).tags,
    ).toEqual([]);
    expect(attentionReason(item)).toBe('2 sessions left');
  });

  it('leaves the plan’s pill and the Ending soon chip to the plan', () => {
    const flagged = row({
      sessionsLeft: 2,
      attention: ['SessionsRunningOut'],
      attentionItems: [],
    });

    expect(flagged.planPill).toEqual({ label: 'On track', tone: 'success' });
    expect(flagged.filters.has('ending')).toBe(false);
    expect(flagged.filters.has('attention')).toBe(false);
  });
});
