import type {
  CoachActivityItemView,
  CoachAttentionItemView,
  CoachAttentionKind,
  CoachClientRef,
  CoachMonthView,
  CoachPlanEndedView,
  CoachPlanEndingView,
  CoachTodayView,
  CoachWaitingClientView,
} from '../app/core/api/generated';

/**
 * Coach Today for Karim Haddad, owner of Atlas Performance, on Thu 1 Oct 2026 at 15:00 in Beirut
 * (12:00 UTC). Lea Khoury coaches Maya and Hadi; Omar Saleh has no clients yet; everyone else is
 * Karim's. Karim reads Maya and Hadi as `MAYA_BUSINESS` and `HADI_BUSINESS`: the business side alone,
 * since he does not coach them (C8, notes plan N9d1a).
 */
export const COACH_TODAY = '2026-10-01';
export const COACH_NOW = '2026-10-01T12:00:00Z';
export const OWNER_ID = '00000000-0000-4000-8000-0000000000a1';
export const LEA_ID = '00000000-0000-4000-8000-0000000000a2';
export const OMAR_ID = '00000000-0000-4000-8000-0000000000a3';

/**
 * A client as Today names them. A null coach is a client waiting for a coach (notes plan N9d1b). `mayCoach` is
 * written only when false (the server's answer for a client the reader does not coach), since a missing one reads
 * as true and many specs compare these refs as they were.
 */
export function coachClient(
  id: string,
  firstName: string,
  lastName: string,
  coach: { id: string; name: string } | null = { id: OWNER_ID, name: 'Karim Haddad' },
  mayCoach = true,
): CoachClientRef {
  return {
    clientProfileId: id,
    firstName,
    lastName,
    assignedCoachUserId: coach?.id ?? null,
    assignedCoachName: coach?.name ?? null,
    ...(mayCoach ? {} : { mayCoach: false }),
  };
}

export const MAYA = coachClient('c-maya', 'Maya', 'Fakhoury', { id: LEA_ID, name: 'Lea Khoury' });
export const SARA = coachClient('c-sara', 'Sara', 'Mansour');
export const ELIE = coachClient('c-elie', 'Elie', 'Azar');
export const RITA = coachClient('c-rita', 'Rita', 'Daher');
export const NOUR = coachClient('c-nour', 'Nour', 'Hamdan');
export const JAD = coachClient('c-jad', 'Jad', 'Karam');
export const LYNN = coachClient('c-lynn', 'Lynn', 'Bou Khalil');
export const RAMI = coachClient('c-rami', 'Rami', 'Tabet');
export const HADI = coachClient('c-hadi', 'Hadi', 'Nassar', { id: LEA_ID, name: 'Lea Khoury' });
/** Lea's clients as the owner reads them: their coach named, the private side withheld (N9d1a). */
export const MAYA_BUSINESS: CoachClientRef = { ...MAYA, mayCoach: false };
export const HADI_BUSINESS: CoachClientRef = { ...HADI, mayCoach: false };
/**
 * Clients waiting for a coach (notes plan N9d1b), whom nobody coaches: Ziad, whose coach Rana Saad left the team,
 * and Dana, who accepted Rana's invitation after she had gone.
 */
export const ZIAD = coachClient('c-ziad', 'Ziad', 'Khalil', null, false);
export const DANA = coachClient('c-dana', 'Dana', 'Aoun', null, false);

export function attentionItem(
  kind: CoachAttentionKind,
  client: CoachClientRef,
  fields: Partial<Omit<CoachAttentionItemView, 'kind' | 'client'>> = {},
): CoachAttentionItemView {
  return {
    kind,
    client,
    since: null,
    date: null,
    count: null,
    weekNumber: null,
    subjectId: null,
    ...fields,
  };
}

/**
 * Karim's Today. Maya's check-in waits for Lea's review, so the server withholds the check-in it would open (its
 * subject); the feed holds only Karim's own clients, and nobody waits for a coach.
 */
export function coachTodayView(overrides: Partial<CoachTodayView> = {}): CoachTodayView {
  const attention: CoachAttentionItemView[] = [
    attentionItem('CheckInToReview', MAYA_BUSINESS, {
      count: 1,
      since: '2026-10-01T10:24:00Z',
    }),
    attentionItem('UnreadMessages', SARA, {
      count: 2,
      since: '2026-10-01T09:00:00Z',
      subjectId: 'conv-sara',
    }),
    attentionItem('RenewalRequested', ELIE, {
      since: '2026-09-29T07:17:00Z',
      date: '2026-09-27',
      subjectId: 'e-elie',
    }),
    attentionItem('PlanEndingSoon', RITA, { date: '2026-10-02', subjectId: 'e-rita' }),
    attentionItem('WeekNotShared', NOUR, {
      date: '2026-10-01',
      weekNumber: 2,
      subjectId: 'm-nour',
    }),
    attentionItem('MissedSessions', JAD, { count: 3, date: '2026-09-24' }),
    attentionItem('NoProgram', LYNN, { date: '2026-09-27' }),
  ];
  const activity: CoachActivityItemView[] = [
    {
      kind: 'WorkoutCompleted',
      client: RAMI,
      occurredAtUtc: '2026-10-01T11:25:00Z',
      subjectId: 'w-rami',
      title: 'Lower A',
      durationSeconds: 3480,
      personalRecords: [
        { exerciseName: 'Back squat', repetitions: 3, load: '140.000', unit: 'Kilogram' },
        { exerciseName: 'Romanian deadlift', repetitions: 8, load: '107.500', unit: 'Kilogram' },
        { exerciseName: 'Leg press', repetitions: 12, load: '215.000', unit: 'Kilogram' },
      ],
    },
    {
      kind: 'CheckInSubmitted',
      client: NOUR,
      occurredAtUtc: '2026-10-01T10:24:00Z',
      subjectId: 'a-nour',
      title: 'Weekly check-in',
      durationSeconds: null,
      personalRecords: [],
    },
    {
      kind: 'WorkoutCompleted',
      client: RITA,
      occurredAtUtc: '2026-09-30T05:55:00Z',
      subjectId: 'w-rita',
      title: 'Full body C',
      durationSeconds: 1920,
      personalRecords: [],
    },
  ];
  return {
    today: COACH_TODAY,
    timeZoneId: 'Asia/Beirut',
    clientCount: 12,
    plansEndingSoonCount: 3,
    renewalRequestCount: 1,
    month: coachMonth(),
    plansEndingSoon: plansEndingSoon(),
    plansEndedNotRenewed: plansEndedNotRenewed(),
    attention,
    activityFromUtc: '2026-09-24T12:00:00Z',
    activity,
    attentionRuleKey: 'CoachAttention',
    attentionRuleVersion: 1,
    trainingRuleKey: 'MissedSinceLastWorkoutAndUnsharedWeek',
    trainingRuleVersion: 1,
    waitingForCoach: [],
    ...overrides,
  };
}

/**
 * The clients waiting for a coach, longest first (notes plan N9d1b): Ziad since Mon 28 Sep, when Rana left, and
 * Dana since 00:30 on Thu 1 Oct in Beirut (21:30 UTC the day before), with nobody before.
 */
export function waitingForCoach(): CoachWaitingClientView[] {
  return [
    {
      client: ZIAD,
      waitingSinceUtc: '2026-09-28T07:30:00Z',
      previousCoachName: 'Rana Saad',
      clientVersion: 6,
    },
    {
      client: DANA,
      waitingSinceUtc: '2026-09-30T21:30:00Z',
      previousCoachName: null,
      clientVersion: 2,
    },
  ];
}

/**
 * Karim's Today while Ziad and Dana wait for a coach: 14 clients, 10 with a plan running today, of whom the team's
 * rows hold 12 and 9, so No coach is 1 of 2. Dana joined with no plan; Ziad's check-in is overdue, which his next
 * coach follows up, and his plan ends on Mon 12 Oct.
 */
export function coachTodayWaitingView(overrides: Partial<CoachTodayView> = {}): CoachTodayView {
  const base = coachTodayView();
  const attention = [...base.attention];
  attention.splice(3, 0, attentionItem('NoPlan', DANA, { date: COACH_TODAY }));
  attention.splice(
    7,
    0,
    attentionItem('CheckInOverdue', ZIAD, { count: 1, date: '2026-09-28', canMessage: false }),
  );
  return coachTodayView({
    clientCount: 14,
    month: coachMonth({ activeClientCount: 10 }),
    attention,
    plansEndingSoon: [
      ...plansEndingSoon(),
      {
        client: ZIAD,
        enrollmentId: 'e-ziad',
        planName: 'Online coaching',
        lastDay: '2026-10-12',
        unpaidRenewalId: null,
        canMessage: false,
        chatId: null,
      },
    ],
    waitingForCoach: waitingForCoach(),
    ...overrides,
  });
}

/**
 * October so far, as the owner reads it (SUB-016, CLI-020): money received in two currencies, never
 * added together, 9 of the 12 clients with a plan running today, and the team, Karim first as You.
 */
export function coachMonth(overrides: Partial<CoachMonthView> = {}): CoachMonthView {
  return {
    from: '2026-10-01',
    toExclusive: '2026-11-01',
    moneyReceived: [
      { currency: 'LBP', amount: 4500000, paymentCount: 1 },
      { currency: 'USD', amount: 2340, paymentCount: 7 },
    ],
    activeClientCount: 9,
    coaches: [
      {
        coachUserId: OWNER_ID,
        name: 'Karim Haddad',
        isYou: true,
        activeClientCount: 7,
        clientCount: 10,
      },
      {
        coachUserId: LEA_ID,
        name: 'Lea Khoury',
        isYou: false,
        activeClientCount: 2,
        clientCount: 2,
      },
      {
        coachUserId: OMAR_ID,
        name: 'Omar Saleh',
        isYou: false,
        activeClientCount: 0,
        clientCount: 0,
      },
    ],
    moneyRuleKey: 'MoneyReceived',
    moneyRuleVersion: 1,
    ...overrides,
  };
}

/**
 * Plans ending soon, the soonest first: Rita's (Karim's chat with her exists), Sara's (no chat yet)
 * and Maya's, whose renewal is booked and not paid yet; Lea coaches Maya, so Karim may not message
 * her (CLI-013).
 */
export function plansEndingSoon(): CoachPlanEndingView[] {
  return [
    {
      client: RITA,
      enrollmentId: 'e-rita',
      planName: 'Strength coaching',
      lastDay: '2026-10-02',
      unpaidRenewalId: null,
      canMessage: true,
      chatId: 'conv-rita',
    },
    {
      client: SARA,
      enrollmentId: 'e-sara',
      planName: 'Online coaching',
      lastDay: '2026-10-07',
      unpaidRenewalId: null,
      canMessage: true,
      chatId: null,
    },
    {
      client: MAYA_BUSINESS,
      enrollmentId: 'e-maya',
      planName: 'Fat loss · 12 weeks',
      lastDay: '2026-10-09',
      unpaidRenewalId: 'e-maya-next',
      canMessage: false,
      chatId: null,
    },
  ];
}

/**
 * Plans that ran out lately and were not renewed, the latest end first: Elie's, who asked to renew,
 * and Hadi's (Lea's client), whose next plan waits for payment. The owner's rows carry each client's
 * version, which End coaching asks for (ADR 0027).
 */
export function plansEndedNotRenewed(): CoachPlanEndedView[] {
  return [
    {
      client: ELIE,
      enrollmentId: 'e-elie',
      planName: 'Strength coaching',
      lastDay: '2026-09-27',
      unpaidRenewalId: null,
      renewalRequestedOn: '2026-09-29',
      clientVersion: 4,
    },
    {
      client: HADI_BUSINESS,
      enrollmentId: 'e-hadi',
      planName: 'Online coaching',
      lastDay: '2026-09-20',
      unpaidRenewalId: 'e-hadi-next',
      renewalRequestedOn: null,
      clientVersion: 9,
    },
  ];
}

/**
 * Today as Lea Khoury, a coach, reads it: her own money and clients only, no team, no client's
 * version, since only the owner ends a client's coaching (CLI-020, ADR 0027), and no waiting list,
 * the owner's alone (notes plan N9d1b). She coaches Maya, so Maya's check-in opens for her.
 */
export function coachOwnTodayView(): CoachTodayView {
  const feed = coachTodayView().activity[1];
  return coachTodayView({
    clientCount: 2,
    month: coachMonth({
      moneyReceived: [{ currency: 'USD', amount: 82.5, paymentCount: 1 }],
      activeClientCount: 2,
      coaches: null,
    }),
    attention: [
      attentionItem('CheckInToReview', MAYA, {
        count: 1,
        since: '2026-10-01T10:24:00Z',
        subjectId: 'a-maya',
      }),
    ],
    activity: [{ ...feed, client: MAYA, subjectId: 'a-maya' }],
    plansEndingSoon: [{ ...plansEndingSoon()[2], client: MAYA, canMessage: true }],
    plansEndedNotRenewed: [{ ...plansEndedNotRenewed()[1], client: HADI, clientVersion: null }],
    waitingForCoach: null,
  });
}

/** A coaching space with no clients yet. */
export function emptyCoachTodayView(): CoachTodayView {
  return coachTodayView({
    clientCount: 0,
    plansEndingSoonCount: 0,
    renewalRequestCount: 0,
    month: coachMonth({
      moneyReceived: [],
      activeClientCount: 0,
      coaches: [
        {
          coachUserId: OWNER_ID,
          name: 'Karim Haddad',
          isYou: true,
          activeClientCount: 0,
          clientCount: 0,
        },
      ],
    }),
    plansEndingSoon: [],
    plansEndedNotRenewed: [],
    attention: [],
    activity: [],
  });
}
