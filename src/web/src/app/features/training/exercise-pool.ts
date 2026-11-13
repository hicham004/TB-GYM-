import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  LOCALE_ID,
  linkedSignal,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';
import type { PoolExerciseView } from '../../core/api/generated';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { Control, Field } from '../../ui/field';
import { UiMenu } from '../../ui/menu';
import { LIBRARY_SEARCH_PAUSE } from '../../ui/paged-search';
import { Skeleton } from '../../ui/skeleton';
import { DemoClip } from './demo-clip';
import { chosenDemo } from './demo-clips';
import { DemoClipsToggle } from './demo-clips-toggle';
import { ExercisePoolApi, type PoolQuery } from './exercise-pool-api';
import {
  isPoolFiltered,
  NO_POOL_FILTERS,
  poolCard,
  poolChips,
  poolFilterParams,
  poolFiltersFrom,
  poolSummaryLine,
  withPoolFilter,
  type PoolFilterKey,
  type PoolFilters,
} from './exercise-pool.models';
import { ownTrainingClosedWords } from './own-workout.models';

/** One page of the pool, as the picker reads it. */
const PAGE = 50;

type PoolState = 'loading' | 'ready' | 'error' | 'gone' | 'closed';

/**
 * TB Gym's exercise pool for a trainee of the house (notes plan N9b4, LIB-006): its exercises in name
 * order as cards, each with its demo playing like a GIF once it is near the screen, searched and
 * filtered by muscle and equipment as the coach's library is, the filters kept in the address so a
 * search can be shared, reloaded and come back to from an exercise. An exercise opens on its own page.
 * It reads only; the server decides who may (a current client of the house, Training open) and answers
 * 404 in any other space, which the page says in the house's words.
 */
@Component({
  selector: 'app-exercise-pool',
  imports: [
    Button,
    Control,
    DemoClip,
    DemoClipsToggle,
    EmptyState,
    Field,
    RouterLink,
    Skeleton,
    UiMenu,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './exercise-pool.html',
  styleUrl: './exercise-pool.scss',
})
export class ExercisePool {
  private readonly pool = inject(ExercisePoolApi);
  private readonly tenants = inject(TenantStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly locale = inject(LOCALE_ID);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly pause = inject(LIBRARY_SEARCH_PAUSE);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  /** The search this page last put in the address, so its answer never undoes what was typed since. */
  private sentQuery: string | null = null;
  /** Moves with every first page read, so a later page of an older list is dropped. */
  private listVersion = 0;

  protected readonly searchLabel = $localize`Search exercises`;
  protected readonly searchPlaceholder = $localize`Search by name`;
  protected readonly loadingLabel = $localize`Loading the exercises…`;

  private readonly params = toSignal(
    this.route.queryParamMap.pipe(
      map((params) => Object.fromEntries(params.keys.map((key) => [key, params.get(key)]))),
    ),
    { initialValue: {} as Record<string, string | null> },
  );
  protected readonly filters = computed(() => poolFiltersFrom(this.params()));
  /** The read the filters make: the same filters in a new address read nothing again. */
  private readonly requestKey = computed(() => JSON.stringify(this.filters()));
  protected readonly chips = computed(() => poolChips(this.filters()));
  protected readonly filtered = computed(() => isPoolFiltered(this.filters()));
  /** The list's filters, carried to an exercise's page so its way back keeps them. */
  protected readonly linkParams = computed(() => poolFilterParams(this.filters()));
  /**
   * What the search box shows: what is typed, ahead of the address. The address's own search when it
   * changes otherwise (Clear filters, the browser's Back).
   */
  protected readonly searchText = linkedSignal<string, string>({
    source: () => this.filters().query,
    computation: (query, previous) =>
      previous !== undefined && query === this.sentQuery ? previous.value : query,
  });

  protected readonly state = signal<PoolState>('loading');
  /** Why Training is closed, when the pool says it is. */
  private readonly closedReason = signal('');
  private readonly items = signal<readonly PoolExerciseView[]>([]);
  /** The server's rows read so far: where the next page starts. */
  private readonly read = signal(0);
  private readonly total = signal(0);
  /** A new search is on its way; the list shown is the one before it. */
  protected readonly searching = signal(false);
  protected readonly loadingMore = signal(false);
  /** Show more could not read the next page: said beside the button, which stays to try again. */
  protected readonly moreFailed = signal(false);

  protected readonly cards = computed(() => this.items().map(poolCard));
  /** A clip plays by itself only for an uploaded video: one pause for all of them then (WCAG 2.2.2). */
  protected readonly hasVideo = computed(() =>
    this.cards().some((card) => chosenDemo(card.demos)?.kind === 'Video'),
  );
  protected readonly closedWords = computed(() => ownTrainingClosedWords(this.closedReason()));
  /** Nothing in the pool at all, as opposed to nothing matching the filters. */
  protected readonly poolEmpty = computed(
    () => this.state() === 'ready' && this.cards().length === 0 && !this.filtered(),
  );
  /** Nothing matches the search or the filters: the empty state says so, and the status line too. */
  protected readonly noMatch = computed(
    () => this.state() === 'ready' && this.cards().length === 0 && this.filtered(),
  );
  protected readonly summary = computed(() =>
    this.state() === 'ready'
      ? poolSummaryLine(this.total(), this.cards().length, this.filtered(), this.locale)
      : '',
  );
  protected readonly hasMore = computed(
    () => this.state() === 'ready' && !this.searching() && this.read() < this.total(),
  );

  constructor() {
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
    inject(DestroyRef).onDestroy(() => this.stopTyping());
    // Another workspace starts from nothing; the effect below reads it again.
    this.scope.onReset(() => {
      ++this.listVersion;
      this.items.set([]);
      this.read.set(0);
      this.total.set(0);
      this.closedReason.set('');
      this.state.set('loading');
      this.searching.set(false);
      this.loadingMore.set(false);
      this.moreFailed.set(false);
    });
    effect(() => {
      this.scope.epoch();
      this.requestKey();
      if (this.tenants.selectedTenantId()) untracked(() => void this.load());
    });
  }

  // ---------- the filters, in the address ----------

  /** Typing: the search goes once the typing has paused; an emptied box at once. */
  protected typed(text: string): void {
    this.searchText.set(text);
    this.stopTyping();
    const send = () => {
      this.searchTimer = null;
      this.navigate({ ...this.filters(), query: text });
    };
    if (text.trim() === '') send();
    else this.searchTimer = setTimeout(send, this.pause);
  }

  /** A chip applies at once, with what is in the search box. */
  protected setFilter(key: PoolFilterKey, value: string): void {
    this.stopTyping();
    this.navigate(withPoolFilter({ ...this.filters(), query: this.searchText() }, key, value));
  }

  /** Clear filters, or Show all exercises: the whole pool, and focus back in the search box. */
  protected clearFilters(): void {
    this.stopTyping();
    this.searchText.set('');
    this.navigate(NO_POOL_FILTERS);
    afterNextRender(() => this.searchBox()?.nativeElement.focus(), { injector: this.injector });
  }

  private stopTyping(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
  }

  private navigate(filters: PoolFilters): void {
    const params = poolFilterParams(filters);
    this.sentQuery = (params['q'] as string | null) ?? '';
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      replaceUrl: true,
    });
  }

  // ---------- reading ----------

  /** The first page of what the filters find; the list before it stays while it is on its way. */
  protected async load(): Promise<void> {
    const filters = this.filters();
    const version = ++this.listVersion;
    this.loadingMore.set(false);
    this.moreFailed.set(false);
    return this.scope.run('load', async (owner) => {
      if (this.state() === 'ready' && this.cards().length > 0) this.searching.set(true);
      else this.state.set('loading');
      try {
        const page = await owner.wait(firstValueFrom(this.pool.search(this.query(filters, 0))));
        if (version !== this.listVersion) return;
        if (!page.isAllowed) {
          this.close(page.accessReason);
          return;
        }
        this.items.set(this.append([], page.items));
        this.read.set(page.items.length);
        this.total.set(Math.max(Number(page.total), page.items.length));
        this.state.set('ready');
      } catch (error) {
        if (!owner.current || version !== this.listVersion) return;
        this.items.set([]);
        this.read.set(0);
        this.total.set(0);
        // A 404 is no failure: the pool is the house's alone (LIB-006), and this is another space.
        this.state.set(
          error instanceof HttpErrorResponse && error.status === 404 ? 'gone' : 'error',
        );
      } finally {
        if (owner.current && version === this.listVersion) this.searching.set(false);
      }
    });
  }

  /**
   * The next page; focus moves to its first exercise, so a keyboard carries on from where it was. A page
   * that could not be read is said beside the button, which keeps focus to try again.
   */
  protected async more(): Promise<void> {
    // Asked before the lane is taken: a second run in the lane would cancel the first (notes plan N9b3).
    if (this.loadingMore() || !this.hasMore()) return;
    const version = this.listVersion;
    const filters = this.filters();
    const skip = this.read();
    const before = this.cards().length;
    return this.scope.run('more', async (owner) => {
      this.loadingMore.set(true);
      this.moreFailed.set(false);
      try {
        const page = await owner.wait(firstValueFrom(this.pool.search(this.query(filters, skip))));
        if (version !== this.listVersion) return;
        if (!page.isAllowed) {
          this.close(page.accessReason);
          return;
        }
        this.items.update((items) => this.append(items, page.items));
        this.read.update((read) => read + page.items.length);
        // An empty page ends the list, whatever the count said (the pool changed meanwhile).
        this.total.set(page.items.length === 0 ? this.read() : Number(page.total));
        afterNextRender(() => this.cardLink(before)?.focus(), { injector: this.injector });
      } catch {
        if (owner.current && version === this.listVersion) this.moreFailed.set(true);
      } finally {
        if (owner.current && version === this.listVersion) this.loadingMore.set(false);
      }
    });
  }

  /** The link of the card at `index`, which names its exercise and opens it. */
  private cardLink(index: number): HTMLElement | undefined {
    return this.host.nativeElement.querySelectorAll<HTMLElement>('.exercise .name a')[index];
  }

  private query(filters: PoolFilters, skip: number): PoolQuery {
    return {
      query: filters.query,
      skip,
      take: PAGE,
      muscle: filters.muscle,
      equipment: filters.equipment,
    };
  }

  /** Training is closed: the pool lists nothing and says why, in the house's words. */
  private close(reason: string): void {
    this.items.set([]);
    this.read.set(0);
    this.total.set(0);
    this.closedReason.set(reason);
    this.state.set('closed');
  }

  /** `items` then the exercises of `page` it does not hold yet (the pool may change between pages). */
  private append(
    items: readonly PoolExerciseView[],
    page: readonly PoolExerciseView[],
  ): PoolExerciseView[] {
    const seen = new Set(items.map((item) => item.id));
    return [
      ...items,
      ...page.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      }),
    ];
  }
}
