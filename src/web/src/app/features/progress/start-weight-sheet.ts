import { formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { MassUnit } from '../../core/units/body-units';
import { DateField } from '../../ui/date-field';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { EntryActions, EntrySheet, ReasonPicker, SHEET_STYLES } from './entry-sheet';
import type { StartingWeight } from './progress-dashboard.models';
import {
  dayErrors,
  massWord,
  numberOrNull,
  quantity,
  reasonErrors,
  reasonPicks,
  reasonValue,
  weightErrors,
  type ReasonPick,
} from './progress-entries.models';

const MASS_UNITS: readonly SegmentOption[] = [
  { value: 'Kilogram' satisfies MassUnit, label: 'kg' },
  { value: 'Pound' satisfies MassUnit, label: 'lb' },
];

/**
 * Correct a client's starting weight (critique B6, PRG-014): the weight as it should read, the day it
 * was weighed, and what was wrong. Only a coach opens it. The start is a record of its own, so its
 * weigh-ins stay as they are, and every earlier value stays in its history, listed here.
 */
@Component({
  selector: 'app-correct-start',
  imports: [Control, DateField, EntryActions, Field, FormSummary, ReasonPicker, SegmentedControl],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [id]="formId" class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="about">
        <strong>{{ saved() }}</strong
        >&ngsp;
        <span class="muted">{{ savedDay() }}</span>
      </p>
      <app-field
        [label]="weightLabel"
        [errors]="shows('value', weightIssues()) ? weightIssues() : null"
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
        [label]="dayLabel"
        [errors]="shows('day', dayIssues()) ? dayIssues() : null"
        [(value)]="day"
        [max]="today()"
        [today]="today()"
        [firstDay]="firstDay()"
        (touched)="attempt.touch('day')"
      />
      <app-reason-picker
        [label]="reasonLabel"
        [picks]="picks()"
        [errors]="shows('reason', reasonIssues()) ? reasonIssues() : null"
        [(pick)]="pick"
        [(typed)]="typed"
        (touched)="attempt.touch('reason')"
      />
      <p class="muted" i18n>The earlier start stays in its history. Weigh-ins are not changed.</p>
      @if (earlier().length) {
        <section class="earlier" aria-labelledby="start-earlier-heading">
          <h3 id="start-earlier-heading" i18n>Earlier starts</h3>
          <ol>
            @for (item of earlier(); track item.id) {
              <li>
                <strong>{{ item.value }}</strong
                >&ngsp;<span class="muted">{{ item.day }}</span
                >&ngsp;<span dir="auto">{{ item.reason }}</span
                >&ngsp;<span class="muted">{{ item.changed }}</span>
              </li>
            }
          </ol>
        </section>
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
        [busyLabel]="savingLabel"
        [busy]="busy()"
        (notNow)="closed.emit(null)"
      />
    </form>
  `,
  styles: [
    SHEET_STYLES,
    `
      .earlier {
        border-block-start: 1px solid var(--tb-line);
        padding-block-start: 0.75rem;
      }

      .earlier h3 {
        color: var(--tb-ink);
        font-size: 0.875rem;
        font-weight: 600;
        margin: 0 0 0.5rem;
      }

      .earlier ol {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .earlier li {
        display: flex;
        flex-wrap: wrap;
        gap: 0.125rem 0.5rem;
        overflow-wrap: anywhere;
      }
    `,
  ],
})
export class CorrectStart extends EntrySheet {
  readonly start = input.required<StartingWeight>();
  /** The start after the correction; null when the sheet was closed without one. */
  readonly closed = output<StartingWeight | null>();

  protected readonly weightLabel = $localize`Starting weight`;
  protected readonly unitLabel = $localize`Unit`;
  protected readonly dayLabel = $localize`Day it was weighed`;
  protected readonly reasonLabel = $localize`What was wrong?`;
  protected readonly saveLabel = $localize`Save correction`;
  protected readonly savingLabel = $localize`Saving…`;
  protected readonly units = MASS_UNITS;
  protected readonly numberOrNull = numberOrNull;

  protected readonly value = linkedSignal<number | null>(() => this.start().enteredValue);
  protected readonly unit = linkedSignal<MassUnit>(() => this.start().enteredUnit);
  protected readonly day = linkedSignal(() => this.start().date);
  protected readonly pick = signal<ReasonPick | null>(null);
  protected readonly typed = signal('');

  protected readonly saved = computed(() => {
    const start = this.start();
    return `${quantity(start.enteredValue, this.audience().locale)} ${massWord(start.enteredUnit)}`;
  });
  protected readonly savedDay = computed(() => this.longDay(this.start().date));
  protected readonly picks = computed(() => reasonPicks('start', this.audience()));
  protected readonly weightIssues = computed(() => weightErrors(this.value(), this.unit()));
  protected readonly dayIssues = computed(() => {
    const issues = dayErrors(this.day(), this.today(), 'weighed');
    if (issues.length > 0 || this.weightIssues().length > 0) return issues;
    const start = this.start();
    return this.value() === start.enteredValue &&
      this.unit() === start.enteredUnit &&
      this.day() === start.date
      ? [$localize`That is the start already saved. Change the weight or the day, or close this.`]
      : [];
  });
  protected readonly reasonIssues = computed(() => reasonErrors(this.pick(), this.typed()));
  protected readonly problems = computed(
    () => this.weightIssues().length + this.dayIssues().length + this.reasonIssues().length,
  );
  protected readonly earlier = computed(() => {
    const locale = this.audience().locale;
    return this.start().corrections.map((item) => ({
      id: item.id,
      value: `${quantity(item.enteredValue, locale)} ${massWord(item.enteredUnit)}`,
      day: this.longDay(item.date),
      reason: item.reason,
      changed: item.byName
        ? $localize`Changed by ${item.byName}:name:, ${formatDate(item.atUtc, 'EEE d MMM y', locale)}:day:`
        : $localize`Changed ${formatDate(item.atUtc, 'EEE d MMM y', locale)}:day:`,
    }));
  });

  constructor() {
    super();
    effect(() => {
      const start = this.start();
      this.dirtyChange.emit(
        this.value() !== start.enteredValue ||
          this.unit() !== start.enteredUnit ||
          this.day() !== start.date ||
          this.pick() !== null,
      );
    });
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    const clientId = this.clientId();
    if (clientId === null) return;
    if (this.problems() > 0) {
      this.refuse();
      return;
    }
    const request = {
      value: this.value()!,
      unit: this.unit(),
      measurementDate: this.day(),
      reason: reasonValue(this.pick(), this.typed()),
      version: this.start().version,
    };
    let corrected: StartingWeight | null = null;
    const ok = await this.send(
      async (owner) => {
        corrected = await owner.wait(firstValueFrom(this.entries.correctStart(clientId, request)));
      },
      $localize`The start could not be saved. Try again.`,
    );
    if (ok) this.closed.emit(corrected);
  }

  private longDay(date: string): string {
    return formatDate(date, 'EEE d MMM y', this.audience().locale);
  }
}
