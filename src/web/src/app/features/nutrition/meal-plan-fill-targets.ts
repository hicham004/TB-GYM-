import { formatNumber } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  LOCALE_ID,
  output,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { SheetForm } from '../../core/forms/sheet-form';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { EntryActions, SHEET_STYLES } from '../../ui/sheet-parts';
import { FAT_PICKS, numberOrNull, problemCount } from './client-nutrition.models';
import { fillErrors, type FilledSplit, mapSplit } from './daily-target.models';
import { MealPlanApi } from './meal-plan-api';

/** What the sheet opens with: the card's calories and protein, and the share and client, if any. */
export interface FillStart {
  calories: number | null;
  protein: number | null;
  /** The share the fat was filled in at before; 25 when it never was, as the targets sheet starts. */
  share: number | null;
  /** The client whose targets the plan started from, whose weight the warnings use. */
  client: { name: string; weight: number | null; isEnergyDeficit: boolean } | null;
}

/**
 * "Fill in fat and carbs" (critique B5c2, T13): the daily calories and protein, and fat as a share of
 * the calories with the targets sheet's picks. The server's macro split (NUT-008) works fat and carbs
 * out, so the plan keeps its grams unrounded and names the share they came from; no gram is worked out
 * here. Fat under 20 % of the calories, or under 0.5 g a kilogram of a client's weight, is flagged in
 * the card afterwards, never refused.
 */
@Component({
  selector: 'app-meal-plan-fill-targets',
  imports: [Control, EntryActions, Field, FormSummary, SegmentedControl],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [id]="formId" class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="muted" i18n>
        Fat takes the share of the calories you pick, and carbs what protein and fat leave.
      </p>
      <div class="pair">
        <app-field
          [label]="caloriesLabel"
          [errors]="shows('calories', issues().calories) ? issues().calories : null"
        >
          <input
            appControl
            name="calories"
            type="number"
            inputmode="numeric"
            step="1"
            min="0"
            [value]="calories() ?? ''"
            (input)="calories.set(numberOrNull($any($event.target).valueAsNumber))"
            (blur)="attempt.touch('calories')"
          />
        </app-field>
        <app-field
          [label]="proteinLabel"
          [errors]="shows('protein', issues().protein) ? issues().protein : null"
        >
          <input
            appControl
            name="protein"
            type="number"
            inputmode="numeric"
            step="1"
            min="0"
            [value]="protein() ?? ''"
            (input)="protein.set(numberOrNull($any($event.target).valueAsNumber))"
            (blur)="attempt.touch('protein')"
          />
        </app-field>
      </div>
      <!-- The targets sheet's fat block (critique B5c): the box first and one row of picks under it. -->
      <div class="block" data-block="fat">
        <app-field
          [label]="fatLabel"
          [help]="fatHelp"
          [errors]="shows('fat', issues().fat) ? issues().fat : null"
        >
          <input
            appControl
            name="fat"
            type="number"
            inputmode="decimal"
            step="1"
            min="0"
            max="100"
            [value]="fat() ?? ''"
            (input)="fat.set(numberOrNull($any($event.target).valueAsNumber))"
            (blur)="attempt.touch('fat')"
          />
        </app-field>
        <div class="picks">
          <app-segmented-control
            [label]="fatPicksLabel"
            [hideLabel]="true"
            [options]="fatOptions"
            [selected]="fatPickValue()"
            (selectedChange)="pickFat($event)"
          />
          <span class="caption" aria-hidden="true" i18n>% of calories</span>
        </div>
      </div>
      @if (weightLine(); as line) {
        <p class="muted" data-weight>{{ line }}</p>
      }
      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        } @else if (attempt.wasTried() && problems() > 0) {
          <ng-container i18n>Check the fields marked above.</ng-container>
        }
      </app-form-summary>
      <app-entry-actions
        [form]="formId"
        [saveLabel]="saveLabel"
        [busyLabel]="workingLabel"
        [busy]="busy()"
        cancelLabel="Cancel"
        i18n-cancelLabel
        (notNow)="cancelled.emit()"
      />
    </form>
  `,
  styles: [
    SHEET_STYLES,
    `
      .pair {
        align-items: start;
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      @media (max-width: 26rem) {
        .pair {
          grid-template-columns: minmax(0, 1fr);
        }
      }

      .block {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      // The caption beside its picks, and under them when large text leaves no room beside.
      .picks {
        align-items: center;
        column-gap: 0.75rem;
        display: flex;
        flex-wrap: wrap;
        row-gap: 0.25rem;
      }

      .picks app-segmented-control {
        flex: 1 1 12rem;
        max-inline-size: 20rem;
      }

      .caption {
        color: var(--tb-muted);
        flex: none;
        font-size: 0.875rem;
        white-space: nowrap;
      }
    `,
  ],
})
export class MealPlanFillTargets extends SheetForm {
  private readonly api = inject(MealPlanApi);
  private readonly locale = inject(LOCALE_ID);

  readonly start = input.required<FillStart>();
  /** The server's split, for the card's boxes. */
  readonly filled = output<FilledSplit>();
  readonly cancelled = output<void>();

  protected readonly caloriesLabel = $localize`Calories (kcal)`;
  protected readonly proteinLabel = $localize`Protein (g)`;
  protected readonly fatLabel = $localize`Fat (percent of calories)`;
  protected readonly fatHelp = $localize`A share of the day’s calories: the grams are worked out when you fill them in.`;
  protected readonly fatPicksLabel = $localize`Share of calories from fat`;
  protected readonly saveLabel = $localize`Fill in fat and carbs`;
  protected readonly workingLabel = $localize`Working it out…`;
  protected readonly numberOrNull = numberOrNull;
  /** "20 · 25 · 30 · 35", captioned "% of calories", as the targets sheet has them. */
  protected readonly fatOptions: readonly SegmentOption[] = FAT_PICKS.map((share) => ({
    value: String(share),
    label: String(share),
  }));

  protected readonly calories = linkedSignal<number | null>(() => this.start().calories);
  protected readonly protein = linkedSignal<number | null>(() => this.start().protein);
  protected readonly fat = linkedSignal<number | null>(() => this.start().share ?? 25);

  private readonly values = computed(() => ({
    calories: this.calories(),
    protein: this.protein(),
    fat: this.fat(),
  }));
  protected readonly issues = computed(() => fillErrors(this.values()));
  protected readonly problems = computed(() => problemCount(this.issues()));
  protected readonly fatPickValue = computed(() => {
    const fat = this.fat();
    return fat !== null && FAT_PICKS.includes(fat) ? String(fat) : '';
  });
  /** The client's weight, which the per-kilogram warning needs, said once. */
  protected readonly weightLine = computed(() => {
    const client = this.start().client;
    if (!client || client.weight === null) return null;
    const weight = formatNumber(client.weight, this.locale, '1.0-1');
    return $localize`The warnings use ${client.name}:name:’s weight, ${weight}:weight: kg.`;
  });

  protected pickFat(value: string): void {
    const share = Number(value);
    if (FAT_PICKS.includes(share)) this.fat.set(share);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problems() > 0) {
      this.refuse();
      return;
    }
    const client = this.start().client;
    const request = {
      calorieTarget: this.calories()!,
      proteinGrams: this.protein()!,
      fatPercentage: this.fat()!,
      bodyweightKilograms: client?.weight ?? null,
      isEnergyDeficit: client?.isEnergyDeficit ?? false,
    };
    // A read, so no token is needed; the answer is dropped if the workspace changed meanwhile.
    const split = await this.scope.run(
      'fill',
      async (owner) => {
        this.busy.set(true);
        this.error.set(null);
        try {
          return mapSplit(await owner.wait(firstValueFrom(this.api.macroSplit(request))));
        } catch (error) {
          if (owner.current) {
            this.error.set(
              apiErrorMessage(error, $localize`Fat and carbs could not be worked out. Try again.`),
            );
            this.focusSummary();
          }
          return null;
        } finally {
          if (owner.current) this.busy.set(false);
        }
      },
      null,
    );
    if (split) this.filled.emit(split);
  }
}
