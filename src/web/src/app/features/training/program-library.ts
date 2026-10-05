import { CdkDrag, CdkDragPlaceholder, CdkDropList } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SavedSessionView } from '../../core/api/generated';
import { Button } from '../../ui/button';
import { Icon } from '../../ui/icon';
import { SegmentedControl } from '../../ui/segmented-control';
import { Skeleton } from '../../ui/skeleton';
import {
  type DragItem,
  filterLibrary,
  libraryChips,
  type LibraryExercise,
  type LibraryGroup,
} from './program-builder.models';

/** A picture the server granted for an exercise's first media, by media id. */
export type LibraryThumbs = ReadonlyMap<string, string>;

/**
 * The exercise library beside the program grid (C4): search, chips by movement and the coach's
 * saved sessions. Beside the grid (`drag`) every row can be dragged into a session or onto a rest
 * day; in a sheet (`pick`) every row is a button, which is also how a keyboard or a phone adds one.
 */
@Component({
  selector: 'app-program-library',
  imports: [
    Button,
    CdkDrag,
    CdkDragPlaceholder,
    CdkDropList,
    Icon,
    RouterLink,
    SegmentedControl,
    Skeleton,
  ],
  templateUrl: './program-library.html',
  styleUrl: './program-library.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramLibrary {
  readonly exercises = input.required<readonly LibraryExercise[]>();
  readonly saved = input<readonly SavedSessionView[]>([]);
  readonly thumbs = input<LibraryThumbs>(new Map());
  readonly mode = input<'drag' | 'pick'>('drag');
  readonly state = input<'loading' | 'ready' | 'error'>('ready');
  /** Saved sessions land on a day; a sheet adding to one session does not offer them. */
  readonly offerSaved = input(true);
  /** The ids of the grid's lists a row from the library can be dropped into. */
  readonly connectedTo = input<string[]>([]);
  /** Names the exercises already added from this sheet, so a second tap is visible. */
  readonly added = input<ReadonlySet<string>>(new Set());

  readonly pickExercise = output<LibraryExercise>();
  readonly pickSaved = output<SavedSessionView>();
  readonly retry = output<void>();

  protected readonly search = signal('');
  protected readonly group = signal<LibraryGroup>('all');
  protected readonly tab = signal('exercises');
  protected readonly loadingLabel = $localize`Loading your exercises…`;
  protected readonly tabs = [
    { value: 'exercises', label: $localize`Exercises` },
    { value: 'saved', label: $localize`Saved sessions` },
  ];
  /** Nothing is ever dropped back into the library. */
  protected readonly never = () => false;
  protected readonly dragDelay = { touch: 250, mouse: 0 };

  protected readonly showTabs = computed(() => this.offerSaved() && this.saved().length > 0);
  protected readonly chips = computed(() => libraryChips(this.exercises()));
  protected readonly shown = computed(() =>
    filterLibrary(this.exercises(), this.search(), this.group()),
  );
  protected readonly noMatch = computed(() => {
    const search = this.search().trim();
    return search
      ? $localize`No exercise matches “${search}:search:”.`
      : $localize`No exercise in this group yet.`;
  });

  protected exerciseItem(exercise: LibraryExercise): DragItem {
    return { kind: 'library', exercise };
  }

  protected savedItem(saved: SavedSessionView): DragItem {
    return { kind: 'saved', saved };
  }

  protected savedLine(saved: SavedSessionView): string {
    const count = saved.session.exercises.length;
    return count === 1 ? $localize`1 exercise` : $localize`${count}:count: exercises`;
  }

  protected thumb(exercise: LibraryExercise): string | null {
    return exercise.mediaId ? (this.thumbs().get(exercise.mediaId) ?? null) : null;
  }

  protected addLabel(exercise: LibraryExercise): string {
    return $localize`Add ${exercise.name}:exercise:`;
  }

  protected clear(): void {
    this.search.set('');
    this.group.set('all');
  }
}
