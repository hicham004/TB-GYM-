import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExerciseSearchResult } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, field, fill, formSummary, press, settle, tick } from '../../../testing/dom';
import {
  access,
  asset,
  BACK_SQUAT,
  BENCH_PRESS,
  exercise,
  PULL_UP,
  results,
} from '../../../testing/exercise-fixtures';
import { ExerciseLibrary } from './exercise-library';
import { ExerciseLibraryApi } from './exercise-library-api';
import { UnsavedWork } from '../../core/forms/unsaved-work';

type Api = { [K in keyof ExerciseLibraryApi]: ReturnType<typeof vi.fn> };

async function render(
  url = '/training/exercises',
  search: (query: Record<string, unknown>) => Observable<ExerciseSearchResult> = () =>
    of(results([BACK_SQUAT, BENCH_PRESS, PULL_UP])),
  overrides: Partial<Api> = {},
) {
  const api: Api = {
    search: vi.fn(search),
    get: vi.fn((id: string) => of(exercise('Selected swap', { id }))),
    create: vi.fn((request: { name: string }) => of(exercise(request.name))),
    update: vi.fn((id: string, request: { name: string }) =>
      of(exercise(request.name, { id, version: 4 })),
    ),
    setArchived: vi.fn((id: string, isArchived: boolean) =>
      of({ ...BACK_SQUAT, id, isArchived, version: 9 }),
    ),
    listMedia: vi.fn(() =>
      of({
        items: [
          asset({}),
          asset({
            id: 'm-bench-link',
            title: 'Bench demo',
            kind: 'Video',
            source: 'ExternalEmbed',
            externalProvider: 'YouTube',
            externalMediaId: 'dQw4w9WgXcQ',
          }),
        ],
        total: 2,
        skip: 0,
        take: 100,
      }),
    ),
    uploadMedia: vi.fn(() => of(asset({ id: 'm-new', title: 'New upload' }))),
    registerVideoLink: vi.fn(() =>
      of(asset({ id: 'm-link', kind: 'Video', source: 'ExternalEmbed' })),
    ),
    deleteMedia: vi.fn(() => of(asset({ status: 'Tombstoned' }))),
    grant: vi.fn(() => of({ items: [access({ assetId: 'm-squat-photo' })] })),
    ...overrides,
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'training/exercises', component: ExerciseLibrary }]),
      { provide: ExerciseLibraryApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, ExerciseLibrary);
  await settle(harness.fixture);
  return { harness, host: harness.routeNativeElement as HTMLElement, api };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const dialog = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};

const toast = () => textOf(document.querySelector('app-toast-host'));

const cards = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('.exercise'));

/** Chooses `item` from the menu whose button reads or is named `label`. */
async function choose(
  harness: RouterTestingHarness,
  host: HTMLElement,
  label: string,
  item: string,
) {
  const trigger = Array.from(host.querySelectorAll<HTMLButtonElement>('app-menu button')).find(
    (candidate) => candidate.getAttribute('aria-label') === label || textOf(candidate) === label,
  );
  if (!trigger) throw new Error(`No menu is named "${label}".`);
  trigger.click();
  await settle(harness.fixture);
  const choice = Array.from(host.querySelectorAll<HTMLButtonElement>('.panel .item')).find(
    (candidate) => textOf(candidate.querySelector('.item-title')) === item,
  );
  if (!choice) throw new Error(`The menu "${label}" has no "${item}".`);
  choice.click();
  await settle(harness.fixture);
}

const params = () => TestBed.inject(Router).routerState.snapshot.root.queryParams;

describe('the exercise library', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('protects a typed exercise across a session change and refresh, and unregisters on destroy', async () => {
    const { harness, host } = await render();
    const work = TestBed.inject(UnsavedWork);
    press(host, 'New exercise');
    await settle(harness.fixture);
    fill(dialog()!, 'Exercise name', 'Hip Thrust');
    await settle(harness.fixture);
    const refresh = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(refresh);
    expect(refresh.defaultPrevented).toBe(true);
    const leaving = work.confirmLeave();
    await settle(harness.fixture);
    press(dialog()!, 'Keep editing');
    await expect(leaving).resolves.toBe(false);
    expect(dialog()?.querySelector<HTMLInputElement>('input[name="exercise-name"]')?.value).toBe(
      'Hip Thrust',
    );
    harness.fixture.destroy();
    await expect(work.confirmLeave()).resolves.toBe(true);
  });

  it('drops a save closed during CSRF refresh before a workspace switch', async () => {
    const { harness, host, api } = await render();
    let resolve!: () => void;
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    vi.mocked(TestBed.inject(CsrfService).refresh).mockReturnValue(pending);
    press(host, 'New exercise');
    await settle(harness.fixture);
    fill(dialog()!, 'Exercise name', 'Hip Thrust');
    await settle(harness.fixture);
    press(dialog()!, 'Add exercise');
    await settle(harness.fixture);
    harness.fixture.destroy();
    (TestBed.inject(TenantStore).selectedTenantId as ReturnType<typeof signal<string>>).set(
      'tenant-2',
    );
    resolve();
    await pending;
    await Promise.resolve();
    expect(api.create).not.toHaveBeenCalled();
    expect(api.registerVideoLink).not.toHaveBeenCalled();
  });

  it('searches swaps on the server and retains an off-page selection across another search', async () => {
    const saved = exercise('Squat', {
      alternatives: [{ exerciseId: 'far-away', exerciseName: 'Selected swap', note: null }],
    });
    // A library of 40, so the swaps get a search box; the selected swap is on none of these pages.
    const firstPage = [
      saved,
      ...Array.from({ length: 12 }, (_, index) => exercise(`Lift ${index}`)),
    ];
    const { harness, host, api } = await render(undefined, (query) =>
      of(query['query'] === 'press' ? results([exercise('Bench press')]) : results(firstPage, 40)),
    );
    await choose(harness, host, 'More for Squat', 'Edit');
    const sheet = dialog()!;
    expect(sheet.textContent).toContain('Selected swap');
    fill(sheet, 'Find an exercise', 'press');
    await settle(harness.fixture);
    expect(api.search).toHaveBeenLastCalledWith({ query: 'press', skip: 0, take: 25 });
    // The box stays while a search empties the rows under it, with what was typed.
    expect(field(sheet, 'Find an exercise').value).toBe('press');
    expect(sheet.textContent).toContain('Bench press');
    expect(sheet.textContent).toContain('Selected swap');
    press(sheet, 'Save exercise');
    await settle(harness.fixture);
    expect(api.update).toHaveBeenCalledWith(
      saved.id,
      expect.objectContaining({
        alternatives: [expect.objectContaining({ exerciseId: 'far-away' })],
      }),
    );
  });

  it('shows each exercise as a card with what it trains, its type and its first picture or video', async () => {
    const { host, api } = await render();

    expect(textOf(host.querySelector('h1'))).toBe('Exercises');
    expect(textOf(host.querySelector('.lede'))).toBe('3 exercises');
    const [squat, bench, pullUp] = cards(host);
    expect(textOf(squat.querySelector('.name'))).toBe('Back Squat');
    expect(textOf(squat.querySelector('.detail'))).toBe('Quadriceps · Squat · Barbell');
    expect(textOf(squat.querySelector('.type'))).toBe('Strength');
    expect(textOf(squat.querySelector('.has-media'))).toBe('2 videos or pictures');
    expect(textOf(squat.querySelector('.tags'))).toBe('compound, knee-friendly');
    // Only pictures are granted, each card's first, in one batch, after the antiforgery token is read
    // (a grant is a POST, refused straight after sign-in without it). The media list says which
    // media is a video, which needs no grant to show as one.
    expect(api.grant).toHaveBeenCalledWith(['m-squat-photo']);
    const refresh = TestBed.inject(CsrfService).refresh as unknown as ReturnType<typeof vi.fn>;
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(api.grant.mock.invocationCallOrder[0]);
    expect(squat.querySelector('img')?.getAttribute('src')).toBe(
      '/api/media/m-squat-photo/content',
    );
    // A video link shows a play tile: pictures from other sites are not loaded.
    expect(textOf(bench.querySelector('.play'))).toBe('Video link');
    expect(bench.querySelector('img')).toBeNull();
    expect(textOf(pullUp.querySelector('.initials'))).toBe('PU');
    expect(pullUp.querySelector('.cover')?.getAttribute('data-tone')).toBe('pull');
  });

  it('keeps the lettered tiles when the pictures cannot be granted', async () => {
    const { host } = await render(undefined, undefined, {
      grant: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 503 }))),
    });
    expect(textOf(cards(host)[0].querySelector('.initials'))).toBe('BS');
  });

  it('reads its filters from the address and sends each to the server', async () => {
    const { host, api } = await render(
      '/training/exercises?muscle=Chest&pattern=nonsense&archived=1&q=press',
    );

    expect(api.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'press',
        muscle: 'Chest',
        movementPattern: null,
        includeArchived: true,
        skip: 0,
        take: 48,
      }),
    );
    expect(textOf(host.querySelector('.lede'))).toBe('3 exercises match');
    const chips = Array.from(host.querySelectorAll('.chips app-menu button'));
    expect(chips.map(textOf)).toEqual(['Muscle: Chest', 'Pattern', 'Type', 'Equipment']);
    expect(chips[0].classList).toContain('selected');
    expect(button(host, 'Archived too').getAttribute('aria-pressed')).toBe('true');
  });

  it('applies a chip at once and keeps it in the address; Any takes it off', async () => {
    const { harness, host, api } = await render();
    await choose(harness, host, 'Pattern', 'Hinge');

    expect(params()).toEqual({ pattern: 'Hinge' });
    expect(api.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ movementPattern: 'Hinge' }),
    );
    await choose(harness, host, 'Pattern: Hinge', 'Any');
    expect(params()).toEqual({});
  });

  it('searches a moment after typing stops, and Clear filters empties everything', async () => {
    const { harness, host } = await render('/training/exercises?equipment=Barbell');
    // Only the typing runs on fake timers: rendering and settling need real ones.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fill(host, 'Search exercises', 'squ');
      fill(host, 'Search exercises', 'squat');
      vi.advanceTimersByTime(300);
    } finally {
      vi.useRealTimers();
    }
    await settle(harness.fixture);
    expect(params()).toEqual({ equipment: 'Barbell', q: 'squat' });

    press(host, 'Clear filters');
    await settle(harness.fixture);
    expect(params()).toEqual({});
    expect(host.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe('');
  });

  it('switches between cards and a list without asking the server again', async () => {
    const { harness, host, api } = await render();
    press(host, 'List');
    await settle(harness.fixture);

    expect(params()).toEqual({ view: 'list' });
    expect(host.querySelector('.exercises')?.classList).toContain('as-list');
    expect(button(host, 'List').getAttribute('aria-pressed')).toBe('true');
    expect(api.search).toHaveBeenCalledTimes(1);
  });

  it('says what is missing, and offers the one action that fills it', async () => {
    const empty = await render(undefined, () => of(results([])));
    expect(textOf(empty.host.querySelector('app-empty-state h2'))).toBe(
      'Build your exercise library',
    );
    TestBed.resetTestingModule();

    const none = await render('/training/exercises?type=Mobility', () => of(results([])));
    expect(textOf(none.host.querySelector('app-empty-state h2'))).toBe('No exercise matches');
    press(none.host, 'Show all exercises');
    await settle(none.harness.fixture);
    expect(params()).toEqual({});
  });

  it('says so when the library cannot be loaded, and tries again', async () => {
    let fail = true;
    const { harness, host, api } = await render(undefined, () =>
      fail ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(results([PULL_UP])),
    );
    expect(textOf(host.querySelector('[role="alert"]'))).toBe(
      'Your exercises could not be loaded.',
    );
    fail = false;
    press(host, 'Try again');
    await settle(harness.fixture);
    expect(api.search).toHaveBeenCalledTimes(2);
    expect(cards(host)).toHaveLength(1);
  });

  it('shows more on request, with the server’s count', async () => {
    const page = Array.from({ length: 48 }, (_, index) => exercise(`Move ${index}`));
    const { harness, host, api } = await render(undefined, (query) =>
      of(results(query['skip'] === 0 ? page : [PULL_UP], 49)),
    );
    expect(textOf(host.querySelector('.lede'))).toBe('48 of 49 shown');
    press(host, 'Show more exercises');
    await settle(harness.fixture);
    expect(api.search).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 48 }));
    expect(cards(host)).toHaveLength(49);
    expect(textOf(host.querySelector('.lede'))).toBe('49 exercises');
  });

  describe('New exercise', () => {
    it('adds an exercise with its video link, the link first among its media', async () => {
      const { harness, host, api } = await render('/training/exercises?muscle=Glutes');
      press(host, 'New exercise');
      await settle(harness.fixture);
      const sheet = dialog()!;
      expect(textOf(sheet.querySelector('h2'))).toBe('New exercise');
      // A new exercise starts as what the coach was looking at.
      expect(sheet.querySelector<HTMLSelectElement>('select[name="muscle"]')!.value).toBe('Glutes');

      fill(sheet, 'Exercise name', ' Hip Thrust ');
      fill(sheet, 'Video link (optional)', 'https://youtu.be/dQw4w9WgXcQ?si=share');
      await settle(harness.fixture);
      expect(sheet.textContent).toContain('YouTube video found.');
      press(sheet, 'Add exercise');
      await settle(harness.fixture);

      expect(api.registerVideoLink).toHaveBeenCalledWith({
        title: 'Hip Thrust',
        provider: 'YouTube',
        externalMediaId: 'dQw4w9WgXcQ',
      });
      expect(api.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Hip Thrust',
          muscles: [{ muscle: 'Glutes', role: 'Primary' }],
          mediaAssetIds: ['m-link'],
        }),
      );
      expect(dialog()).toBeNull();
      expect(toast()).toContain('Hip Thrust is in your library.');
    });

    it('refuses a link it cannot read and an empty name, sending nothing', async () => {
      const { harness, host, api } = await render();
      press(host, 'New exercise');
      await settle(harness.fixture);
      const sheet = dialog()!;
      fill(sheet, 'Video link (optional)', 'https://example.com/clip');
      await settle(harness.fixture);
      press(sheet, 'Add exercise');
      await settle(harness.fixture);

      expect(api.registerVideoLink).not.toHaveBeenCalled();
      expect(api.create).not.toHaveBeenCalled();
      expect(sheet.textContent).toContain('Give the exercise a name.');
      expect(sheet.textContent).toContain('Paste a YouTube or Vimeo link');
    });

    it('keeps the entry and says why when the name is taken, reusing the link on retry', async () => {
      let calls = 0;
      const taken = new HttpErrorResponse({
        status: 409,
        error: { code: 'exercise_name_conflict' },
      });
      const { harness, host, api } = await render(undefined, undefined, {
        create: vi.fn(() =>
          ++calls === 1 ? throwError(() => taken) : of(exercise('Hip Thrust 2')),
        ),
      });
      press(host, 'New exercise');
      await settle(harness.fixture);
      const sheet = dialog()!;
      fill(sheet, 'Exercise name', 'Hip Thrust');
      fill(sheet, 'Video link (optional)', 'vimeo.com/123456789');
      await settle(harness.fixture);
      press(sheet, 'Add exercise');
      await settle(harness.fixture);

      expect(textOf(formSummary(sheet))).toContain('You already have an exercise with this name.');
      expect(document.activeElement).toBe(formSummary(sheet));
      fill(sheet, 'Exercise name', 'Hip Thrust 2');
      await settle(harness.fixture);
      press(sheet, 'Add exercise');
      await settle(harness.fixture);
      expect(api.registerVideoLink).toHaveBeenCalledTimes(1);
      expect(api.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ mediaAssetIds: ['m-link'] }),
      );
    });
  });

  it('edits an exercise with every detail, keeping its version', async () => {
    const { harness, host, api } = await render();
    await choose(harness, host, 'More for Back Squat', 'Edit');
    const sheet = dialog()!;
    expect(textOf(sheet.querySelector('h2'))).toBe('Edit Back Squat');
    expect(sheet.querySelector<HTMLInputElement>('input[name="exercise-name"]')!.value).toBe(
      'Back Squat',
    );

    tick(sheet, 'Hamstrings');
    tick(sheet, 'Back squat side view', false);
    fill(sheet, 'How to do it', 'Brace, sit between the hips.');
    await settle(harness.fixture);
    press(sheet, 'Save exercise');
    await settle(harness.fixture);

    expect(api.update).toHaveBeenCalledWith('ex-back-squat', {
      name: 'Back Squat',
      instructions: 'Brace, sit between the hips.',
      equipment: 'Barbell',
      movementPattern: 'Squat',
      classification: 'Strength',
      muscles: [
        { muscle: 'Quadriceps', role: 'Primary' },
        { muscle: 'Glutes', role: 'Secondary' },
        { muscle: 'Hamstrings', role: 'Secondary' },
      ],
      tags: ['compound', 'knee-friendly'],
      alternatives: [],
      mediaAssetIds: ['m-squat-video'],
      version: 3,
    });
    expect(toast()).toContain('Back Squat is saved.');
  });

  it('archives with the version it showed, and Undo restores it', async () => {
    const { harness, host, api } = await render();
    await choose(harness, host, 'More for Back Squat', 'Archive');

    expect(api.setArchived).toHaveBeenCalledWith('ex-back-squat', true, 3);
    expect(toast()).toContain('Back Squat is archived. Programs already built keep it.');
    button(document.body, 'Undo').click();
    await settle(harness.fixture);
    expect(api.setArchived).toHaveBeenLastCalledWith('ex-back-squat', false, 9);
  });

  it('offers only Restore on an archived exercise', async () => {
    const archived = exercise('Banded Pull-apart', { isArchived: true });
    const { harness, host } = await render('/training/exercises?archived=1', () =>
      of(results([archived])),
    );
    expect(textOf(cards(host)[0].querySelector('.archived-tag'))).toBe('Archived');
    host
      .querySelector<HTMLButtonElement>('button[aria-label="More for Banded Pull-apart"]')!
      .click();
    await settle(harness.fixture);
    expect(Array.from(host.querySelectorAll('.panel .item-title')).map(textOf)).toEqual([
      'Restore',
    ]);
  });
});
