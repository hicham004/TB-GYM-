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
  LOCALE_ID,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { CsrfService } from '../../core/security/csrf.service';
import { Icon } from '../../ui/icon';
import { RecipeApi } from './recipe-api';
import { foodFromView, foodMeasure, type RecipeFood, sourceWord } from './recipe.models';

const SEARCH_DELAY_MS = 250;
/** USDA is asked only once a word is long enough to mean something; it is slower and paged. */
const USDA_MINIMUM = 3;

type Option =
  | { kind: 'food'; key: string; food: RecipeFood }
  | { kind: 'usda'; key: string; fdcId: string; name: string };

/**
 * Finds an ingredient (R4.4b): the workspace's own foods first, each with its source and calories
 * per measure, then matches from USDA FoodData Central, which are added to the foods when chosen. The
 * database codes stay out of sight (plan C7). Follows the ARIA combobox pattern with a listbox popup;
 * Enter picks and never submits the form around it.
 */
@Component({
  selector: 'app-recipe-food-search',
  imports: [Icon],
  templateUrl: './recipe-food-search.html',
  styleUrl: './recipe-food-search.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeFoodSearch {
  private readonly api = inject(RecipeApi);
  private readonly csrf = inject(CsrfService);
  private readonly injector = inject(Injector);
  private readonly locale = inject(LOCALE_ID);
  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  readonly inputId = input.required<string>();
  /** What the box starts with, such as the name of an AI-suggested ingredient. */
  readonly initialQuery = input('');
  readonly label = input($localize`Add an ingredient`);
  readonly picked = output<RecipeFood>();

  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly active = signal(0);
  protected readonly searching = signal(false);
  protected readonly adding = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);
  private readonly foods = signal<RecipeFood[]>([]);
  private readonly usda = signal<{ fdcId: string; name: string }[]>([]);
  /** Said once, quietly, when USDA search is not available here; never the server's own sentence. */
  protected readonly usdaNote = signal<string | null>(null);

  protected readonly listId = computed(() => `${this.inputId()}-list`);
  protected readonly options = computed<Option[]>(() => {
    const own = new Set(this.foods().map((food) => food.name.toLocaleLowerCase()));
    return [
      ...this.foods().map((food) => ({ kind: 'food' as const, key: `f-${food.versionId}`, food })),
      // A USDA food already copied into the workspace shows once, as the coach's own.
      ...this.usda()
        .filter((item) => !own.has(item.name.toLocaleLowerCase()))
        .map((item) => ({ kind: 'usda' as const, key: `u-${item.fdcId}`, ...item })),
    ];
  });
  protected readonly ownOptions = computed(() =>
    this.options().filter(
      (option): option is Extract<Option, { kind: 'food' }> => option.kind === 'food',
    ),
  );
  protected readonly usdaOptions = computed(() =>
    this.options().filter(
      (option): option is Extract<Option, { kind: 'usda' }> => option.kind === 'usda',
    ),
  );
  protected readonly activeId = computed(() =>
    this.open() && this.options().length ? this.optionId(this.active()) : null,
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
      this.generation++;
    });
    afterNextRender(() => {
      const start = this.initialQuery();
      if (start) this.query.set(start);
    });
  }

  focus(): void {
    this.box()?.nativeElement.focus();
  }

  protected optionId(index: number): string {
    return `${this.inputId()}-option-${index}`;
  }

  protected measure(food: RecipeFood): string {
    return $localize`${sourceWord(food.source)}:source: · ${foodMeasure(food, this.locale)}:measure:`;
  }

  protected focused(): void {
    if (!this.open()) {
      this.open.set(true);
      this.schedule(0);
    }
  }

  protected typed(text: string): void {
    this.query.set(text);
    this.open.set(true);
    this.active.set(0);
    this.schedule(SEARCH_DELAY_MS);
  }

  protected keydown(event: KeyboardEvent): void {
    const count = this.options().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!this.open()) {
          this.focused();
        } else if (count) {
          this.active.update((index) => Math.min(index + 1, count - 1));
          this.reveal();
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (this.open() && count) {
          this.active.update((index) => Math.max(index - 1, 0));
          this.reveal();
        }
        break;
      case 'Enter': {
        event.preventDefault();
        const option = this.open() ? this.options()[this.active()] : undefined;
        if (option) void this.choose(option);
        break;
      }
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          this.close();
        }
        break;
    }
  }

  protected async choose(option: Option): Promise<void> {
    if (this.adding()) return;
    if (option.kind === 'food') {
      this.reset();
      this.picked.emit(option.food);
      return;
    }
    // A USDA food becomes one of the workspace's foods first, so the line names a real food version.
    this.adding.set(option.key);
    this.problem.set(null);
    try {
      await this.csrf.refresh();
      const view = await firstValueFrom(this.api.importUsda(option.fdcId));
      this.reset();
      this.picked.emit(foodFromView(view));
    } catch (error) {
      this.problem.set(
        apiErrorMessage(error, $localize`That USDA food could not be added. Try another match.`),
      );
    } finally {
      this.adding.set(null);
    }
  }

  protected close(): void {
    this.open.set(false);
  }

  /** After a pick the box starts again empty, so the next search never shows the last one's foods. */
  private reset(): void {
    this.close();
    this.query.set('');
    this.generation++;
    this.foods.set([]);
    this.usda.set([]);
    this.searching.set(false);
  }

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.search();
    }, delay);
  }

  private async search(): Promise<void> {
    const generation = ++this.generation;
    const query = this.query().trim();
    this.searching.set(true);
    this.problem.set(null);
    try {
      const [own, usda] = await Promise.all([
        firstValueFrom(this.api.searchFoods(query)),
        query.length >= USDA_MINIMUM ? firstValueFrom(this.api.searchUsda(query)) : null,
      ]);
      if (generation !== this.generation) return;
      this.foods.set(own.items.map(foodFromView));
      this.usda.set(usda?.items.map((item) => ({ fdcId: item.externalId, name: item.name })) ?? []);
      if (usda?.failureCode || usda?.message) {
        this.usdaNote.set(
          $localize`USDA search isn’t available right now, so only your own foods are listed.`,
        );
      }
      this.active.set(0);
    } catch {
      if (generation !== this.generation) return;
      this.problem.set(
        $localize`Foods could not be searched. Check your connection and try again.`,
      );
    } finally {
      if (generation === this.generation) this.searching.set(false);
    }
  }

  private reveal(): void {
    afterNextRender(
      () =>
        document
          .getElementById(this.optionId(this.active()))
          ?.scrollIntoView?.({ block: 'nearest' }),
      { injector: this.injector },
    );
  }
}
