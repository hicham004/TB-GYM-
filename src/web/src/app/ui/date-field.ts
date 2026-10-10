import {
  afterNextRender,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  LOCALE_ID,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  addDays,
  addMonths,
  addYears,
  clampIso,
  deviceToday,
  endOfWeek,
  isIsoDate,
  localeFirstDay,
  monthStart,
  monthWeeks,
  startOfWeek,
  toDate,
  type IsoDate,
} from './calendar';
import { Icon } from './icon';

let nextId = 0;

interface DayCell {
  readonly iso: IsoDate;
  readonly number: number;
  readonly outside: boolean;
  readonly selected: boolean;
  readonly today: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly tabindex: 0 | -1;
}

/**
 * Form/Date field (plan §4: a date is never a raw `<input type="date">`). A field whose button says
 * the chosen day in words and opens a month calendar under it. The calendar sits in the flow of the
 * page instead of floating, so it can never be clipped by a sheet or run off a phone.
 *
 * The value is a calendar day, `YYYY-MM-DD`, or `''` for none; nothing here knows a time zone. Pass
 * `today` when a screen's days are not the device's (the platform admin's are UTC days). `min` and
 * `max` grey out days that cannot be chosen; the page still validates, because a field can be
 * given a value from outside.
 *
 * Keyboard, as in the W3C date picker pattern: the arrow keys move by a day or a week, Home and End
 * to the week's ends, Page Up and Page Down by a month (with Shift, a year), Enter or Space chooses,
 * Escape closes and puts focus back on the button. The page labels it like any field and shows its
 * own messages through `errors`, as `app-field` does.
 */
@Component({
  selector: 'app-date-field',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'tb-field',
    '(keydown.escape)': 'closeFromKeyboard($event)',
    '(focusout)': 'closeOnFocusOut($event)',
  },
  template: `
    <label class="tb-field__label" [id]="labelId" [attr.for]="triggerId">{{ label() }}</label>
    <button
      #trigger
      type="button"
      class="tb-control trigger"
      [id]="triggerId"
      [disabled]="disabled()"
      [attr.aria-labelledby]="labelId + ' ' + valueId"
      [attr.aria-describedby]="describedBy()"
      [attr.aria-invalid]="showsError() ? 'true' : null"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="open() ? panelId : null"
      (click)="toggle()"
    >
      <span class="value" [id]="valueId" [class.empty]="!hasValue()">{{ valueText() }}</span>
      <app-icon name="calendar" />
    </button>
    @if (showsError()) {
      <p class="tb-field__support tb-field__support--error" [id]="errorId">
        @for (message of errors() ?? []; track $index) {
          <span class="tb-field__message">{{ message }}</span>
        }
      </p>
    } @else if (help()) {
      <p class="tb-field__support" [id]="helpId">{{ help() }}</p>
    }
    @if (open()) {
      <div class="panel" role="group" tabindex="-1" [id]="panelId" [attr.aria-label]="panelLabel()">
        <div class="head">
          <button
            type="button"
            class="nav"
            [attr.aria-label]="previousMonthLabel"
            (click)="showMonth(-1)"
          >
            <app-icon name="chevron-left" />
          </button>
          <p class="month" [id]="monthId" aria-live="polite">{{ monthTitle() }}</p>
          <button
            type="button"
            class="nav"
            [attr.aria-label]="nextMonthLabel"
            (click)="showMonth(1)"
          >
            <app-icon name="chevron-right" />
          </button>
        </div>
        <table role="grid" [attr.aria-labelledby]="monthId">
          <thead>
            <tr>
              @for (day of weekdays(); track day.long) {
                <th scope="col" [attr.abbr]="day.long">{{ day.short }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (week of weeks(); track $index) {
              <tr>
                @for (day of week; track day.iso) {
                  <td [attr.aria-selected]="day.selected ? 'true' : null">
                    <button
                      type="button"
                      class="day"
                      [class.outside]="day.outside"
                      [class.today]="day.today"
                      [class.selected]="day.selected"
                      [attr.aria-disabled]="day.disabled ? 'true' : null"
                      [attr.aria-current]="day.today ? 'date' : null"
                      [attr.aria-label]="day.label"
                      [attr.data-date]="day.iso"
                      [attr.tabindex]="day.tabindex"
                      (click)="pick(day)"
                      (keydown)="moveWithKeys($event)"
                    >
                      {{ day.number }}
                    </button>
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
        <div class="foot">
          <button type="button" class="link" [disabled]="!todayAllowed()" (click)="pickToday()">
            {{ todayLabel }}
          </button>
          @if (clearable() && hasValue()) {
            <button type="button" class="link" (click)="clear()">{{ clearLabel }}</button>
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: grid;
    }

    .trigger {
      align-items: center;
      cursor: pointer;
      display: flex;
      gap: var(--space-8);
      justify-content: space-between;
      text-align: start;
    }

    .trigger:disabled {
      cursor: not-allowed;
    }

    .value {
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }

    .value.empty {
      color: var(--tb-muted);
    }

    .panel {
      background: var(--tb-surface);
      border: 1px solid var(--tb-line);
      border-radius: var(--tb-radius-card-small);
      box-shadow: var(--tb-shadow-card);
      box-sizing: border-box;
      display: grid;
      gap: var(--space-8);
      inline-size: 100%;
      max-inline-size: 22rem;
      outline: none;
      padding: var(--space-12);
    }

    .head {
      align-items: center;
      display: flex;
      gap: var(--space-8);
      justify-content: space-between;
    }

    .month {
      color: var(--tb-ink);
      font-size: 1rem;
      font-weight: 600;
      margin: 0;
      text-align: center;
    }

    .nav {
      align-items: center;
      background: none;
      border: 1px solid var(--tb-line-strong);
      border-radius: 999px;
      color: var(--tb-ink);
      cursor: pointer;
      display: inline-flex;
      flex: none;
      block-size: 2.5rem;
      inline-size: 2.5rem;
      justify-content: center;
      padding: 0;
      touch-action: manipulation;
    }

    .nav:hover {
      background: var(--tb-surface-2);
    }

    .nav:focus-visible,
    .day:focus-visible,
    .link:focus-visible {
      outline: 3px solid var(--tb-focus);
      outline-offset: 2px;
    }

    :host-context([dir='rtl']) .nav app-icon {
      transform: scaleX(-1);
    }

    table {
      border-collapse: separate;
      border-spacing: 0 2px;
      inline-size: 100%;
      table-layout: fixed;
    }

    th {
      color: var(--tb-muted);
      font-size: 0.75rem;
      font-weight: 600;
      overflow: hidden;
      padding: var(--space-4) 0;
      text-align: center;
      text-overflow: ellipsis;
    }

    td {
      padding: 0;
      text-align: center;
    }

    .day {
      background: none;
      border: 0;
      border-radius: 999px;
      box-sizing: border-box;
      color: var(--tb-ink);
      cursor: pointer;
      font: inherit;
      font-variant-numeric: tabular-nums;
      inline-size: 100%;
      max-inline-size: 2.75rem;
      min-block-size: 2.5rem;
      padding: 0;
      // A focused day scrolls clear of the sticky action bar a sheet keeps at its foot.
      scroll-margin-block: 1rem 5.5rem;
      touch-action: manipulation;
    }

    .day:hover {
      background: var(--tb-surface-2);
    }

    .day.outside {
      color: var(--tb-muted);
    }

    .day.today {
      box-shadow: inset 0 0 0 1.5px var(--tb-accent-ink);
    }

    .day.selected {
      background: var(--tb-brand);
      color: var(--tb-on-brand);
      font-weight: 700;
    }

    .day[aria-disabled='true'] {
      color: var(--tb-muted);
      cursor: not-allowed;
      opacity: 0.45;
    }

    .day[aria-disabled='true']:hover {
      background: none;
    }

    .foot {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-8) var(--space-16);
      justify-content: space-between;
    }

    .link {
      background: none;
      border: 0;
      border-radius: var(--tb-radius-control);
      color: var(--tb-accent-ink);
      cursor: pointer;
      font: inherit;
      font-weight: 600;
      min-block-size: 2.5rem;
      padding: 0 var(--space-8);
      touch-action: manipulation;
    }

    .link:hover:not(:disabled) {
      text-decoration: underline;
    }

    .link:disabled {
      color: var(--tb-muted);
      cursor: not-allowed;
    }

    @media (forced-colors: active) {
      .day.selected {
        border: 2px solid Highlight;
      }

      .day.today {
        border: 1px solid CanvasText;
      }
    }
  `,
})
export class DateField {
  private readonly locale = inject(LOCALE_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  private readonly id = `tb-date-${++nextId}`;
  protected readonly labelId = `${this.id}-label`;
  protected readonly triggerId = `${this.id}-button`;
  protected readonly valueId = `${this.id}-value`;
  protected readonly panelId = `${this.id}-panel`;
  protected readonly monthId = `${this.id}-month`;
  protected readonly helpId = `${this.id}-help`;
  protected readonly errorId = `${this.id}-error`;

  readonly label = input.required<string>();
  readonly help = input<string | null>(null);
  /** Messages due on screen now, as `app-field` takes them. */
  readonly errors = input<readonly string[] | null>(null);
  /** The chosen day, `YYYY-MM-DD`, or `''` for none. */
  readonly value = model<string>('');
  /** The first day that can be chosen. */
  readonly min = input<string | null>(null);
  /** The last day that can be chosen. */
  readonly max = input<string | null>(null);
  /** Today in the screen's own days; the device's calendar day when not given. */
  readonly today = input<string | null>(null);
  /** An ISO weekday (1 Monday … 7 Sunday) the week starts on; the locale's own when not given. */
  readonly firstDay = input<number | null>(null);
  readonly placeholder = input($localize`Choose a day`);
  /** Offers a Clear link for a field that may be left empty. */
  readonly clearable = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  /** The calendar was closed or focus left the field: the moment a page may show its messages. */
  readonly touched = output<void>();

  protected readonly previousMonthLabel = $localize`Previous month`;
  protected readonly nextMonthLabel = $localize`Next month`;
  protected readonly todayLabel = $localize`Today`;
  protected readonly clearLabel = $localize`Clear`;

  protected readonly open = signal(false);
  /** The first day of the month the calendar shows. */
  protected readonly viewMonth = signal<IsoDate>('');
  /** The day the keyboard is on; the only one in the tab order. */
  protected readonly focusIso = signal<IsoDate>('');

  protected readonly showsError = computed(() => (this.errors()?.length ?? 0) > 0);
  protected readonly hasValue = computed(() => isIsoDate(this.value()));
  private readonly minIso = computed(() => (isIsoDate(this.min()) ? this.min() : null));
  private readonly maxIso = computed(() => (isIsoDate(this.max()) ? this.max() : null));
  protected readonly todayIso = computed(() => {
    const given = this.today();
    return isIsoDate(given) ? given : deviceToday();
  });
  private readonly weekStart = computed(() => this.firstDay() ?? localeFirstDay(this.locale));

  protected readonly describedBy = computed(() =>
    this.showsError() ? this.errorId : this.help() ? this.helpId : null,
  );

  private readonly valueFormat = new Intl.DateTimeFormat(this.locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  private readonly dayFormat = new Intl.DateTimeFormat(this.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  private readonly monthFormat = new Intl.DateTimeFormat(this.locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  protected readonly valueText = computed(() =>
    this.hasValue() ? this.valueFormat.format(toDate(this.value())) : this.placeholder(),
  );
  protected readonly panelLabel = computed(
    () => $localize`Choose a day for ${this.label()}:field:`,
  );
  protected readonly monthTitle = computed(() =>
    this.viewMonth() ? this.monthFormat.format(toDate(this.viewMonth())) : '',
  );

  protected readonly weekdays = computed(() => {
    const short = new Intl.DateTimeFormat(this.locale, { weekday: 'short', timeZone: 'UTC' });
    const long = new Intl.DateTimeFormat(this.locale, { weekday: 'long', timeZone: 'UTC' });
    // 2024-01-01 was a Monday.
    const monday = '2024-01-01';
    return Array.from({ length: 7 }, (_, index) => {
      const day = toDate(addDays(monday, (this.weekStart() - 1 + index) % 7));
      return { short: short.format(day), long: long.format(day) };
    });
  });

  protected readonly weeks = computed<DayCell[][]>(() => {
    if (!this.viewMonth()) return [];
    const value = this.value();
    const today = this.todayIso();
    const focus = this.focusIso();
    return monthWeeks(this.viewMonth(), this.weekStart()).map((week) =>
      week.map((day) => ({
        ...day,
        selected: day.iso === value,
        today: day.iso === today,
        disabled: this.isOutOfRange(day.iso),
        label: this.dayFormat.format(toDate(day.iso)),
        tabindex: day.iso === focus ? 0 : -1,
      })),
    );
  });

  protected readonly todayAllowed = computed(() => !this.isOutOfRange(this.todayIso()));

  protected toggle(): void {
    if (this.open()) {
      this.close(false);
      return;
    }
    const start = clampIso(
      this.hasValue() ? this.value() : this.todayIso(),
      this.minIso(),
      this.maxIso(),
    );
    this.focusIso.set(start);
    this.viewMonth.set(monthStart(start));
    this.open.set(true);
    afterNextRender(() => this.focusDay(start), { injector: this.injector });
  }

  protected showMonth(by: number): void {
    this.viewMonth.set(addMonths(this.viewMonth(), by));
    this.focusIso.set(addMonths(this.focusIso(), by));
  }

  protected pick(day: DayCell): void {
    if (day.disabled) return;
    this.value.set(day.iso);
    this.close(true);
  }

  protected pickToday(): void {
    if (!this.todayAllowed()) return;
    this.value.set(this.todayIso());
    this.close(true);
  }

  protected clear(): void {
    this.value.set('');
    this.close(true);
  }

  /** The keys of the W3C date picker grid; the page's own handlers never see the ones used here. */
  protected moveWithKeys(event: KeyboardEvent): void {
    const from = this.focusIso();
    const rtl = this.isRightToLeft();
    let next: IsoDate;
    switch (event.key) {
      case 'ArrowLeft':
        next = addDays(from, rtl ? 1 : -1);
        break;
      case 'ArrowRight':
        next = addDays(from, rtl ? -1 : 1);
        break;
      case 'ArrowUp':
        next = addDays(from, -7);
        break;
      case 'ArrowDown':
        next = addDays(from, 7);
        break;
      case 'Home':
        next = startOfWeek(from, this.weekStart());
        break;
      case 'End':
        next = endOfWeek(from, this.weekStart());
        break;
      case 'PageUp':
        next = event.shiftKey ? addYears(from, -1) : addMonths(from, -1);
        break;
      case 'PageDown':
        next = event.shiftKey ? addYears(from, 1) : addMonths(from, 1);
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = clampIso(next, this.minIso(), this.maxIso());
    this.focusIso.set(target);
    if (monthStart(target) !== this.viewMonth()) this.viewMonth.set(monthStart(target));
    afterNextRender(() => this.focusDay(target), { injector: this.injector });
  }

  protected closeFromKeyboard(event: Event): void {
    if (!this.open()) return;
    // The sheet around the field closes on Escape too; this Escape only closes the calendar.
    event.stopPropagation();
    event.preventDefault();
    this.close(true);
  }

  protected closeOnFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && !this.host.nativeElement.contains(next)) {
      if (this.open()) this.open.set(false);
      this.touched.emit();
    }
  }

  private close(refocus: boolean): void {
    this.open.set(false);
    if (refocus) this.trigger().nativeElement.focus();
    this.touched.emit();
  }

  private isOutOfRange(iso: IsoDate): boolean {
    const min = this.minIso();
    const max = this.maxIso();
    return (min !== null && iso < min) || (max !== null && iso > max);
  }

  private focusDay(iso: IsoDate): void {
    this.host.nativeElement.querySelector<HTMLElement>(`[data-date="${iso}"]`)?.focus();
  }

  private isRightToLeft(): boolean {
    const element = this.host.nativeElement;
    const direction = element.closest('[dir]')?.getAttribute('dir') ?? element.ownerDocument.dir;
    return direction === 'rtl';
  }
}
