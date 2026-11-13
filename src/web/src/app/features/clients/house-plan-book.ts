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
import { firstValueFrom } from 'rxjs';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { ModalFooter, modalFormId } from '../../ui/modal-footer';
import { IntentIdempotencyKey } from '../training/training-assignment-state';
import type { FieldMessages } from './client-service-forms.models';
import { shortDate } from './client-service.models';
import { HousePlanAsksApi } from './house-plan-asks-api';
import {
  amountInput,
  askEnded,
  bookingErrors,
  bookingIntro,
  bookingLine,
  bookingRefusal,
  type HousePlanAsk,
} from './house-plan-asks.models';

/**
 * Booking a house trainee's plan from their ask (SUB-020): one step makes the plan, from the house's day or
 * the day after their current plan ends, and records its money as a Whish receipt of today. The staff pick no
 * day and type the amount they see in the Whish account; the server takes the exact price alone and says so
 * under the amount. A retry of the same booking reuses its key, so a double tap books one plan (SUB-011).
 */
@Component({
  selector: 'app-house-plan-book',
  imports: [Button, Control, Field, FormSummary, ModalFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [id]="formId" class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="plan-line" dir="auto">{{ planLine() }}</p>
      <p dir="auto">{{ intro() }}</p>
      @if (ask().moneySent; as sent) {
        @if (sent.whishName && sent.whishNumber) {
          <p class="sent" i18n>
            {{ firstName() }} says they sent it from <span dir="auto">{{ sent.whishName }}</span
            >, <span class="number" dir="ltr" translate="no">{{ sent.whishNumber }}</span> on
            {{ sentDay() }}.
          </p>
        } @else {
          <p class="sent" i18n>{{ firstName() }} says they sent it on {{ sentDay() }}.</p>
        }
      }

      <app-field [label]="amountLabel" [errors]="shows('amount') ? errors()['amount'] : null">
        <div class="value-unit">
          <input
            appControl
            name="amount"
            autocomplete="off"
            type="number"
            inputmode="decimal"
            min="0.01"
            step="0.01"
            [value]="prefill()"
            (input)="setAmount($any($event.target).valueAsNumber)"
            (blur)="attempt.touch('amount')"
          />
          <span class="unit">{{ ask().priceCurrency }}</span>
        </div>
      </app-field>

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
          maxlength="200"
          dir="auto"
          [value]="reference()"
          (input)="setReference($any($event.target).value)"
        />
      </app-field>

      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        } @else if (attempt.wasTried() && problemCount() > 0) {
          <ng-container i18n>Check the fields marked above.</ng-container>
        }
      </app-form-summary>
    </form>
    <ng-template appModalFooter>
      <button appButton type="button" variant="text" [disabled]="busy()" (click)="notNow()" i18n>
        Not now
      </button>
      <button appButton type="submit" [attr.form]="formId" [loading]="busy()">
        @if (busy()) {
          <ng-container i18n>Booking…</ng-container>
        } @else {
          <ng-container i18n>Book plan</ng-container>
        }
      </button>
    </ng-template>
  `,
  styles: `
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

    .plan-line {
      font-weight: 600;
    }

    .sent {
      background: var(--tb-surface-2);
      border-radius: var(--tb-radius-control);
      padding: 0.75rem 0.875rem;
    }

    .number {
      font-variant-numeric: tabular-nums;
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
  `,
})
export class HousePlanBook {
  private readonly api = inject(HousePlanAsksApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly locale = inject(LOCALE_ID);
  private readonly intent = new IntentIdempotencyKey();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly summary = viewChild.required(FormSummary);

  readonly clientId = input.required<string>();
  readonly ask = input.required<HousePlanAsk>();
  readonly firstName = input.required<string>();
  /** True when the plan was booked. */
  readonly closed = output<boolean>();
  readonly dirtyChange = output<boolean>();
  /** Whether the booking is on its way, so the sheet is not closed under it and its answer is kept. */
  readonly busyChange = output<boolean>();
  /** The ask was booked or closed meanwhile: the page's asks are out of date. */
  readonly stale = output<void>();

  protected readonly attempt = new FormAttempt();
  protected readonly formId = modalFormId('house-plan-book');
  protected readonly amountLabel = $localize`Amount received`;
  protected readonly referenceLabel = $localize`Reference (optional)`;
  protected readonly referenceHelp = $localize`The Whish transaction number, to find it later.`;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Starts at the price asked for, which is the one figure the server books. */
  protected readonly amount = linkedSignal<number | null>(() => this.ask().priceAmount);
  /** The field's first figure, "47.50" or "45"; what the staff type then stays as they typed it. */
  protected readonly prefill = computed(() => amountInput(this.ask().priceAmount));
  protected readonly reference = signal('');
  /** The server's word on a field, shown under it until that field is changed. */
  private readonly refused = signal<FieldMessages>({});

  protected readonly errors = computed<FieldMessages>(() => ({
    ...this.refused(),
    ...bookingErrors({ amount: this.amount() }),
  }));
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);

  protected readonly planLine = computed(() => bookingLine(this.ask(), this.locale));
  protected readonly intro = computed(() =>
    bookingIntro(this.ask(), this.firstName(), this.locale),
  );
  protected readonly sentDay = computed(() => {
    const sent = this.ask().moneySent;
    return sent ? shortDate(sent.sentOn, this.locale) : '';
  });

  protected setAmount(value: number): void {
    this.amount.set(Number.isFinite(value) ? value : null);
    this.forget('amount');
    this.dirtyChange.emit(true);
  }

  protected setReference(value: string): void {
    this.reference.set(value);
    this.forget('reference');
    this.dirtyChange.emit(true);
  }

  protected notNow(): void {
    if (!this.busy()) this.closed.emit(false);
  }

  protected shows(field: string): boolean {
    return this.attempt.shows(field, this.errors()[field] ?? []);
  }

  private forget(field: string): void {
    if (!(field in this.refused())) return;
    this.refused.update((current) => {
      const rest = { ...current };
      delete rest[field];
      return rest;
    });
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    return this.scope.run('submit', async (owner) => {
      this.attempt.attempt();
      if (this.problemCount() > 0) {
        this.error.set(null);
        afterNextRender(
          () =>
            this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
          { injector: this.injector },
        );
        return;
      }
      const ask = this.ask();
      const entered = {
        ask: ask.id,
        amount: this.amount()!,
        currencyCode: ask.priceCurrency,
        reference: this.reference().trim() || null,
      };
      // Bound to the whole entry: the same booking again is answered with the first (SUB-020).
      const key = this.intent.forPayload(entered);
      this.setBusy(true);
      this.error.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        await owner.wait(
          firstValueFrom(
            this.api.book(this.clientId(), ask.id, {
              amount: entered.amount,
              currencyCode: entered.currencyCode,
              reference: entered.reference,
              idempotencyKey: key,
            }),
          ),
        );
        this.intent.complete();
        this.closed.emit(true);
      } catch (error) {
        if (!owner.current) return;
        const refusal = bookingRefusal(error, this.firstName());
        if (refusal.field) {
          this.refused.set({ [refusal.field]: [refusal.message] });
        } else {
          this.error.set(refusal.message);
        }
        if (askEnded(error)) this.stale.emit();
        this.summary().focus();
      } finally {
        if (owner.current) this.setBusy(false);
      }
    });
  }

  private setBusy(busy: boolean): void {
    this.busy.set(busy);
    this.busyChange.emit(busy);
  }
}
