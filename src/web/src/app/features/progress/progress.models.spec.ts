import { describe, expect, it } from 'vitest';
import { mapProgress } from './progress.models';

describe('progress view mapping', () => {
  it('preserves missing days and converts API decimals without inventing values', () => {
    const mapped = mapProgress({
      clientProfileId: 'client',
      timeZoneId: 'Asia/Beirut',
      weekStartsOn: 'Saturday',
      displayUnit: 'Pound',
      from: '2026-08-22',
      toExclusive: '2026-08-24',
      days: [
        {
          date: '2026-08-22',
          observation: null,
          displayValue: null,
          trendEstimate: null,
          trendSampleCount: null,
        },
        {
          date: '2026-08-23',
          observation: {
            id: 'observation',
            measurementDate: '2026-08-23',
            valueKilograms: '100.000',
            enteredValue: '220.462',
            enteredUnit: 'Pound',
            source: 'Client',
            recordedByUserId: 'user',
            recordedAtUtc: '2026-08-22T21:30:00Z',
            version: '7',
          },
          displayValue: '220.462',
          trendEstimate: '220.462',
          trendSampleCount: '1',
        },
      ],
      weeks: [
        {
          weekStart: '2026-08-22',
          weekEndExclusive: '2026-08-29',
          meanKilograms: '100.000',
          displayMean: '220.462',
          observedDayCount: '1',
        },
      ],
      trend: {
        isEstimate: true,
        availability: 'NotEnoughData',
        methodKey: 'BodyweightTrendEwma',
        methodVersion: '2.0',
        timeConstantDays: '10',
        warmupDays: '90',
        minimumSampleCount: '3',
        sampleCount: '1',
        windowStart: '2026-08-22',
        windowEndExclusive: '2026-08-24',
        latestEstimateKilograms: null,
        latestDisplayEstimate: null,
      },
    });

    expect(mapped.days[0].observation).toBeNull();
    expect(mapped.days[0].displayValue).toBeNull();
    expect(mapped.days[1].observation?.valueKilograms).toBe(100);
    expect(mapped.weeks[0].observedDayCount).toBe(1);
    expect(mapped.trend.sampleCount).toBe(1);
    expect(mapped.trend.availability).toBe('NotEnoughData');
    expect(mapped.trend.timeConstantDays).toBe(10);
  });
});
