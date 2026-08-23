import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { MediaAccessView } from '../../core/api/generated';
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
      { provide: ApiClient, useValue: { createMediaAccess } },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      // No selected tenant, so the load effect stays inert and only photo state is exercised.
      { provide: TenantStore, useValue: { selectedTenantId: signal(null) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ProgressView);
  fixture.detectChanges();
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
