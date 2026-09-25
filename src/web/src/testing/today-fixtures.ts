import { signal } from '@angular/core';
import { vi } from 'vitest';
import type { ClientAccessStatus } from '../app/core/access/client-access.store';
import type {
  CoachingFeature,
  FeatureAccessDecision,
  FeatureAccessReason,
} from '../app/core/api/api.models';
import type { ClientTrainingDayResult, ClientWorkoutView } from '../app/core/api/generated';
import type { UpcomingTraining } from '../app/features/training/training-read.models';

/**
 * Fixtures for the client's Today (Step 3B). The approved scenario (339:2140): Sun 20 Sep 2026, day 7 of
 * week 4 of Maya's block, session "Upper Body — Strength B" (3 exercises, 10 sets).
 */
export const TODAY = '2026-09-20';

export function workout(overrides: Partial<ClientWorkoutView> = {}): ClientWorkoutView {
  const set = (isCompleted: boolean) =>
    ({ isCompleted }) as ClientWorkoutView['exercises'][0]['sets'][0];
  return {
    sessionId: 'session-b',
    mesocycleId: 'block-1',
    workoutExecutionId: null,
    name: 'Upper Body — Strength B',
    coachNotes: 'Top set first.',
    status: null,
    exercises: [
      { sets: [set(false), set(false), set(false), set(false)] },
      { sets: [set(false), set(false), set(false)] },
      { sets: [set(false), set(false), set(false)] },
    ] as ClientWorkoutView['exercises'],
    notes: [],
    executionVersion: null,
    ...overrides,
  };
}

export function day(
  workouts: ClientWorkoutView[] = [],
  allowed = true,
  reason = 'Granted',
): ClientTrainingDayResult {
  return { isAllowed: allowed, accessReason: reason, localDate: TODAY, workouts };
}

export function upcoming(overrides: Partial<UpcomingTraining> = {}): UpcomingTraining {
  return {
    isAllowed: true,
    accessReason: 'Granted',
    localDate: TODAY,
    hasAssignedProgram: true,
    hasVisibleSessions: true,
    searchThrough: '2026-12-19',
    nextSession: null,
    unfinishedWorkouts: [],
    nextSkip: null,
    todayCoverage: {
      activeBlock: {
        id: 'block-1',
        name: 'Upper-Body Strength v3',
        weekNumber: 4,
        weekCount: 8,
        isCurrentWeekPublished: true,
      },
      nextBlockStartDate: null,
    },
    ...overrides,
  };
}

export function decision(
  feature: FeatureAccessDecision['feature'],
  reason: FeatureAccessReason = 'Granted',
): FeatureAccessDecision {
  return {
    feature,
    isAllowed: reason === 'Granted',
    reason,
    enrollmentId: null,
    accessibleFrom: null,
    accessibleUntilExclusive: null,
  };
}

const FEATURES: CoachingFeature[] = [
  'Training',
  'Nutrition',
  'CheckIns',
  'Messaging',
  'ResourceLibrary',
];

/**
 * A stand-in for ClientAccessStore. Every feature is granted unless `reasons` says otherwise;
 * `status` other than 'loaded' means no decision is known yet.
 */
export function fakeClientAccess(
  reasons: Partial<Record<CoachingFeature, FeatureAccessReason>> = {},
  status: ClientAccessStatus = 'loaded',
) {
  const decisions = signal<FeatureAccessDecision[] | null>(
    status === 'loaded'
      ? FEATURES.map((feature) => decision(feature, reasons[feature] ?? 'Granted'))
      : null,
  );
  const statusState = signal<ClientAccessStatus>(status);
  const decisionOf = (feature: CoachingFeature) =>
    decisions()?.find((item) => item.feature === feature) ?? null;
  return {
    decisions,
    status: statusState,
    decision: decisionOf,
    notInPlan: (feature: CoachingFeature) => decisionOf(feature)?.reason === 'NoEntitlement',
    load: vi.fn(async () => undefined),
    /** Replaces the decisions, as a completed read would. */
    set(next: Partial<Record<CoachingFeature, FeatureAccessReason>>) {
      decisions.set(FEATURES.map((feature) => decision(feature, next[feature] ?? 'Granted')));
      statusState.set('loaded');
    },
  };
}
