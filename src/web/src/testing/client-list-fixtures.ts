import type {
  ClientOverviewRow,
  ClientOverviewView,
  CoachClientRef,
} from '../app/core/api/generated';
import {
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

/** Seven days of [scheduled, completed], oldest first, ending today. */
export function recentDays(counts: readonly (readonly [number, number])[]) {
  return counts.map(([scheduled, completed], index) => {
    const date = new Date(Date.parse(`${RECENT_FROM}T00:00:00Z`) + index * 86_400_000);
    return { date: date.toISOString().slice(0, 10), scheduled, completed };
  });
}

export function overviewRow(
  client: CoachClientRef,
  fields: Partial<Omit<ClientOverviewRow, 'client'>> = {},
): ClientOverviewRow {
  return {
    client,
    goals: null,
    joinedOn: '2026-07-01',
    isNew: false,
    status: 'OnTrack',
    planState: 'Running',
    planEndsOn: '2026-12-20',
    attention: [],
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
    ...fields,
  };
}

export function clientListView(overrides: Partial<ClientOverviewView> = {}): ClientOverviewView {
  return {
    today: COACH_TODAY,
    recentFrom: RECENT_FROM,
    recentToExclusive: '2026-10-02',
    clients: [
      overviewRow(ELIE, {
        goals: 'Squat 180 kg and deadlift 220 kg before the Beirut Classic in March.',
        status: 'NeedsAttention',
        planState: 'Ended',
        planEndsOn: '2026-09-27',
        attention: ['RenewalRequested'],
        lastActivityKind: 'WeighInLogged',
        lastActivityAtUtc: '2026-09-30T06:40:00Z',
        recentSessions: null,
      }),
      overviewRow(HIBA, {
        goals: 'Bench 120 kg.',
        planEndsOn: '2027-01-15',
        lastActivityKind: 'WorkoutCompleted',
        lastActivityAtUtc: '2026-09-30T17:10:00Z',
      }),
      overviewRow(JAD, {
        goals: 'Put on 5 kg of muscle.',
        status: 'NeedsAttention',
        attention: ['MissedSessions'],
        lastActivityKind: 'WorkoutCompleted',
        lastActivityAtUtc: '2026-09-24T18:00:00Z',
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
        status: 'Paused',
        planState: 'Paused',
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
        status: 'NeedsAttention',
        attention: ['CheckInToReview'],
        lastActivityKind: 'WorkoutCompleted',
        lastActivityAtUtc: '2026-10-01T10:00:00Z',
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
        joinedOn: '2026-09-21',
        isNew: true,
        status: 'NeedsAttention',
        attention: ['WeekNotShared'],
        lastActivityKind: 'CheckInSubmitted',
        lastActivityAtUtc: '2026-09-29T19:30:00Z',
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
        lastActivityKind: 'WorkoutCompleted',
        lastActivityAtUtc: '2026-10-01T11:25:00Z',
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
        status: 'EndingSoon',
        planEndsOn: '2026-10-02',
        attention: ['PlanEndingSoon'],
        lastActivityKind: 'WorkoutCompleted',
        lastActivityAtUtc: '2026-09-30T08:00:00Z',
      }),
      overviewRow(SARA, {
        goals: 'Lose the belly and stop my lower back from flaring up.',
        status: 'NeedsAttention',
        planEndsOn: '2026-10-12',
        attention: ['UnreadMessages', 'PlanEndingSoon'],
        lastActivityKind: 'CheckInSubmitted',
        lastActivityAtUtc: '2026-09-30T16:45:00Z',
      }),
      overviewRow(TALA, {
        goals: 'Run a half marathon in March and stay lean.',
        lastActivityKind: 'WeighInLogged',
        lastActivityAtUtc: '2026-10-01T05:50:00Z',
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
        status: 'NoActivePlan',
        planState: 'PaymentDue',
        planEndsOn: null,
        recentSessions: null,
      }),
    ],
    attentionRuleKey: 'CoachAttention',
    attentionRuleVersion: 1,
    trainingRuleKey: 'MissedSinceLastWorkoutAndUnsharedWeek',
    trainingRuleVersion: 1,
    ...overrides,
  };
}
