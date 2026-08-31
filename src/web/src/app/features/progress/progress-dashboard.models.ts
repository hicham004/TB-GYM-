import type {
  DashboardBodyweightSection as ContractBodyweight,
  DashboardChange as ContractChange,
  DashboardEntitledSectionOfDashboardNutritionContext as ContractNutritionSection,
  DashboardEntitledSectionOfDashboardTrainingContext as ContractTrainingSection,
  DashboardMeasurementsSection as ContractMeasurements,
  DashboardMeasurementSummary as ContractMeasurementSummary,
  DashboardNutritionContext as ContractNutritionContext,
  DashboardPhotosSection as ContractPhotos,
  DashboardPhotoView as ContractDashboardPhoto,
  DashboardTrainingContext as ContractTrainingContext,
  FeatureAccessReason,
  MeasurementType,
  MeasurementUnit,
  ProgressDashboardView as ContractDashboard,
  ProgressPhotoPose,
  RecordedMassUnit,
} from '../../core/api/generated';

export interface DashboardChange {
  fromDate: string;
  fromValue: number;
  toDate: string;
  toValue: number;
  delta: number;
}

export interface DashboardBodyweight {
  latestDate: string | null;
  latestDisplayValue: number | null;
  change: DashboardChange | null;
  weeks: { weekStart: string; displayMean: number | null; observedDayCount: number }[];
  trendEstimate: number | null;
  trendIsAvailable: boolean;
  observedDayCount: number;
}

export interface DashboardMeasurement {
  measurementType: MeasurementType;
  displayUnit: MeasurementUnit;
  latestDate: string;
  latestDisplayValue: number;
  change: DashboardChange | null;
  observationCount: number;
}

export interface DashboardPhoto {
  id: string;
  photoDate: string;
  pose: ProgressPhotoPose;
  mediaAssetId: string;
  /**
   * The preview path, or null for a photo stored before renditions existed. A null value is
   * rendered as an explicit "preview unavailable" tile: the dashboard never falls back to the
   * full-resolution original, which would pull megabytes into a thumbnail slot.
   */
  thumbnailUrl: string | null;
}

export interface DashboardPhotos {
  poses: { pose: ProgressPhotoPose; photos: DashboardPhoto[] }[];
  photoCount: number;
  missingThumbnailCount: number;
  /**
   * How many tiles the timelines actually carry. Lower than `photoCount` once a pose has more
   * photos in the window than the server previews, so the view can say which it is showing.
   */
  previewPhotoCount: number;
}

/**
 * A cross-domain section. It is always present in the payload: when the client is not entitled it
 * arrives unavailable with the deciding reason and no content, so the view can say why rather than
 * showing an empty panel that reads as "nothing recorded".
 */
export interface DashboardSection<TContext> {
  available: boolean;
  reason: FeatureAccessReason;
  context: TContext | null;
}

export interface DashboardNutrition {
  recentDayCount: number;
  recentLoggedDayCount: number;
  recentCompletedDayCount: number;
  windowLoggedDayCount: number;
  windowCompletedDayCount: number;
  lastLoggedDate: string | null;
}

export interface DashboardTraining {
  recentDayCount: number;
  recentScheduledSessionCount: number;
  recentCompletedWorkoutCount: number;
  windowScheduledSessionCount: number;
  windowCompletedWorkoutCount: number;
  windowInProgressWorkoutCount: number;
  lastCompletedDate: string | null;
}

export interface ProgressDashboard {
  clientProfileId: string;
  timeZoneId: string;
  from: string;
  toExclusive: string;
  windowDayCount: number;
  displayUnit: RecordedMassUnit;
  measurementDisplayUnit: MeasurementUnit;
  bodyweight: DashboardBodyweight;
  measurements: DashboardMeasurement[];
  measurementObservedDayCount: number;
  photos: DashboardPhotos;
  nutrition: DashboardSection<DashboardNutrition>;
  training: DashboardSection<DashboardTraining>;
  /** True when no domain recorded anything in the window, which the view reports as empty. */
  isEmpty: boolean;
}

export function mapProgressDashboard(value: ContractDashboard): ProgressDashboard {
  const bodyweight = mapBodyweight(value.bodyweight);
  const measurements = mapMeasurements(value.measurements);
  const photos = mapPhotos(value.photos);
  const nutrition = mapNutrition(value.nutrition);
  const training = mapTraining(value.training);
  return {
    clientProfileId: value.clientProfileId,
    timeZoneId: value.timeZoneId,
    from: value.from,
    toExclusive: value.toExclusive,
    windowDayCount: Number(value.windowDayCount),
    displayUnit: value.displayUnit,
    measurementDisplayUnit: value.measurementDisplayUnit,
    bodyweight,
    measurements: measurements.summaries,
    measurementObservedDayCount: measurements.observedDayCount,
    photos,
    nutrition,
    training,
    // An unavailable section is not emptiness: the client may well have logged, and the viewer is
    // simply not permitted to see it. Only sections that are both readable and empty count here.
    isEmpty:
      bodyweight.observedDayCount === 0 &&
      measurements.summaries.length === 0 &&
      photos.photoCount === 0 &&
      (!nutrition.available || nutrition.context?.windowLoggedDayCount === 0) &&
      (!training.available || training.context?.windowScheduledSessionCount === 0),
  };
}

function mapBodyweight(value: ContractBodyweight): DashboardBodyweight {
  return {
    latestDate: value.latest?.measurementDate ?? null,
    latestDisplayValue: nullableNumber(value.latestDisplayValue),
    change: mapChange(value.change),
    weeks: value.weeks.map((week) => ({
      weekStart: week.weekStart,
      displayMean: nullableNumber(week.displayMean),
      observedDayCount: Number(week.observedDayCount),
    })),
    trendEstimate: nullableNumber(value.trend.latestDisplayEstimate),
    trendIsAvailable: value.trend.availability === 'Available',
    observedDayCount: Number(value.observedDayCount),
  };
}

function mapMeasurements(value: ContractMeasurements): {
  summaries: DashboardMeasurement[];
  observedDayCount: number;
} {
  return {
    summaries: value.measurements.map(mapMeasurementSummary),
    observedDayCount: Number(value.observedDayCount),
  };
}

function mapMeasurementSummary(value: ContractMeasurementSummary): DashboardMeasurement {
  return {
    measurementType: value.measurementType,
    displayUnit: value.displayUnit,
    latestDate: value.latestDate,
    latestDisplayValue: Number(value.latestDisplayValue),
    change: mapChange(value.change),
    observationCount: Number(value.observationCount),
  };
}

function mapPhotos(value: ContractPhotos): DashboardPhotos {
  return {
    poses: value.poses.map((pose) => ({
      pose: pose.pose,
      photos: pose.photos.map(mapDashboardPhoto),
    })),
    photoCount: Number(value.photoCount),
    missingThumbnailCount: Number(value.missingThumbnailCount),
    previewPhotoCount: Number(value.previewPhotoCount),
  };
}

/**
 * The media assets whose previews the dashboard is about to display. Each one needs its own
 * short-lived path-scoped grant before the browser may fetch it, and they are requested together
 * in one bounded call rather than one request per tile.
 */
export function previewAssetIds(dashboard: ProgressDashboard): string[] {
  return dashboard.photos.poses.flatMap((pose) =>
    pose.photos.filter((photo) => photo.thumbnailUrl !== null).map((photo) => photo.mediaAssetId),
  );
}

function mapDashboardPhoto(value: ContractDashboardPhoto): DashboardPhoto {
  return {
    id: value.id,
    photoDate: value.photoDate,
    pose: value.pose,
    mediaAssetId: value.mediaAssetId,
    thumbnailUrl: value.thumbnailUrl ?? null,
  };
}

function mapNutrition(value: ContractNutritionSection): DashboardSection<DashboardNutrition> {
  return {
    available: value.availability === 'Available',
    reason: value.reason,
    context: mapNutritionContext(value.context),
  };
}

function mapNutritionContext(value: ContractNutritionContext | null): DashboardNutrition | null {
  return value === null
    ? null
    : {
        recentDayCount: Number(value.recentDayCount),
        recentLoggedDayCount: Number(value.recentLoggedDayCount),
        recentCompletedDayCount: Number(value.recentCompletedDayCount),
        windowLoggedDayCount: Number(value.windowLoggedDayCount),
        windowCompletedDayCount: Number(value.windowCompletedDayCount),
        lastLoggedDate: value.lastLoggedDate ?? null,
      };
}

function mapTraining(value: ContractTrainingSection): DashboardSection<DashboardTraining> {
  return {
    available: value.availability === 'Available',
    reason: value.reason,
    context: mapTrainingContext(value.context),
  };
}

function mapTrainingContext(value: ContractTrainingContext | null): DashboardTraining | null {
  return value === null
    ? null
    : {
        recentDayCount: Number(value.recentDayCount),
        recentScheduledSessionCount: Number(value.recentScheduledSessionCount),
        recentCompletedWorkoutCount: Number(value.recentCompletedWorkoutCount),
        windowScheduledSessionCount: Number(value.windowScheduledSessionCount),
        windowCompletedWorkoutCount: Number(value.windowCompletedWorkoutCount),
        windowInProgressWorkoutCount: Number(value.windowInProgressWorkoutCount),
        lastCompletedDate: value.lastCompletedDate ?? null,
      };
}

function mapChange(value: ContractChange | null): DashboardChange | null {
  return value === null
    ? null
    : {
        fromDate: value.fromDate,
        fromValue: Number(value.fromValue),
        toDate: value.toDate,
        toValue: Number(value.toValue),
        delta: Number(value.delta),
      };
}

function nullableNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}
