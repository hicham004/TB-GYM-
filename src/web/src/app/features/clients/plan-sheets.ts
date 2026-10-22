import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { formatDate } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  LOCALE_ID,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type {
  ClientEnrollment,
  ManualPaymentMethod,
  ProductCatalog,
} from '../../core/api/api.models';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { Button } from '../../ui/button';
import { isoWeekdayOfName } from '../../ui/calendar';
import { DateField } from '../../ui/date-field';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { selectOptions, UiSelect } from '../../ui/select';
import { IntentIdempotencyKey } from '../training/training-assignment-state';
import { ClientWorkspaceContext } from './client-workspace.context';
import {
  overlappingPlan,
  paymentErrors,
  paymentOutcome,
  planRunText,
  planStartErrors,
  serviceWriteError,
} from './client-service-forms.models';
import {
  defaultPlanStart,
  money,
  offerChoices,
  paymentMethodLabel,
  renewalOfferId,
  shortDate,
  type PlanCard,
} from './client-service.models';

/**
 * The two longer forms of Service & access, each in a sheet: starting or renewing a plan, and
 * recording a payment. They ask only for what the server needs, say what will happen in a sentence,
 * and keep a refusal on screen in coach words instead of closing and losing the entry. A retry of
 * the same entry reuses its idempotency key, so a double tap records one plan or payment (SUB-011).
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
  }

  .plan-line {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .caption {
    color: var(--tb-muted);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .choices {
    border: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0;
    min-inline-size: 0;
    padding: 0;
  }

  .choices legend {
    color: var(--tb-ink);
    font-weight: 600;
    margin-block-end: 0.5rem;
    padding: 0;
  }

  .choice {
    align-items: flex-start;
    border: 1px solid var(--tb-line);
    border-radius: var(--tb-radius-control);
    cursor: pointer;
    display: flex;
    gap: 0.75rem;
    min-block-size: 2.75rem;
    padding: 0.75rem 0.875rem;
  }

  .choice:hover {
    border-color: var(--tb-accent-ink);
  }

  .choice:has(input:checked) {
    background: var(--tb-accent-soft);
    border-color: var(--tb-accent-ink);
  }

  .choice:has(input:focus-visible) {
    outline: 3px solid var(--tb-focus);
    outline-offset: 2px;
  }

  .choice input {
    accent-color: var(--tb-accent-ink);
    block-size: 1.125rem;
    flex: none;
    inline-size: 1.125rem;
    margin: 0.125rem 0 0;
  }

  // A span straight inside a label: the legacy "label > span" rule in styles.scss sets a fixed
  // colour, size, weight and margin, so each is restated here.
  .choice-text {
    color: var(--tb-ink);
    display: flex;
    flex-direction: column;
    font-size: 1rem;
    font-weight: 400;
    gap: 0.125rem;
    margin: 0;
    min-inline-size: 0;
  }

  .choice-label {
    color: var(--tb-ink);
    font-weight: 600;
  }

  .choice-detail,
  .field-note {
    color: var(--tb-muted);
    font-size: 0.875rem;
  }

  .run {
    font-weight: 600;
    margin-block-start: -0.5rem;
  }

  .warn-text {
    color: var(--tb-warning);
    font-size: 0.875rem;
  }

  .notice {
    background: var(--tb-surface-2);
    border-radius: var(--tb-radius-control);
    padding: 0.75rem 0.875rem;
  }

  .notice a {
    color: var(--tb-accent-ink);
    font-weight: 600;
  }

  .value-unit {
    align-items: center;
    display: grid;
    gap: 0.5rem;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .unit {
    color: var(--tb-muted);
    font-weight: 600;
  }

  .actions {
    background: var(--tb-surface);
    border-block-start: 1px solid var(--tb-line);
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    inset-block-end: 0;
    justify-content: flex-end;
    margin-block-end: -1.5rem;
    margin-inline: -1.5rem;
    padding: 0.75rem 1.5rem;
    position: sticky;
  }
`;

/** After a refused submit, the first field marked wrong takes focus, as on Assign program. */
function focusFirstProblem(host: ElementRef<HTMLElement>, injector: Injector): void {
  afterNextRender(
    () =>
      host.nativeElement
        .querySelector<HTMLElement>('[aria-invalid="true"], fieldset[aria-describedby] input')
        ?.focus(),
    { injector },
  );
}

// ------------------------------------------------------------------------------------------------

@Component({
  selector: 'app-plan-start',
  imports: [Button, DateField, FormSummary, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      @if (renewFrom(); as from) {
        <p class="plan-line">
          <span class="caption" i18n>Renewing</span>
          <span dir="auto">{{ followsLine() }}</span>
        </p>
      }
      @if (choices().length === 0) {
        @if (renewFrom()) {
          <p class="notice" i18n>
            None of this plan’s price options is offered now. Turn one on, or add one, under
            <a routerLink="/products">Products</a>.
          </p>
        } @else {
          <p class="notice" i18n>
            You have nothing to sell yet. Add a plan and its price options under
            <a routerLink="/products">Products</a>.
          </p>
        }
      } @else {
        <fieldset
          class="choices"
          [attr.aria-describedby]="shows('offerId') ? 'plan-offer-error' : null"
        >
          <legend i18n>Price option</legend>
          @for (choice of choices(); track choice.offerId) {
            <label class="choice">
              <input
                type="radio"
                name="offer"
                [value]="choice.offerId"
                [checked]="choice.offerId === offerId()"
                (change)="offerId.set(choice.offerId); dirtyChange.emit(true)"
              />
              <span class="choice-text">
                <span class="choice-label" dir="auto">{{ choice.label }}</span>
                <span class="choice-detail" dir="auto">{{ choice.detail }}</span>
              </span>
            </label>
          }
        </fieldset>
        @if (shows('offerId')) {
          <p id="plan-offer-error" class="warn-text">{{ errors()['offerId'][0] }}</p>
        }

        <app-date-field
          [label]="startLabel"
          [errors]="shows('startDate') ? errors()['startDate'] : null"
          [today]="today()"
          [firstDay]="firstDay()"
          [value]="startDate()"
          (valueChange)="startDate.set($event); dirtyChange.emit(true)"
          (touched)="attempt.touch('startDate')"
        />
        @if (run(); as text) {
          <p class="run" aria-live="polite">{{ text }}</p>
        }
        @if (overlap(); as text) {
          <p class="warn-text" dir="auto" role="status">{{ text }}</p>
        }
        @if (accessLine(); as text) {
          <p class="muted" dir="auto">{{ text }}</p>
        }
      }

      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        } @else if (attempt.wasTried() && problemCount() > 0) {
          <ng-container i18n>Check the fields marked above.</ng-container>
        }
      </app-form-summary>
      <div class="actions">
        <button appButton type="button" variant="text" (click)="closed.emit(null)" i18n>
          Not now
        </button>
        @if (choices().length > 0) {
          <button appButton type="submit" [loading]="busy()">
            @if (busy()) {
              <ng-container i18n>Saving…</ng-container>
            } @else if (renewFrom()) {
              <ng-container i18n>Renew plan</ng-container>
            } @else {
              <ng-container i18n>Start plan</ng-container>
            }
          </button>
        }
      </div>
    </form>
  `,
  styles: SHEET_STYLES,
})
export class PlanStart {
  private readonly record = inject(ClientWorkspaceContext, { optional: true });
  /** The workspace's week start, as the record's other calendars have it; the locale's without one. */
  protected readonly firstDay = computed(() =>
    isoWeekdayOfName(this.record?.workspace()?.weekStartsOn),
  );
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly locale = inject(LOCALE_ID);
  private readonly intent = new IntentIdempotencyKey();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly summary = viewChild.required(FormSummary);

  readonly clientId = input.required<string>();
  readonly firstName = input.required<string>();
  readonly today = input.required<string>();
  readonly catalog = input.required<ProductCatalog | null>();
  readonly plans = input.required<readonly ClientEnrollment[]>();
  /** The plan being renewed: the new plan uses one of its price options and follows it. */
  readonly renewFrom = input<ClientEnrollment | null>(null);
  /** The plan started, or null when the coach closed the sheet without one. */
  readonly closed = output<ClientEnrollment | null>();
  readonly dirtyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly startLabel = $localize`First day`;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly choices = computed(() =>
    offerChoices(this.catalog(), this.locale, this.renewFrom()?.productId ?? null),
  );
  /**
   * A renewal starts on the plan's own price option while it is offered, or on the option that replaced it
   * when its price changed (COACH-3).
   */
  protected readonly offerId = linkedSignal(() => {
    const choices = this.choices();
    const from = this.renewFrom();
    const renewal = from ? renewalOfferId(this.catalog(), from.productId, from.offerId) : null;
    const same = choices.find((choice) => choice.offerId === renewal);
    return (same ?? (choices.length === 1 ? choices[0] : undefined))?.offerId ?? '';
  });
  protected readonly startDate = linkedSignal(() =>
    defaultPlanStart(this.today(), this.renewFrom()),
  );

  private readonly choice = computed(() =>
    this.choices().find((item) => item.offerId === this.offerId()),
  );
  protected readonly errors = computed(() =>
    planStartErrors(
      { offerId: this.offerId(), startDate: this.startDate() },
      this.choice(),
      this.today(),
    ),
  );
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);

  protected readonly followsLine = computed(() => {
    const from = this.renewFrom();
    return from
      ? $localize`${from.productName}:plan: · ${from.offerLabel}:option:, until ${shortDate(from.lastActiveDate, this.locale)}:date:`
      : '';
  });

  protected readonly run = computed(() => {
    const choice = this.choice();
    return choice && this.startDate()
      ? planRunText(this.startDate(), choice.days, this.today(), this.locale)
      : null;
  });

  protected readonly overlap = computed(() => {
    const choice = this.choice();
    if (!choice || !this.startDate()) return null;
    const other = overlappingPlan(choice, this.startDate(), this.plans(), this.today());
    return other
      ? $localize`${this.firstName()}:name: already has ${other.productName}:plan: from ${formatDate(other.startDate, 'EEE d MMM y', this.locale)}:from: to ${formatDate(other.lastActiveDate, 'EEE d MMM y', this.locale)}:to:. Start on ${formatDate(other.endDateExclusive, 'EEE d MMM y', this.locale)}:next: or later.`
      : null;
  });

  protected readonly accessLine = computed(() => {
    const choice = this.choice();
    if (!choice) return null;
    const name = this.firstName();
    return choice.price === 0
      ? $localize`It is free, so ${name}:name: can use it from its first day.`
      : $localize`${name}:name: can use it once ${money(choice.price, choice.currency, this.locale)}:price: is paid. You record the payment here.`;
  });

  protected shows(field: string): boolean {
    return this.attempt.shows(field, this.errors()[field] ?? []);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    return this.scope.run('submit', async (owner) => {
      if (this.problemCount() > 0) {
        this.error.set(null);
        this.attempt.attempt();
        focusFirstProblem(this.host, this.injector);
        return;
      }
      const payload = { offerId: this.offerId(), startDate: this.startDate() };
      const from = this.renewFrom();
      const request = {
        ...payload,
        idempotencyKey: this.intent.forPayload({ ...payload, from: from?.id }),
      };
      this.busy.set(true);
      this.error.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        const plan = await owner.wait(
          firstValueFrom(
            from
              ? this.api.renewEnrollment(from.id, request)
              : this.api.assignProduct(this.clientId(), request),
          ),
        );
        this.intent.complete();
        this.closed.emit(plan);
      } catch (error) {
        if (!owner.current) return;
        this.error.set(
          serviceWriteError(
            error,
            from
              ? $localize`The plan could not be renewed. Try again.`
              : $localize`The plan could not be started. Try again.`,
            this.firstName(),
          ),
        );
        this.summary().focus();
      } finally {
        if (owner.current) {
          this.busy.set(false);
        }
      }
    });
  }
}

// ------------------------------------------------------------------------------------------------

const METHODS: readonly ManualPaymentMethod[] = [
  'Cash',
  'BankTransfer',
  'MobileWallet',
  'Card',
  'Other',
];

@Component({
  selector: 'app-plan-payment',
  imports: [Button, Control, DateField, Field, FormSummary, UiSelect],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="plan-line">
        <span class="caption" i18n>Plan</span>
        <span dir="auto">{{ planLine() }}</span>
      </p>

      <app-field
        [label]="amountLabel"
        [help]="amountHelp()"
        [errors]="shows('amount') ? errors()['amount'] : null"
      >
        <div class="value-unit">
          <input
            appControl
            name="amount"
            autocomplete="off"
            type="number"
            inputmode="decimal"
            min="0.01"
            step="0.01"
            [value]="amount() ?? ''"
            (input)="setAmount($any($event.target).valueAsNumber); dirtyChange.emit(true)"
            (blur)="attempt.touch('amount')"
          />
          <span class="unit">{{ plan().currency }}</span>
        </div>
      </app-field>
      @if (outcome(); as text) {
        <p class="muted" dir="auto" aria-live="polite">{{ text }}</p>
      }

      <app-date-field
        [label]="receivedLabel"
        [errors]="shows('receivedOn') ? errors()['receivedOn'] : null"
        [today]="today()"
        [firstDay]="firstDay()"
        [max]="today()"
        [value]="receivedOn()"
        (valueChange)="receivedOn.set($event); dirtyChange.emit(true)"
        (touched)="attempt.touch('receivedOn')"
      />

      <app-select
        [label]="methodLabel"
        [options]="methods"
        [value]="method()"
        (valueChange)="method.set($any($event)); dirtyChange.emit(true)"
      />

      <app-field [label]="referenceLabel" [help]="referenceHelp">
        <input
          appControl
          name="reference"
          autocomplete="off"
          spellcheck="false"
          maxlength="200"
          dir="auto"
          [value]="reference()"
          (input)="reference.set($any($event.target).value); dirtyChange.emit(true)"
        />
      </app-field>

      <app-field [label]="noteLabel" [help]="noteHelp">
        <textarea
          appControl
          name="note"
          autocomplete="off"
          rows="2"
          maxlength="2000"
          dir="auto"
          [value]="note()"
          (input)="note.set($any($event.target).value); dirtyChange.emit(true)"
        ></textarea>
      </app-field>

      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        } @else if (attempt.wasTried() && problemCount() > 0) {
          <ng-container i18n>Check the fields marked above.</ng-container>
        }
      </app-form-summary>
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
export class PlanPayment {
  private readonly record = inject(ClientWorkspaceContext, { optional: true });
  /** The workspace's week start, as the record's other calendars have it; the locale's without one. */
  protected readonly firstDay = computed(() =>
    isoWeekdayOfName(this.record?.workspace()?.weekStartsOn),
  );
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly locale = inject(LOCALE_ID);
  private readonly intent = new IntentIdempotencyKey();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly summary = viewChild.required(FormSummary);

  readonly plan = input.required<PlanCard>();
  readonly firstName = input.required<string>();
  readonly today = input.required<string>();
  /** True when a payment was recorded. */
  readonly closed = output<boolean>();
  readonly dirtyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly methods = selectOptions(METHODS, paymentMethodLabel);
  protected readonly amountLabel = $localize`Amount received`;
  protected readonly receivedLabel = $localize`Received on`;
  protected readonly methodLabel = $localize`How it was paid`;
  protected readonly referenceLabel = $localize`Reference (optional)`;
  protected readonly referenceHelp = $localize`A receipt or transfer number, to find it later.`;
  protected readonly noteLabel = $localize`Note (optional)`;
  protected readonly noteHelp = $localize`Only your team sees it.`;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Starts at what is left, the usual case; a part payment is typed over it. */
  protected readonly amount = linkedSignal<number | null>(() => this.plan().balance);
  protected readonly receivedOn = linkedSignal(() => this.today());
  protected readonly method = signal<ManualPaymentMethod>('Cash');
  protected readonly reference = signal('');
  protected readonly note = signal('');

  protected readonly errors = computed(() =>
    paymentErrors(
      { amount: this.amount(), receivedOn: this.receivedOn() },
      this.plan().balance,
      this.today(),
    ),
  );
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);

  protected readonly planLine = computed(() => {
    const plan = this.plan();
    return $localize`${plan.paymentContext}:plan: · ${money(plan.price, plan.currency, this.locale)}:price:`;
  });
  protected readonly amountHelp = computed(
    () =>
      $localize`${money(this.plan().balance, this.plan().currency, this.locale)}:left: left to pay. Part payments are fine.`,
  );
  protected readonly outcome = computed(() =>
    paymentOutcome(this.amount(), this.plan(), this.firstName(), this.today(), this.locale),
  );

  protected setAmount(value: number): void {
    this.amount.set(Number.isFinite(value) ? value : null);
  }

  protected shows(field: string): boolean {
    return this.attempt.shows(field, this.errors()[field] ?? []);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    return this.scope.run('submit', async (owner) => {
      if (this.problemCount() > 0) {
        this.error.set(null);
        this.attempt.attempt();
        focusFirstProblem(this.host, this.injector);
        return;
      }
      const plan = this.plan();
      const entered = {
        plan: plan.id,
        amount: this.amount()!,
        receivedOn: this.receivedOn(),
        method: this.method(),
        reference: this.reference().trim() || null,
        note: this.note().trim() || null,
      };
      // The day goes as typed: the server stamps the instant in the workspace's zone (WEA-6). The key
      // is bound to the whole entry, so a retry of it is answered with the payment recorded (SUB-011).
      const key = this.intent.forPayload(entered);
      this.busy.set(true);
      this.error.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        await owner.wait(
          firstValueFrom(
            this.api.recordManualPayment(plan.id, {
              amount: entered.amount,
              currencyCode: plan.currency,
              receivedOn: entered.receivedOn,
              method: entered.method,
              reference: entered.reference,
              note: entered.note,
              idempotencyKey: key,
            }),
          ),
        );
        this.intent.complete();
        this.closed.emit(true);
      } catch (error) {
        if (!owner.current) return;
        this.error.set(
          serviceWriteError(
            error,
            $localize`The payment could not be recorded. Try again.`,
            this.firstName(),
          ),
        );
        this.summary().focus();
      } finally {
        if (owner.current) {
          this.busy.set(false);
        }
      }
    });
  }
}
