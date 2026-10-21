import { type Observable, of } from 'rxjs';
import type {
  ExercisePrescriptionView,
  ExerciseSearchResult,
  ExerciseView,
  MovementPattern,
  ProgramDraftSaveView,
  ProgramDraftSummary,
  ProgramDraftView,
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
    mediaAssetIds: [],
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

/**
 * The coach's draft of Strength base (R4.2a): week 1 only, Lower A renamed "Lower A, heavier" with
 * one back-squat set of 3 reps at 80%, as the server keeps a draft (a save's shape).
 */
export function draftView(overrides: Partial<ProgramDraftView> = {}): ProgramDraftView {
  return {
    id: 'draft-1',
    templateId: 'template-1',
    sourceVersionId: 'version-2',
    startedAtVersionNumber: 2,
    updatedAtUtc: '2026-10-04T15:30:00Z',
    version: 7,
    content: {
      name: 'Strength base',
      description: 'Three days a week around the big lifts.',
      weeks: [
        {
          label: 'Week 1',
          isPublished: true,
          sessions: [
            {
              name: 'Lower A, heavier',
              dayOffset: 0,
              coachNotes: null,
              exercises: [
                {
                  exerciseId: 'squat',
                  position: 1,
                  isMainLift: true,
                  modificationPolicy: 'Locked',
                  coachNotes: null,
                  approvedAlternativeExerciseIds: [],
                  sets: [
                    {
                      position: 1,
                      setType: 'Normal',
                      repetitionsMinimum: 3,
                      repetitionsMaximum: 3,
                      loadStrategy: 'PercentageWorkingMax',
                      directLoad: null,
                      loadUnit: 'Kilogram',
                      percentageWorkingMax: 80,
                      targetRpe: 8,
                      targetRir: null,
                      exertionDisplayPreference: 'Rpe',
                      restSeconds: 180,
                      tempo: null,
                      coachNotes: null,
                      manualLoadOverride: null,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    exercises: [{ id: 'squat', name: 'Back squat', isArchived: false }],
    ...overrides,
  };
}

export function draftSummary(overrides: Partial<ProgramDraftSummary> = {}): ProgramDraftSummary {
  return {
    id: 'draft-1',
    templateId: 'template-1',
    name: 'Strength base',
    weekCount: 1,
    updatedAtUtc: '2026-10-04T15:30:00Z',
    ...overrides,
  };
}

/** A save that just happened: the status line reads "Saved at 14:32" only for the day it is read on. */
export function saveView(id = 'draft-1', version = 8): ProgramDraftSaveView {
  return { id, version, updatedAtUtc: new Date().toISOString() };
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

/** What a builder asks `ApiClient.searchExercises` for. */
export interface LibraryQuery {
  query?: string;
  movementPatterns?: readonly MovementPattern[];
  ids?: readonly string[];
  includeArchived?: boolean;
  patterns?: boolean;
  skip?: number;
  take?: number;
}

/**
 * `GET /api/exercises` as the server answers it (WEA-14): archived exercises only when asked for, the ids
 * and patterns asked for, every word in the name or a tag, by name, one page from `skip`, and, when asked
 * for, the library's count under each pattern whatever else was asked.
 */
export function libraryPage(
  library: readonly ExerciseView[],
  query: LibraryQuery = {},
): ExerciseSearchResult {
  const shown = library.filter((item) => query.includeArchived || !item.isArchived);
  const words = (query.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const found = shown
    .filter((item) => !query.ids?.length || query.ids.includes(item.id))
    .filter(
      (item) =>
        !query.movementPatterns?.length || query.movementPatterns.includes(item.movementPattern),
    )
    .filter((item) =>
      words.every(
        (word) =>
          item.name.toLowerCase().includes(word) ||
          item.tags.some((tag) => tag.toLowerCase().includes(word)),
      ),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const counts = new Map<MovementPattern, number>();
  for (const item of shown) {
    counts.set(item.movementPattern, (counts.get(item.movementPattern) ?? 0) + 1);
  }
  const skip = query.skip ?? 0;
  return {
    total: found.length,
    items: found.slice(skip, skip + (query.take ?? 100)),
    patterns: query.patterns ? [...counts].map(([pattern, count]) => ({ pattern, count })) : [],
  };
}

/** The same, for a spec that stubs `ApiClient.searchExercises`. */
export function searchLibrary(library: readonly ExerciseView[] = LIBRARY) {
  return (query: LibraryQuery = {}): Observable<ExerciseSearchResult> =>
    of(libraryPage(library, query));
}

/** What a request to `GET /api/exercises` asks for, read from its address, for the Playwright mocks. */
export function libraryQueryOf(address: string): LibraryQuery {
  const params = new URL(address).searchParams;
  return {
    query: params.get('query') ?? undefined,
    movementPatterns: params.getAll('movementPattern') as MovementPattern[],
    ids: params.getAll('ids'),
    includeArchived: params.get('includeArchived') === 'true',
    patterns: params.get('patterns') === 'true',
    skip: Number(params.get('skip') ?? 0),
    take: Number(params.get('take') ?? 50),
  };
}

export const LIBRARY: ExerciseView[] = [
  exercise('squat', 'Back squat', {
    alternatives: [
      { exerciseId: 'goblet', exerciseName: 'Goblet squat', note: null, isArchived: false },
    ],
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
