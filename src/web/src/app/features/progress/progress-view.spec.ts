import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { MediaAccessView } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ProgressView } from './progress-view';
import type { ProgressPhoto } from './progress.models';

interface ProgressPhotoHarness {
  openPhoto(photo: ProgressPhoto): Promise<void>;
  showFullSize(): void;
  closePhoto(): void;
  openPhotoUrl(): string | null;
  showingThumbnail(): boolean;
}

const photo: ProgressPhoto = {
  id: 'photo-1',
  photoDate: '2026-08-22',
  pose: 'Front',
  mediaAssetId: 'asset-1',
  status: 'Active',
  source: 'Client',
  version: 3,
};

const access: MediaAccessView = {
  assetId: 'asset-1',
  kind: 'Image',
  source: 'Upload',
  contentType: 'image/jpeg',
  url: '/api/media/asset-1/content',
  expiresAtUtc: '2026-08-22T08:30:00Z',
  downloadAllowed: false,
  thumbnailUrl: '/api/media/asset-1/content/thumbnail',
};

async function createHarness(
  granted: MediaAccessView,
): Promise<{ harness: ProgressPhotoHarness; createMediaAccess: ReturnType<typeof vi.fn> }> {
  const createMediaAccess = vi.fn(() => of(granted));
  await TestBed.configureTestingModule({
    imports: [ProgressView],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          createMediaAccess,
          getMyProgress: () => of(null),
          getMyBodyMeasurements: () => of(null),
          getMyProgressPhotos: () => of(null),
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ProgressView);
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve));
  return {
    harness: fixture.componentInstance as unknown as ProgressPhotoHarness,
    createMediaAccess,
  };
}

describe('ProgressView progress photo thumbnails', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('opens the preview first and swaps to full size without asking for a second grant', async () => {
    const { harness, createMediaAccess } = await createHarness(access);

    await harness.openPhoto(photo);
    // Opening shows the downscaled rendition, so the full-resolution bytes of a health-adjacent
    // image are not transferred until the viewer deliberately asks for them.
    expect(harness.showingThumbnail()).toBe(true);
    expect(harness.openPhotoUrl()).toBe('/api/media/asset-1/content/thumbnail');

    harness.showFullSize();
    expect(harness.openPhotoUrl()).toBe('/api/media/asset-1/content');
    expect(harness.showingThumbnail()).toBe(false);
    // One access call covered both variants.
    expect(createMediaAccess).toHaveBeenCalledTimes(1);

    // Closing resets the request, so the next photo opens at preview size again.
    harness.closePhoto();
    expect(harness.openPhotoUrl()).toBeNull();
    expect(harness.showingThumbnail()).toBe(false);
    await harness.openPhoto(photo);
    expect(harness.showingThumbnail()).toBe(true);
  });

  it('falls back to the full image when a photo has no thumbnail rendition', async () => {
    const { harness } = await createHarness({ ...access, thumbnailUrl: null });

    await harness.openPhoto(photo);
    // Nothing smaller exists, so the photo is already at full resolution and must not offer to
    // load a full size it is showing.
    expect(harness.openPhotoUrl()).toBe('/api/media/asset-1/content');
    expect(harness.showingThumbnail()).toBe(false);
  });
});

describe('ProgressView starting units', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  interface UnitHarness {
    displayUnit: string;
    entryUnit: string;
    correctionUnit: string;
  }

  async function render(
    clientId: string | null,
  ): Promise<{ units: UnitHarness; getProgress: ReturnType<typeof vi.fn> }> {
    const getProgress = vi.fn(() => of(null));
    await TestBed.configureTestingModule({
      imports: [ProgressView],
      providers: [
        {
          provide: ApiClient,
          useValue: {
            getMyProgress: getProgress,
            getClientProgress: getProgress,
            getMyBodyMeasurements: () => of(null),
            getClientBodyMeasurements: () => of(null),
            getMyProgressPhotos: () => of(null),
            getClientProgressPhotos: () => of(null),
          },
        },
        { provide: AuthStore, useValue: { weightUnit: signal('Pound') } },
        { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
        { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProgressView);
    if (clientId) fixture.componentRef.setInput('clientId', clientId);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    return { units: fixture.componentInstance as unknown as UnitHarness, getProgress };
  }

  it('starts a client’s own page in the unit they saved in Me, for the chart, a new weigh-in and a correction', async () => {
    const { units, getProgress } = await render(null);

    expect([units.displayUnit, units.entryUnit, units.correctionUnit]).toEqual([
      'Pound',
      'Pound',
      'Pound',
    ]);
    expect(getProgress).toHaveBeenCalledWith('Pound');
  });

  it('starts a coach reading a client’s page in kilograms, whatever the coach saved', async () => {
    const { units, getProgress } = await render('client-9');

    expect([units.displayUnit, units.entryUnit, units.correctionUnit]).toEqual([
      'Kilogram',
      'Kilogram',
      'Kilogram',
    ]);
    expect(getProgress).toHaveBeenCalledWith('client-9', 'Kilogram');
  });
});
