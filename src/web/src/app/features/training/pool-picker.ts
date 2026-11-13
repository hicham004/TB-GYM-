import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { PoolExerciseView } from '../../core/api/generated';
import { Button } from '../../ui/button';
import { Icon } from '../../ui/icon';
import { ModalFooter } from '../../ui/modal-footer';
import { LIBRARY_SEARCH_PAUSE, PagedSearch, type SearchPage } from '../../ui/paged-search';
import { Skeleton } from '../../ui/skeleton';
import { DemoClip } from './demo-clip';
import { chosenDemo, type ClipDemo } from './demo-clips';
import { DemoClipsToggle } from './demo-clips-toggle';
import { ExerciseDemo } from './exercise-demo';
import { ExercisePoolApi } from './exercise-pool-api';
import { ownTrainingClosedWords, poolExerciseDetail } from './own-workout.models';

/** One page of the pool, as the coach's library pages its list (WEA-14). */
const PAGE = 50;

/**
 * The exercise picker of a workout of one's own (notes plan N9b3): TB Gym's exercise pool in name order
 * (LIB-006), searched as the coach's library is, a page at a time, each exercise with its demo (MED-017).
 * An uploaded video loops beside its row like a GIF and a picture stays a picture (notes plan N9b4), as
 * thumbnails the list's one pause holds; a YouTube or Vimeo link keeps its button, which opens it on
 * its site. A press adds the exercise; the picker stays open for the next. It reads only; the server
 * decides what may be added (TRN-033).
 */
@Component({
  selector: 'app-pool-picker',
  imports: [Button, DemoClip, DemoClipsToggle, ExerciseDemo, Icon, ModalFooter, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pool-picker.html',
  styleUrl: './pool-picker.scss',
})
export class PoolPicker {
  private readonly pool = inject(ExercisePoolApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private destroyed = false;

  /** The exercises in the workout already: a second one is offered, and said to be a second. */
  readonly inWorkout = input<ReadonlySet<string>>(new Set());
  /** How many times each exercise was added since the picker opened. */
  readonly added = input<ReadonlyMap<string, number>>(new Map());
  /**
   * What the last press did, for a screen reader ("Goblet squat added."), counted so the same words
   * said again are heard again.
   */
  readonly announcement = input<{ readonly text: string; readonly version: number } | null>(null);
  /** Why the last press added nothing, said here since the player's own line is under the sheet. */
  readonly problem = input<string | null>(null);
  readonly chosen = output<PoolExerciseView>();
  /** Done: the sheet closes. */
  readonly done = output<void>();

  private readonly first = signal<SearchPage<PoolExerciseView> | null>(null);
  protected readonly firstFailed = signal(false);
  /** Show more could not read the next page: said beside the button, which stays to try again. */
  protected readonly moreFailed = signal(false);
  /** Why Training is closed, when the pool says it is: nothing is listed then. */
  protected readonly closedReason = signal<string | null>(null);
  protected readonly closedWords = ownTrainingClosedWords;
  protected readonly announcementLines = computed(() => {
    const said = this.announcement();
    return said ? [said] : [];
  });
  protected readonly list = new PagedSearch<PoolExerciseView, string>(
    {
      first: () => this.first(),
      isPlain: (text) => text.trim() === '',
      fetch: (text, skip) => this.page(text, skip),
      key: (exercise) => exercise.id,
      filterKey: (text) => text.trim().toLocaleLowerCase(),
      pauseMs: inject(LIBRARY_SEARCH_PAUSE),
    },
    '',
  );
  protected readonly loadingFirst = computed(() => this.first() === null && !this.firstFailed());
  /** Nothing in the pool at all, as opposed to nothing matching a search. */
  protected readonly poolEmpty = computed(() => !this.list.answered() && this.first()?.total === 0);
  /**
   * Each exercise with its demos as the pool names them, kinds kept, and the kind of the one its row
   * shows (the first video, else picture, else link): a clip for an upload, the button for a link.
   */
  protected readonly rows = computed(() =>
    this.list.items().map((exercise) => {
      const demos: readonly ClipDemo[] = exercise.demos.map((demo) => ({
        id: demo.mediaAssetId,
        kind: demo.kind,
      }));
      return {
        exercise,
        detail: poolExerciseDetail(exercise),
        demos,
        ids: demos.map((demo) => demo.id),
        shown: chosenDemo(demos)?.kind ?? null,
      };
    }),
  );
  /** A listed row's clip loops: the list then offers the one pause its thumbnails share (WCAG 2.2.2). */
  protected readonly looping = computed(() => this.rows().some((row) => row.shown === 'Video'));
  protected readonly noMatch = computed(
    () => $localize`No exercise matches “${this.list.filter().trim()}:search:”.`,
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.list.stop();
    });
    void this.loadFirst();
  }

  protected async loadFirst(): Promise<void> {
    this.firstFailed.set(false);
    try {
      const page = await this.page('', 0);
      if (!this.destroyed && page) this.first.set(page);
    } catch {
      if (!this.destroyed) this.firstFailed.set(true);
    }
  }

  protected typed(text: string): void {
    if (text.trim() === '') this.list.choose(text);
    else this.list.type(text);
  }

  protected clear(): void {
    this.list.choose('');
    afterNextRender(() => this.host.nativeElement.querySelector('input')?.focus(), {
      injector: this.injector,
    });
  }

  /**
   * The next page; focus moves to its first row, so a keyboard carries on from where it was. A page that
   * could not be read is said beside the button, which keeps focus to try again.
   */
  protected async more(): Promise<void> {
    const before = this.list.items().length;
    this.moreFailed.set(false);
    const read = await this.list.more();
    if (this.destroyed) return;
    if (!read) {
      this.moreFailed.set(true);
      return;
    }
    afterNextRender(
      () => this.host.nativeElement.querySelectorAll<HTMLElement>('button.pick')[before]?.focus(),
      { injector: this.injector },
    );
  }

  /** "Added", or how many times when more than once, so a second add is seen as well as heard. */
  protected addedCount(exercise: PoolExerciseView): number {
    return this.added().get(exercise.id) ?? 0;
  }

  protected addLabel(exercise: PoolExerciseView): string {
    return this.inWorkout().has(exercise.id)
      ? $localize`Add ${exercise.name}:exercise: again`
      : $localize`Add ${exercise.name}:exercise:`;
  }

  private async page(text: string, skip: number): Promise<SearchPage<PoolExerciseView> | null> {
    const page = await firstValueFrom(this.pool.search({ query: text, skip, take: PAGE }));
    if (this.destroyed) return null;
    if (!page.isAllowed) {
      this.closedReason.set(page.accessReason);
      return { items: [], total: 0 };
    }
    return { items: page.items, total: Number(page.total) };
  }
}
