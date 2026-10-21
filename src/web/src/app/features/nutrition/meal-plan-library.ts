import { CdkDrag, CdkDragPlaceholder, CdkDropList } from '@angular/cdk/drag-drop';
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
  input,
  LOCALE_ID,
  output,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from '../../ui/button';
import { Icon } from '../../ui/icon';
import { LIBRARY_SEARCH_PAUSE, PagedSearch } from '../../ui/paged-search';
import { Skeleton } from '../../ui/skeleton';
import { UiToast } from '../../ui/toast';
import {
  kcalText,
  macroLine,
  macroSplit,
  type PlanDragItem,
  type PlanRecipe,
} from './meal-plan-builder.models';
import type { RecipeLibrarySource } from './meal-plan-library-source';

interface RecipeRow {
  recipe: PlanRecipe;
  drag: PlanDragItem;
  kcal: string;
  macros: string;
  split: { protein: number; carbs: number; fat: number } | null;
  addLabel: string;
  inMealLabel: string;
}

/** Gives each list a lane of its own, so the panel's searches and the sheet's never cancel each other. */
let lists = 0;

/**
 * The recipes beside the meal-plan grid (C7): search, and each published recipe with its calories
 * and macros per serving. Beside the grid (`drag`) every row can be dragged onto a meal or under a
 * day; in a sheet (`pick`) every row is a button, which is also how a keyboard or a phone adds one.
 * The rows are the first page the builder read once; a search asks the server, and Show more brings
 * the next page (WEA-14), so the recipes are never read whole.
 */
@Component({
  selector: 'app-meal-plan-library',
  imports: [Button, CdkDrag, CdkDragPlaceholder, CdkDropList, Icon, RouterLink, Skeleton],
  templateUrl: './meal-plan-library.html',
  styleUrl: './meal-plan-library.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MealPlanLibrary {
  private readonly locale = inject(LOCALE_ID);
  private readonly toast = inject(UiToast);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly source = input.required<RecipeLibrarySource>();
  readonly mode = input<'drag' | 'pick'>('drag');
  /** The ids of the grid's lists a row can be dropped into. */
  readonly connectedTo = input<string[]>([]);
  /** Recipes the open meal already offers, so a second tap is visible and changes nothing. */
  readonly added = input<ReadonlySet<string>>(new Set());

  readonly pickRecipe = output<PlanRecipe>();
  readonly retry = output<void>();

  private readonly lane = `list-${++lists}`;
  protected readonly list = new PagedSearch<PlanRecipe, string>(
    {
      pauseMs: inject(LIBRARY_SEARCH_PAUSE),
      first: () => this.source().first(),
      isPlain: (query) => query.trim() === '',
      fetch: (query, skip) => this.source().search(this.lane, query, skip),
      key: (recipe) => recipe.versionId,
      // The server reads every word, in any case, wherever the spaces fall.
      filterKey: (query) => query.trim().toLocaleLowerCase().split(/\s+/).join(' '),
    },
    '',
  );

  protected readonly loadingLabel = $localize`Loading your recipes…`;
  /** Nothing is ever dropped back into the library. */
  protected readonly never = () => false;
  protected readonly dragDelay = { touch: 250, mouse: 0 };

  protected readonly state = computed(() => this.source().state());
  protected readonly search = this.list.filter;
  /** No recipe is published yet, whatever is asked. */
  protected readonly empty = computed(() => (this.source().first()?.total ?? 0) === 0);
  protected readonly rows = computed<RecipeRow[]>(() =>
    this.list.items().map((recipe) => {
      const split = macroSplit({
        calories: recipe.perServing.calories,
        protein: recipe.perServing.protein,
        carbs: recipe.perServing.carbs,
        fat: recipe.perServing.fat,
      });
      return {
        recipe,
        drag: { kind: 'recipe', recipe },
        kcal: $localize`${kcalText(recipe.perServing.calories, this.locale)}:kcal: a serving`,
        macros: macroLine(recipe.perServing, this.locale),
        split: split ? { protein: split.protein, carbs: split.carbs, fat: split.fat } : null,
        addLabel: $localize`Add ${recipe.name}:recipe:`,
        inMealLabel: $localize`${recipe.name}:recipe: is in this meal`,
      };
    }),
  );
  protected readonly noMatch = computed(
    () => $localize`No recipe matches “${this.search().trim()}:search:”.`,
  );

  constructor() {
    // A new read of the recipes, or a workspace switch, starts the list again from the first page.
    effect(() => {
      this.source().generation();
      untracked(() => this.list.reset());
    });
    inject(DestroyRef).onDestroy(() => this.list.stop());
  }

  protected typed(text: string): void {
    this.list.type(text);
  }

  protected clear(): void {
    this.list.choose('');
  }

  /**
   * Show more stays where it is while there is more; once the last page is in, its button goes, and focus
   * moves to the first row it brought rather than falling back to the page.
   */
  protected async more(): Promise<void> {
    const before = this.list.items().length;
    if (!(await this.list.more())) {
      this.toast.show($localize`More recipes could not be loaded. Try again.`, { tone: 'error' });
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
}
