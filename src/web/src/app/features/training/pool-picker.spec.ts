import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { ExercisePoolPage, MediaAccessView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { LIBRARY_SEARCH_PAUSE } from '../../ui/paged-search';
import { button, field, fill, press, query, settle } from '../../../testing/dom';
import { access } from '../../../testing/exercise-fixtures';
import { fakeMotion, type FakeMotion, provideFakeMotion } from '../../../testing/motion-fake';
import {
  POOL_BENCH_PRESS,
  POOL_GOBLET_SQUAT,
  POOL_PLANK,
  poolExercise,
  poolPage,
} from '../../../testing/own-workout-fixtures';
import { PoolPicker } from './pool-picker';
import { ExercisePoolApi } from './exercise-pool-api';

const WHOLE_POOL = [POOL_BENCH_PRESS, POOL_GOBLET_SQUAT, POOL_PLANK];

/** A picture (notes plan N9b4): it stays a picture beside its row. */
const POOL_PUSH_UP = poolExercise('Push-up', {
  equipment: 'Bodyweight',
  movementPattern: 'HorizontalPush',
  muscles: [{ muscle: 'Chest', role: 'Primary' }],
  demos: [{ mediaAssetId: 'm-push-up-photo', kind: 'Picture' }],
});
/** A YouTube link: it opens on its site, from the demo button. */
const POOL_DEADLIFT = poolExercise('Romanian deadlift', {
  movementPattern: 'Hinge',
  muscles: [{ muscle: 'Hamstrings', role: 'Primary' }],
  demos: [{ mediaAssetId: 'm-deadlift-link', kind: 'VideoLink' }],
});
/** A picture first and a video after it: the row loops the video. */
const POOL_SWING = poolExercise('Kettlebell swing', {
  equipment: 'Kettlebell',
  movementPattern: 'Hinge',
  muscles: [{ muscle: 'Glutes', role: 'Primary' }],
  demos: [
    { mediaAssetId: 'm-swing-photo', kind: 'Picture' },
    { mediaAssetId: 'm-swing-video', kind: 'Video' },
  ],
});
/** Every kind of demo and none, in name order. */
const EVERY_DEMO = [
  POOL_BENCH_PRESS,
  POOL_GOBLET_SQUAT,
  POOL_SWING,
  POOL_PLANK,
  POOL_PUSH_UP,
  POOL_DEADLIFT,
];

/** The server's grant of a demo, by the kind its id names: a picture, a YouTube link or a clip. */
function grantOf(assetId: string): MediaAccessView {
  if (assetId.endsWith('-link')) {
    return access({
      assetId,
      kind: 'Video',
      source: 'ExternalEmbed',
      contentType: null,
      url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      externalProvider: 'YouTube',
      watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
  }
  return assetId.endsWith('-photo')
    ? access({ assetId, url: `/api/media/${assetId}/content` })
    : access({
        assetId,
        kind: 'Video',
        contentType: 'video/webm',
        url: `/api/media/${assetId}/content`,
      });
}

/** A browser's IntersectionObserver, which jsdom lacks: the test says when a clip comes into view. */
class IntersectionObserverStub {
  static instances: IntersectionObserverStub[] = [];
  readonly observed: Element[] = [];
  constructor(private readonly callback: IntersectionObserverCallback) {
    IntersectionObserverStub.instances.push(this);
  }
  observe(element: Element): void {
    this.observed.push(element);
  }
  unobserve(): void {
    // Nothing to let go of.
  }
  disconnect(): void {
    // Nothing to let go of.
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  /** The element it watches came near the screen. */
  intersect(target: Element): void {
    this.callback(
      [{ isIntersecting: true, target } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

/** Installs the observer before the picker draws; `seen` brings one element into view. */
function stubIntersections() {
  IntersectionObserverStub.instances = [];
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
  return {
    seen(element: Element): void {
      const watcher = IntersectionObserverStub.instances.find((observer) =>
        observer.observed.includes(element),
      );
      if (!watcher) throw new Error('Nothing watches that element.');
      watcher.intersect(element);
    },
  };
}

/** jsdom's <video> neither loads nor plays (`play()` answers undefined): it answers as a browser does. */
function stubVideo() {
  return {
    play: vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve()),
    pause: vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined),
    load: vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined),
  };
}

interface Options {
  readonly search?: ExercisePoolApi['search'];
  readonly inWorkout?: ReadonlySet<string>;
  /** How many times each exercise was added since the picker opened. */
  readonly added?: ReadonlyMap<string, number>;
  /** Motion as the fake says; without one jsdom reads as reduced motion, and the clips start paused. */
  readonly motion?: FakeMotion;
}

async function render(options: Options = {}) {
  const pool = {
    search: vi.fn<ExercisePoolApi['search']>(options.search ?? (() => of(poolPage(WHOLE_POOL)))),
  };
  const grant = vi.fn((id: string) => of(grantOf(id)));
  // The server leaves out of a batch what it does not grant, and every link (MED-005).
  const batch = vi.fn((ids: readonly string[]) =>
    of({ items: ids.map(grantOf).filter((view) => view.source === 'Upload') }),
  );
  const refresh = vi.fn(() => Promise.resolve());
  TestBed.configureTestingModule({
    imports: [PoolPicker],
    providers: [
      { provide: ExercisePoolApi, useValue: pool },
      // Demos ask the server for their grants (MED-017) through the app's client: a link's button
      // one at a time, the thumbnails together once seen (notes plan N9b4).
      { provide: ApiClient, useValue: { createMediaAccess: grant, createMediaAccessBatch: batch } },
      { provide: CsrfService, useValue: { refresh } },
      { provide: LIBRARY_SEARCH_PAUSE, useValue: 0 },
      ...(options.motion ? [provideFakeMotion(options.motion)] : []),
    ],
  });
  const fixture = TestBed.createComponent(PoolPicker);
  if (options.inWorkout) fixture.componentRef.setInput('inWorkout', options.inWorkout);
  if (options.added) fixture.componentRef.setInput('added', options.added);
  const chosen = vi.fn();
  const done = vi.fn();
  fixture.componentInstance.chosen.subscribe(chosen);
  fixture.componentInstance.done.subscribe(done);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    pool,
    grant,
    batch,
    refresh,
    chosen,
    done,
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** What sits beside the row named `name`, in the place every row keeps for its demo. */
function slotOf(host: HTMLElement, name: string): HTMLElement {
  const row = Array.from(host.querySelectorAll<HTMLElement>('li.row')).find(
    (item) => textOf(item.querySelector('.name')) === name,
  );
  if (!row) throw new Error(`No row is named "${name}".`);
  return query<HTMLElement>(row, ':scope > .demo-slot');
}

/** The exercises listed, each as its name and the line under it. */
function listed(host: HTMLElement): string[][] {
  return Array.from(host.querySelectorAll('li.row')).map((row) => [
    textOf(row.querySelector('.name')),
    textOf(row.querySelector('.detail')),
  ]);
}

/** The row's button, found by the name a screen reader hears ("Add Plank"). */
function pick(host: ParentNode, label: string): HTMLButtonElement {
  return query<HTMLButtonElement>(host, `button.pick[aria-label="${label}"]`);
}

describe('PoolPicker, TB Gym’s pool for a workout of one’s own (notes plan N9b3)', () => {
  afterEach(() => {
    document.body.replaceChildren();
    TestBed.resetTestingModule();
    // After the picker is gone, so the clips letting go of their videos still meet the stubs.
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('lists the pool’s first page in the order the server gives, each with its equipment and main muscle', async () => {
    const { host, pool } = await render();

    expect(pool.search).toHaveBeenCalledExactlyOnceWith({ query: '', skip: 0, take: 50 });
    expect(listed(host)).toEqual([
      ['Bench press', 'Barbell · Chest'],
      ['Goblet squat', 'Kettlebell · Quadriceps'],
      ['Plank', 'Abdominals'],
    ]);
    expect(
      Array.from(host.querySelectorAll('button.pick')).map((row) => row.getAttribute('aria-label')),
    ).toEqual(['Add Bench press', 'Add Goblet squat', 'Add Plank']);
    expect(host.querySelector('.problem')).toBeNull();
    expect(host.querySelector('app-skeleton')).toBeNull();
  });

  it('shows the skeleton while the first page is on its way', async () => {
    const { host } = await render({ search: () => new Subject<ExercisePoolPage>() });

    expect(textOf(query(host, 'app-skeleton'))).toBe('Loading the exercises…');
    expect(host.querySelector('li.row')).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('searches the pool as typed and lists its answer', async () => {
    const { fixture, host, pool } = await render({
      search: (asked) => of(poolPage(asked?.query ? [POOL_GOBLET_SQUAT] : WHOLE_POOL)),
    });

    fill(host, 'Search exercises', 'squat');
    await settle(fixture);

    expect(pool.search).toHaveBeenLastCalledWith({ query: 'squat', skip: 0, take: 50 });
    expect(listed(host)).toEqual([['Goblet squat', 'Kettlebell · Quadriceps']]);
  });

  it('says when nothing matches, and Show all exercises goes back to the whole pool', async () => {
    const { fixture, host, pool } = await render({
      search: (asked) => of(poolPage(asked?.query ? [] : WHOLE_POOL)),
    });

    fill(host, 'Search exercises', 'zercher');
    await settle(fixture);
    expect(textOf(query(host, '.note [role="status"]'))).toBe('No exercise matches “zercher”.');
    expect(host.querySelector('li.row')).toBeNull();

    press(host, 'Show all exercises');
    await settle(fixture);

    expect(listed(host).map(([name]) => name)).toEqual(['Bench press', 'Goblet squat', 'Plank']);
    const search = field(host, 'Search exercises');
    expect(search.value).toBe('');
    expect(document.activeElement).toBe(search);
    // The first page is the one read on opening, not read again.
    expect(pool.search).toHaveBeenCalledTimes(2);
  });

  it('says when the pool holds nothing yet', async () => {
    const { host } = await render({ search: () => of(poolPage([], 0)) });

    expect(textOf(query(host, '.note [role="status"]'))).toBe(
      'No exercises are in the pool yet. TB Gym adds them, so check back soon.',
    );
    expect(host.querySelector('li.row')).toBeNull();
    expect(host.textContent).not.toContain('No exercise matches');
  });

  // Someone training in TB Gym's own space has no coach to contact: the house says why.
  it.each([
    ['MembershipInactive', 'You no longer train with TB Gym, so training is closed.'],
    ['RelationshipBlocked', 'TB Gym has paused your access.'],
    ['PlatformBlocked', 'Your account is blocked. Contact support.'],
    ['Expired', 'Training isn’t open for you right now.'],
  ])(
    'lists nothing while Training is closed (%s), saying why in TB Gym’s words',
    async (reason, why) => {
      const { host } = await render({
        search: () => of({ isAllowed: false, accessReason: reason, total: 0, items: [] }),
      });

      expect(textOf(query(host, '.note [role="alert"]'))).toBe('No exercise can be added now.');
      expect(Array.from(host.querySelectorAll('.note p')).map(textOf)).toEqual([
        'No exercise can be added now.',
        why,
      ]);
      expect(host.textContent).not.toMatch(/coach/i);
      expect(host.querySelector('li.row')).toBeNull();
      expect(host.textContent).not.toContain('No exercises are in the pool yet.');
    },
  );

  it('offers Try again when the first page could not be read', async () => {
    const search = vi
      .fn<ExercisePoolApi['search']>()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
      .mockReturnValue(of(poolPage(WHOLE_POOL)));
    const { fixture, host } = await render({ search });

    expect(textOf(query(host, '.note [role="alert"]'))).toBe('The exercises couldn’t be loaded.');
    expect(host.querySelector('li.row')).toBeNull();

    press(host, 'Try again');
    await settle(fixture);

    expect(search).toHaveBeenCalledTimes(2);
    expect(listed(host)).toHaveLength(3);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('offers Try again when a search could not be read, and sends it again', async () => {
    const search = vi
      .fn<ExercisePoolApi['search']>()
      .mockReturnValueOnce(of(poolPage(WHOLE_POOL)))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })))
      .mockReturnValue(of(poolPage([POOL_PLANK])));
    const { fixture, host } = await render({ search });

    fill(host, 'Search exercises', 'plank');
    await settle(fixture);
    expect(textOf(query(host, '.note [role="alert"]'))).toBe('The exercises couldn’t be loaded.');

    press(host, 'Try again');
    await settle(fixture);

    expect(search).toHaveBeenLastCalledWith({ query: 'plank', skip: 0, take: 50 });
    expect(listed(host)).toEqual([['Plank', 'Abdominals']]);
  });

  it('adds the next page under the first with Show more exercises, focus on its first row', async () => {
    const { fixture, host, pool } = await render({
      search: (asked) =>
        of(
          asked?.skip
            ? poolPage([POOL_PLANK], 3)
            : poolPage([POOL_BENCH_PRESS, POOL_GOBLET_SQUAT], 3),
        ),
    });
    expect(listed(host)).toHaveLength(2);

    press(host, 'Show more exercises');
    await settle(fixture);

    expect(pool.search).toHaveBeenLastCalledWith({ query: '', skip: 2, take: 50 });
    expect(listed(host).map(([name]) => name)).toEqual(['Bench press', 'Goblet squat', 'Plank']);
    expect(host.textContent).not.toContain('Show more exercises');
    expect(document.activeElement).toBe(pick(host, 'Add Plank'));
  });

  it('says beside Show more exercises when the next page could not be read, and the button tries again', async () => {
    const search = vi
      .fn<ExercisePoolApi['search']>()
      .mockReturnValueOnce(of(poolPage([POOL_BENCH_PRESS, POOL_GOBLET_SQUAT], 3)))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })))
      .mockReturnValue(of(poolPage([POOL_PLANK], 3)));
    const { fixture, host } = await render({ search });
    // A keyboard press: focus is on the button.
    const more = button(host, 'Show more exercises');
    more.focus();

    more.click();
    await settle(fixture);

    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenLastCalledWith({ query: '', skip: 2, take: 50 });
    // The page's own line is under the sheet: the picker says it, beside the button.
    const failed = query<HTMLElement>(host, '.more p[role="alert"]');
    expect(textOf(failed)).toBe('More exercises couldn’t be loaded. Try again.');
    expect(listed(host).map(([name]) => name)).toEqual(['Bench press', 'Goblet squat']);
    // The button stays, and keeps focus, to try again.
    expect(button(host, 'Show more exercises')).toBe(more);
    expect(more.getAttribute('aria-disabled')).toBeNull();
    expect(failed.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.activeElement).toBe(more);

    press(host, 'Show more exercises');
    await settle(fixture);

    expect(search).toHaveBeenCalledTimes(3);
    expect(search).toHaveBeenLastCalledWith({ query: '', skip: 2, take: 50 });
    expect(listed(host).map(([name]) => name)).toEqual(['Bench press', 'Goblet squat', 'Plank']);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).not.toContain('Show more exercises');
    expect(document.activeElement).toBe(pick(host, 'Add Plank'));
  });

  it('hands the exercise pressed to the player, and stays open for the next', async () => {
    const { fixture, host, chosen, done } = await render();

    pick(host, 'Add Goblet squat').click();
    await settle(fixture);

    expect(chosen).toHaveBeenCalledExactlyOnceWith(POOL_GOBLET_SQUAT);
    expect(done).not.toHaveBeenCalled();
    expect(listed(host)).toHaveLength(3);
  });

  it('marks what was added and what is in the workout already, which is offered again', async () => {
    const { host } = await render({
      inWorkout: new Set([POOL_BENCH_PRESS.id, POOL_GOBLET_SQUAT.id]),
      added: new Map([[POOL_BENCH_PRESS.id, 1]]),
    });

    const bench = pick(host, 'Add Bench press again');
    expect(textOf(bench.querySelector('.mark.added'))).toBe('Added');
    // The row's name says what a press does; the mark is for the eye.
    expect(bench.querySelector('.mark.added')?.getAttribute('aria-hidden')).toBe('true');
    const goblet = pick(host, 'Add Goblet squat again');
    expect(textOf(goblet.querySelector('.mark'))).toBe('In this workout');
    expect(goblet.querySelector('.mark.added')).toBeNull();
    const plank = pick(host, 'Add Plank');
    expect(plank.querySelector('.mark')).toBeNull();
    expect(plank.querySelector('.add app-icon')).not.toBeNull();
    // A second one is still offered: none of the rows is closed.
    expect([bench, goblet, plank].every((row) => !row.disabled)).toBe(true);
  });

  it('counts a second add of the same exercise on its row, so it is seen as well as heard', async () => {
    const { fixture, host } = await render({
      inWorkout: new Set([POOL_BENCH_PRESS.id]),
      added: new Map([[POOL_BENCH_PRESS.id, 1]]),
    });
    expect(textOf(pick(host, 'Add Bench press again').querySelector('.mark.added'))).toBe('Added');

    fixture.componentRef.setInput('added', new Map([[POOL_BENCH_PRESS.id, 2]]));
    await settle(fixture);
    expect(textOf(pick(host, 'Add Bench press again').querySelector('.mark.added'))).toBe(
      'Added ×2',
    );

    fixture.componentRef.setInput(
      'added',
      new Map([
        [POOL_BENCH_PRESS.id, 3],
        [POOL_PLANK.id, 1],
      ]),
    );
    fixture.componentRef.setInput('inWorkout', new Set([POOL_BENCH_PRESS.id, POOL_PLANK.id]));
    await settle(fixture);
    expect(textOf(pick(host, 'Add Bench press again').querySelector('.mark.added'))).toBe(
      'Added ×3',
    );
    expect(textOf(pick(host, 'Add Plank again').querySelector('.mark.added'))).toBe('Added');
    expect(pick(host, 'Add Goblet squat').querySelector('.mark')).toBeNull();
    // Nothing added since the picker opened: the marks go, and the workout's own mark is back.
    fixture.componentRef.setInput('added', new Map());
    await settle(fixture);
    expect(textOf(pick(host, 'Add Bench press again').querySelector('.mark'))).toBe(
      'In this workout',
    );
    expect(host.querySelector('.mark.added')).toBeNull();
  });

  describe('the demos beside the rows (notes plan N9b4)', () => {
    it('shows an uploaded video or a picture as a square thumbnail, hidden from assistive technology, asking nothing until it is seen', async () => {
      const { host, grant, batch } = await render({
        search: () => of(poolPage(EVERY_DEMO)),
      });

      // Every row keeps the demo's place after its button, so the rows line up with a demo or without.
      const rows = Array.from(host.querySelectorAll<HTMLElement>('li.row'));
      expect(rows).toHaveLength(6);
      for (const row of rows) {
        expect(row.lastElementChild?.classList.contains('demo-slot')).toBe(true);
        expect(query(row, 'button.pick').nextElementSibling).toBe(row.lastElementChild);
      }
      for (const name of ['Goblet squat', 'Kettlebell swing', 'Push-up']) {
        const clip = query<HTMLElement>(slotOf(host, name), 'app-demo-clip.row-clip');
        // A thumbnail in a list: the row's button names the exercise, and the clip has no control.
        expect(clip.getAttribute('aria-hidden')).toBe('true');
        expect(clip.querySelector('button, a')).toBeNull();
        expect(clip.closest('button.pick')).toBeNull();
        expect(slotOf(host, name).querySelector('app-exercise-demo')).toBeNull();
      }
      // No demo, nothing drawn; the old demo button stays for the link alone.
      expect(slotOf(host, 'Bench press').children).toHaveLength(0);
      expect(slotOf(host, 'Plank').children).toHaveLength(0);
      expect(slotOf(host, 'Romanian deadlift').querySelector('app-demo-clip')).toBeNull();
      expect(host.querySelectorAll('app-exercise-demo')).toHaveLength(1);
      // jsdom never sees a clip come into view, so none asks for its grant.
      expect(batch).not.toHaveBeenCalled();
      expect(grant).not.toHaveBeenCalled();
    });

    it('keeps the demo button for a YouTube or Vimeo link, at a thumb’s size, which opens it without adding', async () => {
      const { fixture, host, grant, batch, chosen } = await render({
        search: () => of(poolPage(EVERY_DEMO)),
      });
      const demo = query<HTMLButtonElement>(
        slotOf(host, 'Romanian deadlift'),
        'app-exercise-demo button',
      );
      expect(demo.getAttribute('aria-label')).toBe('Watch the Romanian deadlift demo');
      expect(demo.classList.contains('compact')).toBe(true);
      expect(demo.classList.contains('touch')).toBe(true);
      // Beside the row's button, never inside it.
      expect(demo.closest('button.pick')).toBeNull();

      demo.click();
      await settle(fixture);

      expect(grant).toHaveBeenCalledExactlyOnceWith('m-deadlift-link');
      expect(batch).not.toHaveBeenCalled();
      const sheet = query<HTMLElement>(document, '[role="dialog"]');
      expect(textOf(sheet.querySelector('h2'))).toBe('Romanian deadlift');
      expect(query<HTMLAnchorElement>(sheet, '[data-watch-external]').getAttribute('href')).toBe(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      );
      expect(chosen).not.toHaveBeenCalled();
    });

    it('offers one pause for the looping thumbnails, beside the search, while a video is listed', async () => {
      const { fixture, host, pool } = await render({
        search: (asked) => of(poolPage(asked?.query ? [POOL_PUSH_UP, POOL_DEADLIFT] : EVERY_DEMO)),
        motion: fakeMotion({ allowed: true }),
      });
      const find = query<HTMLElement>(host, '.top .find');
      const toggle = query<HTMLButtonElement>(find, 'button[data-clips-toggle]');
      // Outside the search landmark and after its box, which stays the first thing in reach.
      expect(toggle.closest('[role="search"]')).toBeNull();
      expect(
        query(find, '.search').compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(textOf(toggle)).toBe('Pause demos');

      press(host, 'Pause demos');
      await settle(fixture);
      expect(textOf(query(host, 'button[data-clips-toggle]'))).toBe('Play demos');

      // A picture and a link do not move: no pause is offered for them. The search asks as before.
      fill(host, 'Search exercises', 'push');
      await settle(fixture);
      expect(pool.search).toHaveBeenLastCalledWith({ query: 'push', skip: 0, take: 50 });
      expect(listed(host).map(([name]) => name)).toEqual(['Push-up', 'Romanian deadlift']);
      expect(host.querySelector('[data-clips-toggle]')).toBeNull();
    });

    it('starts the clips paused for a person who asked for reduced motion, and offers to play them', async () => {
      const { host } = await render();

      // jsdom answers no reduced-motion question, which the app reads as reduced motion.
      expect(textOf(query(host, '.top button[data-clips-toggle]'))).toBe('Play demos');
    });

    it('asks a seen thumbnail’s grant with the others’ in one request, for the demo its row shows', async () => {
      const intersections = stubIntersections();
      stubVideo();
      const { fixture, host, batch, refresh } = await render({
        search: () => of(poolPage(EVERY_DEMO)),
      });
      const clips = Array.from(host.querySelectorAll<HTMLElement>('app-demo-clip'));
      expect(clips).toHaveLength(3);
      expect(batch).not.toHaveBeenCalled();

      for (const clip of clips) intersections.seen(clip);
      await settle(fixture);

      // One antiforgery read, then one request for all three, and the swing's video, not its picture.
      expect(batch).toHaveBeenCalledTimes(1);
      expect([...batch.mock.calls[0][0]].sort()).toEqual([
        'm-goblet-video',
        'm-push-up-photo',
        'm-swing-video',
      ]);
      expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(batch.mock.invocationCallOrder[0]);
      const goblet = query<HTMLVideoElement>(slotOf(host, 'Goblet squat'), 'video');
      expect(goblet.getAttribute('src')).toMatch(/^\/api\/media\/m-goblet-video\/content/);
      expect(goblet.muted).toBe(true);
      expect(goblet.loop).toBe(true);
      expect(goblet.hasAttribute('controls')).toBe(false);
      expect(
        query<HTMLVideoElement>(slotOf(host, 'Kettlebell swing'), 'video').getAttribute('src'),
      ).toMatch(/^\/api\/media\/m-swing-video\/content/);
      const picture = query<HTMLImageElement>(slotOf(host, 'Push-up'), 'img');
      expect(picture.getAttribute('src')).toBe('/api/media/m-push-up-photo/content');
      expect(picture.getAttribute('alt')).toBe('');
      // Still hidden from assistive technology, with no control of its own.
      for (const clip of clips) {
        expect(clip.getAttribute('aria-hidden')).toBe('true');
        expect(clip.querySelector('button')).toBeNull();
      }
    });
  });

  it('says what the last press did, and the same words again when they are said again', async () => {
    const { fixture, host } = await render();
    const status = query<HTMLElement>(host, 'p.tb-visually-hidden[role="status"]');
    expect(textOf(status)).toBe('');

    fixture.componentRef.setInput('announcement', { text: 'Goblet squat added.', version: 1 });
    await settle(fixture);
    expect(textOf(status)).toBe('Goblet squat added.');
    const first = query<HTMLElement>(status, 'span');

    // Drawn once per count: the same sentence read again changes nothing a screen reader hears.
    fixture.componentRef.setInput('announcement', { text: 'Goblet squat added.', version: 1 });
    await settle(fixture);
    expect(query(status, 'span')).toBe(first);

    // Said again, counted anew: written into the live region afresh, so it is heard a second time.
    fixture.componentRef.setInput('announcement', { text: 'Goblet squat added.', version: 2 });
    await settle(fixture);
    expect(textOf(status)).toBe('Goblet squat added.');
    expect(status.querySelectorAll('span')).toHaveLength(1);
    expect(query(status, 'span')).not.toBe(first);
    expect(first.isConnected).toBe(false);

    fixture.componentRef.setInput('announcement', null);
    await settle(fixture);
    expect(textOf(status)).toBe('');
    expect(status.querySelector('span')).toBeNull();
  });

  it('says why a press added nothing at the top, under the search, where it stays in view', async () => {
    const { fixture, host } = await render();
    expect(host.querySelector('.problem')).toBeNull();

    fixture.componentRef.setInput('problem', 'A workout holds at most 40 exercises.');
    await settle(fixture);

    // The sheet's first block, which holds the search and stays put while the list scrolls under it.
    const top = query<HTMLElement>(host, '.top');
    expect(host.firstElementChild).toBe(top);
    const search = query<HTMLInputElement>(top, '.search input[type="search"]');
    const problem = query<HTMLElement>(top, 'p.problem[role="alert"]');
    expect(textOf(problem)).toBe('A workout holds at most 40 exercises.');
    expect(search.compareDocumentPosition(problem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(host.querySelectorAll('.problem')).toHaveLength(1);
    // Above the rows, never among them.
    expect(
      problem.compareDocumentPosition(query(host, 'ul.items')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fixture.componentRef.setInput('problem', null);
    await settle(fixture);
    expect(host.querySelector('.problem')).toBeNull();
    expect(query(host, '.top .search input')).toBe(search);
  });

  it('closes with Done, drawn where it is written outside a sheet', async () => {
    const { fixture, host, done, chosen } = await render();

    press(host, 'Done');
    await settle(fixture);

    expect(done).toHaveBeenCalledTimes(1);
    expect(chosen).not.toHaveBeenCalled();
  });
});
