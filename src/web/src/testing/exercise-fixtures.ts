import type {
  ExerciseSearchResult,
  ExerciseView,
  MediaAccessView,
  MediaAssetView,
} from '../app/core/api/generated';

/** The exercise library (C10, R5.1b): generated-contract fixtures. */

export function exercise(name: string, overrides: Partial<ExerciseView> = {}): ExerciseView {
  return {
    id: `ex-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    instructions: null,
    equipment: 'Barbell',
    movementPattern: 'Squat',
    classification: 'Strength',
    isArchived: false,
    muscles: [{ muscle: 'Quadriceps', role: 'Primary' }],
    tags: [],
    alternatives: [],
    mediaAssetIds: [],
    version: 3,
    ...overrides,
  };
}

/** Back squat has a picture, Bench press a YouTube link, Pull-up nothing. */
export const BACK_SQUAT = exercise('Back Squat', {
  muscles: [
    { muscle: 'Quadriceps', role: 'Primary' },
    { muscle: 'Glutes', role: 'Secondary' },
  ],
  tags: ['compound', 'knee-friendly'],
  mediaAssetIds: ['m-squat-photo', 'm-squat-video'],
});
export const BENCH_PRESS = exercise('Bench Press', {
  movementPattern: 'HorizontalPush',
  muscles: [{ muscle: 'Chest', role: 'Primary' }],
  mediaAssetIds: ['m-bench-link'],
});
export const PULL_UP = exercise('Pull-up', {
  equipment: 'Bodyweight',
  movementPattern: 'VerticalPull',
  muscles: [{ muscle: 'Back', role: 'Primary' }],
});

export function results(items: ExerciseView[], total = items.length): ExerciseSearchResult {
  return { items, total };
}

export function access(overrides: Partial<MediaAccessView>): MediaAccessView {
  return {
    assetId: 'm-squat-photo',
    kind: 'Image',
    source: 'Upload',
    contentType: 'image/jpeg',
    url: '/api/media/m-squat-photo/content',
    expiresAtUtc: '2026-10-09T12:00:00Z',
    downloadAllowed: true,
    thumbnailUrl: null,
    ...overrides,
  };
}

export function asset(overrides: Partial<MediaAssetView>): MediaAssetView {
  return {
    id: 'm-squat-photo',
    title: 'Back squat side view',
    kind: 'Image',
    source: 'Upload',
    status: 'Ready',
    contentType: 'image/jpeg',
    length: 120_000,
    externalProvider: null,
    externalMediaId: null,
    isCoachProtected: false,
    createdAtUtc: '2026-09-01T09:00:00Z',
    version: 1,
    ...overrides,
  };
}
