import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  LOCALE_ID,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { DateField } from '../../ui/date-field';
import { Control, Field } from '../../ui/field';
import { Icon } from '../../ui/icon';
import {
  formatMonth,
  formatMoney,
  type BillingDiscount,
  type BillingInvoice,
  type PricePlan,
} from '../billing/billing.models';
import { PlatformAdminApi } from './platform-admin-api';
import {
  discountEndExclusive,
  discountErrors,
  lastDayAfterMonths,
  paymentErrors,
  planChanges,
  planEntryFrom,
  planErrors,
  planFields,
  toPublishRequest,
  voidErrors,
  voidOutcome,
  type PlanKey,
} from './platform-admin.models';

/**
 * The four writes of platform billing, each in a sheet (R5.2b, ADR 0028): record a payment, void an
 * invoice, grant a discount and publish a price plan version. They ask only for what the server
 * needs, say in a sentence what will happen, keep a refusal on screen in the server's own words
 * instead of closing and losing the entry, and tell the page when they hold typed work so closing
 * asks first. The server decides every amount and date; nothing is added up here.
 */

const SHEET_STYLES = `
  :host {
    display: block;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  p {
    color: var(--tb-ink);
    margin: 0;
    overflow-wrap: anywhere;
  }

  .muted {
    color: var(--tb-muted);
    font-size: 0.875rem;
  }

  .about {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .who {
    font-weight: 600;
  }

  .caption {
    color: var(--tb-muted);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  code {
    font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
    overflow-wrap: anywhere;
  }

  .amount {
    align-items: baseline;
    background: var(--tb-surface-2);
    border-radius: var(--tb-radius-control);
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    justify-content: space-between;
    padding: 0.75rem 1rem;
  }

  .amount strong {
    font-size: 1.5rem;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .notice {
    background: var(--tb-surface-2);
    border-radius: var(--tb-radius-control);
    padding: 0.75rem 0.875rem;
  }

  // A focused field scrolls clear of the sticky action bar at the sheet's foot.
  input,
  textarea,
  button.trigger {
    scroll-margin-block-end: 5rem;
  }

  .value-unit {
    align-items: center;
    display: grid;
    gap: 0.5rem;
    grid-template-columns: minmax(0, 1fr);
  }

  .value-unit.has-unit {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .unit {
    color: var(--tb-muted);
    font-weight: 600;
  }

  .problem-text {
    background: var(--tb-danger-soft);
    border-radius: var(--tb-radius-control);
    color: var(--tb-danger);
    font-weight: 600;
    padding: 0.625rem 0.875rem;
  }

  .actions {
    background: var(--tb-surface);
    border-block-start: 1px solid var(--tb-line);
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    inset-block-end: -1.5rem;
    justify-content: flex-end;
    margin-block-end: -1.5rem;
    margin-inline: -1.5rem;
    padding: 0.75rem 1.5rem;
    position: sticky;
  }
`;

/** After a refused submit, the first field marked wrong takes focus. */
function focusFirstProblem(host: ElementRef<HTMLElement>, injector: Injector): void {
  afterNextRender(
    () => host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
    { injector },
  );
}

// ------------------------------------------------------------------------------------------------

@Component({
  selector: 'app-platform-payment',
  imports: [Button, Control, DateField, Field],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="about">
        <span class="who"
          ><span dir="auto">{{ spaceName() }}</span></span
        >&ngsp;
        <span class="muted"
          >{{ month() }} · <code dir="ltr" translate="no">{{ invoice().referenceCode }}</code></span
        >
      </p>

      <p class="amount">
        <span class="caption" i18n>Amount received</span>&ngsp;
        <strong>{{ total() }}</strong>
      </p>
      <p class="muted" i18n>
        Exactly what the invoice says. A payment is always the full amount: if the transfer was a
        different amount, leave the invoice open and ask for the rest.
      </p>

      <app-field
        [label]="referenceLabel"
        [help]="referenceHelp"
        [errors]="shows('reference') ? errors()['reference'] : null"
      >
        <input
          appControl
          name="reference"
          autocomplete="off"
          spellcheck="false"
          maxlength="100"
          dir="auto"
          [value]="reference()"
          (input)="reference.set($any($event.target).value)"
          (blur)="attempt.touch('reference')"
        />
      </app-field>

      <app-date-field
        [label]="receivedLabel"
        [help]="receivedHelp"
        [errors]="shows('receivedOn') ? errors()['receivedOn'] : null"
        [(value)]="receivedOn"
        [min]="issuedDay()"
        [max]="today()"
        [today]="today()"
        (touched)="attempt.touch('receivedOn')"
      />

      <app-field
        [label]="noteLabel"
        [help]="noteHelp"
        [errors]="shows('note') ? errors()['note'] : null"
      >
        <textarea
          appControl
          autocomplete="off"
          name="note"
          rows="2"
          maxlength="500"
          dir="auto"
          [value]="note()"
          (input)="note.set($any($event.target).value)"
          (blur)="attempt.touch('note')"
        ></textarea>
      </app-field>

      @if (attempt.wasTried() && problemCount() > 0) {
        <p class="problem-text" role="alert" i18n>Check the fields marked above.</p>
      }
      @if (error(); as message) {
        <p class="problem-text" role="alert">{{ message }}</p>
      }
      <div class="actions">
        <button appButton type="button" variant="text" (click)="closed.emit(false)" i18n>
          Not now
        </button>
        <button appButton type="submit" [loading]="busy()">
          @if (busy()) {
            <ng-container i18n>Recording…</ng-container>
          } @else {
            <ng-container i18n>Record payment</ng-container>
          }
        </button>
      </div>
    </form>
  `,
  styles: SHEET_STYLES,
})
export class PlatformPayment {
  private readonly api = inject(PlatformAdminApi);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly invoice = input.required<BillingInvoice>();
  readonly spaceName = input.required<string>();
  /** Today in UTC, the last day the money can have arrived. */
  readonly today = input.required<string>();
  /** True when the payment was recorded. */
  readonly closed = output<boolean>();
  /** Whether something has been typed that closing would lose. */
  readonly dirtyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly referenceLabel = $localize`Whish or transfer reference`;
  protected readonly referenceHelp = $localize`The number on the transfer, so the money can be found later.`;
  protected readonly receivedLabel = $localize`Received on`;
  protected readonly receivedHelp = $localize`The day the money arrived. Days are UTC, like the invoice’s.`;
  protected readonly noteLabel = $localize`Note (optional)`;
  protected readonly noteHelp = $localize`Only TB Gym’s admin sees it.`;

  protected readonly reference = signal('');
  protected readonly receivedOn = linkedSignal(() => this.today());
  protected readonly note = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly month = computed(() => formatMonth(this.invoice().periodStart, this.locale));
  protected readonly total = computed(() =>
    formatMoney(this.invoice().amounts.total, this.invoice().amounts.currencyCode, this.locale),
  );
  protected readonly issuedDay = computed(() => this.invoice().issuedAtUtc.slice(0, 10));
  protected readonly errors = computed(() =>
    paymentErrors(
      { reference: this.reference(), receivedOn: this.receivedOn(), note: this.note() },
      this.invoice(),
      this.today(),
      this.locale,
    ),
  );
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);

  constructor() {
    effect(() =>
      this.dirtyChange.emit(this.reference().trim() !== '' || this.note().trim() !== ''),
    );
  }

  protected shows(field: string): boolean {
    return this.attempt.shows(field, this.errors()[field] ?? []);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problemCount() > 0) {
      this.attempt.attempt();
      focusFirstProblem(this.host, this.injector);
      return;
    }
    const invoice = this.invoice();
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      await firstValueFrom(
        this.api.recordPayment(
          invoice.id,
          invoice.amounts.total,
          this.reference().trim(),
          this.note().trim() || null,
          this.receivedOn(),
        ),
      );
      this.closed.emit(true);
    } catch (error) {
      this.error.set(
        apiErrorMessage(error, $localize`The payment could not be recorded. Try again.`),
      );
    } finally {
      this.busy.set(false);
    }
  }
}

// ------------------------------------------------------------------------------------------------

@Component({
  selector: 'app-platform-void',
  imports: [Button, Checkbox, Control, Field],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="about">
        <span class="who"
          ><span dir="auto">{{ spaceName() }}</span></span
        >&ngsp;
        <span class="muted"
          >{{ month() }} · <code dir="ltr" translate="no">{{ invoice().referenceCode }}</code> ·
          {{ total() }}</span
        >
      </p>
      <p class="muted" i18n>
        Voiding withdraws the invoice. It stays on record, struck through, and can no longer be
        paid. A paid invoice cannot be voided.
      </p>

      <app-field
        [label]="reasonLabel"
        [help]="reasonHelp"
        [errors]="shows('reason') ? errors()['reason'] : null"
      >
        <textarea
          appControl
          autocomplete="off"
          name="reason"
          rows="2"
          maxlength="500"
          dir="auto"
          [value]="reason()"
          (input)="reason.set($any($event.target).value)"
          (blur)="attempt.touch('reason')"
        ></textarea>
      </app-field>

      <app-checkbox [label]="reissueLabel">
        <input
          type="checkbox"
          appControl
          name="reissue"
          [checked]="reissue()"
          (change)="reissue.set($any($event.target).checked)"
        />
      </app-checkbox>
      <p class="notice" aria-live="polite" dir="auto">{{ outcome() }}</p>

      @if (attempt.wasTried() && problemCount() > 0) {
        <p class="problem-text" role="alert" i18n>Check the fields marked above.</p>
      }
      @if (error(); as message) {
        <p class="problem-text" role="alert">{{ message }}</p>
      }
      <div class="actions">
        <button appButton type="button" variant="text" (click)="closed.emit(false)" i18n>
          Not now
        </button>
        <button appButton type="submit" [loading]="busy()">
          @if (busy()) {
            <ng-container i18n>Voiding…</ng-container>
          } @else if (reissue()) {
            <ng-container i18n>Void and reissue</ng-container>
          } @else {
            <ng-container i18n>Void invoice</ng-container>
          }
        </button>
      </div>
    </form>
  `,
  styles: SHEET_STYLES,
})
export class PlatformVoid {
  private readonly api = inject(PlatformAdminApi);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly invoice = input.required<BillingInvoice>();
  readonly spaceName = input.required<string>();
  /** True when the invoice was voided. */
  readonly closed = output<boolean>();
  readonly dirtyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly reasonLabel = $localize`Why is it void?`;
  protected readonly reasonHelp = $localize`Kept on the invoice. The owner sees it too.`;
  protected readonly reissueLabel = $localize`Issue a corrected invoice`;

  protected readonly reason = signal('');
  protected readonly reissue = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly month = computed(() => formatMonth(this.invoice().periodStart, this.locale));
  protected readonly total = computed(() =>
    formatMoney(this.invoice().amounts.total, this.invoice().amounts.currencyCode, this.locale),
  );
  protected readonly errors = computed(() => voidErrors({ reason: this.reason() }));
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);
  protected readonly outcome = computed(() =>
    voidOutcome(this.invoice(), this.reissue(), this.spaceName(), this.month()),
  );

  constructor() {
    effect(() => this.dirtyChange.emit(this.reason().trim() !== ''));
  }

  protected shows(field: string): boolean {
    return this.attempt.shows(field, this.errors()[field] ?? []);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problemCount() > 0) {
      this.attempt.attempt();
      focusFirstProblem(this.host, this.injector);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      await firstValueFrom(
        this.api.voidInvoice(this.invoice().id, this.reason().trim(), this.reissue()),
      );
      this.closed.emit(true);
    } catch (error) {
      this.error.set(
        apiErrorMessage(error, $localize`The invoice could not be voided. Try again.`),
      );
    } finally {
      this.busy.set(false);
    }
  }
}

// ------------------------------------------------------------------------------------------------

@Component({
  selector: 'app-platform-discount',
  imports: [Button, Control, DateField, Field],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="about">
        <span class="who"
          ><span dir="auto">{{ spaceName() }}</span></span
        >&ngsp;
        <span class="muted" i18n
          >Comes off every invoice for a month it touches. Two discounts cannot overlap.</span
        >
      </p>

      <app-field [label]="percentLabel" [errors]="shows('percent') ? errors()['percent'] : null">
        <div class="value-unit">
          <input
            appControl
            name="percent"
            type="number"
            inputmode="decimal"
            min="0.01"
            max="100"
            step="0.01"
            autocomplete="off"
            [value]="percent() ?? ''"
            (input)="setPercent($any($event.target).valueAsNumber)"
            (blur)="attempt.touch('percent')"
          />
          <span class="unit">%</span>
        </div>
      </app-field>

      <app-date-field
        [label]="fromLabel"
        [errors]="shows('startsOn') ? errors()['startsOn'] : null"
        [(value)]="startsOn"
        [today]="today()"
        (touched)="attempt.touch('startsOn')"
      />
      <app-date-field
        [label]="throughLabel"
        [help]="throughHelp"
        [errors]="shows('lastDay') ? errors()['lastDay'] : null"
        [(value)]="lastDay"
        [min]="startsOn() || null"
        [today]="today()"
        (touched)="attempt.touch('lastDay')"
      />
      <div class="presets" role="group" [attr.aria-label]="presetsLabel">
        <span class="caption" i18n>Run it for</span>
        @for (preset of presets; track preset.months) {
          <button appButton type="button" variant="outlined" (click)="applyPreset(preset.months)">
            {{ preset.label }}
          </button>
        }
      </div>

      <app-field [label]="noteLabel" [errors]="shows('note') ? errors()['note'] : null">
        <input
          appControl
          name="note"
          autocomplete="off"
          maxlength="200"
          dir="auto"
          [value]="note()"
          (input)="note.set($any($event.target).value)"
          (blur)="attempt.touch('note')"
        />
      </app-field>

      @if (attempt.wasTried() && problemCount() > 0) {
        <p class="problem-text" role="alert" i18n>Check the fields marked above.</p>
      }
      @if (error(); as message) {
        <p class="problem-text" role="alert">{{ message }}</p>
      }
      <div class="actions">
        <button appButton type="button" variant="text" (click)="closed.emit(false)" i18n>
          Not now
        </button>
        <button appButton type="submit" [loading]="busy()">
          @if (busy()) {
            <ng-container i18n>Granting…</ng-container>
          } @else {
            <ng-container i18n>Grant discount</ng-container>
          }
        </button>
      </div>
    </form>
  `,
  styles:
    SHEET_STYLES +
    `
    .presets {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-block-start: -0.5rem;
    }
  `,
})
export class PlatformDiscount {
  private readonly api = inject(PlatformAdminApi);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly tenantId = input.required<string>();
  readonly spaceName = input.required<string>();
  readonly today = input.required<string>();
  readonly existing = input<readonly BillingDiscount[]>([]);
  /** True when the discount was granted. */
  readonly closed = output<boolean>();
  readonly dirtyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly percentLabel = $localize`Percent off`;
  protected readonly fromLabel = $localize`First day`;
  protected readonly throughLabel = $localize`Last day`;
  protected readonly throughHelp = $localize`The discount covers this day too.`;
  protected readonly noteLabel = $localize`What it is for`;
  protected readonly presetsLabel = $localize`Choose the last day by length`;
  protected readonly presets = [
    { months: 3, label: $localize`3 months` },
    { months: 6, label: $localize`6 months` },
    { months: 12, label: $localize`A year` },
  ];

  protected readonly percent = signal<number | null>(null);
  protected readonly startsOn = linkedSignal(() => this.today());
  protected readonly lastDay = signal('');
  protected readonly note = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly errors = computed(() =>
    discountErrors(
      {
        percent: this.percent(),
        startsOn: this.startsOn(),
        lastDay: this.lastDay(),
        note: this.note(),
      },
      this.existing(),
      this.locale,
    ),
  );
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);

  constructor() {
    effect(() =>
      this.dirtyChange.emit(
        this.percent() !== null || this.lastDay() !== '' || this.note().trim() !== '',
      ),
    );
  }

  protected setPercent(value: number): void {
    this.percent.set(Number.isFinite(value) ? value : null);
  }

  protected applyPreset(months: number): void {
    this.lastDay.set(lastDayAfterMonths(this.startsOn() || this.today(), months));
    this.attempt.touch('lastDay');
  }

  protected shows(field: string): boolean {
    return this.attempt.shows(field, this.errors()[field] ?? []);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problemCount() > 0) {
      this.attempt.attempt();
      focusFirstProblem(this.host, this.injector);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      await firstValueFrom(
        this.api.grantDiscount(
          this.tenantId(),
          this.percent() ?? 0,
          this.startsOn(),
          discountEndExclusive(this.lastDay()),
          this.note().trim(),
        ),
      );
      this.closed.emit(true);
    } catch (error) {
      this.error.set(
        apiErrorMessage(error, $localize`The discount could not be granted. Try again.`),
      );
    } finally {
      this.busy.set(false);
    }
  }
}

// ------------------------------------------------------------------------------------------------

@Component({
  selector: 'app-platform-plan',
  imports: [Button, Control, Field, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="muted" i18n>
        Version {{ current().versionNumber }} is in force. Invoices issued from now on use the new
        terms; invoices already issued keep theirs.
      </p>

      <div class="grid">
        @for (field of fields; track field.key) {
          <app-field
            [label]="field.label"
            [help]="field.help ?? null"
            [errors]="shows(field.key) ? errors()[field.key] : null"
          >
            <div class="value-unit" [class.has-unit]="field.kind === 'money'">
              <input
                appControl
                type="number"
                autocomplete="off"
                [name]="field.key"
                [attr.inputmode]="field.kind === 'money' ? 'decimal' : 'numeric'"
                [attr.min]="field.min"
                [attr.max]="field.max"
                [attr.step]="field.kind === 'money' ? '0.01' : '1'"
                [value]="entry()[field.key] ?? ''"
                (input)="setNumber(field.key, $any($event.target).valueAsNumber)"
                (blur)="attempt.touch(field.key)"
              />
              @if (field.kind === 'money') {
                <span class="unit">{{ current().currencyCode }}</span>
              }
            </div>
          </app-field>
        }
      </div>

      <app-field
        label="Note (optional)"
        i18n-label
        [errors]="shows('note') ? errors()['note'] : null"
      >
        <input
          appControl
          name="note"
          autocomplete="off"
          maxlength="500"
          dir="auto"
          [value]="entry().note"
          (input)="setNote($any($event.target).value)"
          (blur)="attempt.touch('note')"
        />
      </app-field>

      <section class="changes" aria-live="polite">
        @if (changes().length === 0) {
          @if (problemCount() === 0) {
            <p class="muted" i18n>
              Nothing has changed yet. Change a price or a period to publish a new version.
            </p>
          }
        } @else {
          <h3 i18n>What changes</h3>
          <ul>
            @for (change of changes(); track change.key) {
              <li>
                <span class="what">{{ change.label }}</span>
                <span class="from">{{ change.from }}</span>
                <app-icon name="chevron-right" class="arrow" />
                <strong class="to">{{ change.to }}</strong>
              </li>
            }
          </ul>
        }
      </section>

      @if (attempt.wasTried() && problemCount() > 0) {
        <p class="problem-text" role="alert" i18n>Check the fields marked above.</p>
      }
      @if (error(); as message) {
        <p class="problem-text" role="alert">{{ message }}</p>
      }
      <div class="actions">
        <button appButton type="button" variant="text" (click)="closed.emit(false)" i18n>
          Not now
        </button>
        <button
          appButton
          type="submit"
          [loading]="busy()"
          [disabled]="changes().length === 0 && problemCount() === 0"
        >
          @if (busy()) {
            <ng-container i18n>Publishing…</ng-container>
          } @else {
            <ng-container i18n>Publish version {{ current().versionNumber + 1 }}</ng-container>
          }
        </button>
      </div>
    </form>
  `,
  styles:
    SHEET_STYLES +
    `
    .grid {
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
    }

    .changes {
      background: var(--tb-surface-2);
      border-radius: var(--tb-radius-control);
      padding: 0.75rem 1rem;
    }

    .changes h3 {
      color: var(--tb-ink);
      font-size: 0.9375rem;
      margin: 0 0 0.5rem;
    }

    .changes ul {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .changes li {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 0.5rem;
    }

    .what {
      color: var(--tb-muted);
      flex: 1 1 12rem;
    }

    .from {
      color: var(--tb-muted);
      font-variant-numeric: tabular-nums;
      text-decoration: line-through;
    }

    .to {
      color: var(--tb-ink);
      font-variant-numeric: tabular-nums;
    }

    .arrow {
      color: var(--tb-muted);
    }

    :host-context([dir='rtl']) .arrow {
      transform: scaleX(-1);
    }
  `,
})
export class PlatformPlan {
  private readonly api = inject(PlatformAdminApi);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly current = input.required<PricePlan>();
  /** The version that was published, or false when the sheet was closed without publishing. */
  readonly closed = output<PricePlan | false>();
  readonly dirtyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly fields = planFields();
  protected readonly entry = linkedSignal(() => planEntryFrom(this.current()));
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly errors = computed(() => planErrors(this.entry()));
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);
  /** What differs from the version in force, leaving out a term that is not valid yet. */
  protected readonly changes = computed(() =>
    planChanges(this.current(), this.entry(), this.locale).filter(
      (change) => !this.errors()[change.key],
    ),
  );

  constructor() {
    effect(() =>
      this.dirtyChange.emit(
        this.changes().length > 0 || this.problemCount() > 0 || this.entry().note.trim() !== '',
      ),
    );
  }

  protected setNumber(key: PlanKey, value: number): void {
    this.entry.update((entry) => ({ ...entry, [key]: Number.isFinite(value) ? value : null }));
  }

  protected setNote(note: string): void {
    this.entry.update((entry) => ({ ...entry, note }));
  }

  protected shows(field: string): boolean {
    return this.attempt.shows(field, this.errors()[field] ?? []);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problemCount() > 0) {
      this.attempt.attempt();
      focusFirstProblem(this.host, this.injector);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      const published = await firstValueFrom(
        this.api.publishPricePlan(toPublishRequest(this.entry(), this.current())),
      );
      this.closed.emit(published);
    } catch (error) {
      this.error.set(
        apiErrorMessage(error, $localize`The price plan could not be published. Try again.`),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
