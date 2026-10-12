import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { press, query, settle } from '../../../testing/dom';
import { mayaPhotos, photo, photosView } from '../../../testing/progress-fixtures';
import { photoExport } from '../../../testing/share-card-fixtures';
import { fakeShareCardMaker } from '../../../testing/share-card-maker-fake';
import type { ProgressPhoto } from '../progress/progress.models';
import { BeforeAfterSheet } from './before-after-sheet';
import { ShareCardMaker } from './share-card-maker';

/** What the server grants for a list of assets: the full picture and its small version. */
function granted(ids: readonly string[]) {
  return of({
    items: ids.map((assetId) => ({
      assetId,
      kind: 'Image',
      source: 'Upload',
      contentType: 'image/jpeg',
      url: `/api/media/${assetId}/content`,
      expiresAtUtc: '2026-10-10T10:00:00Z',
      downloadAllowed: false,
      thumbnailUrl: `/api/media/${assetId}/content/thumbnail`,
    })),
  });
}

interface Options {
  photos?: () => ProgressPhoto[];
  read?: ReturnType<typeof vi.fn>;
  exportPhotos?: ReturnType<typeof vi.fn>;
  grant?: ReturnType<typeof vi.fn>;
}

async function render(options: Options = {}) {
  const photos = options.photos ?? mayaPhotos;
  const api = {
    getMyProgressPhotos: options.read ?? vi.fn(() => of(photosView(photos()))),
    createMediaAccessBatch: options.grant ?? vi.fn((ids: readonly string[]) => granted(ids)),
    exportMyProgressPhotos: options.exportPhotos ?? vi.fn(() => of(photoExport())),
  };
  const csrf = { refresh: vi.fn(() => Promise.resolve()) };
  const maker = fakeShareCardMaker();
  TestBed.configureTestingModule({
    imports: [BeforeAfterSheet],
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: CsrfService, useValue: csrf },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      { provide: ShareCardMaker, useValue: maker },
    ],
  });
  const fixture = TestBed.createComponent(BeforeAfterSheet);
  await settle(fixture);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, csrf, maker };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const heading = (host: HTMLElement) => textOf(host.querySelector('[data-step-heading]'));
const slot = (host: HTMLElement, side: 'before' | 'after') =>
  query<HTMLButtonElement>(host, `[data-slot="${side}"]`);
const tiles = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('.tile')).map((tile) => ({
    date: textOf(tile.querySelector('.tile-date')),
    chosen: tile.getAttribute('aria-pressed') === 'true',
    disabled: tile.disabled,
  }));

describe('BeforeAfterSheet', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('starts at the first and latest photo of a pose, reading every year back to the first', async () => {
    const read = vi
      .fn()
      .mockReturnValueOnce(of({ ...photosView(mayaPhotos()), earlierDate: '2025-06-01' }))
      .mockReturnValueOnce(
        of({
          ...photosView([photo({ photoDate: '2025-06-01' })]),
          earlierDate: null,
        }),
      );
    const { host, api } = await render({ read });

    expect(read.mock.calls).toEqual([[], ['2024-06-01', '2025-06-02']]);
    expect(heading(host)).toBe('Choose your photos');
    // One pose has two days, so there is nothing to choose between poses.
    expect(host.querySelector('app-segmented-control')).toBeNull();
    expect(textOf(slot(host, 'before'))).toBe('Before Sun 1 Jun 2025, Change');
    expect(textOf(slot(host, 'after'))).toBe('After Sat 3 Oct 2026, Change');
    expect(textOf(host.querySelector('.apart'))).toBe('16 months between them');
    // The small versions of the pose's photos, granted together; the removed side photo is not.
    expect(api.createMediaAccessBatch).toHaveBeenCalledWith([
      'asset-Front-2025-06-01',
      'asset-Front-2026-09-05',
      'asset-Front-2026-10-03',
    ]);
    expect(slot(host, 'before').querySelector('img')!.getAttribute('src')).toBe(
      '/api/media/asset-Front-2025-06-01/content/thumbnail',
    );
  });

  it('changes one side from the pose’s photos, keeping the before earlier than the after', async () => {
    const { fixture, host } = await render({
      photos: () => [
        photo({ photoDate: '2026-07-04' }),
        photo({ photoDate: '2026-09-05' }),
        photo({ photoDate: '2026-10-03' }),
      ],
    });

    slot(host, 'before').click();
    await settle(fixture);
    expect(heading(host)).toBe('Choose your before photo');
    expect(textOf(host.querySelector('.hint'))).toBe(
      'It must be earlier than your after photo, Sat 3 Oct 2026.',
    );
    expect(tiles(host)).toEqual([
      { date: 'Sat 4 Jul 2026', chosen: true, disabled: false },
      { date: 'Sat 5 Sep 2026', chosen: false, disabled: false },
      { date: 'Sat 3 Oct 2026', chosen: false, disabled: true },
    ]);

    query<HTMLButtonElement>(host, '[data-photo="photo-Front-2026-09-05"]').click();
    await settle(fixture);
    expect(heading(host)).toBe('Choose your photos');
    expect(textOf(slot(host, 'before'))).toContain('Sat 5 Sep 2026');
    expect(document.activeElement).toBe(slot(host, 'before'));

    slot(host, 'after').click();
    await settle(fixture);
    expect(tiles(host).map((tile) => tile.disabled)).toEqual([true, true, false]);
    press(host, 'Back');
    await settle(fixture);
    expect(textOf(slot(host, 'after'))).toContain('Sat 3 Oct 2026');
  });

  it('chooses between poses when several have two days', async () => {
    const { fixture, host, api } = await render({
      photos: () => [...mayaPhotos(), photo({ pose: 'Back', photoDate: '2026-08-01' })],
    });
    const choices = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(choices.map((choice) => textOf(choice.closest('label')))).toEqual(['Front', 'Back']);

    choices[1].click();
    await settle(fixture);
    expect(textOf(slot(host, 'before'))).toContain('Sat 1 Aug 2026');
    expect(textOf(slot(host, 'after'))).toContain('Sat 3 Oct 2026');
    expect(api.createMediaAccessBatch).toHaveBeenLastCalledWith([
      'asset-Back-2026-08-01',
      'asset-Back-2026-10-03',
    ]);
  });

  it('names both photos and their dates first, then records the export before anything is made', async () => {
    const { fixture, host, api, csrf, maker } = await render();

    press(host, 'Use these photos');
    await settle(fixture);
    expect(heading(host)).toBe('Make this before and after?');
    expect(Array.from(host.querySelectorAll('.named li')).map(textOf)).toEqual([
      'Before Front photo, 5 September 2026',
      'After Front photo, 3 October 2026',
    ]);
    expect(textOf(host.querySelector('.note'))).toBe(
      'The picture is made on this device. TB Gym keeps a note that you made it, with these two ' +
        'photos and the time, but never the picture. Nothing is posted for you.',
    );
    // Seeing the confirmation sends nothing and makes nothing.
    expect(api.exportMyProgressPhotos).not.toHaveBeenCalled();
    expect(maker.make).not.toHaveBeenCalled();

    press(host, 'Make the picture');
    await settle(fixture);
    await settle(fixture);
    expect(api.exportMyProgressPhotos).toHaveBeenCalledExactlyOnceWith({
      beforePhotoId: 'photo-Front-2026-09-05',
      afterPhotoId: 'photo-Front-2026-10-03',
    });
    // The record is asked for with a fresh token, and the full pictures only after it was kept.
    const recorded = api.exportMyProgressPhotos.mock.invocationCallOrder[0];
    expect(csrf.refresh.mock.invocationCallOrder.some((order) => order < recorded)).toBe(true);
    expect(api.createMediaAccessBatch).toHaveBeenLastCalledWith([
      'asset-Front-2026-09-05',
      'asset-Front-2026-10-03',
    ]);
    expect(api.createMediaAccessBatch.mock.invocationCallOrder.at(-1)!).toBeGreaterThan(recorded);

    expect(heading(host)).toBe('Your before and after');
    expect(query<HTMLImageElement>(host, '.preview img').getAttribute('src')).toBe(
      'data:image/png;base64,eA==#photos-export-1',
    );
    expect(maker.make).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        kind: 'photos',
        headline: '4 weeks',
        photos: {
          before: { label: 'Before', imageUrl: '/api/media/asset-Front-2026-09-05/content' },
          after: { label: 'After', imageUrl: '/api/media/asset-Front-2026-10-03/content' },
        },
      }),
    );
  });

  it('a photo removed meanwhile is refused: the photos are read again and nothing is made', async () => {
    let photos = [...mayaPhotos(), photo({ photoDate: '2026-07-04' })];
    const exportPhotos = vi.fn(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { code: 'ProgressPhotoRemoved', title: 'A removed photo cannot be used.' },
          }),
      ),
    );
    const { fixture, host, api, maker } = await render({ photos: () => photos, exportPhotos });
    press(host, 'Use these photos');
    await settle(fixture);
    photos = photos.map((item) =>
      item.photoDate === '2026-10-03' && item.pose === 'Front'
        ? { ...item, status: 'Removed' as const }
        : item,
    );

    press(host, 'Make the picture');
    await settle(fixture);
    await settle(fixture);
    expect(heading(host)).toBe('Choose your photos');
    expect(textOf(host.querySelector('.problem[role="alert"]'))).toBe(
      'One of these photos can no longer be used. Choose again.',
    );
    expect(api.getMyProgressPhotos).toHaveBeenCalledTimes(2);
    expect(textOf(slot(host, 'after'))).toContain('Sat 5 Sep 2026');
    expect(maker.make).not.toHaveBeenCalled();
  });

  it('records a confirmed pair once, even when its pictures need a second try', async () => {
    const grant = vi
      .fn()
      .mockImplementationOnce((ids: readonly string[]) => granted(ids))
      .mockImplementationOnce(() =>
        throwError(() => new HttpErrorResponse({ status: 503, error: {} })),
      )
      .mockImplementation((ids: readonly string[]) => granted(ids));
    const { fixture, host, api } = await render({ grant });
    press(host, 'Use these photos');
    await settle(fixture);

    press(host, 'Make the picture');
    await settle(fixture);
    expect(heading(host)).toBe('Make this before and after?');
    expect(textOf(host.querySelector('.problem[role="alert"]'))).not.toBe('');

    press(host, 'Make the picture');
    await settle(fixture);
    await settle(fixture);
    expect(heading(host)).toBe('Your before and after');
    expect(api.exportMyProgressPhotos).toHaveBeenCalledTimes(1);
  });

  it('remembers nothing: every picture made is its own export', async () => {
    const { fixture, host, api } = await render({
      photos: () => [...mayaPhotos(), photo({ photoDate: '2026-07-04' })],
    });
    const make = async () => {
      press(host, 'Use these photos');
      await settle(fixture);
      press(host, 'Make the picture');
      await settle(fixture);
      await settle(fixture);
    };
    // The first and the latest, recorded and made.
    await make();
    expect(heading(host)).toBe('Your before and after');

    // Other photos are another export.
    press(host, 'Use other photos');
    await settle(fixture);
    expect(heading(host)).toBe('Choose your photos');
    slot(host, 'before').click();
    await settle(fixture);
    query<HTMLButtonElement>(host, '[data-photo="photo-Front-2026-09-05"]').click();
    await settle(fixture);
    await make();

    // And the same two again are one more: each picture made is recorded.
    press(host, 'Use other photos');
    await settle(fixture);
    await make();
    expect(api.exportMyProgressPhotos.mock.calls).toEqual([
      [{ beforePhotoId: 'photo-Front-2026-07-04', afterPhotoId: 'photo-Front-2026-10-03' }],
      [{ beforePhotoId: 'photo-Front-2026-09-05', afterPhotoId: 'photo-Front-2026-10-03' }],
      [{ beforePhotoId: 'photo-Front-2026-09-05', afterPhotoId: 'photo-Front-2026-10-03' }],
    ]);
  });

  it('says what is needed when no pose has photos on two days', async () => {
    const { host } = await render({
      photos: () => [photo({ photoDate: '2026-10-03' }), photo({ pose: 'Side' })],
    });
    expect(heading(host)).toBe('Two photos of one pose are needed');
    expect(host.querySelector('[data-slot]')).toBeNull();
  });

  it('says when the photos could not be read, and reads them again on request', async () => {
    const read = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
      .mockReturnValue(of(photosView(mayaPhotos())));
    const { fixture, host } = await render({ read });
    expect(textOf(host.querySelector('.state[role="alert"] p'))).toBe(
      'Your photos couldn’t be loaded.',
    );
    press(host, 'Try again');
    await settle(fixture);
    expect(heading(host)).toBe('Choose your photos');
  });
});
