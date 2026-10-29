import { Component, computed, input, linkedSignal, output } from '@angular/core';
import { Button } from '../../ui/button';
import { ModalFooter, modalFormId } from '../../ui/modal-footer';
import { dayListWords } from './meal-plan-builder.models';

/** A day as the copy sheets list it. */
export interface CopyDay {
  key: string;
  number: number;
  /** Its meals' names, for the line about the day picked. */
  meals: readonly string[];
  kcal: string;
}

export interface CopyWeek {
  key: string;
  title: string;
  days: readonly CopyDay[];
}

/**
 * The meal-plan builder's two copy sheets (critique B5c: nothing shifts). "Copy this day to…" (`to`)
 * picks the days that get this day's meals; "Replace with a copy of…" (`from`) picks the one day
 * whose meals this day gets. Either way the days picked keep their places, and their own meals are
 * replaced. The days are listed in the plan's weeks, a box or a radio for each day.
 */
@Component({
  selector: 'app-meal-plan-day-copy',
  imports: [Button, ModalFooter],
  template: `
    <form [id]="formId" class="copy" (submit)="$event.preventDefault(); submit()">
      <p class="help">{{ help() }}</p>
      @if (mode() === 'to') {
        <div class="shortcuts" role="group" [attr.aria-label]="shortcutsLabel">
          <button type="button" class="shortcut" (click)="pickEveryDay()" i18n>Every day</button>
          <button type="button" class="shortcut" (click)="pickSameWeekday()" i18n>
            The same day of each week
          </button>
          <button type="button" class="shortcut" (click)="picked.set([])" i18n>None</button>
        </div>
      }
      @for (week of weeks(); track week.key) {
        <fieldset class="week">
          <legend>{{ week.title }}</legend>
          <div class="chips">
            @for (day of week.days; track day.key) {
              @if (mode() === 'to') {
                <label
                  class="chip"
                  [class.self]="day.key === dayKey()"
                  [class.empty]="day.meals.length === 0"
                >
                  <input
                    type="checkbox"
                    [checked]="isPicked(day.key)"
                    [disabled]="day.key === dayKey()"
                    [attr.aria-label]="dayName(day)"
                    (change)="toggle(day.key, $any($event.target).checked)"
                  />
                  <span aria-hidden="true">{{ day.number }}</span>
                </label>
              } @else {
                <label
                  class="chip"
                  [class.self]="day.key === dayKey()"
                  [class.empty]="day.meals.length === 0"
                >
                  <input
                    type="radio"
                    [name]="formId"
                    [checked]="isPicked(day.key)"
                    [disabled]="day.key === dayKey() || day.meals.length === 0"
                    [attr.aria-label]="dayName(day)"
                    (change)="picked.set([day.key])"
                  />
                  <span aria-hidden="true">{{ day.number }}</span>
                </label>
              }
            }
          </div>
        </fieldset>
      }
      <p class="summary" role="status">{{ summary() }}</p>
    </form>
    <ng-template appModalFooter>
      <button appButton type="button" variant="outlined" (click)="cancelled.emit()" i18n>
        Cancel
      </button>
      <button appButton type="submit" [attr.form]="formId" [disabled]="picked().length === 0">
        {{ confirmLabel() }}
      </button>
    </ng-template>
  `,
  styleUrl: './meal-plan-day-copy.scss',
})
export class MealPlanDayCopy {
  /** `to`: this day's meals go to the days picked; `from`: this day gets the day picked's meals. */
  readonly mode = input.required<'to' | 'from'>();
  /** The day whose menu opened the sheet. */
  readonly dayKey = input.required<string>();
  readonly weeks = input.required<readonly CopyWeek[]>();
  /** The days that get the meals (`to`), or the one day they come from (`from`). */
  readonly copied = output<readonly string[]>();
  readonly cancelled = output<void>();

  protected readonly formId = modalFormId('day-copy');
  protected readonly shortcutsLabel = $localize`Pick days quickly`;
  /** Nothing is picked when the sheet opens, nor after another day opens it. */
  protected readonly picked = linkedSignal<string, readonly string[]>({
    source: () => `${this.mode()}|${this.dayKey()}`,
    computation: () => [],
  });

  private readonly days = computed(() => this.weeks().flatMap((week) => week.days));
  private readonly day = computed(() => this.days().find((item) => item.key === this.dayKey()));
  private readonly pickedDays = computed(() => {
    const picked = new Set(this.picked());
    return this.days().filter((item) => picked.has(item.key));
  });

  protected readonly help = computed(() => {
    const number = this.day()?.number ?? 0;
    return this.mode() === 'to'
      ? $localize`Day ${number}:day:’s meals go to the days you pick. Their own meals are replaced.`
      : $localize`Day ${number}:day:’s meals are replaced by a copy of the day you pick. A day with no meals can’t be picked.`;
  });

  protected readonly summary = computed(() => {
    const picked = this.pickedDays();
    if (picked.length === 0) return '';
    if (this.mode() === 'from') {
      const source = picked[0]!;
      const meals = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' }).format(
        source.meals.map((name) => name.trim() || $localize`Unnamed meal`),
      );
      return $localize`Day ${source.number}:day:: ${meals}:meals: · ${source.kcal}:calories:`;
    }
    const filled = picked.filter((item) => item.meals.length > 0);
    const count =
      picked.length === 1
        ? $localize`1 day picked.`
        : $localize`${picked.length}:count: days picked.`;
    if (filled.length === 0) return count;
    if (filled.length === 1) {
      return $localize`${count}:count: Day ${filled[0]!.number}:day: has meals now; copying replaces them.`;
    }
    return $localize`${count}:count: ${filled.length}:filled: of them have meals now; copying replaces them.`;
  });

  protected readonly confirmLabel = computed(() => {
    const picked = this.pickedDays();
    if (this.mode() === 'from') {
      return $localize`Replace day ${this.day()?.number ?? 0}:day:`;
    }
    return picked.length === 0
      ? $localize`Copy`
      : $localize`Copy to ${dayListWords(picked.map((item) => item.number))}:days:`;
  });

  protected isPicked(dayKey: string): boolean {
    return this.picked().includes(dayKey);
  }

  protected dayName(day: CopyDay): string {
    if (day.key === this.dayKey()) return $localize`Day ${day.number}:day:, this day`;
    if (day.meals.length === 0) return $localize`Day ${day.number}:day:, no meals`;
    return day.meals.length === 1
      ? $localize`Day ${day.number}:day:, 1 meal`
      : $localize`Day ${day.number}:day:, ${day.meals.length}:count: meals`;
  }

  protected toggle(dayKey: string, checked: boolean): void {
    this.picked.update((keys) =>
      checked
        ? [...keys.filter((key) => key !== dayKey), dayKey]
        : keys.filter((key) => key !== dayKey),
    );
  }

  protected pickEveryDay(): void {
    this.picked.set(this.days().flatMap((item) => (item.key === this.dayKey() ? [] : [item.key])));
  }

  /** The days at the same place in every week as this one: each Friday, when day 1 is a Monday. */
  protected pickSameWeekday(): void {
    const at = ((this.day()?.number ?? 1) - 1) % 7;
    this.picked.set(
      this.days().flatMap((item) =>
        item.key !== this.dayKey() && (item.number - 1) % 7 === at ? [item.key] : [],
      ),
    );
  }

  protected submit(): void {
    const picked = this.pickedDays().map((item) => item.key);
    if (picked.length > 0) this.copied.emit(picked);
  }
}
