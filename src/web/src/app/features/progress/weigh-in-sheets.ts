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
import type { MassUnit } from '../../core/units/body-units';
import { Button } from '../../ui/button';
import { DateField } from '../../ui/date-field';
import { Control, Field } from '../../ui/field';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { Skeleton } from '../../ui/skeleton';
import { EntryActions, EntrySheet, ReasonPicker, SHEET_STYLES } from './entry-sheet';
import {
  dayErrors,
  dayWords,
  massWord,
  moveErrors,
  numberOrNull,
  quantity,
  reasonErrors,
  reasonPicks,
  reasonValue,
  weighInChanges,
  weightErrors,
  type ReasonPick,
  type WeighInRow,
} from './progress-entries.models';
import type {
  BodyweightDateCorrection,
  BodyweightHistory,
  BodyweightObservation,
} from './progress.models';

const MASS_UNITS: readonly SegmentOption[] = [
  { value: 'Kilogram' satisfies MassUnit, label: 'kg' },
  { value: 'Pound' satisfies MassUnit, label: 'lb' },
];

/**
 * Log a weight, in a sheet (R5.3c): the number in the unit the person weighs in, and the day, which
 * is today unless they say otherwise. A day that already has a weight says so before anything is sent
 * and offers to correct that one instead, because the server keeps one weigh-in a day.
 */
@Component({
  selector: 'app-log-weight',
  imports: [Control, DateField, EntryActions, Field, SegmentedControl],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="muted">{{ lede() }}</p>
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
      @if (taken(); as logged) {
        <p class="about" role="status" data-already>
          <strong>{{ loggedNote(logged) }}</strong
          >&ngsp;
          <span class="muted" i18n>Correct that one rather than adding a second.</span>
        </p>
      }
      @if (attempt.wasTried() && problems() > 0) {
        <p class="problem-text" role="alert" i18n>Check the fields marked above.</p>
      }
      @if (error(); as message) {
        <p class="problem-text refusal" role="alert">{{ message }}</p>
      }
      <app-entry-actions
        [saveLabel]="taken() ? correctLabel : saveLabel"
        [busyLabel]="savingLabel"
        [busy]="busy()"
        (notNow)="closed.emit(null)"
      />
    </form>
  `,
  styles: SHEET_STYLES,
})
export class LogWeight extends EntrySheet {
  /** The unit the person weighs in: their saved one, or kilograms for a coach. */
  readonly startUnit = input<MassUnit>('Kilogram');
  /** The weights already logged in the window the page has read, by day. */
  readonly existing = input<ReadonlyMap<string, BodyweightObservation>>(new Map());
  /** The weight that was saved, or null when the sheet was closed without one. */
  readonly closed = output<BodyweightObservation | null>();
  /** A day that already has a weight: the person chose to correct it. */
  readonly correct = output<BodyweightObservation>();

  protected readonly weightLabel = $localize`Weight`;
  protected readonly unitLabel = $localize`Unit`;
  protected readonly dayLabel = $localize`Day you weighed`;
  protected readonly saveLabel = $localize`Save weight`;
  protected readonly correctLabel = $localize`Correct that weight`;
  protected readonly savingLabel = $localize`Saving…`;
  protected readonly units = MASS_UNITS;
  protected readonly numberOrNull = numberOrNull;

  protected readonly value = signal<number | null>(null);
  protected readonly unit = linkedSignal<MassUnit>(() => this.startUnit());
  protected readonly day = linkedSignal(() => this.today());

  protected readonly weightIssues = computed(() => weightErrors(this.value(), this.unit()));
  protected readonly dayIssues = computed(() => dayErrors(this.day(), this.today(), 'weighed'));
  protected readonly taken = computed(() => this.existing().get(this.day()) ?? null);
  protected readonly problems = computed(
    () => this.weightIssues().length + this.dayIssues().length,
  );
  protected readonly lede = computed(() => {
    const audience = this.audience();
    if (!audience.coach) {
      return $localize`The same time of day, such as the morning, makes weights easier to compare.`;
    }
    return audience.firstName
      ? $localize`Recorded as a coach’s entry for ${audience.firstName}:name:.`
      : $localize`Recorded as a coach’s entry.`;
  });

  constructor() {
    super();
    effect(() => this.dirtyChange.emit(this.value() !== null));
  }

  protected loggedNote(logged: BodyweightObservation): string {
    const value = quantity(logged.enteredValue, this.audience().locale);
    const day = dayWords(logged.measurementDate, this.today(), this.audience().locale);
    return $localize`${value}:value: ${massWord(logged.enteredUnit)}:unit: is already logged for ${day}:day:.`;
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    const logged = this.taken();
    if (logged) {
      this.correct.emit(logged);
      return;
    }
    if (this.problems() > 0) {
      this.refuse();
      return;
    }
    const value = this.value()!;
    const unit = this.unit();
    const day = this.day();
    let saved: BodyweightObservation | null = null;
    const ok = await this.send(
      async (owner) => {
        saved = await owner.wait(
          firstValueFrom(
            this.entries.recordWeight(this.clientId(), {
              value,
              unit,
              // Today is left to the server, which knows the coaching space's own day.
              measurementDate: day === this.today() ? null : day,
            }),
          ),
        );
      },
      $localize`The weight could not be saved. Try again.`,
      { day: dayWords(day, this.today(), this.audience().locale) },
    );
    if (ok) this.closed.emit(saved);
  }
}

/** Correct a weight that was typed wrong: the new number, and what was wrong. The old one stays in its history. */
@Component({
  selector: 'app-correct-weight',
  imports: [Control, EntryActions, Field, ReasonPicker, SegmentedControl],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="about">
        <strong>{{ row().value }}</strong
        >&ngsp;
        <span class="muted">{{ dayLine() }}</span>
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
export class CorrectWeight extends EntrySheet {
  readonly row = input.required<WeighInRow>();
  /** The entry after the correction, with what it was before; null when the sheet was closed without one. */
  readonly closed = output<BodyweightHistory | null>();

  protected readonly weightLabel = $localize`Correct weight`;
  protected readonly unitLabel = $localize`Unit`;
  protected readonly reasonLabel = $localize`What was wrong?`;
  protected readonly saveLabel = $localize`Save correction`;
  protected readonly savingLabel = $localize`Saving…`;
  protected readonly units = MASS_UNITS;
  protected readonly numberOrNull = numberOrNull;

  protected readonly value = linkedSignal<number | null>(() => this.row().observation.enteredValue);
  protected readonly unit = linkedSignal<MassUnit>(() => this.row().observation.enteredUnit);
  protected readonly pick = signal<ReasonPick | null>(null);
  protected readonly typed = signal('');

  protected readonly picks = computed(() => reasonPicks('weight', this.audience()));
  protected readonly weightIssues = computed(() => {
    const issues = weightErrors(this.value(), this.unit());
    if (issues.length > 0) return issues;
    const was = this.row().observation;
    return this.value() === was.enteredValue && this.unit() === was.enteredUnit
      ? [$localize`That is the number already saved. Change it, or close this.`]
      : [];
  });
  protected readonly reasonIssues = computed(() => reasonErrors(this.pick(), this.typed()));
  protected readonly problems = computed(
    () => this.weightIssues().length + this.reasonIssues().length,
  );
  protected readonly dayLine = computed(
    () =>
      `${dayWords(this.row().date, this.today(), this.audience().locale)} · ${this.row().addedBy}`,
  );

  constructor() {
    super();
    effect(() => {
      const was = this.row().observation;
      this.dirtyChange.emit(
        this.value() !== was.enteredValue ||
          this.unit() !== was.enteredUnit ||
          this.pick() !== null,
      );
    });
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problems() > 0) {
      this.refuse();
      return;
    }
    const observation = this.row().observation;
    const request = {
      value: this.value()!,
      unit: this.unit(),
      reason: reasonValue(this.pick(), this.typed()),
      version: observation.version,
    };
    let history: BodyweightHistory | null = null;
    const ok = await this.send(
      async (owner) => {
        history = await owner.wait(
          firstValueFrom(this.entries.correctWeight(this.clientId(), observation.id, request)),
        );
      },
      $localize`The correction could not be saved. Try again.`,
    );
    if (ok) this.closed.emit(history);
  }
}

/**
 * "Wrong day": the same weight moves to the day it was taken. The server keeps the old entry as a voided
 * record rather than changing its date, so the history stays honest; that is said here in a sentence.
 */
@Component({
  selector: 'app-move-weigh-in',
  imports: [DateField, EntryActions, ReasonPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="about">
        <strong>{{ row().value }}</strong
        >&ngsp;
        <span class="muted">{{ dayLine() }}</span>
      </p>
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
      <p class="muted" i18n>
        The same weight moves to that day. The entry it leaves is kept, marked as replaced, and is
        not deleted.
      </p>
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
export class MoveWeighIn extends EntrySheet {
  readonly row = input.required<WeighInRow>();
  /** The days that already have a weight, so the new day can be checked before it is sent. */
  readonly taken = input<ReadonlySet<string>>(new Set());
  readonly closed = output<BodyweightDateCorrection | null>();

  protected readonly dayLabel = $localize`Day it was really weighed`;
  protected readonly reasonLabel = $localize`What was wrong?`;
  protected readonly saveLabel = $localize`Move to that day`;
  protected readonly savingLabel = $localize`Moving…`;

  protected readonly day = linkedSignal(() => this.row().date);
  protected readonly pick = signal<ReasonPick | null>(null);
  protected readonly typed = signal('');

  protected readonly picks = computed(() => reasonPicks('date', this.audience()));
  protected readonly dayIssues = computed(() =>
    moveErrors(this.day(), this.row().date, this.today(), this.taken()),
  );
  protected readonly reasonIssues = computed(() => reasonErrors(this.pick(), this.typed()));
  protected readonly problems = computed(
    () => this.dayIssues().length + this.reasonIssues().length,
  );
  protected readonly dayLine = computed(
    () =>
      `${dayWords(this.row().date, this.today(), this.audience().locale)} · ${this.row().addedBy}`,
  );

  constructor() {
    super();
    effect(() => this.dirtyChange.emit(this.day() !== this.row().date || this.pick() !== null));
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problems() > 0) {
      this.refuse();
      return;
    }
    const observation = this.row().observation;
    const day = this.day();
    const request = {
      measurementDate: day,
      reason: reasonValue(this.pick(), this.typed()),
      version: observation.version,
    };
    let moved: BodyweightDateCorrection | null = null;
    const ok = await this.send(
      async (owner) => {
        moved = await owner.wait(
          firstValueFrom(this.entries.moveWeight(this.clientId(), observation.id, request)),
        );
      },
      $localize`The weight could not be moved. Try again.`,
      { day: dayWords(day, this.today(), this.audience().locale) },
    );
    if (ok) this.closed.emit(moved);
  }
}

/** What changed in one weigh-in: the number it was before each correction, why, and when. Read only. */
@Component({
  selector: 'app-weigh-in-changes',
  imports: [Button, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="body">
      <p class="about">
        <strong>{{ row().value }}</strong
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
            @if (read.void; as voided) {
              <p class="muted">{{ voidedLine(voided.reason, voided.voidedAtUtc) }}</p>
            }
            @let changes = changesOf(read);
            @if (changes.length === 0) {
              <p class="muted" i18n>
                This is the number that was first entered. It has not been corrected.
              </p>
            } @else {
              <ol class="changes">
                @for (item of changes; track item.kind + item.id) {
                  <li [attr.data-change]="item.kind">
                    @if (item.kind === 'move') {
                      <strong>{{ movedFrom(item.fromDate) }}</strong>
                      <span>{{ item.reason }}</span>
                      <small class="muted">{{ moved(item.at) }}</small>
                    } @else {
                      <strong>{{ was(item.value) }} {{ unitOf(item.unit) }}</strong>
                      <span>{{ item.reason }}</span>
                      <small class="muted">{{ replaced(item.at) }}</small>
                    }
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
export class WeighInChanges extends EntrySheet implements OnInit {
  readonly row = input.required<WeighInRow>();
  readonly closed = output<void>();

  protected readonly loadingLabel = $localize`Loading the changes…`;
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly history = signal<BodyweightHistory | null>(null);
  protected readonly dayLine = computed(
    () =>
      `${dayWords(this.row().date, this.today(), this.audience().locale)} · ${this.row().addedBy}`,
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
            firstValueFrom(this.entries.weightHistory(this.clientId(), this.row().id)),
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

  protected unitOf(unit: MassUnit): string {
    return massWord(unit);
  }

  protected replaced(at: string): string {
    const when = formatDate(at, 'EEE d MMM, HH:mm', this.audience().locale);
    return $localize`Replaced ${when}:when:`;
  }

  protected readonly changesOf = weighInChanges;

  /** "Moved from Mon 19 Oct": the day it was first logged on, before it was moved to this one. */
  protected movedFrom(date: string): string {
    return $localize`Moved from ${dayWords(date, this.today(), this.audience().locale)}:day:`;
  }

  protected moved(at: string): string {
    const when = formatDate(at, 'EEE d MMM, HH:mm', this.audience().locale);
    return $localize`Moved ${when}:when:`;
  }

  protected voidedLine(reason: string, at: string): string {
    const when = formatDate(at, 'EEE d MMM', this.audience().locale);
    return $localize`This entry was replaced on ${when}:when:: ${reason}:reason:`;
  }
}
