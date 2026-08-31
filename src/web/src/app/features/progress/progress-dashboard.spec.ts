import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { settle } from '../../../testing/dom';
import { ProgressDashboardView } from './progress-dashboard';
import {
  mapProgressDashboard,
  previewAssetIds,
  type ProgressDashboard,
} from './progress-dashboard.models';

function contract(overrides: Record<string, unknown> = {}): never {
  return {
    clientProfileId: 'client-1',
    timeZoneId: 'Asia/Beirut',
    weekStartsOn: 'Monday',
    from: '2026-06-01',
    toExclusive: '2026-08-23',
    windowDayCount: '83',
    displayUnit: 'Kilogram',
    measurementDisplayUnit: 'Centimetre',
    bodyweight: {
      latest: { id: 'obs-1', measurementDate: '2026-08-22' },
      latestDisplayValue: '81.5',
      change: {
        fromDate: '2026-08-20',
        fromValue: '82.5',
        toDate: '2026-08-22',
        toValue: '81.5',
        delta: '-1',
      },
      weeks: [{ weekStart: '2026-08-17', displayMean: '82', observedDayCount: '2' }],
      trend: { availability: 'Available', latestDisplayEstimate: '81.9' },
      observedDayCount: '2',
    },
    measurements: {
      measurements: [
        {
          measurementType: 'Waist',
          displayUnit: 'Centimetre',
          latestDate: '2026-08-22',
          latestDisplayValue: '90',
          change: null,
          observationCount: '1',
        },
      ],
      observedDayCount: '1',
    },
    photos: {
      poses: [
        {
          pose: 'Front',
          photos: [
            {
              id: 'photo-1',
              photoDate: '2026-08-22',
              pose: 'Front',
              mediaAssetId: 'asset-1',
              thumbnailUrl: '/api/media/asset-1/content/thumbnail',
            },
            {
              id: 'photo-2',
              photoDate: '2026-08-21',
              pose: 'Front',
              mediaAssetId: 'asset-2',
              thumbnailUrl: null,
            },
          ],
        },
      ],
      photoCount: '2',
      missingThumbnailCount: '1',
      previewPhotoCount: '2',
    },
    nutrition: {
      feature: 'Nutrition',
      availability: 'Available',
      reason: 'Granted',
      context: {
        recentFrom: '2026-08-16',
        recentToExclusive: '2026-08-23',
        recentDayCount: '7',
        recentLoggedDayCount: '6',
        recentCompletedDayCount: '4',
        windowLoggedDayCount: '20',
        windowCompletedDayCount: '12',
        lastLoggedDate: '2026-08-22',
      },
    },
    training: {
      feature: 'Training',
      availability: 'Unavailable',
      reason: 'Expired',
      context: null,
    },
    ...overrides,
  } as never;
}

const emptySections = {
  bodyweight: {
    latest: null,
    latestDisplayValue: null,
    change: null,
    weeks: [],
    trend: { availability: 'NotEnoughData', latestDisplayEstimate: null },
    observedDayCount: '0',
  },
  measurements: { measurements: [], observedDayCount: '0' },
  photos: { poses: [], photoCount: '0', missingThumbnailCount: '0', previewPhotoCount: '0' },
  nutrition: {
    feature: 'Nutrition',
    availability: 'Unavailable',
    reason: 'Expired',
    context: null,
  },
  training: { feature: 'Training', availability: 'Unavailable', reason: 'Expired', context: null },
};

async function render(
  result: Observable<ProgressDashboard>,
  api: Partial<ApiClient> = {},
): Promise<HTMLElement> {
  return (await renderWith(result, api)).host;
}

async function renderWith(result: Observable<ProgressDashboard>, api: Partial<ApiClient> = {}) {
  const selectedTenantId = signal('tenant-1');
  const createMediaAccessBatch = vi.fn((assetIds: string[]) =>
    of({ items: assetIds.map((assetId) => ({ assetId })) }),
  );
  await TestBed.configureTestingModule({
    imports: [ProgressDashboardView],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          getMyProgressDashboard: vi.fn(() => result),
          createMediaAccessBatch,
          ...api,
        },
      },
      { provide: TenantStore, useValue: { selectedTenantId } },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ProgressDashboardView);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    createMediaAccessBatch,
    selectedTenantId,
  };
}

function twoPreviewDashboard(): ProgressDashboard {
  return mapProgressDashboard(
    contract({
      photos: {
        poses: [
          {
            pose: 'Front',
            photos: [
              {
                id: 'photo-1',
                photoDate: '2026-08-22',
                pose: 'Front',
                mediaAssetId: 'asset-1',
                thumbnailUrl: '/api/media/asset-1/content/thumbnail',
              },
              {
                id: 'photo-2',
                photoDate: '2026-08-21',
                pose: 'Front',
                mediaAssetId: 'asset-2',
                thumbnailUrl: '/api/media/asset-2/content/thumbnail',
              },
            ],
          },
        ],
        photoCount: '2',
        missingThumbnailCount: '0',
        previewPhotoCount: '2',
      },
    }),
  );
}

describe('progress dashboard mapping', () => {
  it('normalises every count and preserves explicit denominators', () => {
    const mapped = mapProgressDashboard(contract());

    expect(mapped.windowDayCount).toBe(83);
    expect(mapped.bodyweight.latestDisplayValue).toBe(81.5);
    expect(mapped.bodyweight.change).toEqual({
      fromDate: '2026-08-20',
      fromValue: 82.5,
      toDate: '2026-08-22',
      toValue: 81.5,
      delta: -1,
    });
    expect(mapped.bodyweight.weeks[0]).toEqual({
      weekStart: '2026-08-17',
      displayMean: 82,
      observedDayCount: 2,
    });
    expect(mapped.measurements[0]).toMatchObject({
      measurementType: 'Waist',
      latestDisplayValue: 90,
      change: null,
      observationCount: 1,
    });

    // Both the numerator and its denominator survive, so the view can never render a bare count.
    expect(mapped.nutrition.available).toBe(true);
    expect(mapped.nutrition.context).toMatchObject({
      recentDayCount: 7,
      recentLoggedDayCount: 6,
      windowLoggedDayCount: 20,
    });

    // An unentitled section keeps its reason and carries no content to render.
    expect(mapped.training.available).toBe(false);
    expect(mapped.training.reason).toBe('Expired');
    expect(mapped.training.context).toBeNull();
    expect(mapped.isEmpty).toBe(false);
  });

  it('maps a missing thumbnail to null rather than to the original', () => {
    const mapped = mapProgressDashboard(contract());
    const photos = mapped.photos.poses[0].photos;

    expect(photos[0].thumbnailUrl).toBe('/api/media/asset-1/content/thumbnail');
    expect(photos[1].thumbnailUrl).toBeNull();
    expect(mapped.photos.missingThumbnailCount).toBe(1);
  });

  it('reports emptiness only from sections the caller may actually read', () => {
    expect(mapProgressDashboard(contract(emptySections)).isEmpty).toBe(true);

    // A readable nutrition section with activity is not empty, even though nothing else was
    // recorded, so an unavailable section is never mistaken for an absent one.
    const withNutrition = mapProgressDashboard(
      contract({
        ...emptySections,
        nutrition: {
          feature: 'Nutrition',
          availability: 'Available',
          reason: 'Granted',
          context: {
            recentFrom: '2026-08-16',
            recentToExclusive: '2026-08-23',
            recentDayCount: '7',
            recentLoggedDayCount: '3',
            recentCompletedDayCount: '1',
            windowLoggedDayCount: '3',
            windowCompletedDayCount: '1',
            lastLoggedDate: '2026-08-20',
          },
        },
      }),
    );
    expect(withNutrition.isEmpty).toBe(false);
  });
});

describe('ProgressDashboardView states', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders counts with their denominators and names why a section is unavailable', async () => {
    const host = await render(of(mapProgressDashboard(contract())));
    const text = host.textContent ?? '';

    expect(text).toContain('Logged on 6 of the last 7 days');
    expect(text).toContain('Weighed on 2 of 83 days');
    // The unentitled training section is stated, not silently dropped.
    expect(text).toContain('This subscription has ended.');
    expect(host.querySelectorAll('img.thumbnail')).toHaveLength(1);
    expect(host.querySelector('.no-preview')?.textContent).toContain('Preview unavailable');
    expect(text).toContain('no relationship between them is implied');
  });

  it('renders an empty state when nothing readable was recorded', async () => {
    const host = await render(of(mapProgressDashboard(contract(emptySections))));

    expect(host.textContent).toContain('Nothing has been recorded in this period yet.');
    expect(host.querySelectorAll('img.thumbnail')).toHaveLength(0);
  });

  it('surfaces a load failure instead of rendering a blank dashboard', async () => {
    const host = await render(throwError(() => new Error('offline')));

    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Nothing has been recorded');
  });
});

/**
 * A thumbnail path is not a public URL. The content route needs a short-lived, path-scoped grant
 * cookie, and the dashboard used to bind the paths straight to `img.src` without ever asking for
 * one — so on a fresh session every tile was a refused request.
 */
describe('ProgressDashboardView media grants', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('requests one bounded batch of grants for exactly the assets it will display', async () => {
    const { host, createMediaAccessBatch } = await renderWith(of(mapProgressDashboard(contract())));

    // One request, not one per tile, and only the photo that actually has a rendition.
    expect(createMediaAccessBatch).toHaveBeenCalledOnce();
    expect(createMediaAccessBatch).toHaveBeenCalledWith(['asset-1']);
    expect(host.querySelectorAll('img.thumbnail')).toHaveLength(1);
  });

  it('binds every preview only when every exact asset grant is returned', async () => {
    const dashboard = twoPreviewDashboard();
    const host = await render(of(dashboard));

    expect(host.querySelectorAll('img.thumbnail')).toHaveLength(2);
  });

  it('binds only the asset ids present in a partial batch response', async () => {
    const dashboard = twoPreviewDashboard();
    const host = await render(of(dashboard), {
      createMediaAccessBatch: vi.fn(() => of({ items: [{ assetId: 'asset-2' }] })) as never,
    });

    const images = [...host.querySelectorAll<HTMLImageElement>('img.thumbnail')];
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute('src')).toContain('asset-2');
    expect(host.querySelectorAll('.no-preview')).toHaveLength(1);
  });

  it('binds no preview after an empty successful batch response', async () => {
    const host = await render(of(twoPreviewDashboard()), {
      createMediaAccessBatch: vi.fn(() => of({ items: [] })) as never,
    });

    expect(host.querySelectorAll('img.thumbnail')).toHaveLength(0);
    expect(host.querySelectorAll('.no-preview')).toHaveLength(2);
  });

  it('does not ask for grants when there is nothing to preview', async () => {
    const { createMediaAccessBatch } = await renderWith(
      of(mapProgressDashboard(contract(emptySections))),
    );

    expect(createMediaAccessBatch).not.toHaveBeenCalled();
  });

  /**
   * Without a grant the browser would request bytes it cannot have and draw a broken tile. The
   * figures are still worth showing, so the dashboard renders and the previews say so instead.
   */
  it('leaves previews unbound rather than requesting bytes it has no grant for', async () => {
    const { host } = await renderWith(of(mapProgressDashboard(contract())), {
      createMediaAccessBatch: vi.fn(() => throwError(() => new Error('denied'))) as never,
    });

    expect(host.querySelectorAll('img.thumbnail')).toHaveLength(0);
    expect(host.textContent).toContain('Preview unavailable');
    // The rest of the dashboard is unaffected: a missing preview is not a failed dashboard.
    expect(host.textContent).toContain('Logged on 6 of the last 7 days');
  });

  it('ignores a grant response that resolves after the workspace has reloaded', async () => {
    const oldGrant = new Subject<{ items: { assetId: string }[] }>();
    const current = mapProgressDashboard(
      contract({
        photos: {
          poses: [
            {
              pose: 'Side',
              photos: [
                {
                  id: 'photo-current',
                  photoDate: '2026-08-22',
                  pose: 'Side',
                  mediaAssetId: 'asset-current',
                  thumbnailUrl: '/api/media/asset-current/content/thumbnail',
                },
              ],
            },
          ],
          photoCount: '1',
          missingThumbnailCount: '0',
          previewPhotoCount: '1',
        },
      }),
    );
    const getDashboard = vi
      .fn()
      .mockReturnValueOnce(of(mapProgressDashboard(contract())))
      .mockReturnValueOnce(of(current));
    const createMediaAccessBatch = vi
      .fn()
      .mockReturnValueOnce(oldGrant)
      .mockReturnValueOnce(of({ items: [{ assetId: 'asset-current' }] }));
    const rendered = await renderWith(of(current), {
      getMyProgressDashboard: getDashboard as never,
      createMediaAccessBatch: createMediaAccessBatch as never,
    });

    rendered.selectedTenantId.set('tenant-2');
    await settle(rendered.fixture);
    oldGrant.next({ items: [{ assetId: 'asset-1' }] });
    oldGrant.complete();
    await settle(rendered.fixture);

    const images = [...rendered.host.querySelectorAll<HTMLImageElement>('img.thumbnail')];
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute('src')).toContain('asset-current');
    expect(rendered.host.textContent).toContain('Side');
  });

  it('says how many photos the bounded preview left out', async () => {
    const host = await render(
      of(
        mapProgressDashboard(
          contract({
            photos: {
              poses: [
                {
                  pose: 'Front',
                  photos: [
                    {
                      id: 'photo-1',
                      photoDate: '2026-08-22',
                      pose: 'Front',
                      mediaAssetId: 'asset-1',
                      thumbnailUrl: '/api/media/asset-1/content/thumbnail',
                    },
                  ],
                },
              ],
              // 23 in the window, 1 previewed: the difference is stated rather than a truncated
              // strip being presented as the whole period.
              photoCount: '23',
              missingThumbnailCount: '0',
              previewPhotoCount: '1',
            },
          }),
        ),
      ),
    );

    expect(host.textContent).toContain('Showing the most recent 1 of 23 photos');
  });

  it('names only the assets that carry a rendition', () => {
    expect(previewAssetIds(mapProgressDashboard(contract()))).toEqual(['asset-1']);
    expect(previewAssetIds(mapProgressDashboard(contract(emptySections)))).toEqual([]);
  });
});
