import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { ExerciseSearchResult } from '../../core/api/generated';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import {
  exercise,
  type LibraryQuery,
  LIBRARY,
  searchLibrary,
} from '../../../testing/program-builder-fixtures';
import { libraryExercise } from './program-builder.models';
import { ProgramLibrarySource } from './program-library-source';

/** A workspace's library of 150 lifts, 40 with a picture, beside the small one of the fixtures. */
const BIG = [
  ...LIBRARY,
  ...Array.from({ length: 150 }, (_, index) =>
    exercise(`lift-${index + 1}`, `Lift ${String(index + 1).padStart(3, '0')}`, {
      mediaAssetIds: index < 40 ? [`media-${index + 1}`, `video-${index + 1}`] : [],
    }),
  ),
  exercise('retired', 'Retired lift', { isArchived: true }),
];

function fakeApi() {
  const search = searchLibrary(BIG);
  return {
    getTenants: () => of(['A', 'B'].map((tenantId) => ({ tenantId, role: 'Owner' }))),
    searchExercises: vi.fn((query: LibraryQuery) => search(query)),
    listSavedSessions: vi.fn(() => of([])),
    // Every picture is an image; a video id comes back as a video, which keeps the tile's letters.
    createMediaAccessBatch: vi.fn((ids: readonly string[]) =>
      of({
        items: ids.map((assetId) => ({
          assetId,
          kind: assetId.startsWith('video') ? 'Video' : 'Image',
          source: 'Upload',
          contentType: 'image/webp',
          url: `/media/${assetId}`,
          thumbnailUrl: `/media/${assetId}/thumb`,
          expiresAtUtc: '2026-10-21T12:00:00Z',
          downloadAllowed: false,
        })),
      }),
    ),
  };
}

@Component({ template: '' })
class SourceHarness {
  readonly tenants = inject(TenantStore);
  readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  readonly freshToken = vi.fn(() => Promise.resolve());
  readonly source = new ProgramLibrarySource(inject(ApiClient), this.scope, this.freshToken);
}

describe('the program library source (WEA-14)', () => {
  let api: ReturnType<typeof fakeApi>;

  beforeEach(async () => {
    localStorage.clear();
    api = fakeApi();
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }] });
    await TestBed.inject(TenantStore).load('A');
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  function setup() {
    const fixture = TestBed.createComponent(SourceHarness);
    fixture.detectChanges();
    return { harness: fixture.componentInstance, tenants: TestBed.inject(TenantStore) };
  }

  it('reads one page and the chips’ counts once, and knows what it read', async () => {
    const { harness } = setup();
    await harness.source.load();

    expect(api.searchExercises.mock.calls).toEqual([[{ take: 48, patterns: true }]]);
    const first = harness.source.first();
    expect([first?.items.length, first?.total]).toEqual([48, 155]);
    expect(harness.source.state()).toBe('ready');
    expect(harness.source.known().size).toBe(48);
    expect(harness.source.patterns()).toContainEqual({ pattern: 'Squat', count: 152 });
    expect(api.listSavedSessions).toHaveBeenCalledTimes(1);
  });

  it('reads by id only lifts it has not read or asked for, a hundred at a time', async () => {
    const { harness } = setup();
    await harness.source.load();
    const ids = Array.from({ length: 150 }, (_, index) => `lift-${index + 1}`);

    await harness.source.ensure([...ids, 'squat', 'retired', 'lift-1']);
    // The first page held four of the fixtures' lifts and lifts 1 to 44: 106 lifts and the
    // archived one remain.
    const byId = api.searchExercises.mock.calls.slice(1).map(([query]) => query.ids?.length);
    expect(byId).toEqual([100, 7]);
    expect(harness.source.known().has('lift-150')).toBe(true);
    expect(harness.source.known().has('retired')).toBe(false);

    // Asked once, answered or archived: never asked again.
    await harness.source.ensure([...ids, 'retired']);
    expect(api.searchExercises).toHaveBeenCalledTimes(3);
  });

  it('says a lift it could not read by id, and reads it again with the library', async () => {
    const { harness } = setup();
    await harness.source.load();
    api.searchExercises.mockImplementationOnce(() => throwError(() => new Error('offline')));

    await harness.source.ensure(['lift-120']);
    // The panel says the library could not be loaded; its Try again reads the library again.
    expect(harness.source.state()).toBe('error');
    await harness.source.ensure(['lift-120']);
    expect(api.searchExercises).toHaveBeenCalledTimes(2);
    expect(harness.source.known().has('lift-120')).toBe(false);

    await harness.source.load();
    expect(harness.source.state()).toBe('ready');
    await harness.source.ensure(['lift-120']);
    expect(api.searchExercises).toHaveBeenLastCalledWith({ ids: ['lift-120'], take: 100 });
    expect(harness.source.known().has('lift-120')).toBe(true);
  });

  it('grants each first picture once, 32 to a request, and keeps a video’s letters', async () => {
    const { harness } = setup();
    await harness.source.load();
    const rows = harness.source.first()!.items;

    await harness.source.grant(rows);
    await harness.source.grant(rows);
    const grants = api.createMediaAccessBatch.mock.calls.map(([ids]) => ids.length);
    // Lifts 1 to 40 and the fixtures' chest-supported row have a picture: 41 on the page.
    expect(grants).toEqual([32, 9]);
    expect(harness.freshToken).toHaveBeenCalledTimes(1);
    expect(harness.source.thumbs().get('media-1')).toBe('/media/media-1/thumb');

    const video = libraryExercise(exercise('clip', 'Clip', { mediaAssetIds: ['video-9'] }));
    await harness.source.grant([video]);
    expect(harness.source.thumbs().has('video-9')).toBe(false);
  });

  it('grants at most 96 pictures a visit, and asks again for those a failed request left', async () => {
    const { harness } = setup();
    await harness.source.load();
    const many = Array.from({ length: 120 }, (_, index) =>
      libraryExercise(
        exercise(`pic-${index}`, `Pic ${index}`, { mediaAssetIds: [`photo-${index}`] }),
      ),
    );
    // The first request fails: nothing is granted, and those pictures may be asked for again.
    api.createMediaAccessBatch.mockImplementationOnce(() => throwError(() => new Error('offline')));
    await harness.source.grant(many.slice(0, 10));
    expect(harness.source.thumbs().size).toBe(0);

    await harness.source.grant(many);
    const asked = api.createMediaAccessBatch.mock.calls.slice(1).flatMap(([ids]) => [...ids]);
    expect(asked).toHaveLength(96);
    expect(asked).toContain('photo-0');
    expect(harness.source.thumbs().size).toBe(96);
    await harness.source.grant(many.slice(100));
    expect(
      api.createMediaAccessBatch.mock.calls.slice(1).flatMap(([ids]) => [...ids]),
    ).toHaveLength(96);
  });

  it('forgets everything on a workspace switch and drops an answer meant for the one before', async () => {
    const { harness, tenants } = setup();
    await harness.source.load();
    const before = harness.source.generation();
    const late = new Subject<ExerciseSearchResult>();
    api.searchExercises.mockImplementationOnce(() => late);
    const answer = harness.source.search('panel', { query: 'lift', group: 'all' }, 0);

    tenants.select('B');
    expect(harness.source.first()).toBeNull();
    expect(harness.source.known().size).toBe(0);
    expect(harness.source.state()).toBe('loading');
    expect(harness.source.generation()).toBeGreaterThan(before);

    late.next({ total: 1, items: [exercise('theirs', 'Their lift')], patterns: [] });
    late.complete();
    expect(await answer).toBeNull();
    expect(harness.source.known().has('theirs')).toBe(false);
  });
});
