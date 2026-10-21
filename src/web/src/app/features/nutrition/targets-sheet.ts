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
import type { FormulaSex, OccupationActivityType } from '../../core/api/generated';
import { SheetForm } from '../../core/forms/sheet-form';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { EntryActions, SHEET_STYLES } from '../../ui/sheet-parts';
import { ClientNutritionApi } from './client-nutrition-api';
import {
  calculationRefusal,
  calculationRequest,
  FAT_PICKS,
  FORMULAS,
  GOAL_PICKS,
  mapWorkedOut,
  numberOrNull,
  perKilogram,
  problemCount,
  PROTEIN_PER_KG,
  proteinFor,
  signedKcal,
  startingTargets,
  targetErrors,
  WORK_KINDS,
  type FormulaKey,
  type Starting,
  type WorkedOut,
} from './client-nutrition.models';
import { dayWords } from '../progress/progress-entries.models';
import { TargetsResult } from './targets-result';

const SEXES: readonly SegmentOption[] = [
  { value: 'Female' satisfies FormulaSex, label: $localize`Female` },
  { value: 'Male' satisfies FormulaSex, label: $localize`Male` },
];

/**
 * Work out a client's calories and macros, in a sheet (R5.3d). It starts from what the record already
 * knows (age from the birth date, height and steps from the intake, weight from the latest weigh-in)
 * and says where each came from; sex and the kind of work are chosen, never assumed. Every press records
 * a calculation on the server and shows it in the same sheet, ready to assign a meal plan with.
 */
@Component({
  selector: 'app-work-out-targets',
  imports: [Button, Control, EntryActions, Field, FormSummary, SegmentedControl, TargetsResult],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (result(); as made) {
      <div class="body" data-result>
        <p class="muted" i18n>
          Saved as the latest targets for {{ firstName() }}. Nothing changes for them until you
          assign a meal plan with these.
        </p>
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
        <p class="muted" i18n>
          Estimates from the formulas, not measurements. You choose the numbers that go to
          {{ firstName() }}.
        </p>

        <fieldset class="group">
          <legend i18n>About {{ firstName() }}</legend>
          <div class="pair">
            <app-field
              [label]="weightLabel"
              [help]="weightHelp()"
              [errors]="shows('weight', issues().weight) ? issues().weight : null"
            >
              <input
                appControl
                name="weight"
                type="number"
                inputmode="decimal"
                step="any"
                min="0"
                [value]="weight() ?? ''"
                (input)="weight.set(numberOrNull($any($event.target).valueAsNumber))"
                (blur)="attempt.touch('weight')"
              />
            </app-field>
            <app-field
              [label]="heightLabel"
              [help]="heightHelp()"
              [errors]="shows('height', issues().height) ? issues().height : null"
            >
              <input
                appControl
                name="height"
                type="number"
                inputmode="decimal"
                step="any"
                min="0"
                [value]="height() ?? ''"
                (input)="height.set(numberOrNull($any($event.target).valueAsNumber))"
                (blur)="attempt.touch('height')"
              />
            </app-field>
          </div>
          <div class="pair">
            <app-field
              [label]="ageLabel"
              [help]="ageHelp()"
              [errors]="shows('age', issues().age) ? issues().age : null"
            >
              <input
                appControl
                name="age"
                type="number"
                inputmode="numeric"
                step="1"
                min="0"
                [value]="age() ?? ''"
                (input)="age.set(numberOrNull($any($event.target).valueAsNumber))"
                (blur)="attempt.touch('age')"
              />
            </app-field>
            <div class="sex tb-field">
              <span class="tb-field__label" aria-hidden="true">{{ sexLabel }}</span>
              <app-segmented-control
                [label]="sexLabel"
                [hideLabel]="true"
                [options]="sexes"
                [selected]="sex() ?? ''"
                (selectedChange)="sex.set($any($event))"
              />
              @if (shows('sex', issues().sex)) {
                <p class="problem" id="sex-error" role="status">{{ issues().sex[0] }}</p>
              }
            </div>
          </div>
        </fieldset>

        <fieldset class="group">
          <legend i18n>Their day</legend>
          <div class="choices" role="radiogroup" [attr.aria-label]="workLabel">
            @for (kind of kinds; track kind.value) {
              <label class="choice" [class.chosen]="work() === kind.value">
                <input
                  type="radio"
                  name="work"
                  [value]="kind.value"
                  [checked]="work() === kind.value"
                  [attr.aria-invalid]="shows('work', issues().work) ? 'true' : null"
                  [attr.aria-describedby]="shows('work', issues().work) ? 'work-error' : null"
                  (change)="work.set(kind.value)"
                />
                <span class="choice-text">
                  <strong>{{ kind.label }}</strong
                  >&ngsp;<span class="muted">{{ kind.hint }}</span>
                </span>
              </label>
            }
          </div>
          @if (shows('work', issues().work)) {
            <p class="problem" id="work-error" role="status">{{ issues().work[0] }}</p>
          }
          <app-field
            [label]="stepsLabel"
            [help]="stepsHelp()"
            [errors]="shows('steps', issues().steps) ? issues().steps : null"
          >
            <input
              appControl
              name="steps"
              type="number"
              inputmode="numeric"
              step="100"
              min="0"
              [value]="steps() ?? ''"
              (input)="steps.set(numberOrNull($any($event.target).valueAsNumber))"
              (blur)="attempt.touch('steps')"
            />
          </app-field>
        </fieldset>

        <fieldset class="group">
          <legend i18n>The goal</legend>
          <div class="chips" role="group" [attr.aria-label]="goalPicksLabel">
            @for (pick of goalPicks; track pick.kcal) {
              <button
                type="button"
                class="chip"
                [class.chosen]="goal() === pick.kcal"
                [attr.aria-pressed]="goal() === pick.kcal"
                (click)="goal.set(pick.kcal)"
              >
                <span>{{ pick.label }}</span
                >&ngsp;<strong>{{ signed(pick.kcal) }}</strong>
              </button>
            }
          </div>
          <app-field
            [label]="goalLabel"
            [help]="goalHelp"
            [errors]="shows('goal', issues().goal) ? issues().goal : null"
          >
            <input
              appControl
              name="goal"
              type="number"
              step="10"
              [value]="goal() ?? ''"
              (input)="goal.set(numberOrNull($any($event.target).valueAsNumber))"
              (blur)="attempt.touch('goal')"
            />
          </app-field>
        </fieldset>

        <fieldset class="group">
          <legend i18n>Protein and fat</legend>
          <div class="chips" role="group" [attr.aria-label]="proteinPicksLabel">
            @for (perKg of proteinPerKg; track perKg) {
              <button
                type="button"
                class="chip"
                [class.chosen]="proteinPick() === perKg"
                [attr.aria-pressed]="proteinPick() === perKg"
                [disabled]="proteinPicksOff()"
                (click)="pickProtein(perKg)"
              >
                <span i18n>{{ perKg }} g a kilogram</span>
              </button>
            }
          </div>
          <app-field
            [label]="proteinLabel"
            [help]="proteinHelp()"
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
          <div class="chips" role="group" [attr.aria-label]="fatPicksLabel">
            @for (share of fatPicks; track share) {
              <button
                type="button"
                class="chip"
                [class.chosen]="fat() === share"
                [attr.aria-pressed]="fat() === share"
                (click)="fat.set(share)"
              >
                <span i18n>{{ share }}% fat</span>
              </button>
            }
          </div>
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
              [value]="fat() ?? ''"
              (input)="fat.set(numberOrNull($any($event.target).valueAsNumber))"
              (blur)="attempt.touch('fat')"
            />
          </app-field>
        </fieldset>

        <details class="formula" [open]="formula() !== 'MifflinStJeor'">
          <summary i18n>Formula: {{ formulaName() }}</summary>
          <div class="choices" role="radiogroup" [attr.aria-label]="formulaLabel">
            @for (option of formulas; track option.value) {
              <label class="choice" [class.chosen]="formula() === option.value">
                <input
                  type="radio"
                  name="formula"
                  [value]="option.value"
                  [checked]="formula() === option.value"
                  (change)="formula.set(option.value)"
                />
                <span class="choice-text">
                  <strong>{{ option.label }}</strong
                  >&ngsp;<span class="muted">{{ option.hint }}</span>
                </span>
              </label>
            }
          </div>
          @if (formula() === 'KatchMcArdle') {
            <app-field
              [label]="bodyFatLabel"
              [errors]="shows('bodyFat', issues().bodyFat) ? issues().bodyFat : null"
            >
              <input
                appControl
                name="bodyFat"
                type="number"
                inputmode="decimal"
                step="any"
                min="0"
                [value]="bodyFat() ?? ''"
                (input)="bodyFat.set(numberOrNull($any($event.target).valueAsNumber))"
                (blur)="attempt.touch('bodyFat')"
              />
            </app-field>
          }
        </details>

        <app-form-summary>
          @if (error(); as message) {
            {{ message }}
          } @else if (attempt.wasTried() && problems() > 0) {
            <ng-container i18n>Check the fields marked above.</ng-container>
          }
        </app-form-summary>
        <app-entry-actions
          [saveLabel]="saveLabel"
          [busyLabel]="workingLabel"
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

      .choices {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .choice {
        align-items: flex-start;
        background: var(--tb-surface);
        border: 1px solid var(--tb-line-strong);
        border-radius: var(--tb-radius-control);
        color: var(--tb-ink);
        cursor: pointer;
        display: flex;
        gap: 0.625rem;
        min-block-size: 2.75rem;
        padding: 0.625rem 0.875rem;
      }

      .choice:hover {
        border-color: var(--tb-ink);
      }

      .choice.chosen {
        background: var(--tb-accent-soft);
        border-color: var(--tb-accent-ink);
      }

      .choice:has(input:focus-visible) {
        outline: 2px solid var(--tb-focus);
        outline-offset: 2px;
      }

      .choice input[type='radio'] {
        accent-color: var(--tb-accent-ink);
        block-size: 1.125rem;
        flex: none;
        inline-size: 1.125rem;
        margin: 0.125rem 0 0;
      }

      // A label's direct span is bold in the legacy global styles; the hint under a name is not.
      .choice-text {
        display: flex;
        flex-direction: column;
        font-weight: 400;
        gap: 0.125rem;
        min-inline-size: 0;
      }

      // The legacy global styles still colour a bare strong; these cards take the mode's own ink.
      .choice-text strong {
        color: var(--tb-ink);
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      .chip {
        align-items: baseline;
        background: var(--tb-surface);
        border: 1px solid var(--tb-line-strong);
        border-radius: 999px;
        color: var(--tb-ink);
        cursor: pointer;
        display: inline-flex;
        font: inherit;
        gap: 0.375rem;
        min-block-size: 2.75rem;
        padding: 0.5rem 0.875rem;
        touch-action: manipulation;
      }

      .chip strong {
        font-variant-numeric: tabular-nums;
      }

      .chip:hover:not(:disabled) {
        border-color: var(--tb-ink);
      }

      .chip.chosen {
        background: var(--tb-accent-soft);
        border-color: var(--tb-accent-ink);
      }

      .chip:focus-visible {
        outline: 3px solid var(--tb-focus);
        outline-offset: 2px;
      }

      .chip:disabled {
        color: var(--tb-muted);
        cursor: not-allowed;
      }

      .problem {
        color: var(--tb-danger);
        font-size: 0.875rem;
        margin: 0.25rem 0 0;
      }

      .sex {
        min-inline-size: 0;
      }

      .formula summary {
        color: var(--tb-ink);
        cursor: pointer;
        font-weight: 600;
        min-block-size: 2.75rem;
        padding-block: 0.625rem;
      }

      .formula summary:focus-visible {
        outline: 3px solid var(--tb-focus);
        outline-offset: 2px;
      }

      .formula .choices {
        margin-block-end: 0.75rem;
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
export class WorkOutTargets extends SheetForm {
  private readonly api = inject(ClientNutritionApi);

  readonly clientId = input.required<string>();
  readonly firstName = input.required<string>();
  /** What the record already knows, with where each number came from. */
  readonly starting = input.required<Starting>();
  /** The targets worked out before, whose choices carry over; null for the first. */
  readonly last = input<WorkedOut | null>(null);
  /** Today in the coaching space, never the browser's. */
  readonly today = input.required<string>();
  readonly locale = input<string>('en');
  /** The calculation that was recorded, or null when the sheet was closed without one. */
  readonly closed = output<WorkedOut | null>();
  /** The result is on screen and the coach wants to assign a meal plan with it. */
  readonly assign = output<WorkedOut>();
  /** A calculation was recorded, so the page reads its list again. */
  readonly recorded = output<WorkedOut>();

  protected readonly weightLabel = $localize`Weight (kg)`;
  protected readonly heightLabel = $localize`Height (cm)`;
  protected readonly ageLabel = $localize`Age (years)`;
  protected readonly sexLabel = $localize`Sex used by the formula`;
  protected readonly workLabel = $localize`Kind of work`;
  protected readonly stepsLabel = $localize`Steps a day, on average`;
  protected readonly goalLabel = $localize`Calories a day, above or below what they burn`;
  protected readonly goalHelp = $localize`Minus eats less than they burn, plus eats more. 0 holds their weight.`;
  protected readonly goalPicksLabel = $localize`Common goals`;
  protected readonly proteinPicksLabel = $localize`Protein for each kilogram of body weight`;
  protected readonly proteinLabel = $localize`Protein (grams a day)`;
  protected readonly fatPicksLabel = $localize`Share of calories from fat`;
  protected readonly fatLabel = $localize`Fat (percent of calories)`;
  protected readonly fatHelp = $localize`Carbohydrate is what is left after protein and fat.`;
  protected readonly formulaLabel = $localize`Formula`;
  protected readonly bodyFatLabel = $localize`Body fat (percent)`;
  protected readonly saveLabel = $localize`Work out targets`;
  protected readonly workingLabel = $localize`Working it out…`;
  protected readonly sexes = SEXES;
  protected readonly kinds = WORK_KINDS;
  protected readonly goalPicks = GOAL_PICKS;
  protected readonly proteinPerKg = PROTEIN_PER_KG;
  protected readonly fatPicks = FAT_PICKS;
  protected readonly formulas = FORMULAS;
  protected readonly numberOrNull = numberOrNull;
  protected readonly signed = signedKcal;

  private readonly start = computed(() => startingTargets(this.starting(), this.last()));
  protected readonly weight = linkedSignal<number | null>(() => this.start().weight);
  protected readonly height = linkedSignal<number | null>(() => this.start().height);
  protected readonly age = linkedSignal<number | null>(() => this.start().age);
  protected readonly sex = linkedSignal<FormulaSex | null>(() => this.start().sex);
  protected readonly work = linkedSignal<OccupationActivityType | null>(() => this.start().work);
  protected readonly steps = linkedSignal<number | null>(() => this.start().steps);
  protected readonly goal = linkedSignal<number | null>(() => this.start().goal);
  protected readonly protein = linkedSignal<number | null>(() => this.start().protein);
  protected readonly fat = linkedSignal<number | null>(() => this.start().fat);
  protected readonly formula = linkedSignal<FormulaKey>(() => this.start().formula);
  protected readonly bodyFat = linkedSignal<number | null>(() => this.start().bodyFat);

  protected readonly result = signal<WorkedOut | null>(null);

  protected readonly values = computed(() => ({
    weight: this.weight(),
    height: this.height(),
    age: this.age(),
    sex: this.sex(),
    work: this.work(),
    steps: this.steps(),
    goal: this.goal(),
    protein: this.protein(),
    fat: this.fat(),
    formula: this.formula(),
    bodyFat: this.bodyFat(),
  }));
  protected readonly issues = computed(() => targetErrors(this.values()));
  protected readonly problems = computed(() => problemCount(this.issues()));
  protected readonly formulaName = computed(
    () => FORMULAS.find((item) => item.value === this.formula())?.label ?? '',
  );

  protected readonly weightHelp = computed(() => {
    const given = this.starting().weight;
    if (!given || this.weight() !== given.value) return null;
    const day = dayWords(given.on, this.today(), this.locale());
    return $localize`From their weigh-in on ${day}:day:.`;
  });
  protected readonly heightHelp = computed(() =>
    this.starting().height !== null && this.height() === this.starting().height
      ? $localize`From their profile.`
      : null,
  );
  protected readonly ageHelp = computed(() =>
    this.starting().age !== null && this.age() === this.starting().age
      ? $localize`Counted from their birth date.`
      : null,
  );
  protected readonly stepsHelp = computed(() =>
    this.starting().steps !== null && this.steps() === this.starting().steps
      ? $localize`From their profile. Under 5,000 a day is a little, over 10,000 a lot.`
      : $localize`A phone’s health app shows it. Under 5,000 a day is a little, over 10,000 a lot.`,
  );
  protected readonly proteinPicksOff = computed(
    () => this.weight() === null || this.issues().weight.length > 0,
  );
  protected readonly proteinPick = computed(() => {
    const weight = this.weight();
    const grams = this.protein();
    if (weight === null || grams === null || this.proteinPicksOff()) return null;
    return PROTEIN_PER_KG.find((perKg) => proteinFor(weight, perKg) === grams) ?? null;
  });
  protected readonly proteinHelp = computed(() => {
    const weight = this.weight();
    const grams = this.protein();
    const perKg = weight !== null && grams !== null ? perKilogram(grams, weight) : null;
    return perKg === null
      ? $localize`Choose a quick pick, or type the grams.`
      : $localize`That is ${perKg}:perKg: g for each kilogram of their weight.`;
  });

  constructor() {
    super();
    effect(() => {
      const start = this.start();
      const now = this.values();
      const same =
        now.weight === start.weight &&
        now.height === start.height &&
        now.age === start.age &&
        now.sex === start.sex &&
        now.work === start.work &&
        now.steps === start.steps &&
        now.goal === start.goal &&
        now.protein === start.protein &&
        now.fat === start.fat &&
        now.formula === start.formula &&
        now.bodyFat === start.bodyFat;
      this.dirtyChange.emit(!same && this.result() === null);
    });
  }

  protected pickProtein(perKg: number): void {
    const weight = this.weight();
    if (weight !== null) this.protein.set(proteinFor(weight, perKg));
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problems() > 0) {
      this.refuse();
      return;
    }
    const request = calculationRequest(this.values());
    let made = null as WorkedOut | null;
    const ok = await this.send(
      async (owner) => {
        const view = await owner.wait(firstValueFrom(this.api.calculate(this.clientId(), request)));
        made = mapWorkedOut({
          result: view,
          inputs: request,
          calculatedAtUtc: new Date().toISOString(),
        });
      },
      (error) =>
        calculationRefusal(
          apiErrorMessage(error, $localize`The targets could not be worked out. Try again.`),
        ),
    );
    if (ok && made) {
      this.result.set(made);
      this.recorded.emit(made);
    }
  }
}
