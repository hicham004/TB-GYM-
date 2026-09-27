import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  LOCALE_ID,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom, Observable } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { CsrfService } from '../../core/security/csrf.service';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { StatusLabel } from '../../ui/status-label';
import {
  AdminWorkspace,
  AdminWorkspaceDetail,
  BillingInvoice,
  billingStatusLabel,
  billingStatusTone,
  formatDay,
  formatMoney,
  formatMonth,
  invoiceStatusLabel,
  invoiceStatusTone,
  PricePlan,
} from '../billing/billing.models';
import { PlatformAdminApi } from './platform-admin-api';

interface InvoiceAction {
  kind: 'pay' | 'void';
  invoiceId: string;
}

/**
 * Platform billing for the TB Gym platform admin (ADR 0028): every workspace's status, and per
 * workspace its invoices, payments, voids and discounts, plus the versioned price plan.
 *
 * Presentation only. The API authorizes the global role on every request, calculates every amount,
 * refuses a payment that is not the exact total, and keeps every record it replaces.
 */
@Component({
  selector: 'app-platform-admin',
  imports: [ReactiveFormsModule, Button, Control, Field, StatusLabel],
  templateUrl: './platform-admin.html',
  styleUrls: ['./platform-admin.scss', './platform-admin-forms.scss'],
})
export class PlatformAdmin implements OnInit {
  private readonly api = inject(PlatformAdminApi);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly formBuilder = inject(FormBuilder);
  private readonly injector = inject(Injector);
  private readonly detailTitle = viewChild<ElementRef<HTMLElement>>('detailTitle');

  protected readonly workspaces = signal<AdminWorkspace[]>([]);
  protected readonly detail = signal<AdminWorkspaceDetail | null>(null);
  protected readonly plans = signal<PricePlan[]>([]);
  protected readonly currentPlan = computed(
    () => this.plans().find((plan) => plan.isCurrent) ?? null,
  );
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly action = signal<InvoiceAction | null>(null);
  protected readonly statusLabel = billingStatusLabel;
  protected readonly statusTone = billingStatusTone;
  protected readonly invoiceLabel = invoiceStatusLabel;
  protected readonly invoiceTone = invoiceStatusTone;

  protected readonly paymentForm = this.formBuilder.nonNullable.group({
    amount: [0, [Validators.required]],
    reference: ['', [Validators.required, Validators.maxLength(100)]],
    note: ['', [Validators.maxLength(500)]],
  });
  protected readonly voidForm = this.formBuilder.nonNullable.group({
    reason: ['', [Validators.required, Validators.maxLength(500)]],
    reissue: [true],
  });
  protected readonly discountForm = this.formBuilder.nonNullable.group({
    percent: [30, [Validators.required]],
    startsOn: ['', [Validators.required]],
    lastDay: ['', [Validators.required]],
    note: ['Founding coach', [Validators.required, Validators.maxLength(200)]],
  });
  protected readonly planForm = this.formBuilder.nonNullable.group({
    seatPrice: [0, [Validators.required]],
    includedClientsPerSeat: [0, [Validators.required]],
    extraClientPrice: [0, [Validators.required]],
    gymFee: [0, [Validators.required]],
    gymFeeMinimumSeats: [1, [Validators.required]],
    trialDays: [0, [Validators.required]],
    paymentTermDays: [0, [Validators.required]],
    graceDays: [0, [Validators.required]],
    note: ['', [Validators.maxLength(500)]],
  });

  ngOnInit(): void {
    void this.loadAll();
  }

  protected money(amount: number, currencyCode: string): string {
    return formatMoney(amount, currencyCode, this.locale);
  }

  protected day(date: string): string {
    return formatDay(date, this.locale);
  }

  /** A discount's last day, from its half-open end. */
  protected lastDay(endsOnExclusive: string): string {
    return this.day(shiftDate(endsOnExclusive, -1));
  }

  protected month(periodStart: string): string {
    return formatMonth(periodStart, this.locale);
  }

  protected amountHelp(invoice: BillingInvoice): string {
    return $localize`Must be exactly ${this.money(invoice.amounts.total, invoice.amounts.currencyCode)}:total:.`;
  }

  protected isUnpaid(invoice: BillingInvoice): boolean {
    return invoice.status === 'Open' || invoice.status === 'Overdue';
  }

  protected async open(workspace: AdminWorkspace): Promise<void> {
    this.action.set(null);
    this.error.set(null);
    this.notice.set(null);
    await this.loadDetail(workspace.tenantId);
    if (this.detail()?.summary.tenantId === workspace.tenantId) {
      afterNextRender(() => this.revealDetail(), { injector: this.injector });
    }
  }

  /** The detail renders below the whole list, so bring it into view and move focus to its title. */
  private revealDetail(): void {
    const title = this.detailTitle()?.nativeElement;
    if (!title) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    title.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    title.focus({ preventScroll: true });
  }

  protected startAction(kind: InvoiceAction['kind'], invoice: BillingInvoice): void {
    this.action.set({ kind, invoiceId: invoice.id });
    this.paymentForm.reset({ amount: invoice.amounts.total, reference: '', note: '' });
    this.voidForm.reset({ reason: '', reissue: true });
  }

  protected cancelAction(): void {
    this.action.set(null);
  }

  protected issueInvoices(): Promise<void> {
    return this.run(async () => {
      const run = await firstValueFrom(this.api.issueInvoices());
      this.notice.set(
        $localize`Invoices for ${this.month(run.periodStart)}:month:: ${run.issued}:issued: issued, ${run.alreadyIssued}:already: already issued, ${run.inTrial}:trial: in trial.`,
      );
      await this.loadAll();
    });
  }

  protected recordPayment(invoice: BillingInvoice): Promise<void> {
    const value = this.paymentForm.getRawValue();
    return this.run(async () => {
      await firstValueFrom(
        this.api.recordPayment(
          invoice.id,
          Number(value.amount),
          value.reference.trim(),
          value.note.trim() || null,
        ),
      );
      this.notice.set($localize`Payment recorded for ${invoice.referenceCode}:reference:.`);
      await this.afterChange();
    });
  }

  protected voidInvoice(invoice: BillingInvoice): Promise<void> {
    const value = this.voidForm.getRawValue();
    return this.run(async () => {
      await firstValueFrom(this.api.voidInvoice(invoice.id, value.reason.trim(), value.reissue));
      this.notice.set(
        value.reissue
          ? $localize`${invoice.referenceCode}:reference: was voided and reissued.`
          : $localize`${invoice.referenceCode}:reference: was voided.`,
      );
      await this.afterChange();
    });
  }

  protected grantDiscount(tenantId: string): Promise<void> {
    const value = this.discountForm.getRawValue();
    return this.run(async () => {
      await firstValueFrom(
        this.api.grantDiscount(
          tenantId,
          Number(value.percent),
          value.startsOn,
          shiftDate(value.lastDay, 1),
          value.note.trim(),
        ),
      );
      this.notice.set($localize`Discount granted.`);
      await this.afterChange();
    });
  }

  protected revokeDiscount(discountId: string): Promise<void> {
    return this.run(async () => {
      await firstValueFrom(this.api.revokeDiscount(discountId));
      this.notice.set($localize`Discount revoked.`);
      await this.afterChange();
    });
  }

  protected publishPlan(): Promise<void> {
    const value = this.planForm.getRawValue();
    const current = this.currentPlan();
    return this.run(async () => {
      const plan = await firstValueFrom(
        this.api.publishPricePlan({
          seatPrice: Number(value.seatPrice),
          includedClientsPerSeat: Number(value.includedClientsPerSeat),
          extraClientPrice: Number(value.extraClientPrice),
          gymFee: Number(value.gymFee),
          gymFeeMinimumSeats: Number(value.gymFeeMinimumSeats),
          trialDays: Number(value.trialDays),
          paymentTermDays: Number(value.paymentTermDays),
          graceDays: Number(value.graceDays),
          expectedCurrentVersion: current?.versionNumber ?? 0,
          note: value.note.trim() || null,
        }),
      );
      this.notice.set(
        $localize`Price plan version ${plan.versionNumber}:version: is published. New invoices use it; issued ones keep theirs.`,
      );
      await this.loadAll();
    });
  }

  private async run(work: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await this.csrf.refresh();
      await work();
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`That did not work. Refresh and try again.`));
    } finally {
      this.busy.set(false);
    }
  }

  private async afterChange(): Promise<void> {
    this.action.set(null);
    const tenantId = this.detail()?.summary.tenantId;
    await this.loadWorkspaces();
    if (tenantId) await this.loadDetail(tenantId);
  }

  private async loadAll(): Promise<void> {
    this.loading.set(true);
    try {
      await Promise.all([this.loadWorkspaces(), this.loadPlans()]);
      const selected = this.detail()?.summary.tenantId;
      if (selected) await this.loadDetail(selected);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`Platform billing could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadWorkspaces(): Promise<void> {
    this.workspaces.set(await firstValueFrom(this.api.getWorkspaces()));
  }

  private async loadPlans(): Promise<void> {
    const plans = await firstValueFrom(this.api.getPricePlans());
    this.plans.set(plans);
    const current = plans.find((plan) => plan.isCurrent);
    if (current) {
      this.planForm.reset({
        seatPrice: current.seatPrice,
        includedClientsPerSeat: current.includedClientsPerSeat,
        extraClientPrice: current.extraClientPrice,
        gymFee: current.gymFee,
        gymFeeMinimumSeats: current.gymFeeMinimumSeats,
        trialDays: current.trialDays,
        paymentTermDays: current.paymentTermDays,
        graceDays: current.graceDays,
        note: '',
      });
    }
  }

  private async loadDetail(tenantId: string): Promise<void> {
    await this.load(this.api.getWorkspace(tenantId), (detail) => this.detail.set(detail));
  }

  private async load<T>(request: Observable<T>, apply: (value: T) => void): Promise<void> {
    try {
      apply(await firstValueFrom(request));
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`That workspace could not be loaded.`));
    }
  }
}

/** Moves a `YYYY-MM-DD` calendar date by whole days, in UTC so no time zone shifts it. */
export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
