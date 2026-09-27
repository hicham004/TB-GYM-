import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  input,
  output,
  signal,
} from '@angular/core';
import { FoodItem, preparationLabel, sourceLabel, unitLabel } from './nutrition.models';

/** Long libraries stay quick to scan; typing narrows the list further. */
const MAX_MATCHES = 50;

/**
 * A searchable food box: type part of a name to narrow the list, then pick with the mouse or with
 * the arrow keys and Enter. Each option shows its source and calories, because several foods can
 * share a name ("BLACK BEANS" canned and dry) and differ by a factor of four.
 *
 * Follows the ARIA combobox pattern with a listbox popup. Enter only picks; it never submits the
 * recipe form the box sits in.
 */
@Component({
  selector: 'app-food-picker',
  templateUrl: './food-picker.html',
  styleUrl: './food-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FoodPicker {
  private readonly injector = inject(Injector);

  readonly inputId = input.required<string>();
  readonly foods = input.required<readonly FoodItem[]>();
  /** The chosen food version. */
  readonly value = input<string>('');
  readonly valueChange = output<string>();

  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly editing = signal(false);
  protected readonly active = signal(0);

  protected readonly listId = computed(() => `${this.inputId()}-list`);
  private readonly selected = computed(() =>
    this.foods().find((food) => food.versionId === this.value()),
  );
  protected readonly text = computed(() =>
    this.editing() ? this.query() : (this.selected()?.name ?? ''),
  );
  protected readonly matches = computed(() =>
    matchFoods(this.foods(), this.editing() ? this.query() : ''),
  );
  protected readonly activeId = computed(() =>
    this.open() && this.matches().length ? this.optionId(this.active()) : null,
  );

  protected optionId(index: number): string {
    return `${this.inputId()}-option-${index}`;
  }

  protected detail(food: FoodItem): string {
    const calories = Math.round(food.calories);
    return $localize`${sourceLabel(food.provenance)}:source: · ${preparationLabel(food.preparationBasis)}:preparation: · ${calories}:calories: kcal per ${food.basisQuantity}:quantity: ${unitLabel(food.basisUnit)}:unit:`;
  }

  protected showList(): void {
    if (this.open()) return;
    const selectedIndex = this.matches().findIndex((food) => food.versionId === this.value());
    this.active.set(Math.max(selectedIndex, 0));
    this.open.set(true);
    this.revealActive();
  }

  protected typed(text: string): void {
    this.editing.set(true);
    this.query.set(text);
    this.active.set(0);
    this.open.set(true);
  }

  protected keydown(event: KeyboardEvent): void {
    const count = this.matches().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!this.open()) {
          this.showList();
        } else if (count) {
          this.active.update((index) => Math.min(index + 1, count - 1));
          this.revealActive();
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (this.open() && count) {
          this.active.update((index) => Math.max(index - 1, 0));
          this.revealActive();
        }
        break;
      case 'Enter': {
        // Enter picks a food. Left alone it would submit the whole recipe form.
        event.preventDefault();
        const food = this.open() ? this.matches()[this.active()] : undefined;
        if (food) this.choose(food);
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

  protected choose(food: FoodItem): void {
    this.close();
    if (food.versionId !== this.value()) {
      this.valueChange.emit(food.versionId);
    }
  }

  /** Leaving the box keeps the food already chosen; half-typed text is dropped. */
  protected close(): void {
    this.open.set(false);
    this.editing.set(false);
    this.query.set('');
  }

  private revealActive(): void {
    afterNextRender(
      () => {
        const option = document.getElementById(this.optionId(this.active()));
        option?.scrollIntoView?.({ block: 'nearest' });
      },
      { injector: this.injector },
    );
  }
}

/** Foods whose name contains every typed word, in any order and ignoring case and accents. */
export function matchFoods(foods: readonly FoodItem[], query: string): FoodItem[] {
  const words = normalize(query).split(' ').filter(Boolean);
  const matching = words.length
    ? foods.filter((food) => {
        const name = normalize(food.name);
        return words.every((word) => name.includes(word));
      })
    : [...foods];
  return matching.slice(0, MAX_MATCHES);
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
