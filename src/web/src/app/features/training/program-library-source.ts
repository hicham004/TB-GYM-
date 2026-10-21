import { signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiClient } from '../../core/api/api-client';
import type {
  ExercisePatternCount,
  ExerciseView,
  SavedSessionView,
} from '../../core/api/generated';
import type { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import type { SearchPage } from '../../ui/paged-search';
import {
  groupPatterns,
  libraryExercise,
  type LibraryExercise,
  type LibraryGroup,
} from './program-builder.models';
import { numeric } from './training-builder.models';

/** A picture the server granted for an exercise's first media, by media id. */
export type LibraryThumbs = ReadonlyMap<string, string>;

/** What a library list asks the server for: words typed and a movement chip. */
export interface LibraryFilter {
  readonly query: string;
  readonly group: LibraryGroup;
}

export const NO_LIBRARY_FILTER: LibraryFilter = { query: '', group: 'all' };

/** A page of the library, as the Exercises page pages it. */
export const LIBRARY_PAGE_SIZE = 48;
/** The server grants at most 32 pictures a call (MED-005) and reads at most 100 exercises by id. */
const GRANT_BATCH = 32;
const IDS_BATCH = 100;
/**
 * Pictures granted a visit at most, as the builders granted when they read the whole library: each grant is a
 * cookie of its own for 30 minutes, and a browser keeps only so many for one site. Tiles past it keep letters.
 */
const GRANTS_A_VISIT = 96;

/**
 * What the program builder and Edit weeks read of the exercise library (audit WEA-14), so a library of
 * hundreds costs what one of 25 does. The first page, by name, is read once a visit and shared by the
 * library beside the grid and the add sheet; a search or a chip asks the server for its own pages; the
 * program's lifts and the swaps approved for them are read by id; and each picture is granted once, for the
 * rows a page brings. Every exercise read on the visit stays known, with the swaps it offers named, so names,
 * swaps and demos never need the rest.
 */
export class ProgramLibrarySource {
  readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  readonly first = signal<SearchPage<LibraryExercise> | null>(null);
  /** The library's count of exercises under each movement pattern: the chips it can offer. */
  readonly patterns = signal<readonly ExercisePatternCount[]>([]);
  readonly saved = signal<readonly SavedSessionView[]>([]);
  readonly known = signal<ReadonlyMap<string, LibraryExercise>>(new Map());
  readonly thumbs = signal<LibraryThumbs>(new Map());
  /** Moves with every read of the first page and every workspace switch: each list starts again. */
  readonly generation = signal(0);
  /** Ids asked for by id, answered, archived or on their way, so none is asked twice. */
  private readonly asked = new Set<string>();
  /** Ids whose read failed: asked for again with the next read of the library, not on every edit. */
  private readonly failed = new Set<string>();
  /** Pictures asked for, so a row in two lists, or shown again, is granted once. */
  private readonly granting = new Set<string>();
  private runs = 0;

  constructor(
    private readonly api: ApiClient,
    private readonly scope: TenantAsyncScope,
    private readonly freshToken: () => Promise<void>,
  ) {
    scope.onReset(() => this.clear());
  }

  /** The first page and the saved sessions, once a visit, for every list on the page. */
  load(): Promise<void> {
    return this.scope.run('library', async (owner) => {
      this.state.set('loading');
      for (const id of this.failed) this.asked.delete(id);
      this.failed.clear();
      this.generation.update((value) => value + 1);
      try {
        const [page, saved] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.searchExercises({ take: LIBRARY_PAGE_SIZE, patterns: true })),
            firstValueFrom(this.api.listSavedSessions()),
          ]),
        );
        this.first.set({ items: this.adopt(page.items), total: numeric(page.total) });
        this.patterns.set(page.patterns);
        this.saved.set(saved);
        this.state.set('ready');
      } catch {
        if (owner.current) this.state.set('error');
      }
    });
  }

  /**
   * One page of what a list asks for, from `skip`. Each list reads in its own `lane`, where a newer search
   * makes an older one obsolete; an obsolete answer, or one from before a workspace switch, is null.
   */
  search(
    lane: string,
    filter: LibraryFilter,
    skip: number,
  ): Promise<SearchPage<LibraryExercise> | null> {
    return this.scope.run(
      `library:${lane}`,
      async (owner) => {
        const page = await owner.wait(
          firstValueFrom(
            this.api.searchExercises({
              query: filter.query.trim() || undefined,
              movementPatterns: filter.group === 'all' ? undefined : groupPatterns(filter.group),
              skip,
              take: LIBRARY_PAGE_SIZE,
            }),
          ),
        );
        return { items: this.adopt(page.items), total: numeric(page.total) };
      },
      null,
    );
  }

  /**
   * Reads by id, a hundred at a time, the lifts a program needs that this visit has not read. One that is
   * archived is not asked for again. A read that fails is the library's error, so the panel says so and its
   * Try again reads the library, and these lifts, again; the program keeps its own names meanwhile.
   */
  async ensure(ids: readonly string[]): Promise<void> {
    const wanted = [...new Set(ids)].filter((id) => !this.known().has(id) && !this.asked.has(id));
    if (wanted.length === 0) return;
    for (const id of wanted) this.asked.add(id);
    await this.scope.run(`library:by-id:${++this.runs}`, async (owner) => {
      try {
        for (let start = 0; start < wanted.length; start += IDS_BATCH) {
          const page = await owner.wait(
            firstValueFrom(
              this.api.searchExercises({
                ids: wanted.slice(start, start + IDS_BATCH),
                take: IDS_BATCH,
              }),
            ),
          );
          this.adopt(page.items);
        }
      } catch {
        if (owner.current) {
          for (const id of wanted.filter((item) => !this.known().has(item))) this.failed.add(id);
          this.state.set('error');
        }
      }
    });
  }

  /**
   * Pictures for these rows' tiles: each exercise's first media, granted once, 32 to a request, up to
   * GRANTS_A_VISIT. A request that fails leaves its pictures, and the ones after it, to be asked for again.
   */
  async grant(items: readonly LibraryExercise[]): Promise<void> {
    const room = GRANTS_A_VISIT - this.granting.size;
    const ids = [...new Set(items.flatMap((item) => (item.mediaId ? [item.mediaId] : [])))]
      .filter((id) => !this.granting.has(id))
      .slice(0, Math.max(0, room));
    if (ids.length === 0) return;
    for (const id of ids) this.granting.add(id);
    await this.scope.run(`library:thumbs:${++this.runs}`, async (owner) => {
      let start = 0;
      try {
        await owner.wait(this.freshToken());
        for (; start < ids.length; start += GRANT_BATCH) {
          const batch = await owner.wait(
            firstValueFrom(this.api.createMediaAccessBatch(ids.slice(start, start + GRANT_BATCH))),
          );
          const thumbs = new Map(this.thumbs());
          for (const item of batch.items) {
            if (item.kind === 'Image') thumbs.set(item.assetId, item.thumbnailUrl ?? item.url);
          }
          this.thumbs.set(thumbs);
        }
      } catch {
        // The tiles keep their initials, and a later list asks for these pictures again.
        if (owner.current) {
          for (const id of ids.slice(start)) this.granting.delete(id);
        }
      }
    });
  }

  /** Every exercise read stays known by id; an archived one is never offered. */
  private adopt(views: readonly ExerciseView[]): LibraryExercise[] {
    const items = views.filter((view) => !view.isArchived).map(libraryExercise);
    // A page of lifts already known changes nothing that reads them, such as the builder's grid.
    if (items.some((item) => !this.known().has(item.id))) {
      this.known.update((known) => {
        const next = new Map(known);
        for (const item of items) next.set(item.id, item);
        return next;
      });
    }
    return items;
  }

  private clear(): void {
    this.state.set('loading');
    this.first.set(null);
    this.patterns.set([]);
    this.saved.set([]);
    this.known.set(new Map());
    this.thumbs.set(new Map());
    this.asked.clear();
    this.failed.clear();
    this.granting.clear();
    this.generation.update((value) => value + 1);
  }
}
