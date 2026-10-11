import type { DialogRef } from '@angular/cdk/dialog';
import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  DestroyRef,
  inject,
  LOCALE_ID,
  linkedSignal,
  signal,
  TemplateRef,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';
import type { ExerciseView, MediaAssetView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import type { HoldsUnsavedWork } from '../../core/forms/leave-guard';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { UiDialog } from '../../ui/dialog';
import { EmptyState } from '../../ui/empty-state';
import { Control, Field } from '../../ui/field';
import { Icon } from '../../ui/icon';
import { UiMenu } from '../../ui/menu';
import type { ModalSurface } from '../../ui/modal-surface';
import { SectionNav } from '../../ui/section-nav';
import { UiSheet } from '../../ui/sheet';
import { Skeleton } from '../../ui/skeleton';
import { UiToast } from '../../ui/toast';
import { ExerciseLibraryApi } from './exercise-library-api';
import {
  type CardCover,
  cardCover,
  coverFromAsset,
  type ExerciseCard,
  exerciseCard,
  exerciseWriteError,
  type FilterKey,
  filterChips,
  filterParams,
  filtersFrom,
  isFiltered,
  type LibraryFilters,
  type LibraryView,
  PAGE_SIZE,
  summaryLine,
  withFilter,
} from './exercise-library.models';
import { ExerciseSheet } from './exercise-sheet';

/** Grants are asked for at most 32 assets at a time (MED-005). */
const GRANT_BATCH = 32;

/**
 * The exercise library (C10, R5.1b): the coach's exercises as cards with their first picture or
 * video, or as a compact list; a search and four filter chips (muscle, pattern, type, equipment) that
 * apply at once and live in the address, so a filtered library can be shared or reopened. New
 * exercise is the one main action; Edit, Archive and Restore sit in each card's menu, and archiving
 * has Undo. Programs already built keep an archived exercise, as they always did.
 */
@Component({
  selector: 'app-exercise-library',
  imports: [
    Button,
    Control,
    EmptyState,
    ExerciseSheet,
    Field,
    Icon,
    SectionNav,
    Skeleton,
    UiConfirm,
    UiMenu,
  ],
  templateUrl: './exercise-library.html',
  styleUrl: './exercise-library.scss',
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class ExerciseLibrary implements HoldsUnsavedWork {
  private readonly api = inject(ExerciseLibraryApi);
  private readonly csrf = inject(CsrfService);
  private readonly sheets = inject(UiSheet);
  private readonly dialogs = inject(UiDialog);
  private readonly toast = inject(UiToast);
  private readonly tenants = inject(TenantStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly sheetTemplate = viewChild.required<TemplateRef<unknown>>('exerciseSheet');
  private readonly confirmDialog = viewChild.required<TemplateRef<unknown>>('confirmDialog');
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private openSheet: DialogRef<unknown, ModalSurface> | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly sections = [
    { label: $localize`Programs`, link: '/training/programs' },
    { label: $localize`Exercises`, link: '/training/exercises' },
  ];
  protected readonly loadingLabel = $localize`Loading your exercises…`;
  protected readonly closeLabel = $localize`Close`;
  protected readonly searchLabel = $localize`Search exercises`;
  protected readonly searchPlaceholder = $localize`Search by name or tag…`;

  private readonly params = toSignal(
    this.route.queryParamMap.pipe(
      map((params) => Object.fromEntries(params.keys.map((key) => [key, params.get(key)]))),
    ),
    { initialValue: {} as Record<string, string | null> },
  );
  protected readonly filters = computed(() => filtersFrom(this.params()));
  protected readonly chips = computed(() => filterChips(this.filters()));
  protected readonly filtered = computed(() => isFiltered(this.filters()));
  /** What the search box shows while typing, ahead of the address it updates. */
  protected readonly searchText = linkedSignal(() => this.filters().query);

  private readonly exercises = signal<ExerciseView[]>([]);
  protected readonly total = signal(0);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly loadingMore = signal(false);
  protected readonly working = signal<string | null>(null);
  private readonly covers = signal<ReadonlyMap<string, CardCover>>(new Map());
  /** The coach's media by id, read once a visit, so a video needs no grant to show as one. */
  private media: Promise<ReadonlyMap<string, MediaAssetView>> | null = null;
  protected readonly sheetExercise = signal<ExerciseView | null | undefined>(undefined);
  private readonly sheetDirty = signal(false);
  protected readonly asking = signal<{ message: string; confirm: string; cancel: string } | null>(
    null,
  );

  protected readonly cards = computed(() => this.exercises().map(exerciseCard));
  protected readonly summary = computed(() =>
    this.state() === 'ready'
      ? summaryLine(this.total(), this.exercises().length, this.filters(), this.locale)
      : '',
  );
  protected readonly hasMore = computed(() => this.exercises().length < this.total());

  /** The request the filters make; the view alone does not reload. */
  private readonly requestKey = computed(() => {
    const filters = this.filters();
    return JSON.stringify({ ...filters, view: null });
  });

  constructor() {
    inject(DestroyRef).onDestroy(inject(UnsavedWork).register(this));
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
    this.scope.onReset(() => {
      this.openSheet?.close();
      this.exercises.set([]);
      this.total.set(0);
      this.covers.set(new Map());
      this.media = null;
      this.state.set('loading');
      this.working.set(null);
    });
    effect(() => {
      this.scope.epoch();
      this.requestKey();
      if (this.tenants.selectedTenantId()) untracked(() => void this.load());
    });
  }

  protected coverOf(card: ExerciseCard): CardCover | null {
    return card.coverId ? (this.covers().get(card.coverId) ?? null) : null;
  }

  // ---------- filters and view, in the address ----------

  protected typed(text: string): void {
    this.searchText.set(text);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.navigate({ ...this.filters(), query: text }), 250);
  }

  protected setFilter(key: FilterKey, value: string): void {
    this.navigate(withFilter(this.filters(), key, value));
  }

  protected toggleArchived(): void {
    this.navigate({ ...this.filters(), archived: !this.filters().archived });
  }

  protected setView(view: LibraryView): void {
    this.navigate({ ...this.filters(), view });
  }

  protected clearFilters(): void {
    this.searchText.set('');
    this.navigate({ ...filtersFrom({}), view: this.filters().view });
  }

  private navigate(filters: LibraryFilters): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: filterParams(filters),
      replaceUrl: true,
    });
  }

  // ---------- reading ----------

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      const filters = this.filters();
      if (this.exercises().length === 0) this.state.set('loading');
      try {
        const page = await owner.wait(firstValueFrom(this.api.search(this.query(filters, 0))));
        this.exercises.set([...page.items]);
        this.total.set(Number(page.total));
        this.state.set('ready');
        void this.loadCovers(page.items);
      } catch {
        if (!owner.current) return;
        this.exercises.set([]);
        this.total.set(0);
        this.state.set('error');
      }
    });
  }

  protected async loadMore(): Promise<void> {
    if (this.loadingMore()) return;
    return this.scope.run('more', async (owner) => {
      this.loadingMore.set(true);
      try {
        const page = await owner.wait(
          firstValueFrom(this.api.search(this.query(this.filters(), this.exercises().length))),
        );
        this.exercises.update((items) => [...items, ...page.items]);
        this.total.set(Number(page.total));
        void this.loadCovers(page.items);
      } catch {
        if (!owner.current) return;
        this.toast.show($localize`More exercises could not be loaded. Try again.`, {
          tone: 'error',
        });
      } finally {
        if (owner.current) this.loadingMore.set(false);
      }
    });
  }

  private query(filters: LibraryFilters, skip: number) {
    return {
      query: filters.query,
      muscle: filters.muscle,
      movementPattern: filters.pattern,
      classification: filters.type,
      equipment: filters.equipment,
      includeArchived: filters.archived,
      skip,
      take: PAGE_SIZE,
    };
  }

  /** The coach's media list (first 100), read once a visit; empty if it cannot be read. */
  private mediaById(): Promise<ReadonlyMap<string, MediaAssetView>> {
    this.media ??= firstValueFrom(this.api.listMedia(0, 100)).then(
      (page) => new Map(page.items.map((item) => [item.id, item] as const)),
      () => new Map<string, MediaAssetView>(),
    );
    return this.media;
  }

  /**
   * Each card's first picture or video. A video shows as a play tile from the media list alone; a
   * picture is granted, in batches. A card whose grant fails keeps its lettered tile; nothing else on
   * the page depends on it.
   */
  private async loadCovers(items: readonly ExerciseView[]): Promise<void> {
    const known = this.covers();
    const wanted = [
      ...new Set(
        items
          .map((item) => item.mediaAssetIds[0])
          .filter((id): id is string => !!id && !known.has(id)),
      ),
    ];
    if (wanted.length === 0) return;
    const media = await this.mediaById();
    const tiles = new Map<string, CardCover>();
    const ids: string[] = [];
    for (const id of wanted) {
      const tile = coverFromAsset(media.get(id));
      if (tile) tiles.set(id, tile);
      else ids.push(id);
    }
    if (tiles.size > 0) this.covers.update((current) => new Map([...current, ...tiles]));
    for (let start = 0; start < ids.length; start += GRANT_BATCH) {
      await this.scope.run('covers', async (owner) => {
        try {
          // A grant is a POST: right after sign-in the antiforgery token must be read first.
          if (start === 0) await owner.wait(this.csrf.refresh());
          const batch = await owner.wait(
            firstValueFrom(this.api.grant(ids.slice(start, start + GRANT_BATCH))),
          );
          this.covers.update((current) => {
            const next = new Map(current);
            for (const access of batch.items) next.set(access.assetId, cardCover(access));
            return next;
          });
        } catch {
          // The tiles stay lettered.
        }
      });
    }
  }

  // ---------- the sheet ----------

  protected newExercise(): void {
    this.open(null, $localize`New exercise`);
  }

  protected cardChosen(card: ExerciseCard, action: string): void {
    switch (action) {
      case 'edit':
        this.open(card.exercise, $localize`Edit ${card.name}:exercise:`);
        return;
      case 'archive':
        void this.setArchived(card.exercise, true);
        return;
      case 'restore':
        void this.setArchived(card.exercise, false);
        return;
    }
  }

  private open(exercise: ExerciseView | null, title: string): void {
    this.openSheet?.close();
    this.sheetExercise.set(exercise);
    this.sheetDirty.set(false);
    const sheet = this.sheets.open(this.sheetTemplate(), {
      title,
      closeLabel: this.closeLabel,
      closeOnNavigation: false,
      canClose: () => this.mayDiscard(),
    });
    this.openSheet = sheet;
    sheet.closed.subscribe(() => {
      if (this.openSheet === sheet) this.openSheet = null;
      this.sheetExercise.set(undefined);
      this.sheetDirty.set(false);
    });
  }

  protected sheetChanged(dirty: boolean): void {
    this.sheetDirty.set(dirty);
  }

  /** The sheet saved (the exercise) or the coach chose Not now (null). */
  protected async sheetClosed(saved: ExerciseView | null): Promise<void> {
    const editing = this.sheetExercise();
    if (!saved) {
      if (await this.mayDiscard()) this.openSheet?.close();
      return;
    }
    this.openSheet?.close();
    // The sheet may have added a link or an upload: read the media list again with the cards.
    this.media = null;
    await this.load();
    this.toast.show(
      editing
        ? $localize`${saved.name}:exercise: is saved.`
        : $localize`${saved.name}:exercise: is in your library.`,
      { tone: 'success' },
    );
  }

  private async mayDiscard(): Promise<boolean> {
    if (!this.sheetDirty()) return true;
    this.asking.set({
      message: $localize`What you typed isn’t saved. If you close it now, it is lost.`,
      confirm: $localize`Close without saving`,
      cancel: $localize`Keep editing`,
    });
    const dialog = this.dialogs.open<boolean>(this.confirmDialog(), {
      title: $localize`Close without saving?`,
      closeLabel: this.closeLabel,
      closeOnNavigation: false,
    });
    return (await firstValueFrom(dialog.closed)) === true;
  }

  async canLeave(): Promise<boolean> {
    if (!(await this.mayDiscard())) return false;
    this.openSheet?.close();
    return true;
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.sheetDirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  // ---------- archiving, with Undo ----------

  private async setArchived(exercise: ExerciseView, archived: boolean): Promise<void> {
    if (this.working()) return;
    const saved = await this.scope.run<ExerciseView | null>(
      'archive',
      async (owner) => {
        this.working.set(exercise.id);
        try {
          await owner.wait(this.csrf.refresh());
          const result = await owner.wait(
            firstValueFrom(this.api.setArchived(exercise.id, archived, Number(exercise.version))),
          );
          await owner.wait(this.load());
          // The card may have left the list, so focus goes to the page rather than to nothing.
          this.heading()?.nativeElement.focus();
          return result;
        } catch (error) {
          if (!owner.current) return null;
          this.toast.show(
            exerciseWriteError(error, $localize`The change could not be saved. Try again.`),
            { tone: 'error' },
          );
          void this.load();
          return null;
        } finally {
          if (owner.current) this.working.set(null);
        }
      },
      null,
    );
    if (!saved) return;
    this.toast.show(
      archived
        ? $localize`${saved.name}:exercise: is archived. Programs already built keep it.`
        : $localize`${saved.name}:exercise: is back in your library.`,
      {
        tone: 'success',
        action: archived
          ? { label: $localize`Undo`, run: () => void this.setArchived(saved, false) }
          : undefined,
      },
    );
  }
}
