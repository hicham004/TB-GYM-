import type {
  ClientIntakeProfile,
  ClientSelfProfile,
  CoachClientDetails,
  WorkspaceDetails,
} from '../app/core/api/api.models';

/** The intake (R5.3b): one client at each point of setting up, on the fixed day 2026-10-10. */

export const TODAY = '2026-10-10';
export const NOW = '2026-10-10T09:00:00Z';

/** A client who has accepted the invitation and answered nothing yet. */
export function newProfile(overrides: Partial<ClientSelfProfile> = {}): ClientSelfProfile {
  return {
    id: 'client-1',
    firstName: 'Rana',
    lastName: 'Haddad',
    email: 'rana@example.test',
    phoneNumber: null,
    birthDate: null,
    heightCentimeters: null,
    heightEnteredValue: null,
    heightEnteredUnit: null,
    workType: null,
    averageDailySteps: null,
    trainingBackground: null,
    foodPreferences: null,
    foodAversions: null,
    goals: null,
    allergies: null,
    medications: null,
    previousInjuries: null,
    onboardingStatus: 'NotStarted',
    onboardingCompletedAtUtc: null,
    version: 4,
    // Open for a coach's client; closed only for a trainee of TB Gym's own space who is not on Max (N9c5a).
    healthStepOpen: true,
    // A coach's client; a trainee of TB Gym's own space reads `selfDirected: true` (notes plan N9a2), and one
    // Max coaches today `coachedByTheHouse: true` as well (N9c5a).
    selfDirected: false,
    coachedByTheHouse: false,
    ...overrides,
  };
}

/** Halfway: about her and her goal are answered, the rest is not. */
export function halfwayProfile(overrides: Partial<ClientSelfProfile> = {}): ClientSelfProfile {
  return newProfile({
    phoneNumber: '+96170123456',
    birthDate: '1996-04-02',
    heightCentimeters: 168,
    heightEnteredValue: 168,
    heightEnteredUnit: 'Centimeter',
    goals: 'Run a 10k in under an hour by June.',
    onboardingStatus: 'InProgress',
    version: 6,
    ...overrides,
  });
}

/** Finished: every question answered, the way the demo's clients are. */
export function finishedProfile(overrides: Partial<ClientSelfProfile> = {}): ClientSelfProfile {
  return halfwayProfile({
    workType: 'Desk job, two days a week on site',
    averageDailySteps: 6500,
    trainingBackground: 'Ran on and off for years.\nGym twice a week since January.',
    foodPreferences: 'Rice, chicken, labneh',
    foodAversions: 'Okra',
    allergies: 'Peanuts',
    medications: null,
    previousInjuries: 'Left knee, 2023',
    onboardingStatus: 'Completed',
    onboardingCompletedAtUtc: '2026-09-20T10:00:00Z',
    version: 9,
    ...overrides,
  });
}

/**
 * Karim, the client's coach and the one reading: the mocked session's signed-in user (`SIGNED_IN_USER` in
 * e2e/support.ts). Only a client's own coach reads the answers and the notes (N9d1a), so the reader is
 * their coach.
 */
export const COACH_USER_ID = '00000000-0000-4000-8000-0000000000aa';

/**
 * What the coach reads: the same answers plus what only a coach holds. `selfDirected` is the client's own
 * read's alone, so it is left out, as the server leaves it out.
 */
export function coachView(profile: ClientIntakeProfile = finishedProfile()): CoachClientDetails {
  const answers: ClientSelfProfile = { ...profile };
  delete answers.selfDirected;
  delete answers.coachedByTheHouse;
  return {
    ...answers,
    userId: 'user-rana',
    coachNotes: null,
    isCoachBlocked: false,
    assignedCoachUserId: COACH_USER_ID,
    assignedCoachName: 'Karim Haddad',
    mayCoach: true,
    release: null,
  };
}

export function workspace(overrides: Partial<WorkspaceDetails> = {}): WorkspaceDetails {
  return {
    id: 'tenant-1',
    name: 'Atlas Performance',
    slug: 'atlas-performance',
    timeZoneId: 'Asia/Beirut',
    defaultCulture: 'en-LB',
    defaultCurrencyCode: 'USD',
    weekStartsOn: 'Monday',
    currentDate: TODAY,
    version: 3,
    brandColor: null,
    accentColor: null,
    logoAssetId: null,
    ...overrides,
  };
}
