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
import { ApiClient } from '../../core/api/api-client';
import type { TrainingLoadUnit } from '../../core/api/generated';
import { SheetForm } from '../../core/forms/sheet-form';
import { DateField } from '../../ui/date-field';
import { Control, Field } from '../../ui/field';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { EntryActions, SHEET_STYLES } from '../../ui/sheet-parts';
import { numberOrNull } from '../nutrition/client-nutrition.models';
import {
  maxErrors,
  mapMax,
  maxProblems,
  RECORDABLE_KINDS,
  recordRefusal,
  recordRequest,
  type MaxEntry,
} from './client-strength.models';
import { ExercisePicker, type ExerciseChoice } from './exercise-picker';

const UNITS: readonly SegmentOption[] = [
  { value: 'Kilogram' satisfies TrainingLoadUnit, label: 'kg' },
  { value: 'Pound' satisfies TrainingLoadUnit, label: 'lb' },
];

/**
 * Record a max by hand, in a sheet (R5.3d): which lift, what kind (a training max a program works
 * from, or a tested one-rep max), the weight and the day it was true. A max is only ever added, never
 * changed (STR-001), and an estimate is not a kind a coach types: it comes from a calculation or a set.
 */
@Component({
  selector: 'app-record-max',
  imports: [Control, DateField, EntryActions, ExercisePicker, Field, SegmentedControl],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="muted" i18n>
        A max is added to {{ firstName() }}’s history and never changed; to put one right, record
        the right number for the day.
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
      <app-date-field
        [label]="dateLabel"
        [errors]="shows('date', issues().date) ? issues().date : null"
        [(value)]="date"
        [max]="today()"
        [today]="today()"
        [firstDay]="firstDay()"
        (touched)="attempt.touch('date')"
      />
      <app-field [label]="noteLabel" [help]="noteHelp">
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
      @if (attempt.wasTried() && problems() > 0) {
        <p class="problem-text" role="alert" i18n>Check what is marked above.</p>
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
    `,
  ],
})
export class RecordMax extends SheetForm {
  private readonly api = inject(ApiClient);

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
  /** The max that was recorded, or null when the sheet was closed without one. */
  readonly closed = output<MaxEntry | null>();

  protected readonly exerciseLabel = $localize`Exercise`;
  protected readonly kindLabel = $localize`What kind of max`;
  protected readonly valueLabel = $localize`Weight`;
  protected readonly unitLabel = $localize`Unit`;
  protected readonly dateLabel = $localize`Day it was true`;
  protected readonly noteLabel = $localize`Note (optional)`;
  protected readonly noteHelp = $localize`How it was tested, or why it is the number.`;
  protected readonly saveLabel = $localize`Record max`;
  protected readonly savingLabel = $localize`Saving…`;
  protected readonly kinds = RECORDABLE_KINDS;
  protected readonly units = UNITS;
  protected readonly numberOrNull = numberOrNull;

  protected readonly exercise = linkedSignal<ExerciseChoice | null>(() => this.start());
  protected readonly kind = signal<'CoachWorkingMax' | 'TestedOneRepMax'>('CoachWorkingMax');
  protected readonly value = signal<number | null>(null);
  protected readonly unit = linkedSignal<TrainingLoadUnit>(() => this.startUnit());
  protected readonly date = linkedSignal(() => this.today());
  protected readonly note = signal('');

  protected readonly issues = computed(() =>
    maxErrors(
      {
        exerciseId: this.exercise()?.id ?? null,
        kind: this.kind(),
        value: this.value(),
        unit: this.unit(),
        date: this.date(),
        note: this.note(),
      },
      this.today(),
    ),
  );
  protected readonly problems = computed(() => maxProblems(this.issues()));
  protected readonly valueHelp = computed(() => {
    const exercise = this.exercise();
    return exercise
      ? $localize`For ${exercise.name}:lift:. The unit is never converted: kilograms stay kilograms.`
      : null;
  });

  constructor() {
    super();
    effect(() =>
      this.dirtyChange.emit(
        this.value() !== null ||
          this.note().trim() !== '' ||
          (this.exercise() !== null && this.exercise()?.id !== this.start()?.id),
      ),
    );
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problems() > 0) {
      this.refuse();
      return;
    }
    const request = recordRequest({
      exerciseId: this.exercise()!.id,
      kind: this.kind(),
      value: this.value(),
      unit: this.unit(),
      date: this.date(),
      note: this.note(),
    });
    let saved = null as MaxEntry | null;
    const ok = await this.send(
      async (owner) => {
        saved = mapMax(
          await owner.wait(firstValueFrom(this.api.recordStrengthMax(this.clientId(), request))),
        );
      },
      (error) => recordRefusal(error, $localize`The max could not be saved. Try again.`),
    );
    if (ok && saved) this.closed.emit(saved);
  }
}
