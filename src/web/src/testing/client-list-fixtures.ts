import type {
  ClientOverviewRow,
  ClientOverviewView,
  ClientPlanStatus,
  ClientPlanSummary,
  CoachAttentionItemView,
  CoachClientRef,
  CoachingFeature,
} from '../app/core/api/generated';
import {
  attentionItem,
  coachClient,
  COACH_TODAY,
  ELIE,
  JAD,
  LYNN,
  MAYA,
  NOUR,
  RAMI,
  RITA,
  SARA,
} from './coach-today-fixtures';

/**
 * Karim Haddad's client list (C2) on Thu 1 Oct 2026, the same day and people as Coach Today's
 * fixtures: Lea Khoury coaches Maya, Karim everyone else. The last seven days run Fri 25 Sep to
 * today.
 */
export const RECENT_FROM = '2026-09-25';

export const KARL = coachClient('c-karl', 'Karl', 'Saade');
export const TALA = coachClient('c-tala', 'Tala', 'Rizk');
export const ZIAD = coachClient('c-ziad', 'Ziad', 'Chahine');
export const HIBA = coachClient('c-hiba', 'Hiba', 'Nasser');

/** Every feature, in the order the plans list them. */
export const ALL_FEATURES: CoachingFeature[] = ['Training', 'Nutrition', 'CheckIns', 'Messaging'];

/** Seven days of [scheduled, completed], oldest first, ending today. */
export function recentDays(counts: readonly (readonly [number, number])[]) {
  return counts.map(([scheduled, completed], index) => {
    const date = new Date(Date.parse(`${RECENT_FROM}T00:00:00Z`) + index * 86_400_000);
    return { date: date.toISOString().slice(0, 10), scheduled, completed };
  });
}

/** A plan as a row sums it up (critique B4a): 12 weeks of online coaching for USD 330 by default. */
export function planSummary(fields: Partial<ClientPlanSummary> = {}): ClientPlanSummary {
  return {
    enrollmentId: 'e-online',
    name: 'Online coaching',
    features: ALL_FEATURES,
    lengthCount: 12,
    lengthUnit: 'Week',
    priceAmount: 330,
    priceCurrency: 'USD',
    ...fields,
  };
}

/**
 * One client's row. Unless a test says otherwise, the plan's own status follows its state and flags,
 * and each attention kind comes with the item Today would show for it.
 */
export function overviewRow(
  client: CoachClientRef,
  fields: Partial<Omit<ClientOverviewRow, 'client'>> = {},
): ClientOverviewRow {
  const attention = fields.attention ?? [];
  const planState = fields.planState ?? 'Running';
  const planStatus: ClientPlanStatus =
    planState === 'Paused'
      ? 'Paused'
      : attention.includes('PlanEndingSoon')
        ? 'EndingSoon'
        : planState === 'Running'
          ? 'OnTrack'
          : 'NoActivePlan';
  return {
    client,
    goals: null,
    joinedOn: '2026-07-01',
    isNew: false,
    onboardingStatus: 'Completed',
    status: 'OnTrack',
    planState,
    planEndsOn: '2026-12-20',
    attention,
    lastActivityKind: null,
    lastActivityAtUtc: null,
    recentSessions: recentDays([
      [1, 1],
      [0, 0],
      [1, 1],
      [0, 0],
      [1, 1],
      [0, 0],
      [0, 0],
    ]),
    birthDate: null,
    planStatus,
    plan: planSummary(),
    otherPlanCount: 0,
    planPausedSince: null,
    featuresToday: planState === 'Running' ? ALL_FEATURES : [],
    attentionItems: attention.map((kind) => attentionItem(kind, client, { count: 1 })),
    lastActivityTitle: null,
    lastCheckInSentAtUtc: null,
    ...fields,
  };
}

/** Today's item for one of these clients, with what its link needs. */
function item(
  kind: CoachAttentionItemView['kind'],
  client: CoachClientRef,
  fields: Partial<Omit<CoachAttentionItemView, 'kind' | 'client'>> = {},
): CoachAttentionItemView {
  return attentionItem(kind, client, { canMessage: true, ...fields });
}

export function clientListView(overrides: Partial<ClientOverviewView> = {}): ClientOverviewView {
  return {
    today: COACH_TODAY,
    recentFrom: RECENT_FROM,
    recentToExclusive: '2026-10-02',
    clients: [
      overviewRow(ELIE, {
        goals: 'Squat 180 kg and deadlift 220 kg before the Beirut Classic in March.',
        birthDate: '1990-05-14',
        status: 'NeedsAttention',
        planState: 'Ended',
        planEndsOn: '2026-09-27',
        attention: ['RenewalRequested'],
        attentionItems: [
          item('RenewalRequested', ELIE, {
            since: '2026-09-29T07:17:00Z',
            date: '2026-09-27',
            subjectId: 'e-elie',
            canMessage: false,
          }),
        ],
        plan: planSummary({
          enrollmentId: 'e-elie',
          name: 'Meet prep',
          features: ['Training', 'CheckIns', 'Messaging'],
        }),
        lastActivityKind: 'WeighInLogged',
        lastActivityAtUtc: '2026-09-30T06:40:00Z',
        recentSessions: null,
      }),
      overviewRow(HIBA, {
        goals: 'Bench 120 kg.',
        birthDate: '1988-11-02',
        planEndsOn: '2027-01-15',
        plan: planSummary({ enrollmentId: 'e-hiba', lengthCount: 16, priceAmount: 440 }),
        lastActivityKind: 'WorkoutCompleted',
        lastActivityAtUtc: '2026-09-30T17:10:00Z',
        lastActivityTitle: 'Upper B',
        lastCheckInSentAtUtc: '2026-09-27T09:00:00Z',
      }),
      overviewRow(JAD, {
        goals: 'Put on 5 kg of muscle.',
        birthDate: '1999-03-30',
        status: 'NeedsAttention',
        attention: ['MissedSessions', 'CheckInOverdue'],
        attentionItems: [
          item('MissedSessions', JAD, { count: 3, date: '2026-09-24' }),
          item('CheckInOverdue', JAD, { count: 2, date: '2026-09-24', subjectId: 'conv-jad' }),
        ],
        plan: planSummary({ enrollmentId: 'e-jad' }),
        lastActivityKind: 'WorkoutCompleted',
        lastActivityAtUtc: '2026-09-24T18:00:00Z',
        lastActivityTitle: 'Push day',
        lastCheckInSentAtUtc: '2026-09-17T10:00:00Z',
        recentSessions: recentDays([
          [1, 0],
          [0, 0],
          [1, 0],
          [0, 0],
          [1, 0],
          [0, 0],
          [1, 0],
        ]),
      }),
      overviewRow(KARL, {
        goals: 'Strong, pain-free legs for ski season.',
        birthDate: '1979-01-22',
        status: 'Paused',
        planState: 'Paused',
        planPausedSince: '2026-09-20',
        plan: planSummary({ enrollmentId: 'e-karl' }),
        lastActivityKind: 'WeighInLogged',
        lastActivityAtUtc: '2026-09-28T07:05:00Z',
        recentSessions: null,
      }),
      overviewRow(LYNN, {
        goals: 'Lose 4 kg and learn to lift properly.',
        joinedOn: '2026-09-28',
        isNew: true,
        status: 'NeedsAttention',
        attention: ['NoProgram'],
        attentionItems: [item('NoProgram', LYNN, { date: '2026-09-27' })],
        plan: planSummary({ enrollmentId: 'e-lynn' }),
        recentSessions: recentDays([
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ]),
      }),
      overviewRow(MAYA, {
        goals: 'Lose 6 kg and feel strong for my wedding in December.',
        birthDate: '1997-06-18',
        status: 'NeedsAttention',
        attention: ['CheckInToReview'],
        attentionItems: [
          item('CheckInToReview', MAYA, {
            count: 1,
            since: '2026-09-30T18:00:00Z',
            subjectId: 'a-maya',
            // Lea coaches Maya: the owner reads her client but never messages her (CLI-013).
            canMessage: false,
          }),
        ],
        plan: planSummary({ enrollmentId: 'e-maya' }),
        otherPlanCount: 1,
        lastActivityKind: 'WorkoutCompleted',
        lastActivityAtUtc: '2026-10-01T10:00:00Z',
        lastActivityTitle: 'Lower A',
        lastCheckInSentAtUtc: '2026-09-30T18:00:00Z',
        recentSessions: recentDays([
          [1, 1],
          [0, 0],
          [1, 1],
          [0, 0],
          [1, 0],
          [0, 0],
          [1, 1],
        ]),
      }),
      overviewRow(NOUR, {
        goals: 'Build my glutes and do my first full pull-up.',
        birthDate: '2001-12-05',
        joinedOn: '2026-09-21',
        isNew: true,
        status: 'NeedsAttention',
        attention: ['WeekNotShared'],
        attentionItems: [
          item('WeekNotShared', NOUR, { date: '2026-10-01', weekNumber: 2, subjectId: 'm-nour' }),
        ],
        plan: planSummary({ enrollmentId: 'e-nour' }),
        lastActivityKind: 'CheckInSubmitted',
        lastActivityAtUtc: '2026-09-29T19:30:00Z',
        lastCheckInSentAtUtc: '2026-09-29T19:30:00Z',
        recentSessions: recentDays([
          [1, 1],
          [0, 0],
          [1, 1],
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ]),
      }),
      overviewRow(RAMI, {
        goals: 'Get down to 85 kg without losing strength.',
        birthDate: '1992-08-09',
        plan: planSummary({
          enrollmentId: 'e-rami',
          name: 'Team training',
          features: ['Training', 'Messaging'],
          priceAmount: 0,
        }),
        featuresToday: ['Training', 'Messaging'],
        lastActivityKind: 'WorkoutCompleted',
        lastActivityAtUtc: '2026-10-01T11:25:00Z',
        lastActivityTitle: 'Lower A',
        recentSessions: recentDays([
          [1, 1],
          [1, 1],
          [0, 0],
          [1, 1],
          [1, 1],
          [0, 0],
          [1, 1],
        ]),
      }),
      overviewRow(RITA, {
        goals: 'Feel strong again after my second baby.',
        birthDate: '1994-02-11',
        status: 'EndingSoon',
        planEndsOn: '2026-10-02',
        attention: ['PlanEndingSoon'],
        attentionItems: [item('PlanEndingSoon', RITA, { date: '2026-10-02', subjectId: 'e-rita' })],
        plan: planSummary({
          enrollmentId: 'e-rita',
          name: 'Postnatal reset',
          features: ['Training', 'CheckIns'],
          lengthCount: 28,
          lengthUnit: 'Day',
          priceAmount: 120,
        }),
        featuresToday: ['Training', 'CheckIns'],
        lastActivityKind: 'WorkoutCompleted',
        lastActivityAtUtc: '2026-09-30T08:00:00Z',
        lastActivityTitle: 'Full body C',
        lastCheckInSentAtUtc: '2026-09-26T08:00:00Z',
      }),
      overviewRow(SARA, {
        goals: 'Lose the belly and stop my lower back from flaring up.',
        birthDate: '1985-09-30',
        status: 'NeedsAttention',
        planEndsOn: '2026-10-12',
        attention: ['UnreadMessages', 'PlanEndingSoon'],
        attentionItems: [
          item('UnreadMessages', SARA, {
            count: 2,
            since: '2026-10-01T09:00:00Z',
            subjectId: 'conv-sara',
          }),
          item('PlanEndingSoon', SARA, { date: '2026-10-12', subjectId: 'e-sara' }),
        ],
        plan: planSummary({
          enrollmentId: 'e-sara',
          lengthCount: 8,
          priceAmount: 250.5,
          priceCurrency: 'EUR',
        }),
        lastActivityKind: 'CheckInSubmitted',
        lastActivityAtUtc: '2026-09-30T16:45:00Z',
        lastCheckInSentAtUtc: '2026-09-30T16:45:00Z',
      }),
      overviewRow(TALA, {
        goals: 'Run a half marathon in March and stay lean.',
        birthDate: '1996-10-01',
        plan: planSummary({ enrollmentId: 'e-tala' }),
        lastActivityKind: 'WeighInLogged',
        lastActivityAtUtc: '2026-10-01T05:50:00Z',
        lastCheckInSentAtUtc: '2026-09-28T07:00:00Z',
        recentSessions: recentDays([
          [1, 1],
          [0, 0],
          [2, 1],
          [0, 0],
          [1, 1],
          [0, 0],
          [1, 0],
        ]),
      }),
      overviewRow(ZIAD, {
        goals: 'Get back to training after knee surgery and lose 5 kg.',
        birthDate: '1983-12-24',
        status: 'NoActivePlan',
        planState: 'PaymentDue',
        planEndsOn: null,
        plan: planSummary({ enrollmentId: 'e-ziad', features: ['Training', 'Nutrition'] }),
        recentSessions: null,
      }),
    ],
    attentionRuleKey: 'CoachAttention',
    attentionRuleVersion: 4,
    trainingRuleKey: 'MissedSinceLastWorkoutAndUnsharedWeek',
    trainingRuleVersion: 1,
    ...overrides,
  };
}
