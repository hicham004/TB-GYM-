import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { isIsoDate } from './calendar';

let nextId = 0;

/** What the three boxes hold: nothing, part of a date, a date that does not exist, or a real day. */
export type DateInputStatus = 'empty' | 'incomplete' | 'invalid' | 'valid';

function splitIso(value: string): { day: string; month: string; year: string } {
  if (!isIsoDate(value)) return { day: '', month: '', year: '' };
  const [year, month, day] = value.split('-');
  return { day: String(Number(day)), month: String(Number(month)), year: String(Number(year)) };
}

function digits(value: string, max: number): string {
  return value.replace(/\D/g, '').slice(0, max);
}

/**
 * Form/Date input (R5.3a, plan §4): a day typed as three boxes (day, month, year), for the dates a person
 * knows by heart such as a birth date, where scrolling a calendar back thirty years is slower than
 * typing and GOV.UK's guidance prefers three boxes to a picker. `app-date-field` is the other choice, for
 * a day picked near today.
 *
 * `value` is a calendar day, `YYYY-MM-DD`, or `''` while the boxes hold no real date; `status` says
 * which of those it is, so a page can ask for a missing part without guessing from an empty value.
 * The page labels the group and shows its own messages through `errors`, as `app-field` does.
 */
@Component({
  selector: 'app-date-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tb-field' },
  template: `
    <fieldset [attr.aria-describedby]="describedBy()">
      <legend class="tb-field__label">{{ label() }}</legend>
      @if (help()) {
        <p class="tb-field__support" [id]="helpId">{{ help() }}</p>
      }
      <div class="parts">
        <label class="part">
          <span>{{ dayLabel }}</span>
          <input
            class="tb-control day"
            inputmode="numeric"
            maxlength="2"
            [attr.autocomplete]="autocompleteFor('day')"
            [attr.aria-invalid]="showsError() ? 'true' : null"
            [attr.aria-describedby]="describedBy()"
            [disabled]="disabled()"
            [value]="day()"
            (input)="setDay($any($event.target).value)"
            (blur)="touched.emit()"
          />
        </label>
        <label class="part">
          <span>{{ monthLabel }}</span>
          <input
            class="tb-control month"
            inputmode="numeric"
            maxlength="2"
            [attr.autocomplete]="autocompleteFor('month')"
            [attr.aria-invalid]="showsError() ? 'true' : null"
            [attr.aria-describedby]="describedBy()"
            [disabled]="disabled()"
            [value]="month()"
            (input)="setMonth($any($event.target).value)"
            (blur)="touched.emit()"
          />
        </label>
        <label class="part">
          <span>{{ yearLabel }}</span>
          <input
            class="tb-control year"
            inputmode="numeric"
            maxlength="4"
            [attr.autocomplete]="autocompleteFor('year')"
            [attr.aria-invalid]="showsError() ? 'true' : null"
            [attr.aria-describedby]="describedBy()"
            [disabled]="disabled()"
            [value]="year()"
            (input)="setYear($any($event.target).value)"
            (blur)="touched.emit()"
          />
        </label>
      </div>
      @if (showsError()) {
        <p class="tb-field__support tb-field__support--error" [id]="errorId">
          @for (message of errors() ?? []; track $index) {
            <span class="tb-field__message">{{ message }}</span>
          }
        </p>
      }
    </fieldset>
  `,
  styles: `
    :host {
      display: block;
    }

    fieldset {
      border: 0;
      display: grid;
      gap: var(--space-8);
      margin: 0;
      min-inline-size: 0;
      padding: 0;
    }

    legend {
      padding: 0;
    }

    p {
      margin: 0;
    }

    .parts {
      align-items: end;
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-12);
    }

    .part {
      display: grid;
      gap: var(--space-4);
    }

    .part span {
      color: var(--tb-muted);
      font-size: var(--text-metadata-size);
      font-weight: 600;
    }

    .day,
    .month {
      inline-size: 4.25rem;
    }

    .year {
      inline-size: 6rem;
    }

    input {
      font-variant-numeric: tabular-nums;
      text-align: center;
    }
  `,
})
export class DateInput {
  private readonly id = `tb-date-input-${++nextId}`;
  protected readonly helpId = `${this.id}-help`;
  protected readonly errorId = `${this.id}-error`;

  readonly label = input.required<string>();
  /** An example the boxes can be read against, such as "For example, 27 3 1988". */
  readonly help = input<string | null>(null);
  readonly errors = input<readonly string[] | null>(null);
  readonly disabled = input(false, { transform: booleanAttribute });
  /** `bday` lets the browser fill a birth date from its saved profile; leave it out for any other date. */
  readonly autocompleteName = input<'bday' | null>(null);
  /** The chosen day, `YYYY-MM-DD`, or `''` while the boxes hold no real date. */
  readonly value = model<string>('');
  readonly status = output<DateInputStatus>();
  /** A box was left: the moment a page may show its messages. */
  readonly touched = output<void>();

  protected readonly dayLabel = $localize`Day`;
  protected readonly monthLabel = $localize`Month`;
  protected readonly yearLabel = $localize`Year`;

  protected readonly day = signal(splitIso(this.value()).day);
  protected readonly month = signal(splitIso(this.value()).month);
  protected readonly year = signal(splitIso(this.value()).year);
  private lastValue = this.value();

  protected autocompleteFor(part: 'day' | 'month' | 'year'): string {
    const name = this.autocompleteName();
    return name ? `${name}-${part}` : 'off';
  }

  protected readonly showsError = computed(() => (this.errors()?.length ?? 0) > 0);
  protected readonly describedBy = computed(() => {
    const ids = [this.help() ? this.helpId : null, this.showsError() ? this.errorId : null];
    return ids.filter((id) => id !== null).join(' ') || null;
  });

  constructor() {
    // A value set from outside (a form reset, a prefilled invitation) fills the boxes; one this
    // component just wrote must not, or typing a part would erase the other parts.
    effect(() => {
      const outside = this.value();
      untracked(() => {
        if (outside === this.lastValue) return;
        this.lastValue = outside;
        const parts = splitIso(outside);
        this.day.set(parts.day);
        this.month.set(parts.month);
        this.year.set(parts.year);
        this.status.emit(outside === '' ? 'empty' : 'valid');
      });
    });
  }

  protected setDay(text: string): void {
    this.day.set(digits(text, 2));
    this.publish();
  }

  protected setMonth(text: string): void {
    this.month.set(digits(text, 2));
    this.publish();
  }

  protected setYear(text: string): void {
    this.year.set(digits(text, 4));
    this.publish();
  }

  private publish(): void {
    const day = this.day();
    const month = this.month();
    const year = this.year();
    const filled = [day, month, year].filter((part) => part !== '').length;
    let status: DateInputStatus = 'empty';
    let value = '';
    if (filled > 0 && (filled < 3 || year.length < 4)) {
      status = 'incomplete';
    } else if (filled === 3) {
      const iso = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      if (isIsoDate(iso)) {
        status = 'valid';
        value = iso;
      } else {
        status = 'invalid';
      }
    }
    this.lastValue = value;
    this.value.set(value);
    this.status.emit(status);
  }
}
