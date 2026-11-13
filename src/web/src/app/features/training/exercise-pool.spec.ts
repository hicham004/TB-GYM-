import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Route } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, Subject, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { ExercisePoolPage, MediaAccessBatchView } from '../../core/api/generated';
import { clientGuard } from '../../core/auth/auth.guards';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { REDESIGNED } from '../../core/theme/redesigned-route';
import { LIBRARY_SEARCH_PAUSE, SEARCH_PAUSE_MS } from '../../ui/paged-search';
import { field, fill, menuChoices, press, settle } from '../../../testing/dom';
import { access } from '../../../testing/exercise-fixtures';
import {
  POOL_BENCH_PRESS,
  POOL_DUMBBELL_ROW,
  POOL_GOBLET_SQUAT,
  POOL_PLANK,
  POOL_ROMANIAN_DEADLIFT,
  poolExercise,
  poolPage,
} from '../../../testing/own-workout-fixtures';
import { ExercisePool } from './exercise-pool';
import { ExercisePoolApi, type PoolQuery } from './exercise-pool-api';
import { PoolExercise } from './pool-exercise';
import { trainingRoutes } from './training.routes';

/** Where a card leads, in place of the exercise's page. */
@Component({ template: '<p>An exercise</p>' })
class ExerciseStub {}

/** The pool in name order: two with no demo, a picture, a video and a YouTube link. */
const WHOLE_POOL = [
  POOL_BENCH_PRESS,
  POOL_DUMBBELL_ROW,
  POOL_GOBLET_SQUAT,
  POOL_PLANK,
  POOL_ROMANIAN_DEADLIFT,
];

type Search = (query: PoolQuery) => Observable<ExercisePoolPage>;

async function render(
  url = '/training/pool',
  search: Search = () => of(poolPage(WHOLE_POOL)),
  /** How long typing must pause before the search goes; at once unless a test says otherwise. */
  pause = 0,
) {
  const pool = { search: vi.fn<Search>(search), get: vi.fn() };
  // The clips ask for their grants here, once they are seen; nothing is seen in jsdom by itself.
  const api = {
    createMediaAccess: vi.fn(),
    createMediaAccessBatch: vi.fn<
      (assetIds: readonly string[]) => Observable<MediaAccessBatchView>
    >(() => of({ items: [] })),
  };
  const selectedTenantId = signal<string | null>('tenant-house');
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'training/pool', component: ExercisePool },
        { path: 'training/pool/:exerciseId', component: ExerciseStub },
      ]),
      { provide: ExercisePoolApi, useValue: pool },
      { provide: ApiClient, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId } },
      { provide: LIBRARY_SEARCH_PAUSE, useValue: pause },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, ExercisePool);
  await settle(harness.fixture);
  return {
    harness,
    host: harness.routeNativeElement as HTMLElement,
    pool,
    api,
    selectedTenantId,
    settle: () => settle(harness.fixture),
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const cards = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('li.exercise'));

/** Each card as its name and the line under it. */
const listed = (host: HTMLElement) =>
  cards(host).map((card) => [
    textOf(card.querySelector('.name')),
    textOf(card.querySelector('.detail')),
  ]);

const params = () => TestBed.inject(Router).routerState.snapshot.root.queryParams;
const url = () => TestBed.inject(Router).url;

/**
 * jsdom has no IntersectionObserver: this one says a clip came near the screen when a test says so.
 * Installed with `vi.stubGlobal` and taken away after the test (Vitest shares one jsdom).
 */
class ObserverStub {
  static instances: ObserverStub[] = [];
  readonly observed: Element[] = [];

  constructor(private readonly callback: IntersectionObserverCallback) {
    ObserverStub.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.push(target);
  }

  unobserve(target: Element): void {
    const index = this.observed.indexOf(target);
    if (index >= 0) this.observed.splice(index, 1);
  }

  disconnect(): void {
    this.observed.length = 0;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** The browser saying `target` came near the screen. */
  static seen(target: Element): void {
    const observer = ObserverStub.instances.find((instance) => instance.observed.includes(target));
    if (!observer) throw new Error('Nothing watches this element.');
    observer.callback(
      [{ target, isIntersecting: true } as unknown as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    );
  }
}

/** What the page's empty state says: its heading and its line. */
const emptyState = (host: HTMLElement) => {
  const empty = host.querySelector('app-empty-state');
  return empty ? [textOf(empty.querySelector('h1, h2')), textOf(empty.querySelector('p'))] : null;
};

/** Chooses `item` from the chip that reads `label`, as a person does: open it, press the choice. */
async function choose(
  harness: RouterTestingHarness,
  host: HTMLElement,
  label: string,
  item: string,
) {
  const trigger = Array.from(
    host.querySelectorAll<HTMLButtonElement>('.chips app-menu button'),
  ).find((candidate) => textOf(candidate) === label);
  if (!trigger) throw new Error(`No chip reads "${label}".`);
  trigger.click();
  await settle(harness.fixture);
  const choice = menuChoices(trigger).find(
    (candidate) => textOf(candidate.querySelector('.item-title')) === item,
  );
  if (!choice) throw new Error(`The chip "${label}" has no "${item}".`);
  choice.click();
  await settle(harness.fixture);
}

/** A pool of `count` exercises, in name order. */
const lifts = (count: number, from = 0) =>
  Array.from({ length: count }, (_, index) =>
    poolExercise(`Lift ${String(from + index).padStart(3, '0')}`),
  );

describe('ExercisePool, TB Gym’s pool for a trainee (notes plan N9b4)', () => {
  afterEach(() => {
    // The page goes first, so its clips let their videos go while jsdom's media stand-ins are still in.
    TestBed.resetTestingModule();
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    vi.restoreAllMocks();
  });

  it('lists the pool in the server’s order as cards, each with its equipment and main muscle', async () => {
    const { host, pool } = await render();

    expect(pool.search).toHaveBeenCalledExactlyOnceWith({
      query: '',
      skip: 0,
      take: 50,
      muscle: null,
      equipment: null,
    });
    expect(textOf(host.querySelector('.kicker'))).toBe('TB Gym’s pool');
    const heading = host.querySelector('h1');
    expect(textOf(heading)).toBe('Exercises');
    expect(document.activeElement).toBe(heading);
    expect(textOf(host.querySelector('.lede'))).toBe(
      'Pick an exercise to see how it’s done, then start a workout with it.',
    );
    expect(textOf(host.querySelector('.summary[role="status"]'))).toBe('5 exercises');
    expect(listed(host)).toEqual([
      ['Bench press', 'Barbell · Chest'],
      ['Dumbbell row', 'Dumbbell · Back'],
      ['Goblet squat', 'Kettlebell · Quadriceps'],
      ['Plank', 'Abdominals'],
      ['Romanian deadlift', 'Barbell · Hamstrings'],
    ]);
    // Each name is the card's one link, to the exercise's page; its name is drawn in its own direction.
    const links = cards(host).map((card) => card.querySelectorAll('a'));
    expect(links.every((found) => found.length === 1)).toBe(true);
    expect(links.map((found) => found[0].getAttribute('href'))).toEqual([
      '/training/pool/pool-bench-press',
      '/training/pool/pool-dumbbell-row',
      '/training/pool/pool-goblet-squat',
      '/training/pool/pool-plank',
      '/training/pool/pool-romanian-deadlift',
    ]);
    expect(links[0][0].getAttribute('dir')).toBe('auto');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('app-skeleton')).toBeNull();
  });

  it('tops a card with its demo as a thumbnail hidden from a screen reader, and one with no demo with its letters', async () => {
    const { host, api } = await render();
    const [bench, row, goblet, plank, deadlift] = cards(host);

    expect(bench.querySelector('app-demo-clip')).toBeNull();
    expect(plank.querySelector('app-demo-clip')).toBeNull();
    // No demo: the exercise's letters keep the card's shape, as the coach's library draws them.
    for (const [card, letters] of [
      [bench, 'BP'],
      [plank, 'PL'],
    ] as const) {
      const tile = card.querySelector('.letters')!;
      expect(tile.textContent?.trim()).toBe(letters);
      expect(tile.getAttribute('aria-hidden')).toBe('true');
    }
    for (const card of [row, goblet, deadlift]) expect(card.querySelector('.letters')).toBeNull();
    for (const card of [row, goblet, deadlift]) {
      const clip = card.querySelector('app-demo-clip')!;
      expect(clip).not.toBeNull();
      expect(clip.getAttribute('aria-hidden')).toBe('true');
      // The card's link is its one control: the clip in a list has no button of its own.
      expect(clip.querySelector('button, a')).toBeNull();
    }
    // A clip asks for its demo only once it is seen, and nothing is seen in this jsdom.
    expect(api.createMediaAccessBatch).not.toHaveBeenCalled();
    expect(api.createMediaAccess).not.toHaveBeenCalled();
  });

  it('asks for a card’s demo only once it is seen, after the antiforgery read, and plays it muted', async () => {
    ObserverStub.instances = [];
    vi.stubGlobal('IntersectionObserver', ObserverStub);
    // jsdom's <video> neither loads nor plays: answer as a browser does.
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    try {
      const { host, api, settle } = await render();
      api.createMediaAccessBatch.mockImplementation(() =>
        of({
          items: [
            access({
              assetId: 'm-goblet-video',
              kind: 'Video',
              contentType: 'video/webm',
              url: '/api/media/m-goblet-video/content',
            }),
          ],
        }),
      );
      const refresh = vi.mocked(TestBed.inject(CsrfService).refresh);
      const [, , goblet, , deadlift] = cards(host).map((card) =>
        card.querySelector('app-demo-clip'),
      );
      expect(api.createMediaAccessBatch).not.toHaveBeenCalled();

      ObserverStub.seen(goblet!);
      await settle();

      expect(api.createMediaAccessBatch).toHaveBeenCalledExactlyOnceWith(['m-goblet-video']);
      expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(
        api.createMediaAccessBatch.mock.invocationCallOrder[0],
      );
      const video = goblet!.querySelector('video')!;
      expect(video.getAttribute('src')).toMatch(/^\/api\/media\/m-goblet-video\/content/);
      expect(video.muted).toBe(true);
      expect(video.loop).toBe(true);
      expect(video.controls).toBe(false);

      // A link in a list is a play tile: its grant is asked only on the exercise's page.
      ObserverStub.seen(deadlift!);
      await settle();
      expect(api.createMediaAccess).not.toHaveBeenCalled();
      expect(api.createMediaAccessBatch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('offers one pause for the clips only while a listed exercise’s demo is a video', async () => {
    const { host } = await render();
    const toggle = host.querySelector('.toolbar [data-clips-toggle]');
    expect(toggle).not.toBeNull();
    // Nothing moves by itself under reduced motion, which is what this jsdom reports.
    expect(textOf(toggle)).toBe('Play demos');
    TestBed.resetTestingModule();

    const stills = await render('/training/pool', () =>
      of(poolPage([POOL_BENCH_PRESS, POOL_DUMBBELL_ROW, POOL_ROMANIAN_DEADLIFT])),
    );
    expect(stills.host.querySelectorAll('app-demo-clip')).toHaveLength(2);
    expect(stills.host.querySelector('[data-clips-toggle]')).toBeNull();
  });

  it('searches a moment after typing stops, and keeps the search in the address', async () => {
    const { host, pool, settle } = await render('/training/pool', (asked) =>
      of(poolPage(asked.query ? [POOL_GOBLET_SQUAT] : WHOLE_POOL)),
    );
    const search = field(host, 'Search exercises');
    expect(search.placeholder).toBe('Search by name');
    expect(search.type).toBe('search');

    fill(host, 'Search exercises', 'goblet');
    await settle();
    await settle();

    expect(params()).toEqual({ q: 'goblet' });
    expect(pool.search).toHaveBeenLastCalledWith({
      query: 'goblet',
      skip: 0,
      take: 50,
      muscle: null,
      equipment: null,
    });
    expect(listed(host)).toEqual([['Goblet squat', 'Kettlebell · Quadriceps']]);
    expect(textOf(host.querySelector('.summary'))).toBe('1 exercise matches');
    expect(field(host, 'Search exercises').value).toBe('goblet');
  });

  it('waits for the typing to pause before it asks, as the library and the picker do', async () => {
    const { host, pool, settle } = await render('/training/pool', undefined, 250);
    expect(pool.search).toHaveBeenCalledTimes(1);

    // Only the typing runs on fake timers: rendering and settling need real ones.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fill(host, 'Search exercises', 'gob');
      vi.advanceTimersByTime(200);
      fill(host, 'Search exercises', 'goblet');
      vi.advanceTimersByTime(200);
      expect(params()).toEqual({});
      vi.advanceTimersByTime(100);
    } finally {
      vi.useRealTimers();
    }
    await settle();

    expect(params()).toEqual({ q: 'goblet' });
    expect(pool.search).toHaveBeenCalledTimes(2);
    expect(pool.search).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'goblet' }));
  });

  /**
   * The box shows what is typed, ahead of the address: the search the page sent comes back trimmed,
   * and the box must not take it (the space is kept, the caret stays). An address the page did not
   * write is what the box shows then.
   */
  it('keeps what is typed, a space at its end included, when its search reaches the address', async () => {
    const { harness, host, pool, settle } = await render(
      '/training/pool',
      (asked) => of(poolPage(asked.query ? [POOL_GOBLET_SQUAT] : WHOLE_POOL)),
      SEARCH_PAUSE_MS,
    );

    // Only the typing runs on fake timers: rendering and settling need real ones.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fill(host, 'Search exercises', 'goblet ');
      vi.advanceTimersByTime(SEARCH_PAUSE_MS);
    } finally {
      vi.useRealTimers();
    }
    await settle();

    expect(params()).toEqual({ q: 'goblet' });
    expect(pool.search).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'goblet' }));
    expect(listed(host)).toEqual([['Goblet squat', 'Kettlebell · Quadriceps']]);
    // Still "goblet ", so "squat" can follow.
    expect(field(host, 'Search exercises').value).toBe('goblet ');

    // Another address (the browser's Back, a link): the box shows its search.
    await harness.navigateByUrl('/training/pool?q=row', ExercisePool);
    await settle();
    expect(field(host, 'Search exercises').value).toBe('row');
  });

  it('keeps the typing that went on while its search was on its way to the address', async () => {
    const { host, pool, settle } = await render('/training/pool', undefined, SEARCH_PAUSE_MS);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fill(host, 'Search exercises', 'gob');
      vi.advanceTimersByTime(SEARCH_PAUSE_MS);
      // "gob" has gone to the address, which has not caught up yet, and the typing goes on.
      fill(host, 'Search exercises', 'goblet');
    } finally {
      // Real timers drop the search for "goblet", still in its pause: the box is what is read here.
      vi.useRealTimers();
    }
    await settle();

    expect(params()).toEqual({ q: 'gob' });
    expect(pool.search).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'gob' }));
    expect(field(host, 'Search exercises').value).toBe('goblet');
  });

  it('reads its filters from the address, sends each, and leaves out a value the pool does not know', async () => {
    const { host, pool } = await render(
      '/training/pool?muscle=Glutes&equipment=Wings&q=squat',
      () => of(poolPage([POOL_GOBLET_SQUAT])),
    );

    expect(pool.search).toHaveBeenCalledExactlyOnceWith({
      query: 'squat',
      skip: 0,
      take: 50,
      muscle: 'Glutes',
      equipment: null,
    });
    const chips = Array.from(host.querySelectorAll('.chips app-menu button'));
    expect(chips.map(textOf)).toEqual(['Muscle: Glutes', 'Equipment']);
    expect(chips[0].classList).toContain('selected');
    expect(chips[1].classList).not.toContain('selected');
    // A client's thumb: the chips are the kit's 44 px ones.
    expect(chips.every((chip) => chip.classList.contains('chip-touch'))).toBe(true);
    expect(field(host, 'Search exercises').value).toBe('squat');
    expect(textOf(host.querySelector('.summary'))).toBe('1 exercise matches');
    expect(host.querySelector('[data-clear-filters]')).not.toBeNull();
  });

  it('applies a chip at once and keeps it in the address; Any takes it off', async () => {
    const { harness, host, pool } = await render();
    expect(host.querySelector('[data-clear-filters]')).toBeNull();

    await choose(harness, host, 'Muscle', 'Glutes');
    expect(params()).toEqual({ muscle: 'Glutes' });
    expect(pool.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ muscle: 'Glutes', equipment: null, skip: 0 }),
    );

    // An exercise needing nothing is offered in the trainee's words, and sent as the server names it.
    await choose(harness, host, 'Equipment', 'No equipment');
    expect(params()).toEqual({ muscle: 'Glutes', equipment: 'None' });
    expect(pool.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ muscle: 'Glutes', equipment: 'None' }),
    );
    expect(Array.from(host.querySelectorAll('.chips app-menu button')).map(textOf)).toEqual([
      'Muscle: Glutes',
      'Equipment: No equipment',
    ]);

    await choose(harness, host, 'Muscle: Glutes', 'Any');
    expect(params()).toEqual({ equipment: 'None' });
    expect(pool.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ muscle: null, equipment: 'None' }),
    );
  });

  it('keeps what is typed when a chip is chosen before the search has gone', async () => {
    // A pause no test outlasts: the search is still waiting when the chip is chosen.
    const { harness, host, pool } = await render('/training/pool', undefined, 60_000);
    fill(host, 'Search exercises', 'squat');

    await choose(harness, host, 'Muscle', 'Quadriceps');

    expect(params()).toEqual({ q: 'squat', muscle: 'Quadriceps' });
    expect(pool.search).toHaveBeenCalledTimes(2);
    expect(pool.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'squat', muscle: 'Quadriceps' }),
    );
  });

  it('clears the search and the chips at once, and focus goes back to the search box', async () => {
    const { host, pool, settle } = await render('/training/pool?q=row&muscle=Back');

    press(host, 'Clear filters');
    await settle();

    expect(params()).toEqual({});
    expect(pool.search).toHaveBeenLastCalledWith({
      query: '',
      skip: 0,
      take: 50,
      muscle: null,
      equipment: null,
    });
    const search = field(host, 'Search exercises');
    expect(search.value).toBe('');
    expect(document.activeElement).toBe(search);
    expect(host.querySelector('[data-clear-filters]')).toBeNull();
    expect(textOf(host.querySelector('.summary'))).toBe('5 exercises');
  });

  it('carries the list’s filters to an exercise’s page, so its way back keeps them', async () => {
    const { harness, host } = await render('/training/pool?muscle=Quadriceps&q=squat', () =>
      of(poolPage([POOL_GOBLET_SQUAT])),
    );
    const link = cards(host)[0].querySelector<HTMLAnchorElement>('a')!;
    expect(link.getAttribute('href')).toBe(
      '/training/pool/pool-goblet-squat?q=squat&muscle=Quadriceps',
    );

    link.click();
    await settle(harness.fixture);

    expect(url()).toBe('/training/pool/pool-goblet-squat?q=squat&muscle=Quadriceps');
    expect(textOf(harness.routeNativeElement)).toBe('An exercise');
  });

  it('says when nothing matches, and Show all exercises goes back to the whole pool', async () => {
    const { host, settle } = await render('/training/pool?muscle=Calves', (asked) =>
      of(poolPage(asked.muscle ? [] : WHOLE_POOL)),
    );

    expect(emptyState(host)).toEqual([
      'No exercise matches',
      'Try another word, or clear the filters.',
    ]);
    expect(cards(host)).toHaveLength(0);
    // Heard in the status line too, where the count was (WCAG 4.1.3); shown once, by the empty state.
    const status = host.querySelector('.summary[role="status"]');
    expect(textOf(status)).toBe('No exercise matches');
    expect(status?.querySelector('span')?.classList).toContain('tb-visually-hidden');
    // The search stays, to try another word.
    expect(field(host, 'Search exercises')).toBeTruthy();

    press(host, 'Show all exercises');
    await settle();

    expect(params()).toEqual({});
    expect(cards(host)).toHaveLength(5);
    expect(document.activeElement).toBe(field(host, 'Search exercises'));
    expect(textOf(status)).toBe('5 exercises');
    expect(status?.querySelector('.tb-visually-hidden')).toBeNull();
  });

  it('says in its status line when what is typed or chosen finds nothing, where the count was', async () => {
    const { harness, host, settle } = await render('/training/pool', (asked) =>
      of(poolPage(asked.query === 'zzz' || asked.muscle === 'Calves' ? [] : WHOLE_POOL)),
    );
    const status = host.querySelector('.summary[role="status"]')!;
    expect(textOf(status)).toBe('5 exercises');

    fill(host, 'Search exercises', 'zzz');
    await settle();
    await settle();

    // The same live region from the first draw, its words changed, so a screen reader hears them.
    expect(host.querySelector('.summary[role="status"]')).toBe(status);
    expect(textOf(status)).toBe('No exercise matches');
    expect(emptyState(host)?.[0]).toBe('No exercise matches');

    press(host, 'Show all exercises');
    await settle();
    expect(textOf(status)).toBe('5 exercises');

    await choose(harness, host, 'Muscle', 'Calves');

    expect(params()).toEqual({ muscle: 'Calves' });
    expect(host.querySelector('.summary[role="status"]')).toBe(status);
    expect(textOf(status)).toBe('No exercise matches');
  });

  it('says the pool is empty in the house’s words, with no search to offer', async () => {
    const { host } = await render('/training/pool', () => of(poolPage([])));

    expect(emptyState(host)).toEqual([
      'No exercises yet',
      'No exercises are in the pool yet. TB Gym adds them, so check back soon.',
    ]);
    expect(host.querySelector('input[type="search"]')).toBeNull();
    expect(host.querySelector('.chips')).toBeNull();
    expect(textOf(host.querySelector('.summary'))).toBe('');
  });

  it('shows the next 50 from where the list ends, and focus moves to the first new exercise', async () => {
    const first = lifts(50);
    const second = lifts(12, 50);
    const { host, pool, settle } = await render('/training/pool?equipment=Barbell', (asked) =>
      of(poolPage(asked.skip === 50 ? second : first, 62)),
    );
    expect(textOf(host.querySelector('.summary'))).toBe('50 of 62 shown');

    press(host, 'Show more exercises');
    await settle();

    expect(pool.search).toHaveBeenLastCalledWith({
      query: '',
      skip: 50,
      take: 50,
      muscle: null,
      equipment: 'Barbell',
    });
    expect(cards(host)).toHaveLength(62);
    expect(textOf(host.querySelector('.summary'))).toBe('62 exercises match');
    expect(document.activeElement).toBe(cards(host)[50].querySelector('a'));
    expect(textOf(document.activeElement)).toBe('Lift 050');
    expect(host.querySelector('.more')).toBeNull();
  });

  it('says when the next page could not be read, and the button stays to try again', async () => {
    let fail = true;
    const { host, settle } = await render('/training/pool', (asked) => {
      if (asked.skip === 50 && fail)
        return throwError(() => new HttpErrorResponse({ status: 503 }));
      return of(poolPage(asked.skip === 50 ? lifts(5, 50) : lifts(50), 55));
    });

    press(host, 'Show more exercises');
    await settle();

    expect(textOf(host.querySelector('.more [role="alert"]'))).toBe(
      'More exercises couldn’t be loaded. Try again.',
    );
    expect(cards(host)).toHaveLength(50);

    fail = false;
    press(host, 'Show more exercises');
    await settle();

    expect(host.querySelector('.more')).toBeNull();
    expect(cards(host)).toHaveLength(55);
  });

  it('drops a page of the list before when the filters changed while it was on its way', async () => {
    const late = new Subject<ExercisePoolPage>();
    const { harness, host, settle } = await render('/training/pool', (asked) =>
      asked.skip === 50 ? late : of(poolPage(asked.muscle ? [POOL_GOBLET_SQUAT] : lifts(50), 60)),
    );

    press(host, 'Show more exercises');
    await settle();
    await choose(harness, host, 'Muscle', 'Quadriceps');
    late.next(poolPage(lifts(10, 50), 60));
    late.complete();
    await settle();

    expect(listed(host).map(([name]) => name)).toEqual(['Goblet squat']);
  });

  it('keeps the list in place while a new search is on its way, marked busy', async () => {
    const answer = new Subject<ExercisePoolPage>();
    const { harness, host, settle } = await render('/training/pool', (asked) =>
      asked.muscle ? answer : of(poolPage(WHOLE_POOL)),
    );

    await choose(harness, host, 'Muscle', 'Back');

    expect(cards(host)).toHaveLength(5);
    expect(host.querySelector('ul.exercises')?.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelector('.more')).toBeNull();

    answer.next(poolPage([POOL_DUMBBELL_ROW]));
    answer.complete();
    await settle();

    expect(listed(host)).toEqual([['Dumbbell row', 'Dumbbell · Back']]);
    expect(host.querySelector('ul.exercises')?.getAttribute('aria-busy')).toBeNull();
  });

  it('shows the skeleton while the first page is on its way, under the search', async () => {
    const { host } = await render('/training/pool', () => new Subject<ExercisePoolPage>());

    expect(textOf(host.querySelector('app-skeleton'))).toBe('Loading the exercises…');
    expect(host.querySelector('input[type="search"]')).not.toBeNull();
    expect(cards(host)).toHaveLength(0);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('says the exercises couldn’t be loaded, and Try again reads them', async () => {
    let fail = true;
    const { host, pool, settle } = await render('/training/pool', () =>
      fail ? throwError(() => new HttpErrorResponse({ status: 503 })) : of(poolPage(WHOLE_POOL)),
    );

    expect(textOf(host.querySelector('.load-failed [role="alert"]'))).toBe(
      'The exercises couldn’t be loaded.',
    );
    expect(cards(host)).toHaveLength(0);

    fail = false;
    press(host, 'Try again');
    await settle();

    expect(pool.search).toHaveBeenCalledTimes(2);
    expect(cards(host)).toHaveLength(5);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('says in the house’s words that the pool is not open here when the server answers 404', async () => {
    const { host } = await render('/training/pool', () =>
      throwError(() => new HttpErrorResponse({ status: 404 })),
    );
    const read = () => textOf(host);

    expect(emptyState(host)).toEqual([
      'The pool isn’t open here',
      'TB Gym’s exercise pool is for people training with TB Gym’s own space.',
    ]);
    expect(host.querySelector('[data-pool-gone]')).not.toBeNull();
    // Not a failure: nothing to try again, and nothing to search.
    expect(read()).not.toContain('Try again');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('input[type="search"]')).toBeNull();
    expect(read()).not.toMatch(/coach/i);
  });

  it('says why Training is closed in the house’s words, never a coach’s', async () => {
    const closed = (accessReason: string): ExercisePoolPage => ({
      isAllowed: false,
      accessReason,
      total: 0,
      items: [],
    });
    const paused = await render('/training/pool', () => of(closed('RelationshipBlocked')));

    expect(emptyState(paused.host)).toEqual([
      'The pool is closed for now',
      'TB Gym has paused your access.',
    ]);
    expect(paused.host.querySelector('input[type="search"]')).toBeNull();
    expect(textOf(paused.host)).not.toMatch(/coach/i);
    TestBed.resetTestingModule();

    const left = await render('/training/pool', () => of(closed('MembershipInactive')));
    expect(emptyState(left.host)?.[1]).toBe(
      'You no longer train with TB Gym, so training is closed.',
    );
  });

  it('reads the pool again from nothing in another workspace', async () => {
    let space = 'house';
    const { host, pool, selectedTenantId, settle } = await render('/training/pool', () =>
      space === 'house'
        ? of(poolPage(WHOLE_POOL))
        : throwError(() => new HttpErrorResponse({ status: 404 })),
    );
    expect(cards(host)).toHaveLength(5);

    space = 'coach';
    selectedTenantId.set('tenant-coach');
    await settle();

    expect(pool.search).toHaveBeenCalledTimes(2);
    expect(cards(host)).toHaveLength(0);
    expect(emptyState(host)?.[0]).toBe('The pool isn’t open here');
  });
});

describe('the pool’s routes (notes plan N9b4)', () => {
  const route = (path: string) => trainingRoutes.find((candidate) => candidate.path === path);

  it('opens the pool and an exercise lazily, for a client, in the person’s own mode under the tab bar', async () => {
    const pool = route('pool') as Route;
    const exercise = route('pool/:exerciseId') as Route;

    for (const [found, title] of [
      [pool, 'Exercises | TB Gym'],
      [exercise, 'Exercise | TB Gym'],
    ] as const) {
      expect(found.canActivate).toEqual([clientGuard]);
      expect(found.title).toBe(title);
      expect(found.data).toEqual(REDESIGNED);
      expect(found.canDeactivate).toBeUndefined();
    }
    expect(await pool.loadComponent!()).toBe(ExercisePool);
    expect(await exercise.loadComponent!()).toBe(PoolExercise);
    // Before the redirect that sends an unknown Training address to the programs.
    const paths = trainingRoutes.map((candidate) => candidate.path);
    expect(paths.indexOf('pool')).toBeLessThan(paths.indexOf(''));
    expect(paths.indexOf('pool/:exerciseId')).toBeLessThan(paths.indexOf(''));
  });
});
