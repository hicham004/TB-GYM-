import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  LOCALE_ID,
  output,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { EstimateOneRepMaxRequest, TrainingLoadUnit } from '../../core/api/generated';
import { SheetForm } from '../../core/forms/sheet-form';
import { Checkbox } from '../../ui/checkbox';
import { DateField } from '../../ui/date-field';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { EntryActions, SHEET_STYLES } from '../../ui/sheet-parts';
import { numberOrNull } from '../nutrition/client-nutrition.models';
import { ClientStrengthApi } from './client-strength-api';
import {
  estimateRequest,
  fromSetRequest,
  mapMax,
  MAX_CHOICES,
  maxErrors,
  maxProblems,
  recordRefusal,
  recordRequest,
  setEstimate,
  type MaxChoice,
  type MaxEntry,
  type MaxValues,
  type SetEstimate,
} from './client-strength.models';
import { ExercisePicker, type ExerciseChoice } from './exercise-picker';

const UNITS: readonly SegmentOption[] = [
  { value: 'Kilogram' satisfies TrainingLoadUnit, label: 'kg' },
  { value: 'Pound' satisfies TrainingLoadUnit, label: 'lb' },
];

/** How long typing pauses before the server is asked for a set's estimate. */
const ESTIMATE_PAUSE_MS = 300;

const requestKey = (request: EstimateOneRepMaxRequest) =>
  `${request.load}|${request.repetitions}|${request.unit}`;

/**
 * Record a max in a sheet (R5.3d; critique B7b): which lift, what kind (a training max a program works from,
 * a tested one-rep max, or a set they did), the numbers and the day. A max is only ever added, never changed
 * (STR-001), and an estimate is never typed: from a set's weight × reps the server works it out by Epley v1,
 * shows it while the coach types, and records it with a training max at 90% of it when the box is ticked
 * (TrainingMaxShare v1, STR-017).
 */
@Component({
  selector: 'app-record-max',
  imports: [
    Checkbox,
    Control,
    DateField,
    EntryActions,
    ExercisePicker,
    Field,
    FormSummary,
    SegmentedControl,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [id]="formId" class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="muted" i18n>
        A max is added to {{ firstName() }}’s history and never changed; to put one right, record
        the right number for the day. Programs don’t read it directly: each keeps its own training
        maxes, set when you assign it and updated from there.
      </p>
      <app-exercise-picker
        [label]="exerciseLabel"
        [suggested]="suggested()"
        [(chosen)]="exercise"
        [errors]="shows('exercise', issues().exercise) ? issues().exercise : null"
      />
      <fieldset class="group">
        <legend i18n>What kind of max</legend>
        <div class="choices" role="radiogroup" [attr.aria-label]="kindLabel">
          @for (item of kinds; track item.value) {
            <label class="choice" [class.chosen]="kind() === item.value">
              <input
                type="radio"
                name="kind"
                [value]="item.value"
                [checked]="kind() === item.value"
                (change)="kind.set(item.value)"
              />
              <span class="choice-text">
                <strong>{{ item.label }}</strong
                >&ngsp;<span class="muted">{{ item.hint }}</span>
              </span>
            </label>
          }
        </div>
      </fieldset>
      <app-field
        [label]="valueLabel"
        [help]="valueHelp()"
        [errors]="shows('value', issues().value) ? issues().value : null"
      >
        <div class="value-unit">
          <input
            appControl
            name="value"
            type="number"
            inputmode="decimal"
            step="any"
            min="0"
            [value]="value() ?? ''"
            (input)="value.set(numberOrNull($any($event.target).valueAsNumber))"
            (blur)="attempt.touch('value')"
          />
          <app-segmented-control
            [label]="unitLabel"
            [hideLabel]="true"
            [options]="units"
            [selected]="unit()"
            (selectedChange)="unit.set($any($event))"
          />
        </div>
      </app-field>
      @if (fromSet()) {
        <app-field
          [label]="repsLabel"
          [help]="repsHelp"
          [errors]="shows('repetitions', issues().repetitions) ? issues().repetitions : null"
        >
          <input
            appControl
            name="repetitions"
            type="number"
            inputmode="numeric"
            step="1"
            min="1"
            max="10"
            class="reps"
            [value]="repetitions() ?? ''"
            (input)="repetitions.set(numberOrNull($any($event.target).valueAsNumber))"
            (blur)="attempt.touch('repetitions')"
          />
        </app-field>
        <div class="estimate" data-estimate>
          <div class="about" aria-live="polite">
            @switch (estimateState()) {
              @case ('ready') {
                @if (worked(); as result) {
                  <p>
                    <span i18n>Estimated 1RM</span>&ngsp;<strong data-estimate-value>{{
                      result.estimate
                    }}</strong>
                  </p>
                  <p class="muted" data-explanation>{{ result.explanation }}</p>
                  @if (result.tooHeavy) {
                    <p class="problem-text" i18n>That set works out to a max of more than 2,000.</p>
                  }
                }
              }
              @case ('working') {
                <p class="muted" i18n>Working out their estimated 1RM…</p>
              }
              @case ('error') {
                <p class="muted" data-estimate-error>{{ estimateFailure()?.message }}</p>
              }
              @default {
                <p class="muted" i18n>
                  Their estimated 1RM shows here once the weight and the reps are in.
                </p>
              }
            }
          </div>
          <app-checkbox [label]="alsoLabel">
            <input
              appControl
              type="checkbox"
              name="also-training-max"
              [checked]="alsoTrainingMax()"
              [aria-describedby]="alsoFigure() ? alsoFigureId : null"
              (change)="alsoTrainingMax.set($any($event.target).checked)"
            />
          </app-checkbox>
          @if (alsoFigure(); as figure) {
            <p class="also-figure" [id]="alsoFigureId" data-training-max>
              <span i18n>Training max</span>&ngsp;<strong>{{ figure }}</strong
              >&ngsp;<span class="muted" i18n>· 90% of the estimate</span>
            </p>
          }
        </div>
      }
      <app-date-field
        [label]="dateLabel()"
        [errors]="shows('date', issues().date) ? issues().date : null"
        [(value)]="date"
        [max]="today()"
        [today]="today()"
        [firstDay]="firstDay()"
        (touched)="attempt.touch('date')"
      />
      <app-field [label]="noteLabel" [help]="noteHelp()">
        <textarea
          appControl
          name="note"
          rows="2"
          maxlength="1000"
          dir="auto"
          [value]="note()"
          (input)="note.set($any($event.target).value)"
        ></textarea>
      </app-field>
      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        } @else if (attempt.wasTried() && problems() > 0) {
          <ng-container i18n>Check what is marked above.</ng-container>
        }
      </app-form-summary>
      <app-entry-actions
        [form]="formId"
        [saveLabel]="saveLabel"
        [busyLabel]="savingLabel"
        [busy]="busy()"
        (notNow)="closed.emit(null)"
      />
    </form>
  `,
  styles: [
    SHEET_STYLES,
    `
      .group {
        border: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
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

      .choice-text strong {
        color: var(--tb-ink);
      }

      // Reps are one or two digits: a narrow box, so it reads as a count beside the weight above it.
      .reps {
        max-inline-size: 8rem;
      }

      .estimate {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .estimate .about {
        gap: 0.25rem;
      }

      // Under the box's label: the kit's 16px box and its 8px gap.
      .also-figure {
        padding-inline-start: 1.5rem;
      }

      .also-figure strong {
        font-variant-numeric: tabular-nums;
        font-weight: 600;
      }
    `,
  ],
})
export class RecordMax extends SheetForm {
  private readonly api = inject(ApiClient);
  private readonly strengthApi = inject(ClientStrengthApi);
  private readonly locale = inject(LOCALE_ID);

  readonly clientId = input.required<string>();
  readonly firstName = input.required<string>();
  /** Today in the coaching space, never the browser's. */
  readonly today = input.required<string>();
  readonly firstDay = input<number | null>(null);
  /** The lifts with something on record, offered first. */
  readonly suggested = input<readonly ExerciseChoice[]>([]);
  /** A lift to start from, when the sheet is opened from its row. */
  readonly start = input<ExerciseChoice | null>(null);
  /** The unit the lift is already kept in, so a second entry matches the first. */
  readonly startUnit = input<TrainingLoadUnit>('Kilogram');
  /**
   * What was recorded, or null when the sheet was closed without it: one max, or a set's estimate followed by
   * the training max set from it.
   */
  readonly closed = output<readonly MaxEntry[] | null>();

  protected readonly exerciseLabel = $localize`Exercise`;
  protected readonly kindLabel = $localize`What kind of max`;
  protected readonly valueLabel = $localize`Weight`;
  protected readonly unitLabel = $localize`Unit`;
  protected readonly repsLabel = $localize`Reps`;
  protected readonly repsHelp = $localize`From 1 to 10 reps.`;
  protected readonly alsoLabel = $localize`Also set their training max at 90%`;
  protected readonly noteLabel = $localize`Note (optional)`;
  protected readonly saveLabel = $localize`Record max`;
  protected readonly savingLabel = $localize`Saving…`;
  protected readonly alsoFigureId = `${this.formId}-training-max`;
  protected readonly kinds = MAX_CHOICES;
  protected readonly units = UNITS;
  protected readonly numberOrNull = numberOrNull;

  protected readonly exercise = linkedSignal<ExerciseChoice | null>(() => this.start());
  protected readonly kind = signal<MaxChoice>('CoachWorkingMax');
  protected readonly value = signal<number | null>(null);
  protected readonly repetitions = signal<number | null>(null);
  protected readonly unit = linkedSignal<TrainingLoadUnit>(() => this.startUnit());
  protected readonly date = linkedSignal(() => this.today());
  protected readonly note = signal('');
  /** Ticked from the start: the training max at 90% by default (the owner's choice for critique B7b). */
  protected readonly alsoTrainingMax = signal(true);

  protected readonly fromSet = computed(() => this.kind() === 'FromSet');
  protected readonly dateLabel = computed(() =>
    this.fromSet() ? $localize`Day they did it` : $localize`Day it was true`,
  );
  protected readonly noteHelp = computed(() =>
    this.fromSet()
      ? $localize`How the set went, or where it was done.`
      : $localize`How it was tested, or why it is the number.`,
  );

  private readonly values = computed<MaxValues>(() => ({
    exerciseId: this.exercise()?.id ?? null,
    kind: this.kind(),
    value: this.value(),
    repetitions: this.repetitions(),
    unit: this.unit(),
    date: this.date(),
    note: this.note(),
    alsoTrainingMax: this.alsoTrainingMax(),
  }));
  protected readonly issues = computed(() => maxErrors(this.values(), this.today()));
  protected readonly problems = computed(() => maxProblems(this.issues()));
  protected readonly valueHelp = computed(() => {
    const exercise = this.exercise();
    if (!exercise) return null;
    return this.fromSet()
      ? $localize`The weight of the set, for ${exercise.name}:lift:. The unit is never converted: kilograms stay kilograms.`
      : $localize`For ${exercise.name}:lift:. The unit is never converted: kilograms stay kilograms.`;
  });

  /** What the server's calculator is asked now, or null while the set cannot make an estimate yet. */
  private readonly estimateAsk = computed(() =>
    this.fromSet() ? estimateRequest(this.values()) : null,
  );
  private readonly estimateKey = computed(() => {
    const ask = this.estimateAsk();
    return ask ? requestKey(ask) : null;
  });
  /** The server's last answer, kept with the set it answered, so a changed set never shows an old number. */
  private readonly answered = signal<(SetEstimate & { readonly key: string }) | null>(null);
  protected readonly estimateFailure = signal<{ key: string; message: string } | null>(null);
  protected readonly worked = computed(() => {
    const answer = this.answered();
    return answer && answer.key === this.estimateKey() ? answer : null;
  });
  protected readonly estimateState = computed<'waiting' | 'working' | 'ready' | 'error'>(() => {
    const key = this.estimateKey();
    if (key === null) return 'waiting';
    if (this.worked()) return 'ready';
    return this.estimateFailure()?.key === key ? 'error' : 'working';
  });
  /** The training max the box records, as the server worked it out: shown only while ticked. */
  protected readonly alsoFigure = computed(() =>
    this.alsoTrainingMax() ? (this.worked()?.trainingMax ?? null) : null,
  );

  constructor() {
    super();
    effect(() =>
      this.dirtyChange.emit(
        this.value() !== null ||
          this.repetitions() !== null ||
          this.note().trim() !== '' ||
          (this.exercise() !== null && this.exercise()?.id !== this.start()?.id),
      ),
    );
    // Asks the server once typing pauses; a newer set replaces an answer still on its way (one lane).
    effect((onCleanup) => {
      const ask = this.estimateAsk();
      const key = this.estimateKey();
      if (ask === null || key === null || untracked(() => this.answered()?.key) === key) return;
      const timer = setTimeout(() => void this.estimate(ask, key), ESTIMATE_PAUSE_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }

  private estimate(request: EstimateOneRepMaxRequest, key: string): Promise<void> {
    return this.scope.run('estimate', async (owner) => {
      try {
        // The calculator is a POST like every other and checks the token (audit SEC-4).
        await owner.wait(this.csrf.refresh());
        const view = await owner.wait(firstValueFrom(this.strengthApi.estimateOneRepMax(request)));
        this.answered.set({ key, ...setEstimate(view, this.locale) });
      } catch (error) {
        if (!owner.current) return;
        this.estimateFailure.set({
          key,
          message: recordRefusal(
            error,
            $localize`The estimate could not be worked out. Try again.`,
          ),
        });
      }
    });
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problems() > 0) {
      this.refuse();
      return;
    }
    const values = this.values();
    let saved: readonly MaxEntry[] = [];
    const ok = await this.send(
      async (owner) => {
        if (values.kind === 'FromSet') {
          // The server works every number out again from the set; nothing shown here is sent.
          const answer = await owner.wait(
            firstValueFrom(
              this.strengthApi.recordMaxFromSet(this.clientId(), fromSetRequest(values)),
            ),
          );
          saved = [
            mapMax(answer.estimate, this.locale),
            ...(answer.trainingMax ? [mapMax(answer.trainingMax, this.locale)] : []),
          ];
          return;
        }
        const request = recordRequest({ ...values, kind: values.kind });
        saved = [
          mapMax(
            await owner.wait(firstValueFrom(this.api.recordStrengthMax(this.clientId(), request))),
            this.locale,
          ),
        ];
      },
      (error) => recordRefusal(error, $localize`The max could not be saved. Try again.`),
    );
    if (ok && saved.length > 0) this.closed.emit(saved);
  }
}
