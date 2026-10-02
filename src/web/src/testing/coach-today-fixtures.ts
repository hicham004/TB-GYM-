import type {
  CoachActivityItemView,
  CoachAttentionItemView,
  CoachAttentionKind,
  CoachClientRef,
  CoachTodayView,
} from '../app/core/api/generated';

/**
 * Coach Today for Karim Haddad, owner of Atlas Performance, on Thu 1 Oct 2026 at 15:00 in Beirut
 * (12:00 UTC). Lea Khoury coaches Maya; everyone else is Karim's.
 */
export const COACH_TODAY = '2026-10-01';
export const COACH_NOW = '2026-10-01T12:00:00Z';
export const OWNER_ID = '00000000-0000-4000-8000-0000000000a1';
export const LEA_ID = '00000000-0000-4000-8000-0000000000a2';

export function coachClient(
  id: string,
  firstName: string,
  lastName: string,
  coach: { id: string; name: string } = { id: OWNER_ID, name: 'Karim Haddad' },
): CoachClientRef {
  return {
    clientProfileId: id,
    firstName,
    lastName,
    assignedCoachUserId: coach.id,
    assignedCoachName: coach.name,
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

export function coachTodayView(overrides: Partial<CoachTodayView> = {}): CoachTodayView {
  const attention: CoachAttentionItemView[] = [
    attentionItem('CheckInToReview', MAYA, {
      count: 1,
      since: '2026-10-01T10:24:00Z',
      subjectId: 'a-maya',
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
      client: MAYA,
      occurredAtUtc: '2026-10-01T10:24:00Z',
      subjectId: 'a-maya',
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
    week: {
      from: '2026-09-28',
      toExclusive: '2026-10-05',
      scheduled: 27,
      completed: 10,
      days: [
        { date: '2026-09-28', scheduled: 3, completed: 3 },
        { date: '2026-09-29', scheduled: 5, completed: 3 },
        { date: '2026-09-30', scheduled: 3, completed: 3 },
        { date: '2026-10-01', scheduled: 4, completed: 1 },
        { date: '2026-10-02', scheduled: 6, completed: 0 },
        { date: '2026-10-03', scheduled: 1, completed: 0 },
        { date: '2026-10-04', scheduled: 5, completed: 0 },
      ],
    },
    attention,
    activityFromUtc: '2026-09-24T12:00:00Z',
    activity,
    attentionRuleKey: 'CoachAttention',
    attentionRuleVersion: 1,
    trainingRuleKey: 'MissedSinceLastWorkoutAndUnsharedWeek',
    trainingRuleVersion: 1,
    ...overrides,
  };
}

/** A coaching space with no clients yet. */
export function emptyCoachTodayView(): CoachTodayView {
  return coachTodayView({
    clientCount: 0,
    plansEndingSoonCount: 0,
    renewalRequestCount: 0,
    attention: [],
    activity: [],
    week: {
      from: '2026-09-28',
      toExclusive: '2026-10-05',
      scheduled: 0,
      completed: 0,
      days: ['28', '29', '30']
        .map((day) => ({ date: `2026-09-${day}`, scheduled: 0, completed: 0 }))
        .concat(
          ['01', '02', '03', '04'].map((day) => ({
            date: `2026-10-${day}`,
            scheduled: 0,
            completed: 0,
          })),
        ),
    },
  });
}
