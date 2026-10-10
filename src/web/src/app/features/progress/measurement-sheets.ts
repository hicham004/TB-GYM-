import { formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  linkedSignal,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { MeasurementType } from '../../core/api/generated';
import type { GirthUnit } from '../../core/units/body-units';
import { Button } from '../../ui/button';
import { DateField } from '../../ui/date-field';
import { Control, Field } from '../../ui/field';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { Skeleton } from '../../ui/skeleton';
import { EntryActions, EntrySheet, ReasonPicker, SHEET_STYLES } from './entry-sheet';
import {
  dayErrors,
  dayWords,
  entryRefusal,
  isStale,
  lengthWord,
  MEASURED,
  measurementErrors,
  measurementName,
  measurementUnit,
  numberOrNull,
  quantity,
  reasonErrors,
  reasonPicks,
  reasonValue,
  type MeasurementRow,
  type ReasonPick,
} from './progress-entries.models';
import type { BodyMeasurementHistory } from './progress.models';

const GIRTH_UNITS: readonly SegmentOption[] = [
  { value: 'Centimetre' satisfies GirthUnit, label: 'cm' },
  { value: 'Inch' satisfies GirthUnit, label: 'in' },
];

type LineState = 'idle' | 'saved' | 'failed';
type Lines<T> = Record<MeasurementType, T>;

const emptyLines = <T>(value: T): Lines<T> =>
  Object.fromEntries(MEASURED.map((type) => [type, value])) as Lines<T>;

/**
 * Log several measurements at once, in a sheet (R5.3c): one day, and a box for each of the waist, chest,
 * hips, thigh, arm and body fat. A client measures them in one go, so each box is optional and
 * only the ones with a number are saved. A line the server refuses (one already recorded for that day,
 * say) stays on screen with its reason while the others are saved, and a second try sends only the
 * lines that are still to do.
 */
@Component({
  selector: 'app-log-measurements',
  imports: [Control, DateField, EntryActions, Field, SegmentedControl],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="muted" i18n>Fill in what you measured. Leave the rest empty.</p>
      <app-segmented-control
        [label]="unitLabel"
        [options]="units"
        [selected]="girth()"
        (selectedChange)="girth.set($any($event))"
      />
      <app-date-field
        [label]="dayLabel"
        [errors]="shows('day', dayIssues()) ? dayIssues() : null"
        [(value)]="day"
        [max]="today()"
        [today]="today()"
        [firstDay]="firstDay()"
        (touched)="attempt.touch('day')"
      />
      @for (type of lines; track type) {
        <app-field
          [label]="lineLabel(type)"
          [help]="state()[type] === 'saved' ? savedHelp : null"
          [errors]="lineIssues(type)"
        >
          <input
            appControl
            [name]="type"
            type="number"
            inputmode="decimal"
            step="any"
            min="0"
            [value]="values()[type] ?? ''"
            [disabled]="state()[type] === 'saved'"
            (input)="setValue(type, numberOrNull($any($event.target).valueAsNumber))"
            (blur)="attempt.touch(type)"
          />
        </app-field>
      }
      @if (attempt.wasTried() && nothingYet()) {
        <p class="problem-text" role="alert" i18n>Enter at least one measurement.</p>
      } @else if (attempt.wasTried() && problems() > 0) {
        <p class="problem-text" role="alert" i18n>Check the fields marked above.</p>
      }
      @if (error(); as message) {
        <p class="problem-text refusal" role="alert">{{ message }}</p>
      }
      <app-entry-actions
        [saveLabel]="saveLabel"
        [busyLabel]="savingLabel"
        [busy]="busy()"
        (notNow)="closed.emit(saved())"
      />
    </form>
  `,
  styles: SHEET_STYLES,
})
export class LogMeasurements extends EntrySheet {
  /** The tape the page shows: centimetres or inches. */
  readonly startUnit = input<GirthUnit>('Centimetre');
  /** How many measurements were saved, when the sheet closes (0 when none). */
  readonly closed = output<number>();
  /** Some lines were saved while the sheet stays open: the page reads its list again. */
  readonly changed = output<void>();

  protected readonly unitLabel = $localize`Tape shows`;
  protected readonly dayLabel = $localize`Day you measured`;
  protected readonly savedHelp = $localize`Saved`;
  protected readonly saveLabel = $localize`Save measurements`;
  protected readonly savingLabel = $localize`Saving…`;
  protected readonly units = GIRTH_UNITS;
  protected readonly lines = MEASURED;
  protected readonly numberOrNull = numberOrNull;

  protected readonly girth = linkedSignal<GirthUnit>(() => this.startUnit());
  protected readonly day = linkedSignal(() => this.today());
  protected readonly values = signal<Lines<number | null>>(emptyLines(null));
  protected readonly state = signal<Lines<LineState>>(emptyLines<LineState>('idle'));
  protected readonly lineErrors = signal<Lines<string | null>>(emptyLines<string | null>(null));
  protected readonly saved = signal(0);

  protected readonly dayIssues = computed(() => dayErrors(this.day(), this.today(), 'measured'));
  protected readonly filled = computed(() =>
    MEASURED.filter((type) => this.values()[type] !== null && this.state()[type] !== 'saved'),
  );
  protected readonly nothingYet = computed(() => this.filled().length === 0 && this.saved() === 0);
  protected readonly problems = computed(
    () =>
      this.dayIssues().length +
      MEASURED.filter((type) => this.issues(type).length > 0).length +
      (this.nothingYet() ? 1 : 0),
  );

  constructor() {
    super();
    effect(() => this.dirtyChange.emit(this.filled().length > 0));
  }

  protected lineLabel(type: MeasurementType): string {
    return `${measurementName(type)} (${lengthWord(measurementUnit(type, this.girth()))})`;
  }

  private issues(type: MeasurementType): string[] {
    return measurementErrors(type, this.values()[type], this.girth());
  }

  /** A line's message: the server's reason for a refused one, else a number that cannot be right. */
  protected lineIssues(type: MeasurementType): readonly string[] | null {
    const refused = this.lineErrors()[type];
    if (refused !== null && this.state()[type] === 'failed') return [refused];
    const issues = this.issues(type);
    return this.shows(type, issues) ? issues : null;
  }

  protected setValue(type: MeasurementType, value: number | null): void {
    this.values.update((current) => ({ ...current, [type]: value }));
    if (this.state()[type] === 'failed') this.mark(type, 'idle', null);
  }

  private mark(type: MeasurementType, state: LineState, message: string | null): void {
    this.state.update((current) => ({ ...current, [type]: state }));
    this.lineErrors.update((current) => ({ ...current, [type]: message }));
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problems() > 0) {
      this.refuse();
      return;
    }
    const day = this.day();
    const dayText = dayWords(day, this.today(), this.audience().locale);
    const girth = this.girth();
    const lines = this.filled();
    await this.scope.run('send', async (owner) => {
      this.busy.set(true);
      this.error.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        let failed = 0;
        let savedNow = 0;
        for (const type of lines) {
          try {
            await owner.wait(
              firstValueFrom(
                this.entries.recordMeasurement(this.clientId(), {
                  measurementType: type,
                  value: this.values()[type]!,
                  unit: measurementUnit(type, girth),
                  // Today is left to the server, which knows the coaching space's own day.
                  measurementDate: day === this.today() ? null : day,
                }),
              ),
            );
            this.mark(type, 'saved', null);
            savedNow++;
          } catch (error) {
            if (!owner.current) return;
            failed++;
            this.mark(
              type,
              'failed',
              entryRefusal(error, $localize`This one could not be saved. Try again.`, {
                day: dayText,
                what: measurementName(type),
              }),
            );
            if (isStale(error)) this.stale.emit();
          }
        }
        if (savedNow > 0) {
          this.saved.update((count) => count + savedNow);
          this.changed.emit();
        }
        if (failed === 0) {
          this.closed.emit(this.saved());
        } else {
          this.error.set(
            savedNow > 0
              ? $localize`Some measurements were saved. The ones marked above were not.`
              : $localize`Nothing was saved. The reasons are marked above.`,
          );
          this.reveal();
        }
      } catch {
        if (!owner.current) return;
        this.error.set($localize`The measurements could not be saved. Try again.`);
        this.reveal();
      } finally {
        if (owner.current) this.busy.set(false);
      }
    });
  }
}

/** Correct a measurement that was typed or taken wrong: the new number and what was wrong. */
@Component({
  selector: 'app-correct-measurement',
  imports: [Control, EntryActions, Field, ReasonPicker, SegmentedControl],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="about">
        <strong>{{ row().name }}: {{ row().value }}</strong
        >&ngsp;
        <span class="muted">{{ dayLine() }}</span>
      </p>
      <app-field
        [label]="valueLabel"
        [errors]="shows('value', valueIssues()) ? valueIssues() : null"
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
          @if (isBodyFat()) {
            <span class="muted" aria-hidden="true">%</span>
          } @else {
            <app-segmented-control
              [label]="unitLabel"
              [hideLabel]="true"
              [options]="units"
              [selected]="girth()"
              (selectedChange)="girth.set($any($event))"
            />
          }
        </div>
      </app-field>
      <app-reason-picker
        [label]="reasonLabel"
        [picks]="picks()"
        [errors]="shows('reason', reasonIssues()) ? reasonIssues() : null"
        [(pick)]="pick"
        [(typed)]="typed"
        (touched)="attempt.touch('reason')"
      />
      <p class="muted" i18n>The earlier number stays in this entry’s history.</p>
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
  `,
  styles: SHEET_STYLES,
})
export class CorrectMeasurement extends EntrySheet {
  readonly row = input.required<MeasurementRow>();
  readonly closed = output<BodyMeasurementHistory | null>();

  protected readonly valueLabel = $localize`Correct measurement`;
  protected readonly unitLabel = $localize`Unit`;
  protected readonly reasonLabel = $localize`What was wrong?`;
  protected readonly saveLabel = $localize`Save correction`;
  protected readonly savingLabel = $localize`Saving…`;
  protected readonly units = GIRTH_UNITS;
  protected readonly numberOrNull = numberOrNull;

  protected readonly value = linkedSignal<number | null>(() => this.row().measurement.enteredValue);
  protected readonly girth = linkedSignal<GirthUnit>(() =>
    this.row().measurement.enteredUnit === 'Inch' ? 'Inch' : 'Centimetre',
  );
  protected readonly pick = signal<ReasonPick | null>(null);
  protected readonly typed = signal('');

  protected readonly isBodyFat = computed(() => this.row().type === 'BodyFatPercentage');
  protected readonly picks = computed(() => reasonPicks('measurement', this.audience()));
  protected readonly valueIssues = computed(() => {
    const value = this.value();
    if (value === null) return [$localize`Enter a measurement.`];
    const issues = measurementErrors(this.row().type, value, this.girth());
    if (issues.length > 0) return issues;
    const was = this.row().measurement;
    return value === was.enteredValue && this.unit() === was.enteredUnit
      ? [$localize`That is the number already saved. Change it, or close this.`]
      : [];
  });
  protected readonly reasonIssues = computed(() => reasonErrors(this.pick(), this.typed()));
  protected readonly problems = computed(
    () => this.valueIssues().length + this.reasonIssues().length,
  );
  protected readonly dayLine = computed(
    () =>
      `${dayWords(this.row().measurement.measurementDate, this.today(), this.audience().locale)} · ${this.row().addedBy}`,
  );

  constructor() {
    super();
    effect(() => {
      const was = this.row().measurement;
      this.dirtyChange.emit(
        this.value() !== was.enteredValue ||
          this.unit() !== was.enteredUnit ||
          this.pick() !== null,
      );
    });
  }

  private unit() {
    return measurementUnit(this.row().type, this.girth());
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problems() > 0) {
      this.refuse();
      return;
    }
    const measurement = this.row().measurement;
    const request = {
      value: this.value()!,
      unit: this.unit(),
      reason: reasonValue(this.pick(), this.typed()),
      version: measurement.version,
    };
    let history: BodyMeasurementHistory | null = null;
    const ok = await this.send(
      async (owner) => {
        history = await owner.wait(
          firstValueFrom(this.entries.correctMeasurement(this.clientId(), measurement.id, request)),
        );
      },
      $localize`The correction could not be saved. Try again.`,
    );
    if (ok) this.closed.emit(history);
  }
}

/** What changed in one measurement: the number it was before each correction, why, and when. Read only. */
@Component({
  selector: 'app-measurement-changes',
  imports: [Button, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="body">
      <p class="about">
        <strong>{{ row().name }}: {{ row().value }}</strong
        >&ngsp;
        <span class="muted">{{ dayLine() }}</span>
      </p>
      @switch (state()) {
        @case ('loading') {
          <div aria-busy="true"><app-skeleton [label]="loadingLabel" [lines]="3" /></div>
        }
        @case ('error') {
          <p class="problem-text" role="alert" i18n>The changes could not be loaded.</p>
          <button appButton type="button" variant="outlined" (click)="load()" i18n>
            Try again
          </button>
        }
        @default {
          @if (history(); as read) {
            @if (read.previousValues.length === 0) {
              <p class="muted" i18n>
                This is the number that was first entered. It has not been corrected.
              </p>
            } @else {
              <ol class="changes">
                @for (item of read.previousValues; track item.id) {
                  <li>
                    <strong>{{ was(item.enteredValue) }} {{ unitOf(item.enteredUnit) }}</strong>
                    <span>{{ item.reason }}</span>
                    <small class="muted">{{ replaced(item.supersededAtUtc) }}</small>
                  </li>
                }
              </ol>
            }
          }
        }
      }
      <div class="foot">
        <button appButton type="button" variant="outlined" (click)="closed.emit()" i18n>
          Close
        </button>
      </div>
    </div>
  `,
  styles: [
    SHEET_STYLES,
    `
      .changes {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .changes li {
        border-block-start: 1px solid var(--tb-line);
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        padding-block-start: 0.75rem;
      }

      .changes strong {
        font-variant-numeric: tabular-nums;
      }

      .foot {
        display: flex;
        justify-content: flex-end;
      }
    `,
  ],
})
export class MeasurementChanges extends EntrySheet implements OnInit {
  readonly row = input.required<MeasurementRow>();
  readonly closed = output<void>();

  protected readonly loadingLabel = $localize`Loading the changes…`;
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly history = signal<BodyMeasurementHistory | null>(null);
  protected readonly dayLine = computed(
    () =>
      `${dayWords(this.row().measurement.measurementDate, this.today(), this.audience().locale)} · ${this.row().addedBy}`,
  );

  /** Read once the inputs are set: the entry to read is one of them. */
  ngOnInit(): void {
    void this.load();
  }

  protected load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.state.set('loading');
      try {
        this.history.set(
          await owner.wait(
            firstValueFrom(this.entries.measurementHistory(this.clientId(), this.row().id)),
          ),
        );
        this.state.set('ready');
      } catch {
        if (!owner.current) return;
        this.state.set('error');
      }
    });
  }

  protected was(value: number): string {
    return quantity(value, this.audience().locale);
  }

  protected unitOf(unit: Parameters<typeof lengthWord>[0]): string {
    return lengthWord(unit);
  }

  protected replaced(at: string): string {
    const when = formatDate(at, 'EEE d MMM, HH:mm', this.audience().locale);
    return $localize`Replaced ${when}:when:`;
  }
}
