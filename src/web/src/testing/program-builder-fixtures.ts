import type {
  ExercisePrescriptionView,
  ExerciseView,
  ProgramTemplateSummary,
  ProgramTemplateVersionView,
  SetPrescriptionView,
  TrainingSessionView,
} from '../app/core/api/generated';

/** Fixtures for the program builder (C4, R4.1): a two-week program and a small library. */

export function setView(overrides: Partial<SetPrescriptionView> = {}): SetPrescriptionView {
  return {
    id: `set-${Math.random()}`,
    position: 1,
    setType: 'Normal',
    repetitionsMinimum: 5,
    repetitionsMaximum: 5,
    loadStrategy: 'PercentageWorkingMax',
    directLoad: null,
    loadUnit: 'Kilogram',
    percentageWorkingMax: 75,
    targetRpe: 7,
    targetRir: null,
    exertionDisplayPreference: 'Rpe',
    restSeconds: 180,
    tempo: null,
    coachNotes: null,
    workingMaxSnapshotId: null,
    unroundedRecommendedLoad: null,
    prescribedLoad: null,
    calculationStrategyKey: null,
    calculationStrategyVersion: null,
    calculationExplanation: null,
    isManualLoadOverride: false,
    ...overrides,
  };
}

export function prescription(
  exerciseId: string,
  exerciseName: string,
  overrides: Partial<ExercisePrescriptionView> = {},
): ExercisePrescriptionView {
  return {
    id: `prescription-${exerciseId}-${Math.random()}`,
    exerciseId,
    exerciseName,
    position: 1,
    isMainLift: false,
    modificationPolicy: 'Locked',
    coachNotes: null,
    approvedAlternativeExerciseIds: [],
    sets: [setView(), setView(), setView()],
    ...overrides,
  };
}

export function sessionView(
  id: string,
  name: string,
  dayOffset: number,
  exercises: ExercisePrescriptionView[],
): TrainingSessionView {
  return {
    id,
    position: 1,
    dayOffset,
    scheduledDate: null,
    name,
    coachNotes: null,
    hasStarted: false,
    isCompleted: false,
    workoutExecutionId: null,
    exercises,
  };
}

/** Week 1 and 2: Lower A on day 1, Upper A on day 3. */
export function versionView(
  overrides: Partial<ProgramTemplateVersionView> = {},
): ProgramTemplateVersionView {
  const week = (number: number) => ({
    id: `week-${number}`,
    weekNumber: number,
    label: `Week ${number}`,
    startsOn: null,
    isPublished: true,
    isVisible: null,
    unlockDate: null,
    sessions: [
      sessionView(`lower-${number}`, 'Lower A', 0, [
        prescription('squat', 'Back squat', { isMainLift: true }),
        prescription('rdl', 'Romanian deadlift', {
          sets: [
            setView({
              loadStrategy: 'None',
              percentageWorkingMax: null,
              repetitionsMinimum: 8,
              repetitionsMaximum: 10,
              targetRpe: 8,
            }),
            setView({
              loadStrategy: 'None',
              percentageWorkingMax: null,
              repetitionsMinimum: 8,
              repetitionsMaximum: 10,
              targetRpe: 8,
            }),
          ],
        }),
      ]),
      sessionView(`upper-${number}`, 'Upper A', 2, [prescription('bench', 'Bench press')]),
    ],
  });
  return {
    id: 'version-2',
    templateId: 'template-1',
    versionNumber: 2,
    name: 'Strength base',
    description: 'Three days a week around the big lifts.',
    isPublished: true,
    weeks: [week(1), week(2)],
    ...overrides,
  };
}

export function templateSummary(
  overrides: Partial<ProgramTemplateSummary> = {},
): ProgramTemplateSummary {
  return {
    id: 'template-1',
    name: 'Strength base',
    currentVersionNumber: 2,
    isArchived: false,
    version: 41,
    versions: [
      {
        id: 'version-2',
        versionNumber: 2,
        name: 'Strength base',
        isPublished: true,
        weekCount: 2,
        createdAtUtc: '2026-10-02T09:00:00Z',
      },
      {
        id: 'version-1',
        versionNumber: 1,
        name: 'Strength base',
        isPublished: true,
        weekCount: 2,
        createdAtUtc: '2026-09-20T09:00:00Z',
      },
    ],
    ...overrides,
  };
}

export function exercise(
  id: string,
  name: string,
  overrides: Partial<ExerciseView> = {},
): ExerciseView {
  return {
    id,
    name,
    instructions: null,
    equipment: 'Barbell',
    movementPattern: 'Squat',
    classification: 'Strength',
    isArchived: false,
    muscles: [],
    tags: [],
    alternatives: [],
    mediaAssetIds: [],
    version: 1,
    ...overrides,
  };
}

export const LIBRARY: ExerciseView[] = [
  exercise('squat', 'Back squat', {
    alternatives: [{ exerciseId: 'goblet', exerciseName: 'Goblet squat', note: null }],
  }),
  exercise('goblet', 'Goblet squat', { equipment: 'Dumbbell' }),
  exercise('rdl', 'Romanian deadlift', { movementPattern: 'Hinge' }),
  exercise('bench', 'Bench press', { movementPattern: 'HorizontalPush' }),
  exercise('row', 'Chest-supported row', {
    equipment: 'Dumbbell',
    movementPattern: 'HorizontalPull',
    mediaAssetIds: ['media-row'],
  }),
];
