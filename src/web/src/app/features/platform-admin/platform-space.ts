import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  LOCALE_ID,
  signal,
  TemplateRef,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { CsrfService } from '../../core/security/csrf.service';
import { initialsOf } from '../../shell/initials';
import { Avatar } from '../../ui/avatar';
import { Button } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { UiDialog } from '../../ui/dialog';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { UiSheet } from '../../ui/sheet';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { UiToast } from '../../ui/toast';
import {
  billingStatusLabel,
  billingStatusTone,
  billLines,
  formatDay,
  formatMoney,
  formatMonth,
  invoicePrices,
  invoiceStatusLabel,
  invoiceStatusTone,
  isUnpaid,
  type AdminWorkspaceDetail,
  type BillingDiscount,
  type BillingInvoice,
} from '../billing/billing.models';
import { PlatformAdminApi } from './platform-admin-api';
import {
  discountLastDay,
  discountState,
  invoiceUsage,
  invoiceWhen,
  nextLine,
  sortInvoices,
  statusSentence,
  utcToday,
  type DiscountState,
} from './platform-admin.models';
import { PlatformDiscount, PlatformPayment, PlatformVoid } from './platform-sheets';

type SheetKind = 'payment' | 'void' | 'discount';

/**
 * One coaching space in platform billing (R5.2b, ADR 0028): where it stands, this month so far, its
 * invoices with the two things an admin does to an unpaid one, and its discounts. Everything the
 * admin changes is a sheet; the API works out every amount and refuses what is not allowed, and a
 * paid or voided invoice is never altered.
 */
@Component({
  selector: 'app-platform-space',
  imports: [
    Avatar,
    Button,
    EmptyState,
    Icon,
    PlatformDiscount,
    PlatformPayment,
    PlatformVoid,
    RouterLink,
    Skeleton,
    StatusPill,
    UiConfirm,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './platform-space.html',
  styleUrl: './platform-space.scss',
})
export class PlatformSpace {
  private readonly api = inject(PlatformAdminApi);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly sheets = inject(UiSheet);
  private readonly dialogs = inject(UiDialog);
  private readonly toast = inject(UiToast);
  private readonly injector = inject(Injector);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly paymentSheet = viewChild.required<TemplateRef<unknown>>('paymentSheet');
  private readonly voidSheet = viewChild.required<TemplateRef<unknown>>('voidSheet');
  private readonly discountSheet = viewChild.required<TemplateRef<unknown>>('discountSheet');
  private readonly confirmDialog = viewChild.required<TemplateRef<unknown>>('confirmDialog');
  private openSheet: { close: () => void } | null = null;
  private sheetDirty = false;
  /** Bumped by every load, so an answer for a space the admin has since left is dropped. */
  private loads = 0;

  private readonly tenantId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('tenantId'))),
    { initialValue: null },
  );

  protected readonly closeLabel = $localize`Close`;
  protected readonly loadingLabel = $localize`Loading this coaching space…`;
  protected readonly today = utcToday();

  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly detail = signal<AdminWorkspaceDetail | null>(null);
  /** The invoice a sheet is about. */
  protected readonly subject = signal<BillingInvoice | null>(null);
  protected readonly asking = signal<{ message: string; confirm: string; cancel: string } | null>(
    null,
  );
  protected readonly busy = signal<string | null>(null);

  protected readonly summary = computed(() => this.detail()?.summary ?? null);
  protected readonly invoices = computed(() => sortInvoices(this.detail()?.invoices ?? []));
  protected readonly owes = computed(() => (this.summary()?.unpaidTotal ?? 0) > 0);
  protected readonly initials = computed(() => {
    const summary = this.summary();
    return summary ? initialsOf(summary.name, summary.ownerEmail) : '';
  });
  protected readonly sentence = computed(() => {
    const summary = this.summary();
    return summary ? statusSentence(summary, this.today, this.locale) : '';
  });
  protected readonly next = computed(() => {
    const summary = this.summary();
    return summary ? nextLine(summary, this.today, this.locale) : '';
  });
  protected readonly mailto = computed(() => {
    const summary = this.summary();
    return summary ? `mailto:${summary.ownerEmail}` : null;
  });
  protected readonly monthLines = computed(() => {
    const detail = this.detail();
    return detail ? billLines(detail.currentMonth.amounts, this.locale) : [];
  });
  protected readonly monthTitle = computed(() => {
    const detail = this.detail();
    return detail
      ? $localize`${formatMonth(detail.currentMonth.periodStart, this.locale)}:month: so far`
      : '';
  });
  protected readonly discounts = computed(() =>
    (this.detail()?.discounts ?? []).map((discount) => ({
      discount,
      state: discountState(discount, this.today),
      last: discountLastDay(discount),
    })),
  );

  protected readonly statusLabel = billingStatusLabel;
  protected readonly statusTone = billingStatusTone;
  protected readonly invoiceLabel = invoiceStatusLabel;
  protected readonly invoiceTone = invoiceStatusTone;
  protected readonly isUnpaid = isUnpaid;
  protected readonly invoiceWhen = (invoice: BillingInvoice) => invoiceWhen(invoice, this.locale);
  protected readonly invoiceUsage = invoiceUsage;
  protected readonly invoiceLines = (invoice: BillingInvoice) =>
    billLines(invoice.amounts, this.locale, invoicePrices(invoice));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.openSheet?.close());
    effect(() => {
      const id = this.tenantId();
      if (id) untracked(() => void this.load(id));
    });
  }

  protected async load(id: string | null = this.tenantId()): Promise<void> {
    if (!id) return;
    const mine = ++this.loads;
    const arriving = this.detail()?.summary.tenantId !== id;
    if (arriving) {
      this.detail.set(null);
      this.state.set('loading');
    }
    try {
      const detail = await firstValueFrom(this.api.getWorkspace(id));
      if (mine !== this.loads) return;
      this.detail.set(detail);
      this.state.set('ready');
      // The heading appears with the data, so a screen reader starts at it once it is there (§9).
      if (arriving) {
        afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }), {
          injector: this.injector,
        });
      }
    } catch (error) {
      if (mine !== this.loads) return;
      this.state.set(
        error instanceof HttpErrorResponse && error.status === 404 ? 'missing' : 'error',
      );
    }
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

  protected discountStateLabel(state: DiscountState): string {
    switch (state) {
      case 'running':
        return $localize`Running now`;
      case 'upcoming':
        return $localize`Starts later`;
      case 'ended':
        return $localize`Ended`;
      default:
        return $localize`Revoked`;
    }
  }

  protected discountTone(state: DiscountState): 'success' | 'info' | 'neutral' {
    return state === 'running' ? 'success' : state === 'upcoming' ? 'info' : 'neutral';
  }

  protected referenceOf(id: string | null): string | null {
    return this.detail()?.invoices.find((invoice) => invoice.id === id)?.referenceCode ?? null;
  }

  // ---------- the sheets ----------

  protected recordPayment(invoice: BillingInvoice): void {
    this.subject.set(invoice);
    this.open('payment', $localize`Record payment`, (done) => {
      if (done) {
        this.toast.show($localize`Payment recorded for ${invoice.referenceCode}:reference:.`, {
          tone: 'success',
        });
      }
    });
  }

  protected voidInvoice(invoice: BillingInvoice): void {
    this.subject.set(invoice);
    this.open('void', $localize`Void invoice`, (done) => {
      if (done)
        this.toast.show($localize`${invoice.referenceCode}:reference: was voided.`, {
          tone: 'success',
        });
    });
  }

  protected grantDiscount(): void {
    this.open('discount', $localize`Grant a discount`, (done) => {
      if (done) this.toast.show($localize`Discount granted.`, { tone: 'success' });
    });
  }

  protected async revokeDiscount(discount: BillingDiscount): Promise<void> {
    if (this.busy()) return;
    const yes = await this.ask(
      $localize`Revoke the ${discount.percent}:percent:% discount (${this.day(discount.startsOn)}:from: to ${this.day(discountLastDay(discount))}:to:)? Invoices already issued keep it; invoices from now on will not have it.`,
      $localize`Revoke discount`,
      $localize`Keep it`,
      $localize`Revoke this discount?`,
    );
    if (!yes) return;
    this.busy.set(discount.id);
    try {
      await this.csrf.refresh();
      await firstValueFrom(this.api.revokeDiscount(discount.id));
      this.toast.show($localize`Discount revoked.`, { tone: 'success' });
    } catch (error) {
      this.toast.show(apiErrorMessage(error, $localize`The discount could not be revoked.`), {
        tone: 'error',
      });
    } finally {
      this.busy.set(null);
      await this.load();
    }
  }

  protected setDirty(dirty: boolean): void {
    this.sheetDirty = dirty;
  }

  private open(kind: SheetKind, title: string, finished: (done: boolean) => void): void {
    this.sheetDirty = false;
    this.openSheet?.close();
    const template =
      kind === 'payment'
        ? this.paymentSheet()
        : kind === 'void'
          ? this.voidSheet()
          : this.discountSheet();
    const sheet = this.sheets.open<boolean>(template, {
      title,
      closeLabel: this.closeLabel,
      canClose: () =>
        !this.sheetDirty ||
        this.ask(
          $localize`Close without saving? What you typed will be lost.`,
          $localize`Discard`,
          $localize`Keep editing`,
          $localize`Discard what you typed?`,
        ),
    });
    this.openSheet = sheet;
    sheet.closed.subscribe((done) => {
      if (this.openSheet === sheet) this.openSheet = null;
      finished(done === true);
      // Whatever happened, show the space as it is now: a refused payment may mean it changed.
      void this.load();
    });
  }

  private async ask(
    message: string,
    confirm: string,
    cancel: string,
    title: string,
  ): Promise<boolean> {
    this.asking.set({ message, confirm, cancel });
    const dialog = this.dialogs.open<boolean>(this.confirmDialog(), {
      title,
      closeLabel: this.closeLabel,
    });
    const answer = await firstValueFrom(dialog.closed);
    this.asking.set(null);
    return answer === true;
  }
}
