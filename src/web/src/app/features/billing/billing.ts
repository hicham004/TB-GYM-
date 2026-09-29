import { Component, computed, effect, inject, LOCALE_ID, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { SectionNav } from '../../ui/section-nav';
import { StatusLabel } from '../../ui/status-label';
import { SETTINGS_SECTIONS } from '../workspace/settings-sections';
import { BillingApi } from './billing-api';
import {
  BillingAmounts,
  billingStatusLabel,
  billingStatusTone,
  formatDay,
  formatMoney,
  formatMonth,
  invoiceStatusLabel,
  invoiceStatusTone,
  WorkspaceBilling,
} from './billing.models';

/**
 * Settings / Billing (ADR 0028): what this workspace owes TB Gym. This month so far, past invoices and
 * how to pay. Presentation only: the API calculates every number and shows the bill to the owner alone.
 */
@Component({
  selector: 'app-billing',
  imports: [SectionNav, StatusLabel],
  templateUrl: './billing.html',
  styleUrl: './billing.scss',
})
export class Billing {
  private readonly api = inject(BillingApi);
  private readonly locale = inject(LOCALE_ID);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedTenant: string | null = null;

  protected readonly sections = SETTINGS_SECTIONS;
  protected readonly billing = signal<WorkspaceBilling | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly unpaid = computed(() =>
    (this.billing()?.invoices ?? []).filter(
      (invoice) => invoice.status === 'Open' || invoice.status === 'Overdue',
    ),
  );
  protected readonly statusLabel = billingStatusLabel;
  protected readonly statusTone = billingStatusTone;
  protected readonly invoiceLabel = invoiceStatusLabel;
  protected readonly invoiceTone = invoiceStatusTone;

  constructor() {
    this.scope.onReset(() => {
      this.loadedTenant = null;
      this.billing.set(null);
      this.error.set(null);
      this.loading.set(false);
    });
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenant) {
        this.loadedTenant = tenantId;
        void this.load();
      }
    });
  }

  protected money(amount: number, currencyCode: string): string {
    return formatMoney(amount, currencyCode, this.locale);
  }

  protected day(date: string): string {
    return formatDay(date, this.locale);
  }

  protected month(periodStart: string): string {
    return formatMonth(periodStart, this.locale);
  }

  /** A plain sentence for the workspace's state, naming the next date that matters. */
  protected statusSentence(billing: WorkspaceBilling): string {
    switch (billing.status) {
      case 'Trial':
        return $localize`Your free trial runs until ${this.day(billing.trialEndsAtUtc)}:date:. Nothing is charged for it.`;
      case 'Overdue':
        return billing.readOnlyFrom
          ? $localize`An invoice is overdue. Pay it before ${this.day(billing.readOnlyFrom)}:date: to keep editing. After that, your coaching space is read-only for you and your coaches until it is paid.`
          : $localize`An invoice is overdue.`;
      case 'ReadOnly':
        return $localize`Your coaching space is read-only for you and your coaches until the overdue invoice is paid. Your clients keep full access, and nothing is deleted.`;
      default:
        return $localize`Your coaching space is billed monthly, for the previous month.`;
    }
  }

  protected hasDiscount(amounts: BillingAmounts): boolean {
    return amounts.discountAmount > 0;
  }

  private async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.loading.set(true);
      this.error.set(null);
      try {
        const billing = await owner.wait(firstValueFrom(this.api.getWorkspaceBilling()));
        this.billing.set(billing);
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`Billing could not be loaded.`));
      } finally {
        if (owner.current) this.loading.set(false);
      }
    });
  }
}
