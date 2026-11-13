import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { MediaAccessBatchView, MediaAccessView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { access } from '../../../testing/exercise-fixtures';
import { fakeMotion, provideFakeMotion } from '../../../testing/motion-fake';
import {
  chosenDemo,
  CLIP_BATCH,
  CLIP_MOMENT,
  type ClipDemo,
  clipMedia,
  DemoClips,
  GRANT_BATCH,
  LIVE_GRANTS,
} from './demo-clips';

type Batch = Mock<(ids: readonly string[]) => Observable<MediaAccessBatchView>>;
type Single = Mock<(id: string) => Observable<MediaAccessView>>;

const MINUTE = 60_000;
const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** An uploaded clip's grant, as the server answers it. */
function clip(id: string): MediaAccessView {
  return access({
    assetId: id,
    kind: 'Video',
    contentType: 'video/webm',
    url: `/api/media/${id}/content`,
    downloadAllowed: false,
  });
}

/** An uploaded picture's grant. */
function photo(id: string): MediaAccessView {
  return access({ assetId: id, url: `/api/media/${id}/content`, downloadAllowed: false });
}

/** A YouTube link's grant: its `url` is the embed address, which is never shown; the watch page is. */
function youtube(id: string): MediaAccessView {
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

/** What the house holds, by the id's first word: `photo-`, `link-`, `gone-` (refused), else a clip. */
function held(id: string): MediaAccessView | null {
  if (id.startsWith('gone-')) return null;
  if (id.startsWith('photo-')) return photo(id);
  if (id.startsWith('link-')) return youtube(id);
  return clip(id);
}

/**
 * The server's two grant routes over `held`. The batch answers granted uploads alone: what it
 * refuses, and every link, it leaves out (MediaApplicationService.cs:566-574).
 */
function server(): { batch: Batch; single: Single } {
  return {
    batch: vi.fn((ids: readonly string[]) =>
      of({
        items: ids.map(held).filter((view): view is MediaAccessView => view?.source === 'Upload'),
      }),
    ),
    single: vi.fn((id: string) => {
      const view = held(id);
      return view ? of(view) : throwError(() => new HttpErrorResponse({ status: 404 }));
    }),
  };
}

const video = (id: string): ClipDemo => ({ id, kind: 'Video' });
const picture = (id: string): ClipDemo => ({ id, kind: 'Picture' });
const link = (id: string): ClipDemo => ({ id, kind: 'VideoLink' });
/** A workout's demo: the read names its id alone. */
const idAlone = (id: string): ClipDemo => ({ id, kind: null });

const shownVideo = (id: string) => ({ kind: 'video', id, url: `/api/media/${id}/content` });
const shownPicture = (id: string) => ({ kind: 'picture', id, url: `/api/media/${id}/content` });
const shownLink = (id: string) => ({ kind: 'link', id, provider: 'YouTube', url: WATCH });

function setup(
  options: {
    allowed?: boolean;
    batch?: Batch;
    single?: Single;
    refresh?: Mock<() => Promise<void>>;
  } = {},
) {
  const routes = server();
  const batch = options.batch ?? routes.batch;
  const single = options.single ?? routes.single;
  const refresh = options.refresh ?? vi.fn(() => Promise.resolve());
  const workspace = signal<string | null>('house');
  const motion = fakeMotion({ allowed: options.allowed ?? true });
  TestBed.configureTestingModule({
    providers: [
      {
        provide: ApiClient,
        useValue: { createMediaAccessBatch: batch, createMediaAccess: single },
      },
      { provide: CsrfService, useValue: { refresh } },
      { provide: TenantStore, useValue: { selectedTenantId: workspace } },
      provideFakeMotion(motion),
    ],
  });
  return {
    clips: TestBed.inject(DemoClips),
    context: TestBed.inject(TenantContext),
    batch,
    single,
    refresh,
    workspace,
    motion,
  };
}

/** The page's clock, which the grants are timed by (`performance.now()`); `pass` moves it on. */
function clock() {
  let now = 5_000;
  vi.spyOn(document.defaultView!.performance, 'now').mockImplementation(() => now);
  return {
    pass(ms: number): void {
      now += ms;
    },
  };
}

/** An antiforgery read the test answers when it chooses. */
function heldRead() {
  let answer!: () => void;
  const refresh = vi.fn(() => new Promise<void>((resolve) => (answer = resolve)));
  return { refresh, answer: () => answer() };
}

/** Lets the moment end, so the asks gathered in it are sent. */
const nextMoment = () => new Promise((resolve) => setTimeout(resolve));

const ids = (count: number, from = 0) =>
  Array.from({ length: count }, (_, index) => `clip-${from + index}`);

describe('chosenDemo', () => {
  it('picks the first video, else the first picture, else the first link, in the house’s order', () => {
    expect(
      chosenDemo([picture('photo-1'), link('link-1'), video('clip-1'), video('clip-2')]),
    ).toEqual(video('clip-1'));
    expect(chosenDemo([link('link-1'), picture('photo-1'), picture('photo-2')])).toEqual(
      picture('photo-1'),
    );
    expect(chosenDemo([link('link-1'), link('link-2')])).toEqual(link('link-1'));
  });

  it('chooses nothing where the read names ids alone, or there is nothing', () => {
    expect(chosenDemo([idAlone('clip-1'), idAlone('photo-1')])).toBeNull();
    expect(chosenDemo([])).toBeNull();
  });
});

describe('clipMedia', () => {
  it('shows an upload by its kind and a link by its watch page, never its embed address', () => {
    expect(clipMedia(clip('clip-1'))).toEqual(shownVideo('clip-1'));
    expect(clipMedia(photo('photo-1'))).toEqual(shownPicture('photo-1'));
    expect(clipMedia(youtube('link-1'))).toEqual(shownLink('link-1'));
    expect(
      clipMedia({
        ...youtube('link-2'),
        externalProvider: 'Vimeo',
        watchUrl: 'https://vimeo.com/76979871',
      }),
    ).toEqual({ kind: 'link', id: 'link-2', provider: 'Vimeo', url: 'https://vimeo.com/76979871' });
  });

  it('shows nothing for a link whose address is not a YouTube or Vimeo watch page', () => {
    expect(
      clipMedia({ ...youtube('link-1'), watchUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ' }),
    ).toBeNull();
    expect(clipMedia({ ...youtube('link-1'), watchUrl: null })).toBeNull();
  });
});

describe('DemoClips', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  describe('which demo a clip shows', () => {
    it('shows the first video the pool names, granting it alone', async () => {
      const { clips, batch, single } = setup();

      const shown = await clips.show([
        picture('photo-1'),
        link('link-1'),
        video('clip-1'),
        video('clip-2'),
      ]);

      expect(shown).toEqual(shownVideo('clip-1'));
      expect(batch).toHaveBeenCalledTimes(1);
      expect(batch).toHaveBeenCalledWith(['clip-1']);
      expect(single).not.toHaveBeenCalled();
    });

    it('shows the first picture where the pool names no video', async () => {
      const { clips, batch } = setup();

      expect(await clips.show([link('link-1'), picture('photo-1'), picture('photo-2')])).toEqual(
        shownPicture('photo-1'),
      );
      expect(batch).toHaveBeenCalledWith(['photo-1']);
    });

    it('opens a link alone on its own page: one grant on the single route, after the antiforgery read', async () => {
      const { clips, batch, single, refresh } = setup();

      expect(await clips.show([link('link-1'), link('link-2')])).toEqual(shownLink('link-1'));
      expect(single).toHaveBeenCalledTimes(1);
      expect(single).toHaveBeenCalledWith('link-1');
      expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(single.mock.invocationCallOrder[0]);
      // The batch never answers for a link, so it is not asked.
      expect(batch).not.toHaveBeenCalled();

      // Kept like any grant: another clip of it asks nothing.
      expect(await clips.show([link('link-1')])).toEqual(shownLink('link-1'));
      expect(single).toHaveBeenCalledTimes(1);
    });

    it('grants a workout’s ids together and shows the first uploaded video, else the first picture', async () => {
      const { clips, batch } = setup();

      expect(
        await clips.show([
          idAlone('photo-1'),
          idAlone('link-1'),
          idAlone('clip-1'),
          idAlone('clip-2'),
        ]),
      ).toEqual(shownVideo('clip-1'));
      expect(batch).toHaveBeenCalledTimes(1);
      expect(batch).toHaveBeenCalledWith(['photo-1', 'link-1', 'clip-1', 'clip-2']);

      expect(await clips.show([idAlone('link-2'), idAlone('photo-2'), idAlone('photo-3')])).toEqual(
        shownPicture('photo-2'),
      );
    });

    it('shows nothing for a workout’s link alone, which the screen’s own Watch demo opens', async () => {
      const { clips, batch, single } = setup();

      expect(await clips.show([idAlone('link-1')])).toBe('none');
      expect(batch).toHaveBeenCalledWith(['link-1']);
      expect(single).not.toHaveBeenCalled();
    });

    it('shows nothing, asking nothing, for an exercise with no demo', async () => {
      const { clips, batch, single, refresh } = setup();

      expect(await clips.show([])).toBe('none');
      expect(refresh).not.toHaveBeenCalled();
      expect(batch).not.toHaveBeenCalled();
      expect(single).not.toHaveBeenCalled();
    });

    it('still opens a link the pool names after a workout’s grant left it out', async () => {
      const { clips, batch, single } = setup();

      // The player's grant of a workout's ids: the batch leaves the link out, as it does every link.
      expect(await clips.show([idAlone('link-1')])).toBe('none');
      expect(batch).toHaveBeenCalledWith(['link-1']);

      // The pool's page, in the same visit: the link opens on its own page all the same.
      expect(await clips.show([link('link-1')])).toEqual(shownLink('link-1'));
      expect(single).toHaveBeenCalledWith('link-1');
    });
  });

  describe('asking for grants', () => {
    it('gathers the asks of one moment into one batch, after one antiforgery read', async () => {
      const { clips, batch, refresh } = setup();

      const shown = await Promise.all([
        clips.show([video('clip-1')]),
        clips.show([picture('photo-1')]),
        clips.show([idAlone('clip-2'), idAlone('photo-2')]),
      ]);

      expect(shown).toEqual([shownVideo('clip-1'), shownPicture('photo-1'), shownVideo('clip-2')]);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(batch).toHaveBeenCalledTimes(1);
      expect(batch).toHaveBeenCalledWith(['clip-1', 'photo-1', 'clip-2', 'photo-2']);
      expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(batch.mock.invocationCallOrder[0]);
    });

    it('asks six ids a request at most, all after one antiforgery read', async () => {
      const { clips, batch, refresh } = setup();
      const many = ids(13);

      const shown = await Promise.all(many.map((id) => clips.show([video(id)])));

      expect(shown).toEqual(many.map(shownVideo));
      expect(refresh).toHaveBeenCalledTimes(1);
      // Each grant is a cookie of about 420 bytes in the answer; nginx's 4 KB header buffer refuses
      // about nine, so a request asks six, well inside the server's own limit.
      expect(batch.mock.calls.map(([asked]) => asked)).toEqual([
        many.slice(0, 6),
        many.slice(6, 12),
        [many[12]],
      ]);
      expect(CLIP_BATCH).toBe(6);
      expect(CLIP_BATCH).toBeLessThanOrEqual(GRANT_BATCH);
      expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(batch.mock.invocationCallOrder[0]);
    });

    it('asks once for a demo two clips show, in one moment or while its grant is on its way', async () => {
      const pending = new Subject<MediaAccessBatchView>();
      const routes = server();
      routes.batch.mockReturnValueOnce(pending);
      const { clips, batch } = setup({ batch: routes.batch });

      const first = clips.show([video('clip-1')]);
      const second = clips.show([video('clip-1'), picture('photo-1')]);
      await nextMoment();
      expect(batch).toHaveBeenCalledTimes(1);
      expect(batch).toHaveBeenCalledWith(['clip-1']);

      // A third clip of it, a moment later, waits for the same answer.
      const third = clips.show([video('clip-1')]);
      await nextMoment();
      expect(batch).toHaveBeenCalledTimes(1);

      pending.next({ items: [clip('clip-1')] });
      pending.complete();
      expect(await Promise.all([first, second, third])).toEqual([
        shownVideo('clip-1'),
        shownVideo('clip-1'),
        shownVideo('clip-1'),
      ]);
    });

    it('keeps a grant for 20 minutes, then asks again', async () => {
      const time = clock();
      const { clips, batch } = setup();

      await clips.show([video('clip-1')]);
      time.pass(20 * MINUTE - 1);
      expect(await clips.show([video('clip-1')])).toEqual(shownVideo('clip-1'));
      expect(batch).toHaveBeenCalledTimes(1);

      time.pass(1);
      expect(await clips.show([video('clip-1')])).toEqual(shownVideo('clip-1'));
      expect(batch).toHaveBeenCalledTimes(2);
    });

    it('keeps a refusal: a demo the batch leaves out shows nothing and is not asked again for a while', async () => {
      const time = clock();
      const { clips, batch } = setup();

      expect(await clips.show([video('gone-1')])).toBe('none');
      expect(await clips.show([video('gone-1')])).toBe('none');
      expect(batch).toHaveBeenCalledTimes(1);

      time.pass(20 * MINUTE);
      expect(await clips.show([video('gone-1')])).toBe('none');
      expect(batch).toHaveBeenCalledTimes(2);
    });

    it('waits for a press when a batch fails, and asks again the next time', async () => {
      const routes = server();
      routes.batch.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
      const { clips, batch } = setup({ batch: routes.batch });

      expect(await clips.show([video('clip-1')])).toBe('press');
      expect(await clips.show([video('clip-1')])).toEqual(shownVideo('clip-1'));
      expect(batch).toHaveBeenCalledTimes(2);
    });

    it('answers the first batch’s clips when only the second fails', async () => {
      const routes = server();
      routes.batch
        .mockImplementationOnce((asked) => of({ items: asked.map(clip) }))
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
      const { clips } = setup({ batch: routes.batch });
      const many = ids(CLIP_BATCH + 1);

      const shown = await Promise.all(many.map((id) => clips.show([video(id)])));

      expect(shown.slice(0, CLIP_BATCH)).toEqual(many.slice(0, CLIP_BATCH).map(shownVideo));
      expect(shown[CLIP_BATCH]).toBe('press');
    });

    it('waits for a press, sending nothing, when the antiforgery read fails', async () => {
      const refresh = vi.fn(() => Promise.reject(new HttpErrorResponse({ status: 0 })));
      const { clips, batch } = setup({ refresh });

      expect(await clips.show([video('clip-1')])).toBe('press');
      expect(batch).not.toHaveBeenCalled();
    });

    it('asks a fresh grant on renew, even for one it keeps, and answers null for a refused one', async () => {
      const { clips, batch } = setup();

      await clips.show([video('clip-1')]);
      expect(await clips.renew('clip-1')).toEqual(shownVideo('clip-1'));
      expect(batch).toHaveBeenCalledTimes(2);
      expect(batch).toHaveBeenLastCalledWith(['clip-1']);

      expect(await clips.renew('gone-1')).toBeNull();
    });

    it('tells a renewal that could not be asked from a refusal: press, and the next one asks again', async () => {
      const routes = server();
      routes.batch
        .mockImplementationOnce((asked) => of({ items: asked.map(clip) }))
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })))
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
      const { clips, batch } = setup({ batch: routes.batch });

      await clips.show([video('clip-1')]);
      // The connection dropped, then the server failed: neither refused the clip.
      expect(await clips.renew('clip-1')).toBe('press');
      expect(await clips.renew('clip-1')).toBe('press');
      expect(await clips.renew('clip-1')).toEqual(shownVideo('clip-1'));
      expect(batch).toHaveBeenCalledTimes(4);
    });

    it('answers press for a renewal whose antiforgery read fails, sending nothing', async () => {
      const refresh = vi
        .fn<() => Promise<void>>()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
      const { clips, batch } = setup({ refresh });

      await clips.show([video('clip-1')]);
      expect(await clips.renew('clip-1')).toBe('press');
      expect(batch).toHaveBeenCalledTimes(1);
    });
  });

  describe('the cap on live grants', () => {
    it('holds a clip back past 96 live grants until the person presses, and lets a pressed one through', async () => {
      const time = clock();
      const { clips, batch } = setup();
      const first = ids(LIVE_GRANTS);

      expect(await Promise.all(first.map((id) => clips.show([video(id)])))).toEqual(
        first.map(shownVideo),
      );
      expect(batch).toHaveBeenCalledTimes(LIVE_GRANTS / CLIP_BATCH);

      expect(await clips.show([video('clip-more')])).toBe('press');
      expect(batch).toHaveBeenCalledTimes(LIVE_GRANTS / CLIP_BATCH);
      // What it keeps still shows: only a new grant waits.
      expect(await clips.show([video('clip-0')])).toEqual(shownVideo('clip-0'));

      expect(await clips.show([video('clip-more')], true)).toEqual(shownVideo('clip-more'));
      expect(batch).toHaveBeenLastCalledWith(['clip-more']);

      // A granted upload's cookie lives 30 minutes: then the visit holds none, and a clip asks by itself.
      time.pass(30 * MINUTE);
      expect(await clips.show([video('clip-later')])).toEqual(shownVideo('clip-later'));
    });

    it('holds back a crowd of more than 96 clips asking in one moment', async () => {
      const { clips, batch } = setup();
      const crowd = ids(LIVE_GRANTS + 4);

      const shown = await Promise.all(crowd.map((id) => clips.show([video(id)])));

      expect(shown.filter((answer) => answer === 'press')).toHaveLength(4);
      expect(batch.mock.calls.flatMap(([asked]) => asked)).toHaveLength(LIVE_GRANTS);
    });

    it('counts no refusal and no link against the cap: they leave no cookie', async () => {
      const { clips, batch, single } = setup();
      const refused = Array.from({ length: LIVE_GRANTS }, (_, index) => `gone-${index}`);
      const links = Array.from({ length: LIVE_GRANTS }, (_, index) => `link-${index}`);

      expect(await Promise.all(refused.map((id) => clips.show([video(id)])))).toEqual(
        refused.map(() => 'none'),
      );
      expect(await clips.show([video('clip-1')])).toEqual(shownVideo('clip-1'));

      // A link's grant, on the single route, is kept with its page but sets no cookie: a visit that
      // opened as many links as the cap still has an upload granted without a press.
      expect(await Promise.all(links.map((id) => clips.show([link(id)])))).toEqual(
        links.map((id) => shownLink(id)),
      );
      expect(single).toHaveBeenCalledTimes(LIVE_GRANTS);
      expect(await clips.show([video('clip-2')])).toEqual(shownVideo('clip-2'));
      expect(batch).toHaveBeenLastCalledWith(['clip-2']);
    });
  });

  describe('a link’s own grant', () => {
    it('shows nothing when the server refuses it (404 or 409), keeping that, and waits for a press on any other failure', async () => {
      const single: Single = vi
        .fn<(id: string) => Observable<MediaAccessView>>()
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })))
        .mockReturnValueOnce(
          throwError(
            () => new HttpErrorResponse({ status: 409, error: { code: 'media_not_ready' } }),
          ),
        )
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
        .mockImplementation((id) => of(youtube(id)));
      const { clips } = setup({ single });

      expect(await clips.show([link('link-1')])).toBe('none');
      expect(await clips.show([link('link-1')])).toBe('none');
      expect(single).toHaveBeenCalledTimes(1);

      expect(await clips.show([link('link-2')])).toBe('none');

      expect(await clips.show([link('link-3')])).toBe('press');
      expect(await clips.show([link('link-3')])).toEqual(shownLink('link-3'));
      expect(single).toHaveBeenCalledTimes(4);
    });

    it('shows nothing for a link whose page is not a YouTube or Vimeo watch page', async () => {
      const single: Single = vi.fn((id: string) =>
        of({ ...youtube(id), watchUrl: 'javascript:alert(1)' }),
      );
      const { clips } = setup({ single });

      expect(await clips.show([link('link-1')])).toBe('none');
    });
  });

  describe('a change of workspace', () => {
    it('forgets every grant when the chosen workspace changes or the context is reset', async () => {
      const { clips, batch, single, workspace, context } = setup();

      await clips.show([video('clip-1')]);
      await clips.show([link('link-1')]);
      workspace.set('atlas');
      await clips.show([video('clip-1')]);
      await clips.show([link('link-1')]);
      expect(batch).toHaveBeenCalledTimes(2);
      expect(single).toHaveBeenCalledTimes(2);

      context.invalidate();
      await clips.show([video('clip-1')]);
      await clips.show([link('link-1')]);
      expect(batch).toHaveBeenCalledTimes(3);
      expect(single).toHaveBeenCalledTimes(3);
    });

    it('never sends what was asked before the change: the asks wait for a press', async () => {
      const { clips, batch, refresh, context } = setup();

      const asked = clips.show([video('clip-1')]);
      context.invalidate();

      expect(await asked).toBe('press');
      expect(refresh).not.toHaveBeenCalled();
      expect(batch).not.toHaveBeenCalled();
    });

    it('never sends what was asked before the chosen workspace changed', async () => {
      const { clips, batch, workspace } = setup();

      const asked = clips.show([video('clip-1')]);
      workspace.set('atlas');

      expect(await asked).toBe('press');
      expect(batch).not.toHaveBeenCalled();
    });

    it('never sends a batch when the workspace changes while the antiforgery read is on its way', async () => {
      const read = heldRead();
      const { clips, batch, context } = setup({ refresh: read.refresh });

      const asked = clips.show([video('clip-1')]);
      await nextMoment();
      expect(read.refresh).toHaveBeenCalledTimes(1);
      context.invalidate();
      read.answer();

      expect(await asked).toBe('press');
      expect(batch).not.toHaveBeenCalled();
    });

    it('keeps no answer that comes back after the workspace changed', async () => {
      const pending = new Subject<MediaAccessBatchView>();
      const routes = server();
      routes.batch.mockReturnValueOnce(pending);
      const { clips, batch, context } = setup({ batch: routes.batch });

      const asked = clips.show([video('clip-1')]);
      await nextMoment();
      expect(batch).toHaveBeenCalledTimes(1);
      context.invalidate();
      pending.next({ items: [clip('clip-1')] });
      pending.complete();

      expect(await asked).toBe('press');
      // Asked again under the new workspace: the earlier answer was not kept.
      expect(await clips.show([video('clip-1')])).toEqual(shownVideo('clip-1'));
      expect(batch).toHaveBeenCalledTimes(2);
    });

    it('never sends the second batch of an earlier workspace', async () => {
      const pending = new Subject<MediaAccessBatchView>();
      const routes = server();
      routes.batch.mockReturnValueOnce(pending);
      const { clips, batch, context } = setup({ batch: routes.batch });
      const many = ids(CLIP_BATCH + 1);

      const asked = Promise.all(many.map((id) => clips.show([video(id)])));
      await nextMoment();
      context.invalidate();
      pending.next({ items: many.slice(0, CLIP_BATCH).map(clip) });
      pending.complete();

      expect((await asked).every((answer) => answer === 'press')).toBe(true);
      expect(batch).toHaveBeenCalledTimes(1);
    });

    it('never asks a link’s grant when the workspace changes while the antiforgery read is on its way', async () => {
      const read = heldRead();
      const { clips, single, context } = setup({ refresh: read.refresh });

      const asked = clips.show([link('link-1')]);
      expect(read.refresh).toHaveBeenCalledTimes(1);
      context.invalidate();
      read.answer();

      expect(await asked).toBe('press');
      expect(single).not.toHaveBeenCalled();
    });

    it('keeps no link answer that comes back after the workspace changed', async () => {
      const pending = new Subject<MediaAccessView>();
      const routes = server();
      routes.single.mockReturnValueOnce(pending);
      const { clips, single, context } = setup({ single: routes.single });

      const asked = clips.show([link('link-1')]);
      await nextMoment();
      expect(single).toHaveBeenCalledTimes(1);
      context.invalidate();
      pending.next(youtube('link-1'));
      pending.complete();

      expect(await asked).toBe('press');
      expect(await clips.show([link('link-1')])).toEqual(shownLink('link-1'));
      expect(single).toHaveBeenCalledTimes(2);
    });
  });

  describe('the pause', () => {
    it('starts paused for a person who asked for reduced motion or switched the clips off', () => {
      const { clips, motion } = setup({ allowed: false });

      expect(clips.paused()).toBe(true);
      expect(motion.allowed).toHaveBeenCalledWith(CLIP_MOMENT);
    });

    it('starts playing where motion is allowed', () => {
      const { clips } = setup({ allowed: true });

      expect(clips.paused()).toBe(false);
    });

    it('starts paused on a connection saving data, even where motion is allowed', () => {
      const navigator = document.defaultView!.navigator;
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: { saveData: true },
      });
      try {
        const { clips } = setup({ allowed: true });

        expect(clips.paused()).toBe(true);
      } finally {
        Reflect.deleteProperty(navigator, 'connection');
      }
    });

    it('pauses and plays at the person’s word', () => {
      const { clips } = setup({ allowed: true });

      clips.pause();
      expect(clips.paused()).toBe(true);
      clips.play();
      expect(clips.paused()).toBe(false);
    });
  });
});
