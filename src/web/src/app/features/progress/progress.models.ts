import type {
  BodyMeasurementHistoryView as ContractMeasurementHistory,
  BodyMeasurementsView as ContractMeasurements,
  BodyMeasurementView as ContractMeasurement,
  BodyweightHistoryView as ContractHistory,
  BodyweightObservationView as ContractObservation,
  ProgressView as ContractProgress,
  RecordedMassUnit,
  MeasurementType,
  MeasurementUnit,
  ProgressPhotoView as ContractProgressPhoto,
  ProgressPhotosView as ContractProgressPhotos,
  ProgressPhotoPose as ContractProgressPhotoPose,
  ProgressPhotoSource,
  ProgressPhotoStatus,
} from '../../core/api/generated';

export interface BodyMeasurement {
  id: string;
  measurementDate: string;
  measurementType: MeasurementType;
  canonicalValue: number;
  canonicalUnit: MeasurementUnit;
  enteredValue: number;
  enteredUnit: MeasurementUnit;
  displayValue: number;
  displayUnit: MeasurementUnit;
  source: 'Client' | 'Coach';
  recordedByUserId: string | null;
  recordedAtUtc: string;
  version: number;
}

export interface BodyMeasurements {
  clientProfileId: string;
  timeZoneId: string;
  displayUnit: MeasurementUnit;
  from: string;
  toExclusive: string;
  days: {
    date: string;
    measurements: BodyMeasurement[];
  }[];
}

export interface BodyMeasurementHistory {
  current: BodyMeasurement;
  previousValues: {
    id: string;
    measurementDate: string;
    measurementType: MeasurementType;
    canonicalValue: number;
    canonicalUnit: MeasurementUnit;
    enteredValue: number;
    enteredUnit: MeasurementUnit;
    source: 'Client' | 'Coach';
    recordedByUserId: string | null;
    recordedAtUtc: string;
    reason: string;
    supersededByUserId: string;
    supersededAtUtc: string;
  }[];
}

export interface BodyweightObservation {
  id: string;
  measurementDate: string;
  valueKilograms: number;
  enteredValue: number;
  enteredUnit: RecordedMassUnit;
  source: 'Client' | 'Coach' | 'DeviceImport';
  recordedByUserId: string | null;
  recordedAtUtc: string;
  version: number;
}

export interface BodyweightHistoryItem {
  id: string;
  valueKilograms: number;
  enteredValue: number;
  enteredUnit: RecordedMassUnit;
  source: 'Client' | 'Coach' | 'DeviceImport';
  recordedByUserId: string | null;
  recordedAtUtc: string;
  reason: string;
  supersededByUserId: string;
  supersededAtUtc: string;
}

export interface BodyweightHistory {
  current: BodyweightObservation;
  previousValues: BodyweightHistoryItem[];
}

export interface ProgressViewModel {
  clientProfileId: string;
  timeZoneId: string;
  weekStartsOn: ContractProgress['weekStartsOn'];
  displayUnit: RecordedMassUnit;
  from: string;
  toExclusive: string;
  days: {
    date: string;
    observation: BodyweightObservation | null;
    displayValue: number | null;
    trendEstimate: number | null;
    trendSampleCount: number | null;
  }[];
  weeks: {
    weekStart: string;
    weekEndExclusive: string;
    meanKilograms: number | null;
    displayMean: number | null;
    observedDayCount: number;
  }[];
  trend: {
    isEstimate: boolean;
    availability: ContractProgress['trend']['availability'];
    methodKey: string;
    methodVersion: string;
    timeConstantDays: number;
    warmupDays: number;
    minimumSampleCount: number;
    sampleCount: number;
    windowStart: string;
    windowEndExclusive: string;
    latestEstimateKilograms: number | null;
    latestDisplayEstimate: number | null;
  };
}

export function mapProgress(value: ContractProgress): ProgressViewModel {
  return {
    ...value,
    days: value.days.map((day) => ({
      ...day,
      observation: day.observation ? mapObservation(day.observation) : null,
      displayValue: nullableNumber(day.displayValue),
      trendEstimate: nullableNumber(day.trendEstimate),
      trendSampleCount: nullableNumber(day.trendSampleCount),
    })),
    weeks: value.weeks.map((week) => ({
      ...week,
      meanKilograms: nullableNumber(week.meanKilograms),
      displayMean: nullableNumber(week.displayMean),
      observedDayCount: Number(week.observedDayCount),
    })),
    trend: {
      ...value.trend,
      timeConstantDays: Number(value.trend.timeConstantDays),
      warmupDays: Number(value.trend.warmupDays),
      minimumSampleCount: Number(value.trend.minimumSampleCount),
      sampleCount: Number(value.trend.sampleCount),
      latestEstimateKilograms: nullableNumber(value.trend.latestEstimateKilograms),
      latestDisplayEstimate: nullableNumber(value.trend.latestDisplayEstimate),
    },
  };
}

export function mapObservation(value: ContractObservation): BodyweightObservation {
  return {
    ...value,
    valueKilograms: Number(value.valueKilograms),
    enteredValue: Number(value.enteredValue),
    version: Number(value.version),
  };
}

export function mapHistory(value: ContractHistory): BodyweightHistory {
  return {
    current: mapObservation(value.current),
    previousValues: value.previousValues.map((item) => ({
      ...item,
      valueKilograms: Number(item.valueKilograms),
      enteredValue: Number(item.enteredValue),
    })),
  };
}

export function mapMeasurements(value: ContractMeasurements): BodyMeasurements {
  return {
    ...value,
    days: value.days.map((day) => ({
      date: day.date,
      measurements: day.measurements.map(mapMeasurement),
    })),
  };
}

export function mapMeasurement(value: ContractMeasurement): BodyMeasurement {
  return {
    ...value,
    canonicalValue: Number(value.canonicalValue),
    enteredValue: Number(value.enteredValue),
    displayValue: Number(value.displayValue),
    version: Number(value.version),
  };
}

export function mapMeasurementHistory(value: ContractMeasurementHistory): BodyMeasurementHistory {
  return {
    current: mapMeasurement(value.current),
    previousValues: value.previousValues.map((item) => ({
      ...item,
      canonicalValue: Number(item.canonicalValue),
      enteredValue: Number(item.enteredValue),
    })),
  };
}

export type ProgressPhotoPose = ContractProgressPhotoPose;

export interface ProgressPhoto {
  id: string;
  photoDate: string;
  pose: ProgressPhotoPose;
  mediaAssetId: string;
  status: ProgressPhotoStatus;
  source: ProgressPhotoSource;
  version: number;
}

export interface ProgressPhotos {
  clientProfileId: string;
  from: string;
  toExclusive: string;
  photos: ProgressPhoto[];
}

export function mapProgressPhoto(value: ContractProgressPhoto): ProgressPhoto {
  return {
    id: value.id,
    photoDate: value.photoDate,
    pose: value.pose,
    mediaAssetId: value.mediaAssetId,
    status: value.status,
    source: value.source,
    version: Number(value.version),
  };
}

export function mapProgressPhotos(value: ContractProgressPhotos): ProgressPhotos {
  return {
    clientProfileId: value.clientProfileId,
    from: value.from,
    toExclusive: value.toExclusive,
    photos: value.photos.map(mapProgressPhoto),
  };
}

function nullableNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}
