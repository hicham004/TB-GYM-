import type {
  ClientProgramSummaryView,
  ProgressPhotoExportView,
  WorkoutPersonalRecordView,
} from '../app/core/api/generated';
import type { ShareProgressPhotos } from '../app/features/share-cards/share-card.models';

/**
 * Share card facts (R6.1a) as the server sends them: Maya's bench press record from a finish summary,
 * and the eight-week program it finished. Plain data, so Playwright specs can use it too.
 */
export function personalRecord(
  overrides: Partial<WorkoutPersonalRecordView> = {},
): WorkoutPersonalRecordView {
  return {
    setPerformanceId: 'set-bench',
    exerciseName: 'Barbell bench press',
    repetitions: 6,
    load: 62.5,
    unit: 'Kilogram',
    ruleKey: 'ExactRepsLoad',
    ruleVersion: 1,
    ...overrides,
  };
}

export function programSummary(
  overrides: Partial<ClientProgramSummaryView> = {},
): ClientProgramSummaryView {
  return {
    id: 'block-1',
    name: 'Strength Foundations',
    startDate: '2026-08-10',
    endDateExclusive: '2026-10-05',
    weekCount: 8,
    workoutCount: 30,
    personalRecordCount: 7,
    personalRecordRuleKey: 'ExactRepsLoad',
    personalRecordRuleVersion: 1,
    ...overrides,
  };
}

/**
 * A before-and-after (R6.1b) as the server recorded it: Maya's front photos of 5 September and
 * 3 October 2026, the ones `mayaPhotos()` in progress-fixtures holds.
 */
export function photoExport(
  overrides: Partial<ProgressPhotoExportView> = {},
): ProgressPhotoExportView {
  return {
    id: 'export-1',
    pose: 'Front',
    before: {
      id: 'photo-Front-2026-09-05',
      photoDate: '2026-09-05',
      mediaAssetId: 'asset-Front-2026-09-05',
    },
    after: {
      id: 'photo-Front-2026-10-03',
      photoDate: '2026-10-03',
      mediaAssetId: 'asset-Front-2026-10-03',
    },
    exportedAtUtc: '2026-10-10T09:00:00Z',
    ...overrides,
  };
}

/** The same export with its two pictures granted, as a share card is made from it. */
export function progressPhotos(overrides: Partial<ShareProgressPhotos> = {}): ShareProgressPhotos {
  return {
    exportId: 'export-1',
    pose: 'Front',
    before: { date: '2026-09-05', imageUrl: '/api/media/asset-Front-2026-09-05/content' },
    after: { date: '2026-10-03', imageUrl: '/api/media/asset-Front-2026-10-03/content' },
    ...overrides,
  };
}
