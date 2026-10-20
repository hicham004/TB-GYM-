import { UiConfirm } from '../../ui/confirm';
import {
  Component,
  computed,
  effect,
  inject,
  LOCALE_ID,
  signal,
  TemplateRef,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type {
  ClientEnrollment,
  CoachClientDetails,
  ProductCatalog,
} from '../../core/api/api.models';
import type { ClientProfileOverviewView } from '../../core/api/generated';
import { GuardedSheets, type Closable, type LeaveQuestion } from '../../core/forms/guarded-sheets';
import { CsrfService } from '../../core/security/csrf.service';
import { EmailDelivery } from '../../core/system/email-delivery';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { ClientActions } from './client-actions';
import { ClientCoach } from './client-coach';
import { ClientRelease } from './client-release';
import { serviceWriteError } from './client-service-forms.models';
import {
  accessSummary,
  focusPlanId,
  offerChoices,
  otherPlans,
  planCard,
  planMenu,
  primaryAction,
  renewalAskedFor,
  renewalAskedLine,
  type PlanCard,
  type RenewalRequest,
  type ServiceActionId,
  type ServiceContext,
} from './client-service.models';
import { ClientWorkspaceContext } from './client-workspace.context';
import { AccessChange, PlanStatusChange } from './plan-dialogs';
import { PlanPayment, PlanStart } from './plan-sheets';

/**
 * A client's Service & access (C3, R3.4b): the plan in front with what it includes and what has been
 * paid, the one thing that needs the coach as the page's only filled button (plan §2 rule 5), every
 * other change behind Manage plan, the client's other plans, and who coaches them and whether they
 * can use anything at all. The server decides every change (SUB-003 to SUB-011, ADR 0026, ADR 0027);
 * a former client's record shows the same history with nothing to change.
 */
@Component({
  selector: 'app-client-service',
  imports: [
    AccessChange,
    UiConfirm,
    Button,
    ClientActions,
    ClientCoach,
    ClientRelease,
    EmptyState,
    PlanPayment,
    PlanStart,
    PlanStatusChange,
    Skeleton,
    StatusPill,
  ],
  templateUrl: './client-service.html',
  styleUrl: './client-service.scss',
})
export class ClientService extends GuardedSheets {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly emailDelivery = inject(EmailDelivery);
  private readonly tenants = inject(TenantStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly confirmTemplate = viewChild.required<TemplateRef<unknown>>('leaveDialog');

  protected override readonly leaveQuestion: LeaveQuestion = {
    title: $localize`Close without saving?`,
    message: $localize`What you typed is not saved. Closing loses it.`,
    confirm: $localize`Close without saving`,
    cancel: $localize`Keep editing`,
  };

  protected confirmDialog(): TemplateRef<unknown> {
    return this.confirmTemplate();
  }

  /** A plan sheet's result: saved closes it at once, Not now asks first when something is typed. */
  protected closePlanSheet(result: unknown, sheet: Closable): void {
    if (result) {
      this.dirty = false;
      sheet.close(result);
    } else void this.closeAsking(sheet);
  }

  private loadedKey: string | null = null;

  protected readonly context = inject(ClientWorkspaceContext);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly catalog = signal<ProductCatalog | null>(null);
  /** The client's request to renew (ADR 0029), from the attention read the Overview uses. */
  private readonly renewalRequest = signal<RenewalRequest | null>(null);
  /** The plan the coach picked from the list; otherwise the one the page opens on. */
  private readonly picked = signal<string | null>(null);
  /** The plan a sheet or dialog is about; the renewal source for Renew plan. */
  protected readonly subject = signal<PlanCard | null>(null);
  protected readonly renewSource = signal<ClientEnrollment | null>(null);
  protected readonly statusMode = signal<'pause' | 'cancel'>('pause');
  protected readonly resuming = signal(false);

  protected readonly startSheet = viewChild.required<TemplateRef<unknown>>('startSheet');
  protected readonly paymentSheet = viewChild.required<TemplateRef<unknown>>('paymentSheet');
  protected readonly statusDialog = viewChild.required<TemplateRef<unknown>>('statusDialog');
  protected readonly accessDialog = viewChild.required<TemplateRef<unknown>>('accessDialog');

  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });

  protected readonly loadingLabel = $localize`Loading plans and payments…`;
  // Not "Actions": the client's header above already has an Actions menu of its own.
  protected readonly menuLabel = $localize`Manage plan`;
  protected readonly closeLabel = $localize`Close`;
  protected readonly emptyHeading = $localize`No plan yet`;

  protected readonly firstName = computed(() => this.context.profile()?.firstName ?? '');
  protected readonly today = computed(() => this.context.workspace()?.currentDate ?? '');
  protected readonly plans = computed(() => this.context.plans()?.enrollments ?? []);
  private readonly serviceContext = computed<ServiceContext>(() => ({
    locale: this.locale,
    today: this.today(),
    firstName: this.firstName(),
  }));

  private readonly openId = computed(() => {
    const picked = this.picked();
    return picked && this.plans().some((plan) => plan.id === picked)
      ? picked
      : focusPlanId(this.plans(), this.today());
  });
  private readonly openPlan = computed(
    () => this.plans().find((plan) => plan.id === this.openId()) ?? null,
  );

  /** The plan in front of the coach, as its header and payments. */
  protected readonly card = computed(() => {
    const plan = this.openPlan();
    return plan ? planCard(plan, this.serviceContext()) : null;
  });
  protected readonly others = computed(() =>
    otherPlans(this.plans(), this.openId(), this.serviceContext()),
  );
  protected readonly hasOthers = computed(
    () => this.others().coming.length + this.others().earlier.length > 0,
  );

  /** Whether the request is about the plan in front, so it is said there and answered there. */
  private readonly askedHere = computed(() => renewalAskedFor(this.renewalRequest(), this.card()));

  protected readonly primary = computed(() =>
    this.context.isFormer()
      ? null
      : primaryAction(this.card(), this.plans(), this.serviceContext(), this.askedHere()),
  );

  /** Said beside the plan the client asked about, until a plan follows it. */
  protected readonly renewalLine = computed(() =>
    this.askedHere() && this.primary()?.id === 'renew'
      ? renewalAskedLine(this.renewalRequest()?.since ?? null, this.firstName(), this.locale)
      : null,
  );

  /** A renewal needs one of the same plan's price options still on sale. */
  private readonly renewable = computed(() => {
    const card = this.card();
    return card !== null && offerChoices(this.catalog(), this.locale, card.productId).length > 0;
  });

  protected readonly menu = computed(() =>
    this.context.isFormer() ? [] : planMenu(this.card(), this.primary(), this.renewable()),
  );

  protected readonly emptyDescription = computed(
    () =>
      $localize`Start a plan and ${this.firstName()}:name: can use what it includes once it is paid.`,
  );

  /**
   * What the client can use now and, feature by feature, why something is closed (BILL-5, LOST-13): read
   * from the decisions the shared access service made, which this page already holds.
   */
  protected readonly access = computed(() => {
    const client = this.context.profile();
    if (!client) return null;
    return accessSummary(
      this.context.plans()?.featureAccess ?? [],
      client.firstName,
      client.isCoachBlocked,
      this.locale,
    );
  });

  constructor() {
    super();
    this.scope.onReset(() => this.reset());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.context.clientId();
      const key = tenantId && clientId ? `${tenantId}:${clientId}` : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.load();
      }
    });

    // The Overview's and the header's "Renew plan" arrive as `?renew=<plan id>`, Coach Today's "Record
    // payment" for a renewal still unpaid (BEB-7) as `?pay=<plan id>`, and its "Start a plan" for a new
    // client with none (COACH-9) as `?action=start`: open that sheet once the page has loaded, then take
    // it out of the address so Back and a reload do not reopen it.
    effect(() => {
      const renew = this.query().get('renew');
      const pay = this.query().get('pay');
      const start = this.query().get('action') === 'start';
      if ((!renew && !pay && !start) || this.state() !== 'ready') return;
      // Untracked: picking the plan changes what the page reads, which must not run this again.
      untracked(() => {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { renew: null, pay: null, action: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
        if (this.context.isFormer()) return;
        if (start) return this.openStart();
        const plan = this.plans().find((item) => item.id === (pay ?? renew));
        if (!plan) return;
        this.picked.set(plan.id);
        if (!pay) return this.openRenew(plan);
        // Shown either way; the sheet only while the plan still waits for the payment.
        const card = this.card();
        if (card?.canPay) this.openPayment(card);
      });
    });
  }

  protected load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.state.set('loading');
      const clientId = this.context.clientId();
      const former = this.context.isFormer();
      try {
        const [plans, catalog, overview] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.getClientCommercialOverview(clientId)),
            former
              ? Promise.resolve(null)
              : firstValueFrom(this.api.getProductCatalog()).catch(() => null),
            former
              ? Promise.resolve(null)
              : firstValueFrom(this.api.getClientOverview(clientId)).catch(() => null),
          ]),
        );
        this.context.setPlans(plans);
        this.catalog.set(catalog);
        this.renewalRequest.set(renewalRequestOf(overview));
        this.state.set('ready');
      } catch {
        if (!owner.current) return;
        this.state.set('error');
      }
    });
  }

  protected showPlan(id: string): void {
    this.picked.set(id);
    this.context.clearMessages();
  }

  // ---------- what the coach can do ----------

  protected onAction(id: string): void {
    const card = this.card();
    switch (id as ServiceActionId) {
      case 'start':
        return this.openStart();
      case 'renew': {
        const plan = this.openPlan();
        if (plan) this.openRenew(plan);
        return;
      }
      case 'pay':
        if (card) this.openPayment(card);
        return;
      case 'pause':
      case 'cancel':
        if (card) this.openStatus(card, id as 'pause' | 'cancel');
        return;
      case 'resume':
        if (card) void this.resume(card);
        return;
    }
  }

  protected openStart(): void {
    this.renewSource.set(null);
    this.openSheet(this.startSheet(), $localize`Start a plan`, (plan: ClientEnrollment) => {
      this.picked.set(plan.id);
      return $localize`${plan.productName}:plan: is set up for ${this.firstName()}:name:.`;
    });
  }

  private openRenew(plan: ClientEnrollment): void {
    this.renewSource.set(plan);
    this.openSheet(this.startSheet(), $localize`Renew plan`, (renewal: ClientEnrollment) => {
      this.picked.set(renewal.id);
      return $localize`${renewal.productName}:plan: is renewed for ${this.firstName()}:name:.`;
    });
  }

  private openPayment(card: PlanCard): void {
    this.subject.set(card);
    this.openSheet(
      this.paymentSheet(),
      $localize`Record payment`,
      () => $localize`The payment is recorded.`,
    );
  }

  private openStatus(card: PlanCard, mode: 'pause' | 'cancel'): void {
    this.subject.set(card);
    this.statusMode.set(mode);
    const ref = this.dialogs.open<boolean>(this.statusDialog(), {
      title: mode === 'pause' ? $localize`Pause plan` : $localize`Cancel plan`,
      closeLabel: this.closeLabel,
    });
    ref.closed.subscribe((changed) => {
      if (!changed) return;
      this.afterChange(
        mode === 'pause'
          ? $localize`${card.name}:plan: is paused.`
          : $localize`${card.name}:plan: is cancelled.`,
      );
    });
  }

  protected openAccess(): void {
    const ref = this.dialogs.open<CoachClientDetails | null>(this.accessDialog(), {
      title: this.context.profile()?.isCoachBlocked
        ? $localize`Unblock access`
        : $localize`Block access`,
      closeLabel: this.closeLabel,
    });
    ref.closed.subscribe((updated) => {
      if (!updated) return;
      this.context.setProfile(updated);
      this.afterChange(
        updated.isCoachBlocked
          ? $localize`${updated.firstName}:name: is blocked in your coaching space only.`
          : $localize`${updated.firstName}:name: is unblocked.`,
      );
    });
  }

  /** Resuming asks nothing: it only undoes a pause, which the coach can do again at any time. */
  private async resume(card: PlanCard): Promise<void> {
    if (this.resuming()) return;
    this.resuming.set(true);
    this.context.clearMessages();
    try {
      await this.csrf.refresh();
      await firstValueFrom(this.api.resumeEnrollment(card.id, card.version));
      this.afterChange($localize`${card.name}:plan: is running again.`);
    } catch (error) {
      this.context.error.set(
        serviceWriteError(
          error,
          $localize`The plan could not be resumed. Try again.`,
          this.firstName(),
        ),
      );
    } finally {
      this.resuming.set(false);
    }
  }

  /** The owner ended coaching: the record becomes the read-only former-client record (ADR 0027). */
  protected released(profile: CoachClientDetails): void {
    this.context.setProfile(profile);
    this.context.error.set(null);
    this.context.notice.set(
      this.emailDelivery.off()
        ? $localize`Coaching with ${profile.firstName}:name: has ended. They no longer have access. Email is off on this server, so they weren’t emailed.`
        : $localize`Coaching with ${profile.firstName}:name: has ended. They no longer have access, and we are emailing them.`,
    );
    void this.reread();
  }

  private openSheet<T>(
    template: TemplateRef<unknown>,
    title: string,
    notice: (result: T) => string,
  ): void {
    this.show<T | null | false>(template, title).closed.subscribe((result) => {
      if (result) this.afterChange(notice(result as T));
    });
  }

  /** A change was made: say so, and read the plans again so the header and this page agree. */
  private afterChange(notice: string): void {
    this.context.error.set(null);
    this.context.notice.set(notice);
    void this.reread();
  }

  private reread(): Promise<void> {
    return this.scope.run('reread', async (owner) => {
      const clientId = this.context.clientId();
      try {
        const [plans, overview] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.getClientCommercialOverview(clientId)),
            this.context.isFormer()
              ? Promise.resolve(null)
              : firstValueFrom(this.api.getClientOverview(clientId)).catch(() => null),
          ]),
        );
        this.context.setPlans(plans);
        this.renewalRequest.set(renewalRequestOf(overview));
      } catch {
        if (!owner.current) return;
        this.context.error.set(
          $localize`The plans could not be refreshed. Reload the page to see them as they are now.`,
        );
      }
    });
  }

  private reset(): void {
    this.closeSheets();
    this.loadedKey = null;
    this.state.set('loading');
    this.catalog.set(null);
    this.renewalRequest.set(null);
    this.picked.set(null);
    this.subject.set(null);
    this.renewSource.set(null);
  }
}

/** The client's standing request to renew, from the overview read; null without one. */
function renewalRequestOf(
  overview: Pick<ClientProfileOverviewView, 'attention'> | null,
): RenewalRequest | null {
  const item = overview?.attention.find((entry) => entry.kind === 'RenewalRequested');
  return item?.since ? { since: item.since, subjectId: item.subjectId ?? null } : null;
}
