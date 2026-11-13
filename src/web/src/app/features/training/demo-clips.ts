import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { MediaAccessView } from '../../core/api/generated';
import { Motion } from '../../core/motion/motion';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { externalVideo } from './external-video';

/** The row `tb-motion-off` names to stop the clips alone (notes plan N9b4). */
export const CLIP_MOMENT = 'N9b4';

/** What the pool says a demo is before it is granted (`PoolDemoKind`). */
export type ClipKind = 'Picture' | 'Video' | 'VideoLink';

/** One demo of an exercise; `kind` is null where a read names the ids alone (a workout's exercises). */
export interface ClipDemo {
  readonly id: string;
  readonly kind: ClipKind | null;
}

/** What a clip shows once its demo is granted. */
export type ClipMedia =
  | { readonly kind: 'video' | 'picture'; readonly id: string; readonly url: string }
  | {
      readonly kind: 'link';
      readonly id: string;
      readonly provider: 'YouTube' | 'Vimeo';
      readonly url: string;
    };

/**
 * A clip's answer: the media to show, `none` when there is nothing it can show, or `press` when it
 * waits for the person: this visit holds as many grants as it should, or the grant could not be read.
 */
export type ClipAnswer = ClipMedia | 'none' | 'press';

/** The server's batch limit (`MediaAccessBatchPolicy.MaximumAssets`), above `CLIP_BATCH`. */
export const GRANT_BATCH = 32;

/** Ids a request: each grant is a ~420-byte cookie; nginx's 4 KB header buffer 502s at about 9. */
export const CLIP_BATCH = 6;

/**
 * Grants a visit keeps live before a clip waits for a press: each granted upload is a cookie of its
 * own for the grant's 30 minutes, and a browser keeps only so many for one site (the builder's
 * library panel stops at the same number, `program-library-source.ts`).
 */
export const LIVE_GRANTS = 96;

/** A grant is asked again after this long, inside the server's default 30 minutes (MED-004). */
const FRESH_MS = 20 * 60_000;
/** How long a granted upload's cookie lives on the server's default. */
const COOKIE_MS = 30 * 60_000;

/**
 * Which demo of an exercise a clip shows, where the pool says what each is: the first video, else
 * the first picture, else the first link (in the house's order). Null for ids alone or none.
 */
export function chosenDemo(demos: readonly ClipDemo[]): ClipDemo | null {
  return (
    demos.find((demo) => demo.kind === 'Video') ??
    demos.find((demo) => demo.kind === 'Picture') ??
    demos.find((demo) => demo.kind === 'VideoLink') ??
    null
  );
}

/** A grant as a clip shows it; null for a link that is not a YouTube or Vimeo page. */
export function clipMedia(view: MediaAccessView): ClipMedia | null {
  if (view.source === 'ExternalEmbed') {
    const page = externalVideo(view);
    return page ? { kind: 'link', id: view.assetId, provider: page.provider, url: page.url } : null;
  }
  return { kind: view.kind === 'Image' ? 'picture' : 'video', id: view.assetId, url: view.url };
}

interface Grant {
  /** The grant, or null when the server refused it (missing, not allowed or not ready). */
  readonly view: MediaAccessView | null;
  readonly at: number;
  /** Left out of a batch, which leaves out every link too: no answer for a link's own ask. */
  readonly leftOut?: true;
}

interface Waiting {
  readonly ids: readonly string[];
  /** The workspace's turn it was asked in: a later one never sends it. */
  readonly generation: number;
  readonly resolve: (granted: boolean) => void;
}

/**
 * The exercise demos that play like a GIF (notes plan N9b4, C20's fourth slice): every clip on a
 * screen asks here when it is first seen. Grants go through the media grant every demo uses
 * (MED-004, MED-005), gathered per moment into batch requests of six at most after one antiforgery
 * read, and kept for 20 minutes, so scrolling back and forth asks nothing twice and a list never
 * spends the person's write allowance (the server counts grants with their set saves). A workspace
 * change forgets them all. One pause holds for every clip: it starts paused for a person who asked
 * for reduced motion or less data, and the pause or play they choose then holds until they leave.
 */
@Injectable({ providedIn: 'root' })
export class DemoClips {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly document = inject(DOCUMENT);
  private readonly pausedState = signal(this.startsPaused(inject(Motion)));
  private readonly grants = new Map<string, Grant>();
  /** Ids on their way to the server, so a second clip waits for the same answer. */
  private readonly asked = new Map<string, Promise<boolean>>();
  private queue: Waiting[] = [];
  private flushing: ReturnType<typeof setTimeout> | null = null;
  private tenant: string | null = null;
  private generation = 0;

  /** Whether the clips are paused: the person's choice, or reduced motion or less data at first. */
  readonly paused = this.pausedState.asReadonly();

  constructor() {
    inject(TenantContext).onChange(() => this.forget());
  }

  pause(): void {
    this.pausedState.set(true);
  }

  play(): void {
    this.pausedState.set(false);
  }

  /**
   * What a clip shows for an exercise's demos. Where the pool names their kinds it shows the
   * first video, else the first picture, else the first link; where only ids are known (a
   * workout's exercise) it grants them together and shows the first uploaded video, else the first
   * uploaded picture, and leaves a link to the screen's own Watch demo. `pressed` is the person's
   * own ask, which a busy visit does not hold back.
   */
  async show(demos: readonly ClipDemo[], pressed = false): Promise<ClipAnswer> {
    if (demos.length === 0) return 'none';
    const chosen = chosenDemo(demos);
    if (chosen?.kind === 'VideoLink') return this.link(chosen.id);
    const ids = chosen ? [chosen.id] : demos.map((demo) => demo.id);
    const views = await this.uploads(ids, pressed);
    if (views === 'press') return 'press';
    const granted = ids
      .map((id) => views.get(id))
      .filter((view): view is MediaAccessView => view !== undefined && view.source === 'Upload');
    const shown =
      granted.find((view) => view.kind === 'Video') ??
      granted.find((view) => view.kind === 'Image');
    return (shown && clipMedia(shown)) ?? 'none';
  }

  /**
   * Asks the grant of a clip again, as when its 30 minutes ran out while it was on screen: null when
   * the server refused it, `press` when the ask could not be made (no connection, a server error),
   * which refuses nothing.
   */
  async renew(id: string): Promise<ClipMedia | null | 'press'> {
    this.grants.delete(id);
    const views = await this.uploads([id], true);
    if (views === 'press') return 'press';
    const view = views.get(id);
    return view ? clipMedia(view) : null;
  }

  /** The uploads among `ids` the server grants now, from those kept or one batch; `press` if not asked. */
  private async uploads(
    ids: readonly string[],
    pressed: boolean,
  ): Promise<ReadonlyMap<string, MediaAccessView> | 'press'> {
    this.followTenant();
    const now = this.now();
    const wanted = [...new Set(ids)].filter((id) => !this.fresh(this.grants.get(id), now));
    const missing = wanted.filter((id) => !this.asked.has(id));
    if (missing.length > 0) {
      // Asks still on their way count too, or one moment's crowd of clips would pass the cap.
      if (!pressed && this.live(now) + this.asked.size + missing.length > LIVE_GRANTS) {
        return 'press';
      }
      const generation = this.generation;
      const ask = new Promise<boolean>((resolve) => {
        this.queue.push({ ids: missing, generation, resolve });
        this.flushing ??= setTimeout(() => void this.flush(), 0);
      });
      for (const id of missing) this.asked.set(id, ask);
      void ask.then(() => {
        for (const id of missing) if (this.asked.get(id) === ask) this.asked.delete(id);
      });
    }
    const answers = await Promise.all(wanted.map((id) => this.asked.get(id) ?? true));
    if (answers.some((granted) => !granted)) return 'press';
    const views = new Map<string, MediaAccessView>();
    for (const id of ids) {
      const view = this.grants.get(id)?.view;
      if (view) views.set(id, view);
    }
    return views;
  }

  /** A link's grant: the batch never answers for a link, so it is asked on its own (no cookie). */
  private async link(id: string): Promise<ClipAnswer> {
    this.followTenant();
    const kept = this.grants.get(id);
    // A batch's silence (a workout's ids are granted together) says nothing about a link.
    if (this.fresh(kept, this.now()) && !kept?.leftOut) {
      return (kept?.view && clipMedia(kept.view)) ?? 'none';
    }
    const generation = this.generation;
    try {
      await this.csrf.refresh();
      if (this.moved(generation)) return 'press';
      const view = await firstValueFrom(this.api.createMediaAccess(id));
      if (this.moved(generation)) return 'press';
      this.grants.set(id, { view, at: this.now() });
      return clipMedia(view) ?? 'none';
    } catch (error) {
      if (this.moved(generation)) return 'press';
      if (refused(error)) {
        this.grants.set(id, { view: null, at: this.now() });
        return 'none';
      }
      return 'press';
    }
  }

  /** Sends what the clips asked for in this moment: one antiforgery read, then six ids a request. */
  private async flush(): Promise<void> {
    this.flushing = null;
    this.followTenant();
    const generation = this.generation;
    // What an earlier workspace asked for is never sent under this one's header.
    const waiting = this.queue.filter((item) => item.generation === generation);
    this.queue
      .filter((item) => item.generation !== generation)
      .forEach((item) => item.resolve(false));
    this.queue = [];
    const ids = [...new Set(waiting.flatMap((item) => item.ids))];
    if (ids.length === 0) return;
    const failed = new Set<string>();
    try {
      await this.csrf.refresh();
      for (let start = 0; start < ids.length; start += CLIP_BATCH) {
        // The workspace can change while the antiforgery read or an earlier batch is on its way.
        if (this.moved(generation)) break;
        const batch = ids.slice(start, start + CLIP_BATCH);
        try {
          const answer = await firstValueFrom(this.api.createMediaAccessBatch(batch));
          if (this.moved(generation)) break;
          const at = this.now();
          const granted = new Map(answer.items.map((view) => [view.assetId, view]));
          // A batch leaves out what it refuses (and every link): kept as refused for a while.
          for (const id of batch) {
            const view = granted.get(id);
            this.grants.set(id, view ? { view, at } : { view: null, at, leftOut: true });
          }
        } catch {
          batch.forEach((id) => failed.add(id));
        }
      }
    } catch {
      ids.forEach((id) => failed.add(id));
    }
    const current = generation === this.generation;
    for (const item of waiting) item.resolve(current && item.ids.every((id) => !failed.has(id)));
  }

  /** Grants are the workspace's: a change of workspace or of session forgets every one. */
  private followTenant(): void {
    const tenant = this.tenants.selectedTenantId();
    if (tenant !== this.tenant) {
      this.forget();
      this.tenant = tenant;
    }
  }

  private forget(): void {
    ++this.generation;
    this.grants.clear();
    this.asked.clear();
  }

  /** Whether the workspace changed since an ask of `generation` was made: it is then dropped. */
  private moved(generation: number): boolean {
    this.followTenant();
    return generation !== this.generation;
  }

  private fresh(grant: Grant | undefined, now: number): boolean {
    return grant !== undefined && now - grant.at < FRESH_MS;
  }

  /** Uploads granted in the last 30 minutes: each still holds its cookie. */
  private live(now: number): number {
    let count = 0;
    for (const grant of this.grants.values()) {
      if (grant.view?.source === 'Upload' && now - grant.at < COOKIE_MS) count++;
    }
    return count;
  }

  private now(): number {
    return this.document.defaultView?.performance?.now() ?? 0;
  }

  /** Paused at first for a person who asked for reduced motion (or the motion switch) or for less data. */
  private startsPaused(motion: Motion): boolean {
    const connection = (this.document.defaultView?.navigator as NavigatorWithData | undefined)
      ?.connection;
    return !motion.allowed(CLIP_MOMENT) || connection?.saveData === true;
  }
}

interface NavigatorWithData extends Navigator {
  readonly connection?: { readonly saveData?: boolean };
}

/** The server's refusals of a grant: missing or not allowed (404) and not ready yet (409). */
function refused(error: unknown): boolean {
  return error instanceof HttpErrorResponse && (error.status === 404 || error.status === 409);
}
