import type { DialogRef } from '@angular/cdk/dialog';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  LOCALE_ID,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { whatsAppLink } from '../../core/website/website-settings';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { Icon } from '../../ui/icon';
import type { ModalSurface } from '../../ui/modal-surface';
import { UiSheet } from '../../ui/sheet';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { UiToast } from '../../ui/toast';
import { SettingsFrame } from '../settings/settings-frame';
import { BillingApi } from './billing-api';
import {
  billingStatusLabel,
  billingStatusTone,
  billLines,
  type BillingInvoice,
  formatDay,
  formatMoney,
  formatMonth,
  invoicePrices,
  invoiceStatusLabel,
  invoiceStatusTone,
  isUnpaid,
  type WorkspaceBilling,
} from './billing.models';

/**
 * Settings › Billing (C9, R5.2a; ADR 0028): what this coaching space pays TB Gym. The state of the
 * bill and what is owed come first, then how to pay with each reference one tap from the clipboard,
 * this month so far, and a clean list of invoices that each open in a sheet with their lines.
 *
 * Presentation only: the API works out every number and shows the bill to the owner alone. It keeps
 * TB Gym's own colours whatever the coach's brand (plan §3.1).
 */
@Component({
  selector: 'app-billing',
  imports: [Button, Icon, SettingsFrame, Skeleton, StatusPill],
  templateUrl: './billing.html',
  styleUrl: './billing.scss',
})
export class Billing {
  private readonly api = inject(BillingApi);
  private readonly locale = inject(LOCALE_ID);
  private readonly tenants = inject(TenantStore);
  private readonly sheets = inject(UiSheet);
  private readonly toast = inject(UiToast);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly invoiceSheet = viewChild.required<TemplateRef<unknown>>('invoiceSheet');
  private loadedTenant: string | null = null;
  private openSheet: DialogRef<unknown, ModalSurface> | null = null;

  protected readonly closeLabel = $localize`Close`;
  protected readonly loadingLabel = $localize`Loading billing…`;
  protected readonly billing = signal<WorkspaceBilling | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  /** The invoice open in the sheet. */
  protected readonly shown = signal<BillingInvoice | null>(null);

  protected readonly unpaid = computed(() => (this.billing()?.invoices ?? []).filter(isUnpaid));
  protected readonly monthLines = computed(() => {
    const billing = this.billing();
    return billing ? billLines(billing.currentMonth.amounts, this.locale) : [];
  });
  protected readonly shownLines = computed(() => {
    const invoice = this.shown();
    return invoice ? billLines(invoice.amounts, this.locale, invoicePrices(invoice)) : [];
  });
  /**
   * How to ask TB Gym for the payment details while no Whish number is set (audit BILL-2): its
   * support inbox and WhatsApp number, or null when this server has neither.
   */
  protected readonly payContacts = computed(() => {
    const billing = this.billing();
    const href = whatsAppLink(billing?.whatsAppNumber ?? null);
    const email = billing?.supportEmail ?? null;
    const whatsApp =
      href && billing?.whatsAppNumber ? { href, number: billing.whatsAppNumber } : null;
    return email || whatsApp ? { email, whatsApp } : null;
  });

  protected readonly statusLabel = billingStatusLabel;
  protected readonly statusTone = billingStatusTone;
  protected readonly invoiceLabel = invoiceStatusLabel;
  protected readonly invoiceTone = invoiceStatusTone;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.openSheet?.close());
    this.scope.onReset(() => {
      this.loadedTenant = null;
      this.openSheet?.close();
      this.billing.set(null);
      this.state.set('loading');
    });
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenant) {
        this.loadedTenant = tenantId;
        void this.load();
      }
    });
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.state.set('loading');
      try {
        this.billing.set(await owner.wait(firstValueFrom(this.api.getWorkspaceBilling())));
        this.state.set('ready');
      } catch {
        if (!owner.current) return;
        this.state.set('error');
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

  /** One plain sentence for the bill's state, naming the next date that matters. */
  protected statusSentence(billing: WorkspaceBilling): string {
    switch (billing.status) {
      case 'Trial':
        return $localize`Your free trial runs until ${this.day(billing.trialEndsAtUtc)}:date:. Nothing is charged for it, and your first invoice comes the month after.`;
      case 'Overdue':
        return billing.readOnlyFrom
          ? $localize`An invoice is overdue. Pay it before ${this.day(billing.readOnlyFrom)}:date: to keep editing; after that your coaching space is read-only for you and your coaches until it is paid. Your clients keep full use.`
          : $localize`An invoice is overdue. Pay it to keep editing.`;
      case 'ReadOnly':
        return $localize`Your coaching space is read-only for you and your coaches until the overdue invoice is paid. Your clients keep full use, and nothing is deleted.`;
      default:
        return this.unpaid().length > 0
          ? $localize`A new invoice is waiting. Pay it by its due date below.`
          : $localize`You’re all paid up. An invoice comes on the 1st of each month for the month before.`;
    }
  }

  /** The line under an invoice in the list: its reference and what happens next. */
  protected invoiceDetail(invoice: BillingInvoice): string {
    switch (invoice.status) {
      case 'Open':
        return $localize`${invoice.referenceCode}:reference: · due ${this.day(invoice.dueOn)}:date:`;
      case 'Overdue':
        return $localize`${invoice.referenceCode}:reference: · was due ${this.day(invoice.dueOn)}:date:`;
      case 'Paid':
        return invoice.payment
          ? $localize`${invoice.referenceCode}:reference: · paid ${this.day(invoice.payment.receivedOn)}:date:`
          : invoice.referenceCode;
      case 'Void':
        return $localize`${invoice.referenceCode}:reference: · replaced, nothing to pay`;
      default:
        return invoice.referenceCode;
    }
  }

  protected openInvoice(invoice: BillingInvoice): void {
    this.shown.set(invoice);
    this.openSheet?.close();
    const sheet = this.sheets.open(this.invoiceSheet(), {
      title: $localize`${this.month(invoice.periodStart)}:month: invoice`,
      closeLabel: this.closeLabel,
    });
    this.openSheet = sheet;
    sheet.closed.subscribe(() => {
      if (this.openSheet === sheet) this.openSheet = null;
    });
  }

  /** Opens the invoice another one replaced or was replaced by, in the same sheet. */
  protected openLinked(id: string | null): void {
    const invoice = this.billing()?.invoices.find((item) => item.id === id);
    if (invoice) this.openInvoice(invoice);
  }

  protected async copy(value: string, what: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.toast.show($localize`${what}:what: copied.`, { tone: 'success' });
    } catch {
      this.toast.show($localize`Couldn’t copy. Select it and copy it yourself.`, { tone: 'error' });
    }
  }

  protected readonly referenceWord = $localize`Reference`;
  protected readonly whishWord = $localize`Whish number`;
}
