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

/** What the coach reads: the same answers plus what only a coach holds. */
export function coachView(profile: ClientIntakeProfile = finishedProfile()): CoachClientDetails {
  return {
    ...profile,
    userId: 'user-rana',
    coachNotes: null,
    isCoachBlocked: false,
    assignedCoachUserId: 'user-karim',
    assignedCoachName: 'Karim Haddad',
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
