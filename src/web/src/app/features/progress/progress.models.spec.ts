import { describe, expect, it } from 'vitest';
import {
  mapMeasurements,
  mapProgress,
  mapProgressPhotoImage,
  mapProgressPhotos,
} from './progress.models';

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

  it('maps body measurements while preserving explicitly empty days', () => {
    const mapped = mapMeasurements({
      clientProfileId: 'client',
      timeZoneId: 'Asia/Beirut',
      displayUnit: 'Inch',
      from: '2026-08-22',
      toExclusive: '2026-08-24',
      days: [
        { date: '2026-08-22', measurements: [] },
        {
          date: '2026-08-23',
          measurements: [
            {
              id: 'waist',
              measurementDate: '2026-08-23',
              measurementType: 'Waist',
              canonicalValue: '80.010',
              canonicalUnit: 'Centimetre',
              enteredValue: '31.500',
              enteredUnit: 'Inch',
              displayValue: '31.500',
              displayUnit: 'Inch',
              source: 'Client',
              recordedByUserId: 'user',
              recordedAtUtc: '2026-08-23T08:00:00Z',
              version: '7',
            },
          ],
        },
      ],
    });

    expect(mapped.days[0].measurements).toEqual([]);
    expect(mapped.days[1].measurements[0]).toMatchObject({
      canonicalValue: 80.01,
      enteredValue: 31.5,
      displayValue: 31.5,
      version: 7,
    });
  });

  it('maps progress photos and normalises the concurrency token', () => {
    const mapped = mapProgressPhotos({
      clientProfileId: 'client',
      from: '2026-08-01',
      toExclusive: '2026-08-24',
      photos: [
        {
          id: 'photo-1',
          photoDate: '2026-08-22',
          pose: 'Front',
          mediaAssetId: 'asset-1',
          status: 'Active',
          source: 'Client',
          recordedByUserId: 'user',
          recordedAtUtc: '2026-08-22T08:00:00Z',
          version: '11',
        },
        {
          id: 'photo-2',
          photoDate: '2026-08-23',
          pose: 'Back',
          mediaAssetId: 'asset-2',
          status: 'Removed',
          source: 'Coach',
          recordedByUserId: 'coach',
          recordedAtUtc: '2026-08-23T08:00:00Z',
          version: '12',
        },
      ],
    } as never);

    expect(mapped.photos).toHaveLength(2);
    expect(mapped.photos[0]).toMatchObject({
      id: 'photo-1',
      pose: 'Front',
      mediaAssetId: 'asset-1',
      status: 'Active',
      version: 11,
    });
    // A removed photo stays in the client's own history rather than disappearing.
    expect(mapped.photos[1]).toMatchObject({ status: 'Removed', version: 12 });
  });

  it('maps a photo access grant to its preview and full-size URLs', () => {
    const withThumbnail = mapProgressPhotoImage('photo-1', {
      assetId: 'asset-1',
      kind: 'Image',
      source: 'Upload',
      contentType: 'image/jpeg',
      url: '/api/media/asset-1/content',
      expiresAtUtc: '2026-08-22T08:30:00Z',
      downloadAllowed: false,
      thumbnailUrl: '/api/media/asset-1/content/thumbnail',
    } as never);

    expect(withThumbnail).toEqual({
      photoId: 'photo-1',
      fullUrl: '/api/media/asset-1/content',
      thumbnailUrl: '/api/media/asset-1/content/thumbnail',
    });

    // A photo stored before renditions existed reports no thumbnail rather than an empty string,
    // so the view falls back to the full image instead of rendering a broken preview.
    const withoutThumbnail = mapProgressPhotoImage('photo-2', {
      assetId: 'asset-2',
      kind: 'Image',
      source: 'Upload',
      contentType: 'image/jpeg',
      url: '/api/media/asset-2/content',
      expiresAtUtc: '2026-08-22T08:30:00Z',
      downloadAllowed: false,
    } as never);

    expect(withoutThumbnail.thumbnailUrl).toBeNull();
    expect(withoutThumbnail.fullUrl).toBe('/api/media/asset-2/content');
  });
});
