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
  clientsLine,
  formatDay,
  formatMoney,
  formatMonth,
  includedSources,
  invoicePrices,
  invoiceStatusLabel,
  invoiceStatusTone,
  isUnpaid,
  type AdminWorkspaceDetail,
  type BillingClientGrant,
  type BillingDiscount,
  type BillingInvoice,
} from '../billing/billing.models';
import {
  adminProgressLine,
  clientCount,
  currentFoundingTerms,
  FOUNDING_COACH,
  foundingSeatLine,
  type AdminFounding,
  type FoundingRecord,
  type FoundingTerms,
} from '../billing/founding.models';
import { PlatformAdminApi } from './platform-admin-api';
import { PlatformFoundingApi } from './platform-founding-api';
import { PlatformFoundingEnd, PlatformFoundingMark } from './platform-founding-sheets';
import {
  discountLastDay,
  discountState,
  invoiceUsage,
  invoiceWhen,
  nextLine,
  revokeGrantQuestion,
  sortInvoices,
  statusSentence,
  utcToday,
  type DiscountState,
} from './platform-admin.models';
import {
  PlatformClientGrant,
  PlatformDiscount,
  PlatformPayment,
  PlatformVoid,
} from './platform-sheets';

type SheetKind = 'payment' | 'void' | 'discount' | 'grant-clients' | 'mark' | 'end';

/**
 * One coaching space in platform billing (R5.2b, ADR 0028): where it stands, whether it is a founding
 * space (notes plan N3b) and what its owner's seat includes then (N11b), this month so far, its
 * invoices with the two things an admin does to an unpaid one, its discounts, and the extra included
 * clients granted to a founding space (N11b). Everything the admin changes is a sheet; the API works
 * out every amount, reads the Founding coach badge and refuses what is not allowed, and a paid or
 * voided invoice is never altered, nor an ended founding status.
 */
@Component({
  selector: 'app-platform-space',
  imports: [
    Avatar,
    Button,
    EmptyState,
    Icon,
    PlatformClientGrant,
    PlatformDiscount,
    PlatformFoundingEnd,
    PlatformFoundingMark,
    PlatformPayment,
    PlatformVoid,
    RouterLink,
    Skeleton,
    StatusPill,
    UiConfirm,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './platform-space.html',
  styleUrls: ['./platform-space.scss', './platform-space-founding.scss'],
})
export class PlatformSpace {
  private readonly api = inject(PlatformAdminApi);
  private readonly foundingApi = inject(PlatformFoundingApi);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly sheets = inject(UiSheet);
  private readonly dialogs = inject(UiDialog);
  private readonly toast = inject(UiToast);
  private readonly injector = inject(Injector);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly foundingHeading = viewChild<ElementRef<HTMLElement>>('foundingHeading');
  private readonly grantsHeading = viewChild<ElementRef<HTMLElement>>('grantsHeading');
  private readonly paymentSheet = viewChild.required<TemplateRef<unknown>>('paymentSheet');
  private readonly voidSheet = viewChild.required<TemplateRef<unknown>>('voidSheet');
  private readonly discountSheet = viewChild.required<TemplateRef<unknown>>('discountSheet');
  private readonly clientGrantSheet = viewChild.required<TemplateRef<unknown>>('clientGrantSheet');
  private readonly markSheet = viewChild.required<TemplateRef<unknown>>('markSheet');
  private readonly endSheet = viewChild.required<TemplateRef<unknown>>('endSheet');
  private readonly confirmDialog = viewChild.required<TemplateRef<unknown>>('confirmDialog');
  private openSheet: { close: () => void } | null = null;
  /** Set when the page goes, so an answer that lands after it opens nothing. */
  private destroyed = false;
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
  /** The terms in force when the mark sheet opened, for its sentence; null when unreadable. */
  protected readonly markTerms = signal<FoundingTerms | null>(null);
  /** The clients the price plan in force includes with a seat, for the same; null when unreadable. */
  protected readonly markPlanSeat = signal<number | null>(null);
  /** The open founding status the end sheet is about. */
  protected readonly ending = signal<FoundingRecord | null>(null);

  protected readonly summary = computed(() => this.detail()?.summary ?? null);
  /** The open founding status with the server's reading of its badge, or null. */
  protected readonly founding = computed(() => this.detail()?.founding ?? null);
  /** Ended founding statuses, as the server orders them: the latest ended first. */
  protected readonly foundingHistory = computed(() => this.detail()?.foundingHistory ?? []);
  protected readonly foundingCoach = FOUNDING_COACH;
  protected readonly progress = adminProgressLine;
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
  /** Extra included clients, newest first as the server sends them, revoked ones kept (N11b). */
  protected readonly grants = computed(() =>
    (this.detail()?.includedClientGrants ?? []).map((grant) => ({
      grant,
      state: discountState(grant, this.today),
      last: discountLastDay(grant),
    })),
  );
  /** A space never founding and never granted shows no panel, so it looks as it did before. */
  protected readonly showsGrants = computed(
    () => this.founding() !== null || this.grants().length > 0,
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
  protected readonly clientCount = clientCount;
  protected readonly seatLine = (open: AdminFounding) =>
    foundingSeatLine(open.foundingSeatIncludedClients);

  /**
   * The invoice's clients line as its owner reads it, when a founding seat or a grant counted, so the
   * admin sees where its included clients came from; null for a plain invoice, which shows as before.
   */
  protected includedNote(invoice: BillingInvoice): string | null {
    return includedSources(invoice.amounts) === null
      ? null
      : clientsLine(invoice.amounts, this.locale, invoicePrices(invoice));
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.openSheet?.close();
    });
    effect(() => {
      const id = this.tenantId();
      if (id) untracked(() => void this.load(id));
    });
  }

  /** Reads the space again; true when this read's answer is the one on screen now. */
  protected async load(id: string | null = this.tenantId()): Promise<boolean> {
    if (!id) return false;
    const mine = ++this.loads;
    const arriving = this.detail()?.summary.tenantId !== id;
    if (arriving) {
      this.detail.set(null);
      this.state.set('loading');
    }
    try {
      const detail = await firstValueFrom(this.api.getWorkspace(id));
      if (mine !== this.loads) return false;
      this.detail.set(detail);
      this.state.set('ready');
      // The heading appears with the data, so a screen reader starts at it once it is there (§9).
      if (arriving) {
        afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }), {
          injector: this.injector,
        });
      }
      return true;
    } catch (error) {
      if (mine !== this.loads) return false;
      this.state.set(
        error instanceof HttpErrorResponse && error.status === 404 ? 'missing' : 'error',
      );
      return false;
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

  /** "Badge earned <day>", and that the coach hides it when they do. */
  protected earnedLine(open: AdminFounding): string {
    const day = this.day(open.badge.earnedOn ?? open.status.earnedOn ?? open.status.markedAtUtc);
    return open.badge.hidden
      ? $localize`Badge earned ${day}:day: · Hidden by the coach`
      : $localize`Badge earned ${day}:day:`;
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

  // ---------- extra included clients (notes plan N11b) ----------

  protected grantClients(): void {
    this.open('grant-clients', $localize`Grant extra clients`, (done) => {
      if (done) this.toast.show($localize`Extra clients granted.`, { tone: 'success' });
    });
  }

  protected async revokeClientGrant(grant: BillingClientGrant): Promise<void> {
    if (this.busy()) return;
    // The row's Revoke goes once the grant is revoked; the panel's heading then takes its focus.
    const trigger = document.activeElement;
    const question = revokeGrantQuestion(
      grant.clients,
      this.day(grant.startsOn),
      this.day(discountLastDay(grant)),
    );
    const yes = await this.ask(question.message, question.confirm, question.cancel, question.title);
    if (!yes) return;
    this.busy.set(grant.id);
    try {
      await this.csrf.refresh();
      await firstValueFrom(this.api.revokeIncludedClientGrant(grant.id));
      this.toast.show($localize`Extra clients revoked.`, { tone: 'success' });
    } catch (error) {
      this.toast.show(apiErrorMessage(error, $localize`The extra clients could not be revoked.`), {
        tone: 'error',
      });
    } finally {
      this.busy.set(null);
      await this.load();
      this.refocus(trigger, this.grantsHeading);
    }
  }

  // ---------- the founding status (notes plan N3b, PBL-009) ----------

  /**
   * Reads the terms in force and the price plan's seat for the sheet's sentences, then opens it; it
   * opens without them too.
   */
  protected async markFounding(): Promise<void> {
    if (this.busy()) return;
    this.busy.set('founding-mark');
    let terms: FoundingTerms | null = null;
    let planSeat: number | null = null;
    try {
      // Either read may fail: the sheet then says less, and the server still decides.
      [terms, planSeat] = await Promise.all([
        firstValueFrom(this.foundingApi.getFoundingTerms())
          .then(currentFoundingTerms)
          .catch(() => null),
        firstValueFrom(this.api.getPricePlans())
          .then((plans) => plans.find((plan) => plan.isCurrent)?.includedClientsPerSeat ?? null)
          .catch(() => null),
      ]);
    } catch {
      // Neither read rejects; a call that throws before reading leaves both unknown.
    } finally {
      this.busy.set(null);
    }
    // The read took a moment: the admin may have left the page, or opened another sheet that holds
    // what they typed, which this one must not close without asking.
    if (this.destroyed || this.openSheet) return;
    this.markTerms.set(terms);
    this.markPlanSeat.set(planSeat);
    this.open('mark', $localize`Mark as founding`, (done) => {
      if (done) this.toast.show($localize`Marked as founding.`, { tone: 'success' });
    });
  }

  /**
   * Asks the server to look at every waiting badge now, as its billing sweep does on its own, then
   * says what it found for this space from the page read again, never from the platform's counts.
   */
  protected async checkFounding(): Promise<void> {
    if (this.busy()) return;
    this.busy.set('founding-check');
    try {
      await this.csrf.refresh();
      await firstValueFrom(this.foundingApi.checkFounding());
    } catch (error) {
      this.toast.show(
        apiErrorMessage(error, $localize`The badge could not be checked. Try again.`),
        {
          tone: 'error',
        },
      );
      this.busy.set(null);
      await this.load();
      return;
    }
    const fresh = await this.load();
    this.busy.set(null);
    if (!fresh) {
      // The page did not read this space again, so it says nothing about its badge.
      this.toast.show(
        $localize`The check ran, but this space couldn’t be read again. Read it again to see its badge.`,
      );
    } else if (this.founding()?.badge.state === 'Earned') {
      this.toast.show($localize`Checked: the Founding coach badge is earned.`, { tone: 'success' });
      // Check now goes with the waiting badge it checked.
      this.keepFocus();
    } else {
      this.toast.show($localize`Checked: not earned yet.`);
    }
  }

  protected endFounding(): void {
    const open = this.founding();
    if (!open || this.busy()) return;
    this.ending.set(open.status);
    this.open('end', $localize`End founding status`, (done) => {
      if (done) this.toast.show($localize`Founding status ended.`, { tone: 'success' });
    });
  }

  protected setDirty(dirty: boolean): void {
    this.sheetDirty = dirty;
  }

  private open(kind: SheetKind, title: string, finished: (done: boolean) => void): void {
    this.sheetDirty = false;
    this.openSheet?.close();
    const templates: Record<SheetKind, TemplateRef<unknown>> = {
      payment: this.paymentSheet(),
      void: this.voidSheet(),
      discount: this.discountSheet(),
      'grant-clients': this.clientGrantSheet(),
      mark: this.markSheet(),
      end: this.endSheet(),
    };
    const template = templates[kind];
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
      void this.load().then(() => {
        // Marking or ending takes away the button the sheet gave focus back to.
        if (kind === 'mark' || kind === 'end') this.keepFocus();
      });
    });
  }

  /**
   * When the button that had focus is gone after a read and the focus fell to the page, `heading`
   * takes it; focus the admin moved meanwhile, into a sheet opened during the read say, stays.
   */
  private refocus(
    trigger: Element | null,
    heading: () => ElementRef<HTMLElement> | undefined,
  ): void {
    if (this.destroyed || !(trigger instanceof HTMLElement) || trigger === document.body) return;
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (trigger.isConnected || (active && active !== document.body)) return;
        heading()?.nativeElement.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  /** When the button that had focus went with the reading it served, the panel's heading takes it. */
  private keepFocus(): void {
    // A page left before its read answered has nothing to focus, and no injector to ask.
    if (this.destroyed) return;
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        this.foundingHeading()?.nativeElement.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
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
