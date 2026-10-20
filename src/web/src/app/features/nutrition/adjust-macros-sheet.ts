import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { SheetForm } from '../../core/forms/sheet-form';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { EntryActions, SHEET_STYLES } from '../../ui/sheet-parts';
import { ClientNutritionApi } from './client-nutrition-api';
import {
  ADJUST_REASON_LIMIT,
  adjustRefusal,
  macroCalories,
  macroErrors,
  mapWorkedOut,
  numberOrNull,
  problemCount,
  workedOutOn,
  type MacroField,
  type PlanRow,
  type WorkedOut,
} from './client-nutrition.models';
import { TargetsResult } from './targets-result';

/**
 * The coach's own macros, in a sheet (NUT-008: manual coach overrides win; INV-2). It opens on the
 * latest targets; the coach changes the grams of protein, carbs or fat, says why, and sees the calories
 * the grams make at 4, 4 and 9 kcal a gram beside the targets they change. Saving records new targets
 * with the reason. A meal plan already assigned keeps the targets it was assigned with (NUT-009), so the
 * result says so and can go straight on to assigning a meal plan with the new ones.
 */
@Component({
  selector: 'app-adjust-macros',
  imports: [Button, Control, DecimalPipe, EntryActions, Field, TargetsResult],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (result(); as made) {
      <div class="body" data-result>
        <p class="muted" i18n>
          Saved as the latest targets for {{ firstName() }}. Nothing changes for them until you
          assign a meal plan with these.
        </p>
        @if (current(); as plan) {
          <p class="muted" data-keeps dir="auto" i18n>
            {{ plan.name }} keeps the targets it was assigned with. To give {{ firstName() }} these,
            stop it and assign a meal plan with these.
          </p>
        }
        <app-targets-result [record]="made" />
        <div class="result-actions">
          <button appButton type="button" variant="text" (click)="closed.emit(made)" data-done i18n>
            Done
          </button>
          <button appButton type="button" (click)="assign.emit(made)" data-assign i18n>
            Assign a meal plan with these
          </button>
        </div>
      </div>
    } @else {
      <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
        <p class="about" data-from>
          <span class="muted">{{ fromWords() }}</span
          >&ngsp;<strong i18n
            >{{ from().calories | number: '1.0-0' }} calories ·
            {{ from().protein | number: '1.0-0' }} g protein ·
            {{ from().carbohydrate | number: '1.0-0' }} g carbs ·
            {{ from().fat | number: '1.0-0' }} g fat</strong
          >
        </p>

        <fieldset class="group">
          <legend i18n>Grams a day</legend>
          <div class="trio">
            <app-field
              [label]="proteinLabel"
              [errors]="shows('protein', issues().protein) ? issues().protein : null"
            >
              <input
                appControl
                name="protein"
                type="number"
                inputmode="decimal"
                step="any"
                min="0"
                [value]="protein() ?? ''"
                (input)="protein.set(numberOrNull($any($event.target).valueAsNumber))"
                (blur)="attempt.touch('protein')"
              />
            </app-field>
            <app-field
              [label]="carbsLabel"
              [errors]="shows('carbohydrate', issues().carbohydrate) ? issues().carbohydrate : null"
            >
              <input
                appControl
                name="carbohydrate"
                type="number"
                inputmode="decimal"
                step="any"
                min="0"
                [value]="carbohydrate() ?? ''"
                (input)="carbohydrate.set(numberOrNull($any($event.target).valueAsNumber))"
                (blur)="attempt.touch('carbohydrate')"
              />
            </app-field>
            <app-field
              [label]="fatLabel"
              [errors]="shows('fat', issues().fat) ? issues().fat : null"
            >
              <input
                appControl
                name="fat"
                type="number"
                inputmode="decimal"
                step="any"
                min="0"
                [value]="fat() ?? ''"
                (input)="fat.set(numberOrNull($any($event.target).valueAsNumber))"
                (blur)="attempt.touch('fat')"
              />
            </app-field>
          </div>
          <p class="sum" aria-live="polite" data-sum>{{ sumWords() }}</p>
        </fieldset>

        <app-field
          [label]="reasonLabel"
          [help]="reasonHelp()"
          [errors]="shows('reason', issues().reason) ? issues().reason : null"
        >
          <textarea
            appControl
            name="reason"
            rows="3"
            [attr.maxlength]="limit"
            [value]="reason()"
            (input)="reason.set($any($event.target).value)"
            (blur)="attempt.touch('reason')"
          ></textarea>
        </app-field>

        @if (attempt.wasTried() && problems() > 0) {
          <p class="problem-text" role="alert" i18n>Check the fields marked above.</p>
        }
        @if (error(); as message) {
          <p class="problem-text refusal" role="alert">{{ message }}</p>
        }
        <app-entry-actions
          [saveLabel]="saveLabel"
          [busyLabel]="savingLabel"
          [busy]="busy()"
          (notNow)="closed.emit(null)"
        />
      </form>
    }
  `,
  styles: [
    SHEET_STYLES,
    `
      .group {
        border: 0;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin: 0;
        min-inline-size: 0;
        padding: 0;
      }

      .group > legend {
        color: var(--tb-ink);
        font-size: 1rem;
        font-weight: 600;
        margin-block-end: 0.5rem;
        padding: 0;
      }

      .trio {
        align-items: start;
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      @media (max-width: 26rem) {
        .trio {
          grid-template-columns: minmax(0, 1fr);
        }
      }

      .sum {
        color: var(--tb-ink);
        font-variant-numeric: tabular-nums;
        font-weight: 600;
      }

      .result-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        justify-content: flex-end;
      }
    `,
  ],
})
export class AdjustMacros extends SheetForm {
  private readonly api = inject(ClientNutritionApi);

  readonly clientId = input.required<string>();
  readonly firstName = input.required<string>();
  /** The targets the coach starts from: the newest worked out. */
  readonly from = input.required<WorkedOut>();
  /** The meal plan running or coming, which keeps its own targets. */
  readonly current = input<PlanRow | null>(null);
  /** Today in the coaching space, never the browser's. */
  readonly today = input.required<string>();
  readonly locale = input<string>('en');
  readonly timeZone = input<string>('UTC');
  /** The targets recorded, or null when the sheet was closed without saving any. */
  readonly closed = output<WorkedOut | null>();
  /** The result is on screen and the coach wants to assign a meal plan with it. */
  readonly assign = output<WorkedOut>();
  /** New targets were recorded, so the page reads its list again. */
  readonly recorded = output<WorkedOut>();

  protected readonly proteinLabel = $localize`Protein (g)`;
  protected readonly carbsLabel = $localize`Carbs (g)`;
  protected readonly fatLabel = $localize`Fat (g)`;
  protected readonly reasonLabel = $localize`Why are you changing them?`;
  protected readonly saveLabel = $localize`Save these macros`;
  protected readonly savingLabel = $localize`Saving…`;
  protected readonly limit = ADJUST_REASON_LIMIT;
  protected readonly numberOrNull = numberOrNull;

  // Whole grams to start from, as the page shows them; the coach changes what they want.
  protected readonly protein = linkedSignal<number | null>(() => Math.round(this.from().protein));
  protected readonly carbohydrate = linkedSignal<number | null>(() =>
    Math.round(this.from().carbohydrate),
  );
  protected readonly fat = linkedSignal<number | null>(() => Math.round(this.from().fat));
  protected readonly reason = signal('');
  protected readonly result = signal<WorkedOut | null>(null);

  private readonly values = computed(() => ({
    protein: this.protein(),
    carbohydrate: this.carbohydrate(),
    fat: this.fat(),
  }));
  protected readonly issues = computed<Record<MacroField, string[]>>(() =>
    macroErrors(this.values(), this.reason()),
  );
  protected readonly problems = computed(() => problemCount(this.issues()));
  protected readonly fromWords = computed(() => {
    const on = workedOutOn(
      this.from().calculatedAtUtc,
      this.timeZone(),
      this.today(),
      this.locale(),
    );
    return this.from().adjustment
      ? $localize`Starting from your macros, set ${on}:day:`
      : $localize`Starting from the targets worked out ${on}:day:`;
  });
  protected readonly reasonHelp = computed(
    () =>
      $localize`Kept with these targets, where you and your team see it. ${this.firstName()}:name: sees only the numbers.`,
  );
  protected readonly sumWords = computed(() => {
    const calories = macroCalories(this.values());
    if (calories === null) return $localize`The calories add up here as you type the grams.`;
    const now = Math.round(calories);
    const difference = now - Math.round(this.from().calories);
    const total = now.toLocaleString('en');
    if (difference === 0)
      return $localize`That makes ${total}:calories: calories a day, as before.`;
    const by = Math.abs(difference).toLocaleString('en');
    return difference < 0
      ? $localize`That makes ${total}:calories: calories a day, ${by}:difference: fewer than before.`
      : $localize`That makes ${total}:calories: calories a day, ${by}:difference: more than before.`;
  });

  constructor() {
    super();
    effect(() => {
      const from = this.from();
      const changed =
        this.protein() !== Math.round(from.protein) ||
        this.carbohydrate() !== Math.round(from.carbohydrate) ||
        this.fat() !== Math.round(from.fat) ||
        this.reason().trim() !== '';
      this.dirtyChange.emit(changed && this.result() === null);
    });
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problems() > 0) {
      this.refuse();
      return;
    }
    const values = this.values();
    let made = null as WorkedOut | null;
    const ok = await this.send(
      async (owner) => {
        const record = await owner.wait(
          firstValueFrom(
            this.api.adjustMacros(this.clientId(), this.from().id, {
              proteinGrams: values.protein!,
              carbohydrateGrams: values.carbohydrate!,
              fatGrams: values.fat!,
              reason: this.reason().trim(),
            }),
          ),
        );
        made = mapWorkedOut(record);
      },
      (error) =>
        adjustRefusal(apiErrorMessage(error, $localize`The macros could not be saved. Try again.`)),
    );
    if (ok && made) {
      this.result.set(made);
      this.recorded.emit(made);
    }
  }
}
