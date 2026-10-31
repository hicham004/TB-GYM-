import { formatDate, formatNumber } from '@angular/common';
import type {
  DashboardBodyweightSection as ContractBodyweight,
  DashboardStart as ContractStart,
  DashboardStartKind,
  DashboardWeeklyChange as ContractWeeklyChange,
  StartingWeightView as ContractStartingWeight,
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

/**
 * The change beside the weight as the server worked it out (BodyweightChangeWeeklyMean, critique B16):
 * the latest weekly mean minus the mean of the week holding `fromDate`, the range's first weigh-in,
 * with the two weeks it compares so the figure can be explained. Null while they sit in one week.
 */
export interface DashboardWeeklyChange {
  methodKey: string;
  methodVersion: string;
  fromDate: string;
  firstWeekStart: string;
  latestWeekStart: string;
  displayDelta: number;
}

export interface DashboardBodyweight {
  latestDate: string | null;
  latestDisplayValue: number | null;
  weeklyChange: DashboardWeeklyChange | null;
  weeks: { weekStart: string; displayMean: number | null; observedDayCount: number }[];
  trendEstimate: number | null;
  trendIsAvailable: boolean;
  observedDayCount: number;
  /** Where the client started, on a coach's read only (critique B6); null on the client's own. */
  start: DashboardStart | null;
}

/** One of the person's starts in this coaching space: their first, or a comeback (CLI-016). */
export interface DashboardStartLine {
  clientProfileId: string;
  kind: DashboardStartKind;
  date: string;
  displayValue: number;
}

/**
 * "Since start" as the server worked it out (BodyweightSinceStartWeeklyMean): the latest weekly mean
 * minus the start week's, with the two weeks it compares so the figure can be explained.
 */
export interface DashboardSinceStart {
  methodKey: string;
  methodVersion: string;
  startWeekStart: string;
  latestWeekStart: string;
  displayDelta: number;
  percent: number;
}

/** What the start read before one correction, why it changed, and who changed it when. */
export interface StartingWeightCorrection {
  id: string;
  date: string;
  valueKilograms: number;
  enteredValue: number;
  enteredUnit: RecordedMassUnit;
  reason: string;
  byName: string;
  atUtc: string;
}

/** The profile read's own start, the one Correct start changes. */
export interface StartingWeight {
  id: string;
  date: string;
  valueKilograms: number;
  enteredValue: number;
  enteredUnit: RecordedMassUnit;
  version: number;
  /** Newest first. */
  corrections: StartingWeightCorrection[];
}

export interface DashboardStart {
  lines: DashboardStartLine[];
  sinceStart: DashboardSinceStart | null;
  current: StartingWeight | null;
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
    weeklyChange: value.weeklyChange ? mapWeeklyChange(value.weeklyChange) : null,
    weeks: value.weeks.map((week) => ({
      weekStart: week.weekStart,
      displayMean: nullableNumber(week.displayMean),
      observedDayCount: Number(week.observedDayCount),
    })),
    trendEstimate: nullableNumber(value.trend.latestDisplayEstimate),
    trendIsAvailable: value.trend.availability === 'Available',
    observedDayCount: Number(value.observedDayCount),
    start: value.start ? mapStart(value.start) : null,
  };
}

function mapWeeklyChange(value: ContractWeeklyChange): DashboardWeeklyChange {
  return {
    methodKey: value.methodKey,
    methodVersion: value.methodVersion,
    fromDate: value.fromDate,
    firstWeekStart: value.firstWeekStart,
    latestWeekStart: value.latestWeekStart,
    displayDelta: Number(value.displayDelta),
  };
}

function mapStart(value: ContractStart): DashboardStart {
  const since = value.sinceStart;
  return {
    lines: value.starts.map((line) => ({
      clientProfileId: line.clientProfileId,
      kind: line.kind,
      date: line.measurementDate,
      displayValue: Number(line.displayValue),
    })),
    sinceStart: since
      ? {
          methodKey: since.methodKey,
          methodVersion: since.methodVersion,
          startWeekStart: since.startWeekStart,
          latestWeekStart: since.latestWeekStart,
          displayDelta: Number(since.displayDelta),
          percent: Number(since.percent),
        }
      : null,
    current: value.current ? mapStartingWeight(value.current) : null,
  };
}

export function mapStartingWeight(value: ContractStartingWeight): StartingWeight {
  return {
    id: value.id,
    date: value.measurementDate,
    valueKilograms: Number(value.valueKilograms),
    enteredValue: Number(value.enteredValue),
    enteredUnit: value.enteredUnit,
    version: Number(value.version),
    corrections: value.corrections.map((item) => ({
      id: item.id,
      date: item.measurementDate,
      valueKilograms: Number(item.valueKilograms),
      enteredValue: Number(item.enteredValue),
      enteredUnit: item.enteredUnit,
      reason: item.reason,
      byName: item.supersededByName,
      atUtc: item.supersededAtUtc,
    })),
  };
}

/** The start's lines as the coach reads them, oldest first, and "Since start" when there is one. */
export interface StartWords {
  lines: { key: string; text: string }[];
  sinceStart: string | null;
}

/**
 * "Started at 97.4 kg · Wed 15 Oct 2025", "Came back at 99.0 kg · Tue 3 Mar 2026" and "Since start
 * −5.3 kg (−5.4%)" (critique B6). Weights read to one decimal, days with their year, never worked out
 * here: the server sends the figures.
 */
export function startWords(
  start: DashboardStart | null,
  unit: RecordedMassUnit,
  locale: string,
): StartWords | null {
  if (start === null || start.lines.length === 0) return null;
  const word = unit === 'Pound' ? 'lb' : 'kg';
  const weight = (value: number) => formatNumber(value, locale, '1.1-1');
  const lines = start.lines.map((line) => {
    const day = formatDate(line.date, 'EEE d MMM y', locale);
    return {
      key: line.clientProfileId,
      text:
        line.kind === 'CameBack'
          ? $localize`Came back at ${weight(line.displayValue)}:weight: ${word}:unit: · ${day}:day:`
          : $localize`Started at ${weight(line.displayValue)}:weight: ${word}:unit: · ${day}:day:`,
    };
  });
  return { lines, sinceStart: sinceStartText(start.sinceStart, word, locale) };
}

/**
 * How much a weight changed, to one decimal, or null for no change: the same for "Since start" and the
 * label beside the weight, so the two read alike. Less than 0.05 reads as 0.0. Otherwise formatNumber
 * rounds the size by its decimal digits, half away from zero as the server does (Math.round would
 * take −3.85 to −3.8).
 */
function changeSize(delta: number, locale: string): string | null {
  const size = Math.abs(delta);
  return size < 0.05 ? null : formatNumber(size, locale, '1.1-1');
}

function sinceStartText(
  since: DashboardSinceStart | null,
  word: string,
  locale: string,
): string | null {
  if (since === null) return null;
  const amount = changeSize(since.displayDelta, locale);
  if (amount === null) return $localize`No change since start`;
  // A true minus sign, which is read aloud as "minus"; a gain says plus.
  const sign = since.displayDelta < 0 ? '−' : '+';
  const percent = formatNumber(Math.abs(since.percent), locale, '1.1-1');
  return $localize`Since start ${sign}${amount}:change: ${word}:unit: (${sign}${percent}:percent:%)`;
}

/** The label beside the weight: an arrow, and "3.9 kg since 27 Aug" (critique B16). */
export interface WeightChangeWords {
  mark: '↑' | '↓' | '→';
  text: string;
}

/** Never worked out here: the server sends the figure and the day it counts from. */
export function weightChangeWords(
  change: DashboardWeeklyChange | null,
  unit: RecordedMassUnit,
  locale: string,
): WeightChangeWords | null {
  if (change === null) return null;
  const day = formatDate(change.fromDate, 'd MMM', locale);
  const amount = changeSize(change.displayDelta, locale);
  if (amount === null) return { mark: '→', text: $localize`No change since ${day}:day:` };
  const word = unit === 'Pound' ? 'lb' : 'kg';
  return {
    mark: change.displayDelta < 0 ? '↓' : '↑',
    text: $localize`${amount}:change: ${word}:unit: since ${day}:day:`,
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
