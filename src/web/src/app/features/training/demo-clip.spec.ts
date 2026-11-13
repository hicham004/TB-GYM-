import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { type Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { MediaAccessBatchView, MediaAccessView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { access } from '../../../testing/exercise-fixtures';
import { fakeMotion, provideFakeMotion } from '../../../testing/motion-fake';
import { button, press, query, settle } from '../../../testing/dom';
import { DemoClip } from './demo-clip';
import { type ClipDemo, DemoClips, LIVE_GRANTS } from './demo-clips';
import { DemoClipsToggle } from './demo-clips-toggle';

type Batch = Mock<(ids: readonly string[]) => Observable<MediaAccessBatchView>>;
type Single = Mock<(id: string) => Observable<MediaAccessView>>;

const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** What the house holds, by the id's first word: `photo-`, `link-`, `gone-` (refused), else a clip. */
function held(id: string): MediaAccessView | null {
  if (id.startsWith('gone-')) return null;
  if (id.startsWith('photo-')) {
    return access({ assetId: id, url: `/api/media/${id}/content`, downloadAllowed: false });
  }
  if (id.startsWith('link-')) {
    return access({
      assetId: id,
      kind: 'Video',
      source: 'ExternalEmbed',
      contentType: null,
      url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      externalProvider: 'YouTube',
      watchUrl: WATCH,
      downloadAllowed: false,
    });
  }
  return access({
    assetId: id,
    kind: 'Video',
    contentType: 'video/webm',
    url: `/api/media/${id}/content`,
    downloadAllowed: false,
  });
}

/** The server's batch grant: granted uploads alone; what it refuses, and every link, it leaves out. */
function batchRoute(): Batch {
  return vi.fn((ids: readonly string[]) =>
    of({
      items: ids.map(held).filter((view): view is MediaAccessView => view?.source === 'Upload'),
    }),
  );
}

/** The server's grant of one demo, the only one that answers for a link. */
function singleRoute(): Single {
  return vi.fn((id: string) => {
    const view = held(id);
    return view ? of(view) : throwError(() => new HttpErrorResponse({ status: 404 }));
  });
}

/** jsdom has no IntersectionObserver: this one is told when its clip comes near the screen or leaves. */
class ObserverStub {
  static instances: ObserverStub[] = [];
  readonly observed: Element[] = [];
  disconnected = false;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
    ObserverStub.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  unobserve(element: Element): void {
    this.observed.splice(this.observed.indexOf(element), 1);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Its clip came within reach of the screen, or (`near` false) left it. */
  report(near: boolean): void {
    const entries = this.observed.map(
      (target) => ({ isIntersecting: near, target }) as unknown as IntersectionObserverEntry,
    );
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

/** The observer watching `clip`, found by what it watches (a kit sheet makes an observer too). */
function observerOf(clip: Element): ObserverStub {
  const found = ObserverStub.instances.find((observer) => observer.observed.includes(clip));
  if (!found) throw new Error('Nothing watches this clip.');
  return found;
}

/**
 * jsdom's `<video>` neither loads nor plays (`play()` answers undefined): this one answers as a
 * browser does. `play()` starts it (`paused` false, then `play` and `playing`), or rejects with the
 * error `refuse` names; `pause()` stops it with a `pause`; `load()` stops it without one, as the HTML
 * load algorithm does.
 */
function stubVideo() {
  const running = new WeakSet<HTMLMediaElement>();
  let refusal: string | null = null;
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    return !running.has(this);
  });
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    if (refusal !== null) {
      return Promise.reject(new DOMException('The browser would not start it.', refusal));
    }
    if (!running.has(this)) {
      running.add(this);
      queueMicrotask(() => {
        this.dispatchEvent(new Event('play'));
        this.dispatchEvent(new Event('playing'));
      });
    }
    return Promise.resolve();
  });
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    if (running.delete(this)) queueMicrotask(() => this.dispatchEvent(new Event('pause')));
  });
  const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    running.delete(this);
  });
  return {
    play,
    pause,
    load,
    /** From now on `play()` rejects with this DOMException's name (null: it plays again). */
    refuse(name: string | null): void {
      refusal = name;
    },
  };
}

/** Node's process, which hears of any promise nobody handled (the types leave Node out). */
const node = (
  globalThis as unknown as {
    process: {
      on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
      off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
    };
  }
).process;

interface Shown {
  readonly demos: readonly ClipDemo[];
  readonly name: string;
  readonly decorative?: boolean;
}

@Component({
  imports: [DemoClip, DemoClipsToggle],
  template: `
    @if (toggle()) {
      <app-demo-clips-toggle />
    }
    @for (clip of clips(); track $index) {
      <app-demo-clip
        [demos]="clip.demos"
        [exerciseName]="clip.name"
        [decorative]="clip.decorative ?? false"
      />
    }
  `,
})
class Host {
  readonly clips = signal<readonly Shown[]>([]);
  readonly toggle = signal(false);
}

const SQUAT = 'Goblet squat';

async function render(
  clips: readonly Shown[],
  options: {
    allowed?: boolean;
    batch?: Batch;
    single?: Single;
    /** False for a browser with no IntersectionObserver (as jsdom). */
    observer?: boolean;
    toggle?: boolean;
  } = {},
) {
  if (options.observer !== false) vi.stubGlobal('IntersectionObserver', ObserverStub);
  const batch = options.batch ?? batchRoute();
  const single = options.single ?? singleRoute();
  const refresh = vi.fn(() => Promise.resolve());
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      {
        provide: ApiClient,
        useValue: { createMediaAccessBatch: batch, createMediaAccess: single },
      },
      { provide: CsrfService, useValue: { refresh } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('house') } },
      provideFakeMotion(fakeMotion({ allowed: options.allowed ?? true })),
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.clips.set(clips);
  fixture.componentInstance.toggle.set(options.toggle ?? false);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    host,
    batch,
    single,
    refresh,
    demoClips: TestBed.inject(DemoClips),
    clipAt: (index: number) => host.querySelectorAll<HTMLElement>('app-demo-clip')[index],
  };
}

/** Lets the grants, the clip's events and the screen all settle. */
async function quiet(fixture: ComponentFixture<unknown>): Promise<void> {
  await settle(fixture);
  await settle(fixture);
}

/** The clip comes within reach of the screen (or, with `isNear` false, leaves it). */
async function near(fixture: ComponentFixture<unknown>, clip: Element, isNear = true) {
  observerOf(clip).report(isNear);
  await quiet(fixture);
}

const toggleOf = (clip: Element) => query<HTMLButtonElement>(clip, 'button[data-clip-toggle]');
const videoOf = (clip: Element) => query<HTMLVideoElement>(clip, 'video');
const state = (clip: Element) => clip.getAttribute('data-clip-state');
const video = (id: string): ClipDemo => ({ id, kind: 'Video' });

describe('DemoClip', () => {
  beforeEach(() => {
    ObserverStub.instances = [];
  });

  afterEach(() => {
    // The clips let their videos go as they are destroyed: while the stubs still answer for jsdom.
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks for nothing until it comes near the screen, then plays the clip muted, looping and inline', async () => {
    const media = stubVideo();
    const { fixture, batch, refresh, clipAt } = await render([
      { demos: [video('clip-1')], name: SQUAT },
    ]);
    const clip = clipAt(0);

    expect(state(clip)).toBe('waiting');
    expect(clip.querySelector('video, img, a, button')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
    // It starts loading a little before it is on the screen.
    expect(observerOf(clip).options.rootMargin).toBe('200px 0px');

    await near(fixture, clip);

    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith(['clip-1']);
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(batch.mock.invocationCallOrder[0]);
    const shown = videoOf(clip);
    expect(shown.getAttribute('src')).toBe('/api/media/clip-1/content');
    // The property, which mutes; an attribute written by script does not (tests.md fact 3).
    expect(shown.muted).toBe(true);
    expect(shown.hasAttribute('muted')).toBe(true);
    expect(shown.loop).toBe(true);
    expect(shown.playsInline).toBe(true);
    expect(shown.controls).toBe(false);
    expect(shown.preload).toBe('auto');
    expect(shown.getAttribute('aria-label')).toBe('How to do Goblet squat');
    expect(media.play.mock.contexts).toEqual([shown]);
    expect(shown.paused).toBe(false);
    expect(state(clip)).toBe('ready');
    expect(toggleOf(clip).getAttribute('aria-label')).toBe('Pause the demo');
  });

  it('pauses when it leaves the screen and plays again when it comes back, asking nothing twice', async () => {
    const media = stubVideo();
    const { fixture, batch, clipAt } = await render([{ demos: [video('clip-1')], name: SQUAT }]);
    const clip = clipAt(0);
    await near(fixture, clip);
    const shown = videoOf(clip);

    await near(fixture, clip, false);

    expect(media.pause.mock.contexts).toContain(shown);
    expect(shown.paused).toBe(true);
    expect(toggleOf(clip).getAttribute('aria-label')).toBe('Play the demo');

    media.play.mockClear();
    await near(fixture, clip);

    expect(media.play.mock.contexts).toEqual([shown]);
    expect(shown.paused).toBe(false);
    expect(toggleOf(clip).getAttribute('aria-label')).toBe('Pause the demo');
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('shows the first frame as a still under reduced motion, and a press plays it', async () => {
    const media = stubVideo();
    const { fixture, demoClips, clipAt } = await render(
      [{ demos: [video('clip-1')], name: SQUAT }],
      { allowed: false },
    );
    const clip = clipAt(0);
    expect(demoClips.paused()).toBe(true);

    await near(fixture, clip);

    const shown = videoOf(clip);
    expect(shown.getAttribute('src')).toBe('/api/media/clip-1/content#t=0.001');
    expect(shown.preload).toBe('metadata');
    expect(shown.muted).toBe(true);
    expect(media.play).not.toHaveBeenCalled();
    const toggle = toggleOf(clip);
    expect(toggle.getAttribute('aria-label')).toBe('Play the demo');

    toggle.click();
    // Inside the press itself, where a browser lets a page start a video.
    expect(media.play.mock.contexts).toEqual([shown]);
    expect(demoClips.paused()).toBe(false);
    await quiet(fixture);
    expect(shown.paused).toBe(false);
    expect(toggle.getAttribute('aria-label')).toBe('Pause the demo');

    toggle.click();
    expect(demoClips.paused()).toBe(true);
    expect(media.pause.mock.contexts).toContain(shown);
    await quiet(fixture);
    expect(shown.paused).toBe(true);
    expect(toggle.getAttribute('aria-label')).toBe('Play the demo');
  });

  it('pauses every clip on the screen with one clip’s “Pause the demo”, and plays them all with “Play the demo”', async () => {
    stubVideo();
    const { fixture, demoClips, clipAt } = await render([
      { demos: [video('clip-1')], name: SQUAT },
      { demos: [video('clip-2')], name: 'Plank' },
    ]);
    const [first, second] = [clipAt(0), clipAt(1)];
    await near(fixture, first);
    await near(fixture, second);
    expect(videoOf(first).paused).toBe(false);
    expect(videoOf(second).paused).toBe(false);

    toggleOf(first).click();
    await quiet(fixture);

    expect(demoClips.paused()).toBe(true);
    expect(videoOf(first).paused).toBe(true);
    expect(videoOf(second).paused).toBe(true);
    expect(toggleOf(first).getAttribute('aria-label')).toBe('Play the demo');
    expect(toggleOf(second).getAttribute('aria-label')).toBe('Play the demo');

    toggleOf(second).click();
    await quiet(fixture);

    expect(demoClips.paused()).toBe(false);
    expect(videoOf(first).paused).toBe(false);
    expect(videoOf(second).paused).toBe(false);
    expect(toggleOf(first).getAttribute('aria-label')).toBe('Pause the demo');
  });

  it('waits for a press when the browser will not start it by itself, letting no refusal go unhandled', async () => {
    const media = stubVideo();
    media.refuse('NotAllowedError');
    const unhandled: unknown[] = [];
    const hear = (reason: unknown) => unhandled.push(reason);
    node.on('unhandledRejection', hear);
    try {
      const { fixture, clipAt } = await render([{ demos: [video('clip-1')], name: SQUAT }]);
      const clip = clipAt(0);

      await near(fixture, clip);
      await new Promise((resolve) => setTimeout(resolve));

      expect(media.play).toHaveBeenCalledTimes(1);
      expect(videoOf(clip).paused).toBe(true);
      expect(toggleOf(clip).getAttribute('aria-label')).toBe('Play the demo');
      expect(unhandled).toEqual([]);

      // Coming back to the screen does not ask the browser again: the press does.
      await near(fixture, clip, false);
      await near(fixture, clip);
      expect(media.play).toHaveBeenCalledTimes(1);

      media.refuse(null);
      toggleOf(clip).click();
      expect(media.play).toHaveBeenCalledTimes(2);
      await quiet(fixture);
      expect(videoOf(clip).paused).toBe(false);
      expect(toggleOf(clip).getAttribute('aria-label')).toBe('Pause the demo');
    } finally {
      node.off('unhandledRejection', hear);
    }
  });

  it('takes an interrupted start (AbortError) for no refusal: it plays again by itself', async () => {
    const media = stubVideo();
    media.refuse('AbortError');
    const unhandled: unknown[] = [];
    const hear = (reason: unknown) => unhandled.push(reason);
    node.on('unhandledRejection', hear);
    try {
      const { fixture, clipAt } = await render([{ demos: [video('clip-1')], name: SQUAT }]);
      const clip = clipAt(0);
      await near(fixture, clip);
      await new Promise((resolve) => setTimeout(resolve));
      expect(media.play).toHaveBeenCalledTimes(1);
      expect(unhandled).toEqual([]);

      media.refuse(null);
      await near(fixture, clip, false);
      await near(fixture, clip);

      expect(media.play).toHaveBeenCalledTimes(2);
      expect(videoOf(clip).paused).toBe(false);
      expect(toggleOf(clip).getAttribute('aria-label')).toBe('Pause the demo');
    } finally {
      node.off('unhandledRejection', hear);
    }
  });

  it('shows a picture as a picture, named for the exercise unless it is a list’s thumbnail', async () => {
    stubVideo();
    const { fixture, host, clipAt } = await render([
      { demos: [{ id: 'photo-1', kind: 'Picture' }], name: SQUAT },
      { demos: [{ id: 'photo-2', kind: 'Picture' }], name: 'Plank', decorative: true },
    ]);
    await near(fixture, clipAt(0));
    await near(fixture, clipAt(1));

    const named = query<HTMLImageElement>(clipAt(0), 'img');
    expect(named.getAttribute('src')).toBe('/api/media/photo-1/content');
    expect(named.getAttribute('alt')).toBe('How to do Goblet squat');
    expect(query<HTMLImageElement>(clipAt(1), 'img').getAttribute('alt')).toBe('');
    expect(host.querySelector('video, button')).toBeNull();
  });

  it('opens a link on its own site in a new tab, loading nothing from it', async () => {
    stubVideo();
    const { fixture, batch, single, refresh, clipAt } = await render([
      { demos: [{ id: 'link-1', kind: 'VideoLink' }], name: SQUAT },
    ]);
    const clip = clipAt(0);

    await near(fixture, clip);

    expect(single).toHaveBeenCalledWith('link-1');
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(single.mock.invocationCallOrder[0]);
    expect(batch).not.toHaveBeenCalled();
    expect(clip.textContent).toContain(
      'This demo is a video on YouTube. It opens there, in a new tab.',
    );
    const watch = query<HTMLAnchorElement>(clip, 'a[data-watch-external]');
    expect(watch.getAttribute('href')).toBe(WATCH);
    expect(watch.getAttribute('target')).toBe('_blank');
    expect(watch.getAttribute('rel')).toBe('noopener noreferrer');
    expect(watch.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Watch on YouTube (opens in a new tab)',
    );
    expect(clip.querySelector('video, iframe, img')).toBeNull();
    expect(clip.classList.contains('is-link')).toBe(true);
  });

  it('is a list’s quiet thumbnail when decorative: hidden from readers, no button, and a link a tile that asks nothing', async () => {
    const media = stubVideo();
    const { fixture, host, batch, single, clipAt } = await render([
      { demos: [video('clip-1')], name: SQUAT, decorative: true },
      { demos: [{ id: 'link-1', kind: 'VideoLink' }], name: 'Plank', decorative: true },
    ]);
    const [thumbnail, tile] = [clipAt(0), clipAt(1)];
    expect(thumbnail.getAttribute('aria-hidden')).toBe('true');
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(state(tile)).toBe('tile');

    await near(fixture, thumbnail);
    await near(fixture, tile);

    expect(host.querySelector('button')).toBeNull();
    const shown = videoOf(thumbnail);
    expect(shown.hasAttribute('aria-label')).toBe(false);
    expect(media.play.mock.contexts).toEqual([shown]);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith(['clip-1']);
    expect(single).not.toHaveBeenCalled();
    expect(state(tile)).toBe('tile');
    expect(tile.querySelector('.tile')).not.toBeNull();
    expect(tile.querySelector('video, img, a')).toBeNull();
  });

  it('is hidden, asking nothing, for an exercise with no demo', async () => {
    stubVideo();
    const { fixture, batch, single, refresh, clipAt } = await render([{ demos: [], name: SQUAT }]);
    const clip = clipAt(0);

    expect(clip.classList.contains('is-none')).toBe(true);
    expect(state(clip)).toBe('none');
    await near(fixture, clip);

    expect(clip.classList.contains('is-none')).toBe(true);
    expect(clip.children).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
    expect(single).not.toHaveBeenCalled();
  });

  it('waits for a press where the browser has no IntersectionObserver, then asks as the person’s own and plays', async () => {
    const media = stubVideo();
    const { fixture, host, batch, demoClips, clipAt } = await render(
      [
        { demos: [video('clip-1')], name: SQUAT },
        { demos: [video('clip-2')], name: 'Plank', decorative: true },
      ],
      { observer: false, allowed: false },
    );
    const show = vi.spyOn(demoClips, 'show');
    const [clip, thumbnail] = [clipAt(0), clipAt(1)];

    expect(state(clip)).toBe('press');
    expect(query(clip, 'button[data-clip-press]').textContent?.trim()).toBe('Play the demo');
    // A thumbnail has no press of its own: its quiet box, never a play sign nothing answers.
    expect(state(thumbnail)).toBe('waiting');
    expect(thumbnail.querySelector('button, .tile, svg')).toBeNull();
    expect(batch).not.toHaveBeenCalled();

    press(host, 'Play the demo');
    await quiet(fixture);

    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith([video('clip-1')], true);
    expect(state(thumbnail)).toBe('waiting');
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith(['clip-1']);
    const shown = videoOf(clip);
    // Asked to move, so no still: it plays though the visit started paused.
    expect(shown.getAttribute('src')).toBe('/api/media/clip-1/content');
    expect(demoClips.paused()).toBe(false);
    expect(media.play.mock.contexts).toEqual([shown]);
    expect(toggleOf(clip).getAttribute('aria-label')).toBe('Pause the demo');
  });

  it('hands the focus its “Play the demo” held to what takes its place', async () => {
    stubVideo();
    const batch = batchRoute();
    batch.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    const { fixture, clipAt } = await render(
      [
        { demos: [video('clip-1')], name: SQUAT },
        { demos: [{ id: 'link-1', kind: 'VideoLink' }], name: 'Plank' },
        { demos: [{ id: 'photo-1', kind: 'Picture' }], name: 'Side plank' },
        // A workout names its demos by id alone; this one's only demo is a link, which a grant of
        // ids never answers.
        { demos: [{ id: 'link-2', kind: null }], name: 'Walking lunge' },
      ],
      { observer: false, batch },
    );
    const [clip, linked, pictured, unopened] = [clipAt(0), clipAt(1), clipAt(2), clipAt(3)];

    // A grant that could not be read leaves the press, which keeps the focus.
    query<HTMLButtonElement>(clip, 'button[data-clip-press]').focus();
    query<HTMLButtonElement>(clip, 'button[data-clip-press]').click();
    await quiet(fixture);
    expect(state(clip)).toBe('press');
    expect(document.activeElement).toBe(query(clip, 'button[data-clip-press]'));

    // The clip came: its own button takes the focus.
    query<HTMLButtonElement>(clip, 'button[data-clip-press]').click();
    await quiet(fixture);
    expect(document.activeElement).toBe(toggleOf(clip));

    // A link: its watch link takes it.
    query<HTMLButtonElement>(linked, 'button[data-clip-press]').focus();
    query<HTMLButtonElement>(linked, 'button[data-clip-press]').click();
    await quiet(fixture);
    expect(document.activeElement).toBe(query(linked, 'a[data-watch-external]'));

    // A picture: the picture itself, which its alt names (focusable by script alone).
    query<HTMLButtonElement>(pictured, 'button[data-clip-press]').focus();
    query<HTMLButtonElement>(pictured, 'button[data-clip-press]').click();
    await quiet(fixture);
    const picture = query<HTMLImageElement>(pictured, 'img');
    expect(picture.getAttribute('tabindex')).toBe('-1');
    expect(picture.getAttribute('alt')).toBe('How to do Side plank');
    expect(document.activeElement).toBe(picture);

    // Nothing to show: the clip stays and says so, and its words take the focus.
    query<HTMLButtonElement>(unopened, 'button[data-clip-press]').focus();
    query<HTMLButtonElement>(unopened, 'button[data-clip-press]').click();
    await quiet(fixture);
    expect(batch).toHaveBeenLastCalledWith(['link-2']);
    expect(state(unopened)).toBe('empty');
    expect(unopened.classList.contains('is-none')).toBe(false);
    const words = query<HTMLParagraphElement>(unopened, 'p[data-clip-empty]');
    expect(words.textContent?.trim()).toBe('This demo can’t be opened.');
    expect(words.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(words);
  });

  it('reads “Show the demo” where the pool says its demo is a picture, and “Play the demo” otherwise', async () => {
    stubVideo();
    const { fixture, host, clipAt } = await render(
      [
        {
          demos: [
            { id: 'link-1', kind: 'VideoLink' },
            { id: 'photo-1', kind: 'Picture' },
          ],
          name: SQUAT,
        },
        { demos: [{ id: 'photo-2', kind: 'Picture' }, video('clip-1')], name: 'Plank' },
        // A workout's ids alone may be a video or a picture.
        { demos: [{ id: 'photo-3', kind: null }], name: 'Side plank' },
      ],
      { observer: false },
    );
    const words = (clip: Element) => query(clip, 'button[data-clip-press]').textContent?.trim();

    expect(words(clipAt(0))).toBe('Show the demo');
    expect(words(clipAt(1))).toBe('Play the demo');
    expect(words(clipAt(2))).toBe('Play the demo');

    press(host, 'Show the demo');
    await quiet(fixture);

    expect(query(clipAt(0), 'img').getAttribute('src')).toBe('/api/media/photo-1/content');
  });

  it('folds away, saying nothing, when what it finds by itself is nothing to show', async () => {
    stubVideo();
    const { fixture, clipAt } = await render([
      { demos: [{ id: 'link-1', kind: null }], name: SQUAT },
    ]);
    const clip = clipAt(0);

    await near(fixture, clip);

    expect(state(clip)).toBe('none');
    expect(clip.classList.contains('is-none')).toBe(true);
    expect(clip.querySelector('[data-clip-empty]')).toBeNull();
  });

  it('takes no focus after a press that did not hold it', async () => {
    stubVideo();
    const { fixture, clipAt } = await render([{ demos: [video('clip-1')], name: SQUAT }], {
      observer: false,
    });
    const clip = clipAt(0);
    const outside = document.createElement('button');
    document.body.append(outside);
    try {
      outside.focus();

      // A press with the mouse, as Safari makes it: the button never takes the focus.
      query<HTMLButtonElement>(clip, 'button[data-clip-press]').click();
      await quiet(fixture);

      expect(toggleOf(clip)).toBeTruthy();
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });

  it('offers “Play the demo” when its grant could not be read, and the press asks again', async () => {
    stubVideo();
    const batch = batchRoute();
    batch.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    const { fixture, host, demoClips, clipAt } = await render(
      [{ demos: [video('clip-1')], name: SQUAT }],
      { batch },
    );
    const clip = clipAt(0);
    const show = vi.spyOn(demoClips, 'show');

    await near(fixture, clip);
    expect(state(clip)).toBe('press');
    expect(button(host, 'Play the demo').hasAttribute('data-clip-press')).toBe(true);

    press(host, 'Play the demo');
    await quiet(fixture);

    expect(show).toHaveBeenLastCalledWith([video('clip-1')], true);
    expect(batch).toHaveBeenCalledTimes(2);
    expect(videoOf(clip).getAttribute('src')).toBe('/api/media/clip-1/content');
    expect(videoOf(clip).paused).toBe(false);
  });

  it('keeps the observer’s word after a press: a clip scrolled away while its grant came does not play', async () => {
    const media = stubVideo();
    const pending = new Subject<MediaAccessBatchView>();
    const batch = batchRoute();
    batch
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })))
      .mockReturnValueOnce(pending);
    const { fixture, host, clipAt } = await render([{ demos: [video('clip-1')], name: SQUAT }], {
      batch,
    });
    const clip = clipAt(0);
    await near(fixture, clip);
    expect(state(clip)).toBe('press');

    press(host, 'Play the demo');
    await quiet(fixture);
    expect(batch).toHaveBeenCalledTimes(2);
    expect(state(clip)).toBe('loading');

    // Scrolled away while the grant is on its way; it comes after.
    await near(fixture, clip, false);
    pending.next({ items: [held('clip-1')!] });
    pending.complete();
    await quiet(fixture);

    expect(state(clip)).toBe('ready');
    expect(media.play).not.toHaveBeenCalled();
    expect(videoOf(clip).paused).toBe(true);

    // Back on the screen, it plays.
    await near(fixture, clip);
    expect(media.play.mock.contexts).toEqual([videoOf(clip)]);
    expect(videoOf(clip).paused).toBe(false);
  });

  it('asks a fresh grant once when its bytes are refused and plays on, then gives up on a second refusal', async () => {
    const media = stubVideo();
    const { fixture, batch, clipAt } = await render([{ demos: [video('clip-1')], name: SQUAT }]);
    const clip = clipAt(0);
    await near(fixture, clip);
    const shown = videoOf(clip);
    media.play.mockClear();

    // The 30-minute grant ran out: the next range request was refused.
    shown.dispatchEvent(new Event('error'));
    await quiet(fixture);

    expect(batch).toHaveBeenCalledTimes(2);
    expect(batch).toHaveBeenLastCalledWith(['clip-1']);
    expect(media.load.mock.contexts).toEqual([shown]);
    expect(shown.getAttribute('src')).toBe('/api/media/clip-1/content');
    // Loading again stopped it without a pause event; it starts again and says so.
    expect(media.play.mock.contexts).toContain(shown);
    expect(shown.paused).toBe(false);
    expect(toggleOf(clip).getAttribute('aria-label')).toBe('Pause the demo');

    shown.dispatchEvent(new Event('error'));
    await quiet(fixture);

    expect(batch).toHaveBeenCalledTimes(2);
    expect(state(clip)).toBe('none');
    expect(clip.classList.contains('is-none')).toBe(true);
    expect(clip.querySelector('video')).toBeNull();
  });

  it('offers “Play the demo” when its fresh grant could not be asked for, as nothing was refused, and asks once more after it', async () => {
    stubVideo();
    const { fixture, host, batch, clipAt } = await render([
      { demos: [video('clip-1')], name: SQUAT },
    ]);
    const clip = clipAt(0);
    await near(fixture, clip);
    const first = videoOf(clip);
    // The 30-minute grant ran out on a weak signal, and the fresh one's request never got through.
    batch.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })));

    first.dispatchEvent(new Event('error'));
    await quiet(fixture);

    expect(batch).toHaveBeenCalledTimes(2);
    expect(state(clip)).toBe('press');
    expect(clip.classList.contains('is-none')).toBe(false);
    expect(clip.querySelector('video')).toBeNull();
    // Its bytes were let go.
    expect(first.hasAttribute('src')).toBe(false);
    expect(button(host, 'Play the demo').hasAttribute('data-clip-press')).toBe(true);

    press(host, 'Play the demo');
    await quiet(fixture);

    expect(batch).toHaveBeenCalledTimes(3);
    const again = videoOf(clip);
    expect(again.getAttribute('src')).toBe('/api/media/clip-1/content');
    expect(again.paused).toBe(false);

    // Its bytes refused after that ask a fresh grant once more, as a first refusal does.
    again.dispatchEvent(new Event('error'));
    await quiet(fixture);

    expect(batch).toHaveBeenCalledTimes(4);
    expect(state(clip)).toBe('ready');
    expect(videoOf(clip)).toBe(again);
  });

  it('keeps a list’s thumbnail whose fresh grant could not be asked for a quiet box, and asks again when it next comes near', async () => {
    stubVideo();
    const { fixture, batch, clipAt } = await render([
      { demos: [video('clip-1')], name: SQUAT, decorative: true },
    ]);
    const thumbnail = clipAt(0);
    await near(fixture, thumbnail);
    batch.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));

    videoOf(thumbnail).dispatchEvent(new Event('error'));
    await quiet(fixture);

    expect(batch).toHaveBeenCalledTimes(2);
    expect(state(thumbnail)).toBe('waiting');
    expect(thumbnail.querySelector('video, button, .tile, svg')).toBeNull();

    await near(fixture, thumbnail, false);
    await near(fixture, thumbnail);

    expect(batch).toHaveBeenCalledTimes(3);
    expect(state(thumbnail)).toBe('ready');
    expect(videoOf(thumbnail).paused).toBe(false);
  });

  it('keeps a still a still when its fresh grant reloads it', async () => {
    const media = stubVideo();
    const { fixture, batch, clipAt } = await render([{ demos: [video('clip-1')], name: SQUAT }], {
      allowed: false,
    });
    const clip = clipAt(0);
    await near(fixture, clip);
    const shown = videoOf(clip);

    shown.dispatchEvent(new Event('error'));
    await quiet(fixture);

    expect(batch).toHaveBeenCalledTimes(2);
    expect(media.load.mock.contexts).toEqual([shown]);
    expect(media.play).not.toHaveBeenCalled();
    expect(toggleOf(clip).getAttribute('aria-label')).toBe('Play the demo');
  });

  it('hides a picture whose bytes and fresh grant are both refused', async () => {
    stubVideo();
    const batch = batchRoute();
    const { fixture, clipAt } = await render(
      [{ demos: [{ id: 'photo-1', kind: 'Picture' }], name: SQUAT }],
      { batch },
    );
    const clip = clipAt(0);
    await near(fixture, clip);
    batch.mockReturnValueOnce(of({ items: [] }));

    query(clip, 'img').dispatchEvent(new Event('error'));
    await quiet(fixture);

    expect(batch).toHaveBeenCalledTimes(2);
    expect(state(clip)).toBe('none');
    expect(clip.querySelector('img')).toBeNull();
  });

  it('asks nothing again for a new array of the same demos, and starts over for others', async () => {
    const media = stubVideo();
    const { fixture, batch, clipAt } = await render([{ demos: [video('clip-1')], name: SQUAT }]);
    const clip = clipAt(0);
    await near(fixture, clip);
    const first = videoOf(clip);

    // Every read of a workout builds its arrays anew.
    fixture.componentInstance.clips.set([{ demos: [video('clip-1')], name: SQUAT }]);
    await quiet(fixture);

    expect(batch).toHaveBeenCalledTimes(1);
    expect(videoOf(clip)).toBe(first);
    expect(media.load).not.toHaveBeenCalled();

    fixture.componentInstance.clips.set([{ demos: [video('clip-2')], name: SQUAT }]);
    await quiet(fixture);

    // The first clip let go of its bytes, and the new one is asked for at once: it is on screen.
    expect(first.hasAttribute('src')).toBe(false);
    expect(media.load.mock.contexts).toContain(first);
    expect(batch).toHaveBeenCalledTimes(2);
    expect(batch).toHaveBeenLastCalledWith(['clip-2']);
    expect(videoOf(clip).getAttribute('src')).toBe('/api/media/clip-2/content');
    expect(videoOf(clip).paused).toBe(false);
  });

  it('stops watching and lets its clip go when it is destroyed', async () => {
    const media = stubVideo();
    const { fixture, clipAt } = await render([{ demos: [video('clip-1')], name: SQUAT }]);
    const clip = clipAt(0);
    await near(fixture, clip);
    const shown = videoOf(clip);
    const observer = observerOf(clip);

    fixture.componentInstance.clips.set([]);
    await quiet(fixture);

    expect(observer.disconnected).toBe(true);
    expect(media.pause.mock.contexts).toContain(shown);
    expect(shown.hasAttribute('src')).toBe(false);
    expect(media.load.mock.contexts).toContain(shown);
  });

  it('starts the thumbnails the browser held back when the person presses the page’s “Play demos”', async () => {
    const media = stubVideo();
    media.refuse('NotAllowedError');
    const { fixture, host, clipAt } = await render(
      [
        { demos: [video('clip-1')], name: SQUAT, decorative: true },
        { demos: [video('clip-2')], name: 'Plank', decorative: true },
      ],
      { toggle: true },
    );
    await near(fixture, clipAt(0));
    await near(fixture, clipAt(1));
    expect(media.play).toHaveBeenCalledTimes(2);
    expect(videoOf(clipAt(0)).paused).toBe(true);

    // The press is the person's own: the browser lets the page start them now.
    media.refuse(null);
    press(host, 'Pause demos');
    await quiet(fixture);
    press(host, 'Play demos');
    await quiet(fixture);

    expect(videoOf(clipAt(0)).paused).toBe(false);
    expect(videoOf(clipAt(1)).paused).toBe(false);
  });

  it('pauses a list’s thumbnails with the page’s one “Pause demos”, and plays them with “Play demos”', async () => {
    stubVideo();
    const { fixture, host, demoClips, clipAt } = await render(
      [
        { demos: [video('clip-1')], name: SQUAT, decorative: true },
        { demos: [video('clip-2')], name: 'Plank', decorative: true },
      ],
      { toggle: true },
    );
    await near(fixture, clipAt(0));
    await near(fixture, clipAt(1));
    expect(videoOf(clipAt(0)).paused).toBe(false);

    press(host, 'Pause demos');
    await quiet(fixture);

    expect(demoClips.paused()).toBe(true);
    expect(videoOf(clipAt(0)).paused).toBe(true);
    expect(videoOf(clipAt(1)).paused).toBe(true);

    press(host, 'Play demos');
    await quiet(fixture);

    expect(demoClips.paused()).toBe(false);
    expect(videoOf(clipAt(0)).paused).toBe(false);
    expect(videoOf(clipAt(1)).paused).toBe(false);
  });

  it('keeps a list’s thumbnail a quiet box when its grant could not be read, and asks again when it next comes near', async () => {
    const media = stubVideo();
    const batch = batchRoute();
    batch.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    const { fixture, demoClips, clipAt } = await render(
      [{ demos: [video('clip-1')], name: SQUAT, decorative: true }],
      { batch },
    );
    const thumbnail = clipAt(0);
    const show = vi.spyOn(demoClips, 'show');

    await near(fixture, thumbnail);

    // No play sign nothing answers: the quiet box it was before it asked.
    expect(batch).toHaveBeenCalledTimes(1);
    expect(state(thumbnail)).toBe('waiting');
    expect(thumbnail.querySelector('button, .tile, svg, video, img')).toBeNull();
    expect(thumbnail.classList.contains('is-none')).toBe(false);

    await near(fixture, thumbnail, false);
    expect(batch).toHaveBeenCalledTimes(1);
    await near(fixture, thumbnail);

    expect(show).toHaveBeenLastCalledWith([video('clip-1')], false);
    expect(batch).toHaveBeenCalledTimes(2);
    expect(state(thumbnail)).toBe('ready');
    expect(media.play.mock.contexts).toEqual([videoOf(thumbnail)]);
  });

  it('asks again for the thumbnails held back near the screen when the person presses “Play demos”, past a busy visit', async () => {
    const media = stubVideo();
    const { fixture, host, batch, demoClips, clipAt } = await render(
      [
        { demos: [video('clip-near')], name: SQUAT, decorative: true },
        { demos: [video('clip-away')], name: 'Plank', decorative: true },
      ],
      { toggle: true },
    );
    const [shown, away] = [clipAt(0), clipAt(1)];
    // The visit already holds as many grants as it should.
    await Promise.all(
      Array.from({ length: LIVE_GRANTS }, (_, index) => demoClips.show([video(`clip-${index}`)])),
    );
    const sent = batch.mock.calls.length;
    const show = vi.spyOn(demoClips, 'show');

    await near(fixture, shown);
    await near(fixture, away);

    // Held back without a request: quiet boxes, never a play sign that can't be pressed.
    expect(show).toHaveBeenCalledTimes(2);
    expect(batch).toHaveBeenCalledTimes(sent);
    for (const thumbnail of [shown, away]) {
      expect(state(thumbnail)).toBe('waiting');
      expect(thumbnail.querySelector('button, .tile, svg, video')).toBeNull();
    }

    // Coming near again asks again; the busy visit holds it back again, asking the server nothing.
    await near(fixture, shown, false);
    await near(fixture, shown);
    expect(show).toHaveBeenCalledTimes(3);
    expect(show).toHaveBeenLastCalledWith([video('clip-near')], false);
    expect(batch).toHaveBeenCalledTimes(sent);
    expect(state(shown)).toBe('waiting');

    // "Play demos" is the person's own ask, for the thumbnails near the screen alone.
    await near(fixture, away, false);
    press(host, 'Pause demos');
    await quiet(fixture);
    expect(show).toHaveBeenCalledTimes(3);
    press(host, 'Play demos');
    await quiet(fixture);

    expect(show).toHaveBeenCalledTimes(4);
    expect(show).toHaveBeenLastCalledWith([video('clip-near')], true);
    expect(batch).toHaveBeenCalledTimes(sent + 1);
    expect(batch).toHaveBeenLastCalledWith(['clip-near']);
    expect(state(shown)).toBe('ready');
    expect(media.play.mock.contexts).toEqual([videoOf(shown)]);
    expect(state(away)).toBe('waiting');
  });
});
