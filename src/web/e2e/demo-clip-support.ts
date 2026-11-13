import type { Browser, Locator, Page, Route } from '@playwright/test';
import type { MediaAccessView } from '../src/app/core/api/generated';
import { expect, json } from './support';

/**
 * The exercise demos that play like a GIF (notes plan N9b4), in mocked checks. Nothing is committed
 * (the repo is public, NOTES-PLAN N9b6): each worker records its own clip in its own browser, and a
 * check serves it from the grant's same-origin address, never a data: or blob: one, because the
 * production content policy allows neither for media.
 */
type Handler = (route: Route) => Promise<void> | void;

/** A grant that never runs out in a mocked run, whatever the zone or the day. */
const EXPIRES = '2099-01-01T00:00:00Z';

/** The YouTube page a link demo opens, as the server builds it. */
export const YOUTUBE_WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** A 4 by 3 PNG, standing in for an uploaded picture demo. */
export const PICTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGM4siAPjhhwcgCuMhXZQnoZuwAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * A one-second WebM the browser records itself, once per worker:
 * `test.beforeAll(async ({ browser }) => { clip = await recordClip(browser); })`.
 * A bar rises and falls smoothly on a still background: no full-frame flashing (WCAG 2.3.1).
 */
export async function recordClip(browser: Browser): Promise<Buffer> {
  const page = await browser.newPage(); // about:blank
  try {
    const dataUrl = await page.evaluate(async () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 160, height: 120 });
      const paint = canvas.getContext('2d')!;
      const recorder = new MediaRecorder(canvas.captureStream(15), { mimeType: 'video/webm' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const stopped = new Promise((resolve) => (recorder.onstop = resolve));
      recorder.start();
      for (let frame = 0; frame < 20; frame++) {
        const height = 20 + Math.round(70 * Math.sin((Math.PI * frame) / 19));
        paint.fillStyle = '#d9ed94';
        paint.fillRect(0, 0, 160, 120);
        paint.fillStyle = '#2e6b4f';
        paint.fillRect(70, 110 - height, 20, height);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      recorder.stop();
      await stopped;
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(new Blob(chunks, { type: 'video/webm' }));
      });
    });
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  } finally {
    await page.close();
  }
}

/** The grant of an uploaded video: its bytes come from `/api/media/<id>/content`. */
export function clipGrant(
  assetId: string,
  overrides: Partial<MediaAccessView> = {},
): MediaAccessView {
  return {
    assetId,
    kind: 'Video',
    source: 'Upload',
    contentType: 'video/webm',
    url: `/api/media/${assetId}/content`,
    expiresAtUtc: EXPIRES,
    downloadAllowed: false,
    thumbnailUrl: null,
    ...overrides,
  };
}

/** The grant of an uploaded picture: its bytes come from `/api/media/<id>/content`. */
export function pictureGrant(
  assetId: string,
  overrides: Partial<MediaAccessView> = {},
): MediaAccessView {
  return clipGrant(assetId, { kind: 'Image', contentType: 'image/png', ...overrides });
}

/** The grant of a YouTube link: it opens on YouTube, and is asked on its own (never in a batch). */
export function linkGrant(
  assetId: string,
  watchUrl = YOUTUBE_WATCH,
  overrides: Partial<MediaAccessView> = {},
): MediaAccessView {
  return clipGrant(assetId, {
    source: 'ExternalEmbed',
    contentType: null,
    url: watchUrl,
    externalProvider: 'YouTube',
    watchUrl,
    externalTitle: null,
    ...overrides,
  });
}

/** What a page asked the batch grant for: one entry per request, its ids in order. */
export type BatchAsks = string[][];

/**
 * `POST /api/media/access` answered from the grants it knows, as the server does: what it does not
 * know, and every link, is left out of `items`. Each request's `assetIds` go into `asked`.
 */
export function grantBatch(grants: Iterable<MediaAccessView>, asked: BatchAsks = []): Handler {
  const known = new Map([...grants].map((grant) => [grant.assetId, grant]));
  return (route) => {
    const { assetIds } = route.request().postDataJSON() as { assetIds: string[] };
    asked.push([...assetIds]);
    const items = assetIds
      .map((id) => known.get(id))
      .filter((grant): grant is MediaAccessView => grant?.source === 'Upload');
    return json(route, 200, { items });
  };
}

/**
 * The handlers a page needs for its demos: the batch grant, each demo's own grant (a link's, or one
 * a demo sheet asks for on a press), and the bytes of every upload (a clip's WebM, a picture's PNG).
 * Spread into `mockSession`'s `extra`.
 */
export function demoHandlers(
  clip: Buffer,
  grants: Iterable<MediaAccessView>,
  asked: BatchAsks = [],
): Record<string, Handler> {
  const all = [...grants];
  const handlers: Record<string, Handler> = { 'POST /api/media/access': grantBatch(all, asked) };
  for (const grant of all) {
    handlers[`POST /api/media/${grant.assetId}/access`] = (route) => json(route, 200, grant);
    if (grant.source === 'Upload') {
      const body = grant.kind === 'Video' ? clip : PICTURE;
      const contentType =
        grant.contentType ?? (grant.kind === 'Video' ? 'video/webm' : 'image/png');
      handlers[`GET ${new URL(grant.url, 'http://e2e.test').pathname}`] = (route) =>
        route.fulfill({ status: 200, contentType, body });
    }
  }
  return handlers;
}

/** One request a page made for media, in the order it made them. */
export interface MediaRequest {
  readonly method: string;
  readonly path: string;
  /** The batch grant's ids, for `POST /api/media/access`. */
  readonly assetIds?: readonly string[];
  /** The workspace the app named (`X-Tenant-Id`); null for the browser's own request for bytes. */
  readonly tenant: string | null;
}

/**
 * Records every request under `/api/media/` from now on, so a check can say what was asked, when
 * and in which order (a grant before its bytes, nothing for a clip not yet seen).
 */
export function watchMedia(page: Page): MediaRequest[] {
  const requests: MediaRequest[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/media/')) return;
    const assetIds =
      request.method() === 'POST' && url.pathname === '/api/media/access'
        ? ((request.postDataJSON() as { assetIds?: string[] } | null)?.assetIds ?? [])
        : undefined;
    requests.push({
      method: request.method(),
      path: url.pathname,
      assetIds,
      tenant: request.headers()['x-tenant-id'] ?? null,
    });
  });
  return requests;
}

/** The batch grants among `requests`, each one's ids. */
export function batchesOf(requests: readonly MediaRequest[]): (readonly string[])[] {
  return requests
    .filter((request) => request.method === 'POST' && request.path === '/api/media/access')
    .map((request) => request.assetIds ?? []);
}

/** What a clip's `<video>` says of itself, as properties: a static `muted` attribute does not mute. */
export interface ClipState {
  readonly readyState: number;
  readonly currentTime: number;
  readonly paused: boolean;
  readonly muted: boolean;
  readonly mutedAttribute: boolean;
  readonly loop: boolean;
  readonly autoplay: boolean;
  readonly controls: boolean;
  readonly playsInline: boolean;
  readonly preload: string;
  readonly src: string | null;
  readonly currentSrc: string;
  readonly played: number;
  readonly error: number | null;
}

export function clipState(video: Locator): Promise<ClipState> {
  return video.evaluate((element: HTMLVideoElement) => ({
    readyState: element.readyState,
    currentTime: element.currentTime,
    paused: element.paused,
    muted: element.muted,
    mutedAttribute: element.hasAttribute('muted'),
    loop: element.loop,
    autoplay: element.autoplay,
    controls: element.controls,
    playsInline: element.playsInline,
    preload: element.preload,
    src: element.getAttribute('src'),
    currentSrc: element.currentSrc,
    played: element.played.length,
    error: element.error?.code ?? null,
  }));
}

/** A clip as the row designs it: muted (the property), looping, inline; `controls` where kept. */
export async function expectClipProperties(
  video: Locator,
  options: { controls?: boolean } = {},
): Promise<void> {
  await expect(video).toHaveJSProperty('muted', true);
  await expect(video).toHaveJSProperty('loop', true);
  await expect(video).toHaveJSProperty('playsInline', true);
  await expect(video).toHaveJSProperty('controls', options.controls ?? false);
}

/** The clip has its frames and plays: not paused, and its time moves on. Never its pixels. */
export async function expectPlaying(video: Locator, timeout = 8000): Promise<void> {
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState), { timeout })
    .toBeGreaterThanOrEqual(2);
  const start = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
  await expect
    .poll(
      () =>
        video.evaluate(
          (element: HTMLVideoElement, from: number) =>
            !element.paused && element.currentTime !== from,
          start,
        ),
      { timeout },
    )
    .toBe(true);
}

/**
 * The clip wraps round: each wrap seeks back to its start and fires `seeked` (measured: five wraps
 * of a 1.2 s WebM in 6 s from a single request). Counted in the page, so it needs no page timers; a
 * seek counts only when it goes back from further on, so a still's seek to its first frame is none.
 */
export async function expectLoops(video: Locator, timeout = 8000): Promise<void> {
  await video.evaluate((element: HTMLVideoElement & { e2eSeeks?: number }) => {
    element.e2eSeeks = 0;
    let furthest = element.currentTime;
    element.addEventListener('timeupdate', () => {
      furthest = Math.max(furthest, element.currentTime);
    });
    element.addEventListener('seeked', () => {
      if (furthest > element.currentTime + 0.3) element.e2eSeeks = (element.e2eSeeks ?? 0) + 1;
      furthest = element.currentTime;
    });
  });
  await expect
    .poll(
      () => video.evaluate((element: HTMLVideoElement & { e2eSeeks?: number }) => element.e2eSeeks),
      { timeout },
    )
    .toBeGreaterThan(0);
}

/**
 * A still for a person who asked for reduced motion: paused on its first frame (`#t=0.001`, preload
 * metadata), and never played.
 */
export async function expectStill(video: Locator): Promise<void> {
  await expect(video).toHaveJSProperty('paused', true);
  await expect(video).toHaveAttribute('src', /#t=0\.001$/);
  await expect(video).toHaveAttribute('preload', 'metadata');
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(1);
  expect((await clipState(video)).played, 'the still has not played').toBe(0);
}
