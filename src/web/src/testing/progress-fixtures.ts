import type {
  BodyMeasurement,
  BodyMeasurementHistory,
  BodyMeasurements,
  BodyweightDateCorrection,
  BodyweightHistory,
  BodyweightObservation,
  ProgressPhoto,
  ProgressPhotos,
  ProgressViewModel,
} from '../app/features/progress/progress.models';

/** Weigh-ins, measurements and photos (R5.3c) for Maya Rahman, on the fixed day 2026-10-10. */

export const TODAY = '2026-10-10';
export const NOW = '2026-10-10T09:00:00Z';

export function observation(overrides: Partial<BodyweightObservation> = {}): BodyweightObservation {
  const date = overrides.measurementDate ?? '2026-10-09';
  return {
    id: `weight-${date}`,
    measurementDate: date,
    valueKilograms: 80.2,
    enteredValue: 80.2,
    enteredUnit: 'Kilogram',
    source: 'Client',
    recordedByUserId: 'user-maya',
    recordedAtUtc: `${date}T07:00:00Z`,
    status: 'Active',
    version: 2,
    ...overrides,
  };
}

/**
 * A window of weigh-ins, oldest day first as the server sends it. `days` lists only the days with a
 * weigh-in; the days between get the empty rows the API also sends, so a page that must skip them does.
 */
export function progressView(
  weighIns: readonly BodyweightObservation[],
  overrides: Partial<ProgressViewModel> = {},
): ProgressViewModel {
  const sorted = [...weighIns].sort((a, b) => (a.measurementDate < b.measurementDate ? -1 : 1));
  const unit = overrides.displayUnit ?? 'Kilogram';
  const days: ProgressViewModel['days'] = [];
  if (sorted.length > 0) {
    const first = new Date(`${sorted[0].measurementDate}T12:00:00Z`);
    const last = new Date(`${sorted[sorted.length - 1].measurementDate}T12:00:00Z`);
    for (let day = first; day <= last; day = new Date(day.getTime() + 86_400_000)) {
      const date = day.toISOString().slice(0, 10);
      const found = sorted.find((item) => item.measurementDate === date) ?? null;
      days.push({
        date,
        observation: found,
        displayValue: found
          ? unit === 'Pound'
            ? Math.round(found.valueKilograms * 2.2046226218 * 100) / 100
            : found.valueKilograms
          : null,
        trendEstimate: null,
        trendSampleCount: null,
      });
    }
  }
  return {
    clientProfileId: 'client-1',
    timeZoneId: 'Asia/Beirut',
    weekStartsOn: 'Monday',
    displayUnit: 'Kilogram',
    from: '2025-10-10',
    toExclusive: '2026-10-11',
    days,
    weeks: [],
    trend: {
      isEstimate: true,
      availability: 'Available',
      methodKey: 'BodyweightTrendEwma',
      methodVersion: '2.0',
      timeConstantDays: 10,
      warmupDays: 90,
      minimumSampleCount: 3,
      sampleCount: sorted.length,
      windowStart: '2025-10-10',
      windowEndExclusive: '2026-10-11',
      latestEstimateKilograms: 80,
      latestDisplayEstimate: 80,
    },
    ...overrides,
  };
}

/** Maya: a daily-ish weigher, one entry in pounds and one added by her coach. */
export function mayaWeighIns(): BodyweightObservation[] {
  return [
    observation({ measurementDate: '2026-10-05', valueKilograms: 80.6, enteredValue: 80.6 }),
    observation({ measurementDate: '2026-10-07', valueKilograms: 80.1, enteredValue: 80.1 }),
    observation({
      measurementDate: '2026-10-08',
      valueKilograms: 79.8,
      enteredValue: 175.9,
      enteredUnit: 'Pound',
    }),
    observation({
      measurementDate: '2026-10-09',
      valueKilograms: 80.2,
      enteredValue: 80.2,
      source: 'Coach',
      version: 3,
    }),
  ];
}

export function weightHistory(
  overrides: Partial<BodyweightHistory> = {},
  current: BodyweightObservation = observation(),
): BodyweightHistory {
  return {
    current,
    previousValues: [
      {
        id: 'previous-1',
        valueKilograms: 82.2,
        enteredValue: 82.2,
        enteredUnit: 'Kilogram',
        source: 'Client',
        recordedByUserId: 'user-maya',
        recordedAtUtc: '2026-10-09T07:00:00Z',
        reason: 'Typed the wrong number',
        supersededByUserId: 'user-maya',
        supersededAtUtc: '2026-10-09T08:30:00Z',
      },
    ],
    void: null,
    moves: [],
    ...overrides,
  };
}

export function dateCorrection(
  from = observation({ measurementDate: '2026-10-09' }),
  to = '2026-10-08',
): BodyweightDateCorrection {
  return {
    replacement: observation({
      ...from,
      id: 'weight-replacement',
      measurementDate: to,
      version: 1,
    }),
    voided: { ...from, status: 'Voided' },
    void: {
      id: 'void-1',
      reason: 'Logged on the wrong day',
      voidedByUserId: 'user-maya',
      voidedAtUtc: '2026-10-10T08:00:00Z',
      replacementObservationId: 'weight-replacement',
    },
  };
}

export function measurement(overrides: Partial<BodyMeasurement> = {}): BodyMeasurement {
  const type = overrides.measurementType ?? 'Waist';
  const date = overrides.measurementDate ?? '2026-10-03';
  const percent = type === 'BodyFatPercentage';
  return {
    id: `${type}-${date}`,
    measurementDate: date,
    measurementType: type,
    canonicalValue: percent ? 22 : 82,
    canonicalUnit: percent ? 'Percent' : 'Centimetre',
    enteredValue: percent ? 22 : 82,
    enteredUnit: percent ? 'Percent' : 'Centimetre',
    displayValue: percent ? 22 : 82,
    displayUnit: percent ? 'Percent' : 'Centimetre',
    source: 'Client',
    recordedByUserId: 'user-maya',
    recordedAtUtc: `${date}T07:00:00Z`,
    version: 1,
    ...overrides,
  };
}

/** A window of measurements, oldest day first, each day with the lines recorded on it. */
export function measurementsView(
  recorded: readonly BodyMeasurement[],
  overrides: Partial<BodyMeasurements> = {},
): BodyMeasurements {
  const dates = [...new Set(recorded.map((item) => item.measurementDate))].sort();
  return {
    clientProfileId: 'client-1',
    timeZoneId: 'Asia/Beirut',
    displayUnit: 'Centimetre',
    from: '2025-10-10',
    toExclusive: '2026-10-11',
    days: dates.map((date) => ({
      date,
      measurements: recorded.filter((item) => item.measurementDate === date),
    })),
    ...overrides,
  };
}

export function mayaMeasurements(): BodyMeasurement[] {
  return [
    measurement({
      measurementType: 'Hips',
      measurementDate: '2026-10-03',
      displayValue: 96,
      enteredValue: 96,
      canonicalValue: 96,
    }),
    measurement({ measurementType: 'Waist', measurementDate: '2026-10-03' }),
    measurement({ measurementType: 'BodyFatPercentage', measurementDate: '2026-10-03' }),
    measurement({
      measurementType: 'Waist',
      measurementDate: '2026-09-05',
      displayValue: 83.5,
      enteredValue: 32.9,
      enteredUnit: 'Inch',
      canonicalValue: 83.5,
      source: 'Coach',
    }),
  ];
}

export function measurementHistory(
  current: BodyMeasurement = measurement(),
): BodyMeasurementHistory {
  return {
    current,
    previousValues: [
      {
        id: 'previous-m1',
        measurementDate: current.measurementDate,
        measurementType: current.measurementType,
        canonicalValue: 85,
        canonicalUnit: 'Centimetre',
        enteredValue: 85,
        enteredUnit: 'Centimetre',
        source: 'Client',
        recordedByUserId: 'user-maya',
        recordedAtUtc: `${current.measurementDate}T07:00:00Z`,
        reason: 'Measured in the wrong place',
        supersededByUserId: 'user-maya',
        supersededAtUtc: '2026-10-04T08:30:00Z',
      },
    ],
  };
}

export function photo(overrides: Partial<ProgressPhoto> = {}): ProgressPhoto {
  const pose = overrides.pose ?? 'Front';
  const date = overrides.photoDate ?? '2026-10-03';
  return {
    id: `photo-${pose}-${date}`,
    photoDate: date,
    pose,
    mediaAssetId: `asset-${pose}-${date}`,
    status: 'Active',
    source: 'Client',
    version: 1,
    ...overrides,
  };
}

export function photosView(photos: readonly ProgressPhoto[]): ProgressPhotos {
  return {
    clientProfileId: 'client-1',
    from: '2025-10-10',
    toExclusive: '2026-10-11',
    photos: [...photos],
  };
}

export function mayaPhotos(): ProgressPhoto[] {
  return [
    photo({ pose: 'Front', photoDate: '2026-09-05' }),
    photo({ pose: 'Front', photoDate: '2026-10-03' }),
    photo({ pose: 'Side', photoDate: '2026-10-03' }),
    photo({ pose: 'Back', photoDate: '2026-10-03', source: 'Coach' }),
    photo({ pose: 'Side', photoDate: '2026-09-05', status: 'Removed' }),
  ];
}
