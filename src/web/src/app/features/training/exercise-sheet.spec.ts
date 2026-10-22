import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, expect, it, vi } from 'vitest';
import type { ExerciseSearchResult, ExerciseView, MediaAssetView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { asset, exercise, results } from '../../../testing/exercise-fixtures';
import { chooseOption, formSummary, settle } from '../../../testing/dom';
import { ExerciseLibraryApi } from './exercise-library-api';
import { ExerciseSheet } from './exercise-sheet';
import { mediaLine, type ExerciseValues } from './exercise-library.models';

async function render() {
  const tenant = signal('tenant-a');
  const csrf = { refresh: vi.fn(() => Promise.resolve()) };
  const api = {
    search: vi.fn<ExerciseLibraryApi['search']>(() => of(results([]))),
    get: vi.fn((id: string) => of(exercise('Selected', { id }))),
    listMedia: vi.fn(() => of({ items: [], total: 0 })),
    create: vi.fn(() => of(exercise('Saved'))),
    update: vi.fn(() => of(exercise('Saved'))),
    registerVideoLink: vi.fn(() => of(asset({}))),
    uploadMedia: vi.fn(() => of(asset({}))),
    deleteMedia: vi.fn(() => of(asset({ status: 'Tombstoned' }))),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: TenantStore, useValue: { selectedTenantId: tenant } },
      { provide: CsrfService, useValue: csrf },
      { provide: ExerciseLibraryApi, useValue: api },
    ],
  });
  const fixture = TestBed.createComponent(ExerciseSheet);
  await settle(fixture);
  const sheet = fixture.componentInstance as unknown as {
    set(change: Partial<ExerciseValues>): void;
    submit(): Promise<void>;
    upload(event: Event): Promise<void>;
    deleteMedia(media: MediaAssetView): Promise<void>;
    searchAlternatives(query: string): void;
    loadAlternatives(more?: boolean): Promise<void>;
    shownOthers(): ExerciseView[];
  };
  sheet.set({ name: 'Hip thrust' });
  return { fixture, sheet, api, csrf, tenant };
}

afterEach(() => TestBed.resetTestingModule());

it('says a video link opens on its own site from the workout, not that it plays there', async () => {
  const { fixture, sheet } = await render();
  const shown = () =>
    ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');

  // C18 (audit WEA-2): a link is opened on YouTube or Vimeo; only an upload plays inside TB Gym.
  expect(shown()).toContain(
    'Paste a YouTube or Vimeo link. Clients open it on that site from their workout.',
  );
  sheet.set({ videoLink: 'https://vimeo.com/76979871' });
  await settle(fixture);
  expect(shown()).toContain('Vimeo video found. Clients open it on Vimeo from their workout.');
  expect(shown()).not.toContain('Clients see it in their workout');
});

it('does not dispatch the exercise write after an obsolete video-registration reply', async () => {
  const { sheet, api, tenant } = await render();
  const pending = new Subject<MediaAssetView>();
  api.registerVideoLink.mockReturnValue(pending);
  sheet.set({ videoLink: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  const saving = sheet.submit();
  await Promise.resolve();
  await Promise.resolve();
  TestBed.inject(TenantContext).invalidate();
  tenant.set('tenant-b');
  pending.next(asset({ id: 'old-video' }));
  pending.complete();
  await saving;
  expect(api.registerVideoLink).toHaveBeenCalledOnce();
  expect(api.create).not.toHaveBeenCalled();
  expect(api.update).not.toHaveBeenCalled();
});

it.each(['upload', 'delete'] as const)(
  'does not dispatch %s after destruction during CSRF refresh',
  async (kind) => {
    const { sheet, fixture, api, csrf } = await render();
    let resolve!: () => void;
    csrf.refresh.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    const pending =
      kind === 'delete'
        ? sheet.deleteMedia(asset({}))
        : sheet.upload({
            target: {
              files: { item: () => new File(['bytes'], 'demo.png', { type: 'image/png' }) },
              value: '',
            },
          } as unknown as Event);
    fixture.destroy();
    resolve();
    await pending;
    expect(api.uploadMedia).not.toHaveBeenCalled();
    expect(api.deleteMedia).not.toHaveBeenCalled();
  },
);

it('ignores a superseded server search reply', async () => {
  const { sheet, api, fixture } = await render();
  const old = new Subject<ExerciseSearchResult>();
  api.search
    .mockReturnValueOnce(old)
    .mockReturnValueOnce(of({ ...results([exercise('Far result')]), total: 101 }));
  sheet.searchAlternatives('old');
  sheet.searchAlternatives('far');
  await settle(fixture);
  old.next(results([exercise('Obsolete')]));
  old.complete();
  await settle(fixture);
  expect(sheet.shownOthers().map((row) => row.name)).toEqual(['Far result']);
  api.search.mockReturnValue(of({ ...results([exercise('Beyond first 100')]), total: 101 }));
  await sheet.loadAlternatives(true);
  expect(api.search).toHaveBeenLastCalledWith({ query: 'far', skip: 1, take: 25 });
  expect(sheet.shownOthers().map((row) => row.name)).toContain('Beyond first 100');
});

it('reaches exercise 101 through bounded server pages', async () => {
  const { sheet, api } = await render();
  api.search.mockImplementation(({ skip = 0 }) =>
    of({
      ...results(
        Array.from({ length: Math.min(25, 101 - skip) }, (_, offset) => {
          const index = skip + offset + 1;
          return exercise(`Swap ${index}`, { id: `swap-${index}` });
        }),
      ),
      total: 101,
    }),
  );
  await sheet.loadAlternatives();
  for (let page = 1; page <= 4; page++) await sheet.loadAlternatives(true);
  expect(api.search).toHaveBeenLastCalledWith({ query: '', skip: 100, take: 25 });
  expect(sheet.shownOthers()).toHaveLength(101);
  expect(sheet.shownOthers().some((row) => row.id === 'swap-101')).toBe(true);
});

it('reads the exercise again after a stale save, shows what was saved, and saves with its version (WEA-3)', async () => {
  const { fixture, api } = await render();
  const opened = exercise('Back Squat', { id: 'ex-squat', version: 3 });
  fixture.componentRef.setInput('exercise', opened);
  await settle(fixture);
  const sheet = fixture.componentInstance as unknown as {
    set(change: Partial<ExerciseValues>): void;
    submit(): Promise<void>;
    values(): ExerciseValues;
    error(): string | null;
  };
  const dirty: boolean[] = [];
  const reloaded: unknown[] = [];
  fixture.componentInstance.dirtyChange.subscribe((value) => dirty.push(value));
  fixture.componentInstance.reloaded.subscribe(() => reloaded.push(true));
  api.update.mockReturnValueOnce(
    throwError(
      () => new HttpErrorResponse({ status: 409, error: { code: 'concurrency_conflict' } }),
    ) as never,
  );
  api.get.mockReturnValueOnce(
    of(exercise('Back Squat (paused)', { id: 'ex-squat', version: 4 })) as never,
  );

  sheet.set({ name: 'Back Squat, high bar' });
  await sheet.submit();
  await settle(fixture);

  // Read again, as the sentence says, and the library behind reads again too.
  expect(api.get).toHaveBeenCalledWith('ex-squat');
  expect(sheet.error()).toBe(
    'Someone saved this exercise after you opened it. It now shows what they saved: make your change again.',
  );
  // Said in the sheet's summary, which takes focus.
  const summary = formSummary(fixture.nativeElement as HTMLElement);
  expect(summary.textContent?.trim()).toBe(sheet.error());
  expect(document.activeElement).toBe(summary);
  expect(sheet.values().name).toBe('Back Squat (paused)');
  expect(dirty.at(-1)).toBe(false);
  expect(reloaded).toHaveLength(1);

  // The next save carries the version just read, so it is not refused again.
  api.update.mockClear();
  sheet.set({ name: 'Back Squat, high bar' });
  await sheet.submit();
  expect(api.update).toHaveBeenCalledWith('ex-squat', expect.objectContaining({ version: 4 }));
});

it('takes its type and main muscle from their lists, the main muscle leaving the secondaries', async () => {
  const { fixture, sheet, api } = await render();
  const host = fixture.nativeElement as HTMLElement;
  sheet.set({ secondaryMuscles: ['Hamstrings', 'Glutes'] } as Partial<ExerciseValues>);
  await settle(fixture);

  await chooseOption(fixture, host, 'Type', 'Conditioning');
  await chooseOption(fixture, host, 'Main muscle', 'Hamstrings');
  await sheet.submit();

  expect(api.create).toHaveBeenCalledWith(
    expect.objectContaining({
      classification: 'Conditioning',
      muscles: [
        { muscle: 'Hamstrings', role: 'Primary' },
        { muscle: 'Glutes', role: 'Secondary' },
      ],
    }),
  );
});

it('names each video link by its address, so two links on one exercise read apart (TRAIN-7)', () => {
  const link = (provider: 'YouTube' | 'Vimeo', id: string | null) =>
    mediaLine(
      asset({
        source: 'ExternalEmbed',
        kind: 'Video',
        externalProvider: provider,
        externalMediaId: id,
      }),
    );
  expect(link('YouTube', 'dQw4w9WgXcQ')).toBe('YouTube link · youtu.be/dQw4w9WgXcQ');
  expect(link('YouTube', 'aBcDeFgHiJk')).toBe('YouTube link · youtu.be/aBcDeFgHiJk');
  expect(link('Vimeo', '76979871')).toBe('Vimeo link · vimeo.com/76979871');
  expect(link('YouTube', null)).toBe('Video link · YouTube');
  expect(mediaLine(asset({}))).toBe('Picture');
  expect(mediaLine(asset({ kind: 'Video' }))).toBe('Video');
});
