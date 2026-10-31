import { CdkDrag, CdkDragPlaceholder, CdkDropList } from '@angular/cdk/drag-drop';
import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SavedSessionView } from '../../core/api/generated';
import { Button } from '../../ui/button';
import { UiDisclosure, UiDisclosureContent } from '../../ui/disclosure';
import { Icon } from '../../ui/icon';
import { LIBRARY_SEARCH_PAUSE, PagedSearch } from '../../ui/paged-search';
import { SegmentedControl } from '../../ui/segmented-control';
import { Skeleton } from '../../ui/skeleton';
import { UiToast } from '../../ui/toast';
import {
  type DragItem,
  libraryChips,
  type LibraryExercise,
  libraryFilterKey,
  type LibraryGroup,
} from './program-builder.models';
import {
  type LibraryFilter,
  NO_LIBRARY_FILTER,
  type ProgramLibrarySource,
} from './program-library-source';

/** Gives each list a lane of its own, so the panel's searches and the sheet's never cancel each other. */
let lists = 0;

/** What a row's + chooses: an exercise, or a saved workout to copy onto a day. */
export type ChosenItem = Extract<DragItem, { kind: 'library' | 'saved' }>;

/** One row of the library, whichever tab it is on. */
export function chosenKey(item: ChosenItem): string {
  return item.kind === 'library' ? `exercise:${item.exercise.id}` : `saved:${item.saved.id}`;
}

/**
 * The exercise library beside the program grid (C4): search, chips by movement and the coach's
 * saved sessions. Beside the grid (`drag`) every row can be dragged into a session or onto a rest
 * day, and a row's + chooses it too, so the grid offers Add here wherever it can go (critique B5b,
 * the way without dragging), with a "How adding works" tip open until the coach's first add. In a
 * sheet (`pick`) every row is a button, which is also how a keyboard or a phone adds one. The rows are
 * the first page the builder read once; a search or a chip asks the server, and Show more brings the
 * next page (WEA-14), so a library is never read whole.
 */
@Component({
  selector: 'app-program-library',
  imports: [
    Button,
    CdkDrag,
    CdkDragPlaceholder,
    CdkDropList,
    Icon,
    NgTemplateOutlet,
    RouterLink,
    SegmentedControl,
    Skeleton,
    UiDisclosure,
    UiDisclosureContent,
  ],
  templateUrl: './program-library.html',
  styleUrls: ['./program-library.scss', './library-adding.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramLibrary {
  private readonly toast = inject(UiToast);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly source = input.required<ProgramLibrarySource>();
  readonly mode = input<'drag' | 'pick'>('drag');
  /** Saved sessions land on a day; a sheet adding to one session does not offer them. */
  readonly offerSaved = input(true);
  /** The ids of the grid's lists a row from the library can be dropped into. */
  readonly connectedTo = input<string[]>([]);
  /** Names the exercises already added from this sheet, so a second tap is visible. */
  readonly added = input<ReadonlySet<string>>(new Set());
  /** Edit weeks' grid has real days, and one already gone takes nothing: the tip says so. */
  readonly pastDays = input(false, { transform: booleanAttribute });
  /** The row chosen with +, while the grid offers Add here for it. */
  readonly chosen = input<ChosenItem | null>(null);
  /** Whether "How adding works" is open beside the grid. */
  readonly tip = input(false);

  readonly pickExercise = output<LibraryExercise>();
  readonly pickSaved = output<SavedSessionView>();
  /** A row's +: the builder chooses that row, or lets it go when it was already chosen. */
  readonly choose = output<ChosenItem>();
  readonly tipChange = output<boolean>();
  readonly retry = output<void>();

  private readonly lane = `list-${++lists}`;
  protected readonly list = new PagedSearch<LibraryExercise, LibraryFilter>(
    {
      pauseMs: inject(LIBRARY_SEARCH_PAUSE),
      first: () => this.source().first(),
      isPlain: (filter) => filter.query.trim() === '' && filter.group === 'all',
      fetch: (filter, skip) => this.source().search(this.lane, filter, skip),
      key: (exercise) => exercise.id,
      filterKey: libraryFilterKey,
    },
    NO_LIBRARY_FILTER,
  );

  protected readonly tab = signal('exercises');
  protected readonly loadingLabel = $localize`Loading your exercises…`;
  protected readonly tabs = [
    { value: 'exercises', label: $localize`Exercises` },
    { value: 'saved', label: $localize`Saved workouts` },
  ];
  /** Nothing is ever dropped back into the library. */
  protected readonly never = () => false;
  protected readonly dragDelay = { touch: 250, mouse: 0 };

  protected readonly state = computed(() => this.source().state());
  protected readonly saved = computed(() => this.source().saved());
  protected readonly showTabs = computed(() => this.offerSaved() && this.saved().length > 0);
  protected readonly chips = computed(() => libraryChips(this.source().patterns()));
  protected readonly shown = this.list.items;
  protected readonly search = computed(() => this.list.filter().query);
  protected readonly group = computed(() => this.list.filter().group);
  /** The library itself holds nothing, whatever is asked. */
  protected readonly empty = computed(() => (this.source().first()?.total ?? 0) === 0);
  protected readonly noMatch = computed(() => {
    const search = this.search().trim();
    return search
      ? $localize`No exercise matches “${search}:search:”.`
      : $localize`No exercise in this group yet.`;
  });

  constructor() {
    // A new read of the library, or a workspace switch, starts the list again from the first page.
    effect(() => {
      this.source().generation();
      untracked(() => this.list.reset());
    });
    // Each page's pictures, granted as its rows arrive.
    effect(() => {
      const shown = this.shown();
      untracked(() => void this.source().grant(shown));
    });
    inject(DestroyRef).onDestroy(() => this.list.stop());
  }

  protected typed(text: string): void {
    this.list.type({ ...this.list.filter(), query: text });
  }

  protected chose(group: LibraryGroup): void {
    this.list.choose({ ...this.list.filter(), group });
  }

  protected clear(): void {
    this.list.choose(NO_LIBRARY_FILTER);
  }

  /**
   * Show more stays where it is while there is more; once the last page is in, its button goes, and focus
   * moves to the first row it brought rather than falling back to the page.
   */
  protected async more(): Promise<void> {
    const before = this.list.items().length;
    if (!(await this.list.more())) {
      this.toast.show($localize`More exercises could not be loaded. Try again.`, { tone: 'error' });
      return;
    }
    if (this.list.hasMore() || this.list.items().length === before) return;
    afterNextRender(
      () => {
        const row = this.host.nativeElement.querySelectorAll<HTMLElement>('.lib-item')[before];
        if (!row) return;
        if (!row.matches('button')) row.tabIndex = -1;
        row.focus();
      },
      { injector: this.injector },
    );
  }

  /** "Got it" folds the tip, and focus stays on its row rather than on a button folded away. */
  protected closeTip(): void {
    this.tipChange.emit(false);
    this.host.nativeElement.querySelector<HTMLElement>('.how summary')?.focus();
  }

  protected exerciseItem(exercise: LibraryExercise): ChosenItem {
    return { kind: 'library', exercise };
  }

  protected savedItem(saved: SavedSessionView): ChosenItem {
    return { kind: 'saved', saved };
  }

  protected isChosen(item: ChosenItem): boolean {
    const chosen = this.chosen();
    return chosen !== null && chosenKey(chosen) === chosenKey(item);
  }

  protected savedAddLabel(saved: SavedSessionView): string {
    return $localize`Add ${saved.name}:session:`;
  }

  protected savedLine(saved: SavedSessionView): string {
    const count = saved.session.exercises.length;
    return count === 1 ? $localize`1 exercise` : $localize`${count}:count: exercises`;
  }

  protected thumb(exercise: LibraryExercise): string | null {
    return exercise.mediaId ? (this.source().thumbs().get(exercise.mediaId) ?? null) : null;
  }

  protected addLabel(exercise: LibraryExercise): string {
    return $localize`Add ${exercise.name}:exercise:`;
  }
}
