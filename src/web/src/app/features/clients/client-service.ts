import { NgTemplateOutlet } from '@angular/common';
import { UiConfirm } from '../../ui/confirm';
import {
  afterNextRender,
  Component,
  computed,
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
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type {
  ClientCommercialOverview,
  ClientEnrollment,
  CoachClientDetails,
  ProductCatalog,
  TeamMember,
} from '../../core/api/api.models';
import type { ClientProfileOverviewView } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { GuardedSheets, type Closable, type LeaveQuestion } from '../../core/forms/guarded-sheets';
import { CsrfService } from '../../core/security/csrf.service';
import { EmailDelivery } from '../../core/system/email-delivery';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { UiDisclosure, UiDisclosureContent } from '../../ui/disclosure';
import { EmptyState } from '../../ui/empty-state';
import { UiMenu } from '../../ui/menu';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { TeamApi } from '../team/team-api';
import { IntentIdempotencyKey } from '../training/training-assignment-state';
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
  sessionHolders,
  sessionPackRows,
  type PlanCard,
  type RenewalRequest,
  type ServiceActionId,
  type ServiceContext,
  type SessionLine,
} from './client-service.models';
import { planEnding } from './client-overview.models';
import { ClientWorkspaceContext } from './client-workspace.context';
import { HousePlanAsksApi } from './house-plan-asks-api';
import { askRows, isHouseTrainee, type HousePlanAsk } from './house-plan-asks.models';
import { HousePlanBook } from './house-plan-book';
import { HousePlanClose } from './house-plan-close';
import { AccessChange, PlanStatusChange } from './plan-dialogs';
import { PlanPayment, PlanStart } from './plan-sheets';
import { SessionSheet } from './session-sheet';

/**
 * A client's Service & access (C3, R3.4b): the plan in front with what it includes and what has been
 * paid, the one thing that needs the coach as the page's only filled button (plan §2 rule 5), every
 * other change behind Manage plan, their 1-on-1 sessions (ADR 0038), the client's other plans, and who
 * coaches them and whether they can use anything at all. The server decides every change (SUB-003 to
 * SUB-011, ADR 0026, ADR 0027); a former client's record shows the same history with nothing to change.
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
    HousePlanBook,
    HousePlanClose,
    NgTemplateOutlet,
    PlanPayment,
    PlanStart,
    PlanStatusChange,
    SessionSheet,
    Skeleton,
    StatusPill,
    UiDisclosure,
    UiDisclosureContent,
    UiMenu,
  ],
  templateUrl: './client-service.html',
  styleUrl: './client-service.scss',
})
export class ClientService extends GuardedSheets {
  private readonly api = inject(ApiClient);
  private readonly team = inject(TeamApi);
  private readonly houseAsks = inject(HousePlanAsksApi);
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthStore);
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

  /** No sheet closes while a booking is on its way: the close button, Escape, the backdrop or Not now. */
  protected override canClose(): boolean | Promise<boolean> {
    return this.askBusy() ? false : super.canClose();
  }

  /** A plan sheet's result: saved closes it at once, Not now asks first when something is typed. */
  protected closePlanSheet(result: unknown, sheet: Closable): void {
    if (result) {
      this.dirty = false;
      sheet.close(result);
    } else void this.closeAsking(sheet);
  }

  private loadedKey: string | null = null;
  private readonly undoIntent = new IntentIdempotencyKey();

  protected readonly context = inject(ClientWorkspaceContext);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly catalog = signal<ProductCatalog | null>(null);
  /** The client's request to renew (ADR 0029), from the attention read the Overview uses. */
  private readonly renewalRequest = signal<RenewalRequest | null>(null);
  /** The team, read for the owner alone; null until then, or if the read failed. */
  private readonly members = signal<readonly TeamMember[] | null>(null);
  /** The plan the coach picked from the list; otherwise the one the page opens on. */
  private readonly picked = signal<string | null>(null);
  /** The plan a sheet or dialog is about; the renewal source for Renew plan. */
  protected readonly subject = signal<PlanCard | null>(null);
  protected readonly renewSource = signal<ClientEnrollment | null>(null);
  protected readonly statusMode = signal<'pause' | 'cancel'>('pause');
  protected readonly resuming = signal(false);
  /** Whether the start sheet is selling sessions, so it offers packs alone. */
  protected readonly sellingSessions = signal(false);
  /**
   * A house trainee's asks for a paid plan (SUB-020): read for a client holding the house's Free alone, so no
   * other page reads them; `failed` keeps the rest of the page when only this read was refused.
   */
  private readonly asks = signal<AsksRead>({ kind: 'none' });
  /** The ask the booking sheet or the closing dialog is about. */
  protected readonly askSubject = signal<HousePlanAsk | null>(null);
  protected readonly retryingAsks = signal(false);
  /** A booking or closing on its way: its sheet or dialog stays open, so its answer is said and acted on. */
  protected readonly askBusy = signal(false);
  /** The server said the ask was booked or closed meanwhile: the asks are read again once its surface closes. */
  private asksStale = false;
  /** `?action=coach` asked for the coach dialog; the coach panel opens it and sets this back (N9d2). */
  protected readonly coachAsked = signal(false);

  protected readonly startSheet = viewChild.required<TemplateRef<unknown>>('startSheet');
  protected readonly sessionSheet = viewChild.required<TemplateRef<unknown>>('sessionSheet');
  protected readonly paymentSheet = viewChild.required<TemplateRef<unknown>>('paymentSheet');
  protected readonly statusDialog = viewChild.required<TemplateRef<unknown>>('statusDialog');
  protected readonly accessDialog = viewChild.required<TemplateRef<unknown>>('accessDialog');
  protected readonly bookSheet = viewChild.required<TemplateRef<unknown>>('bookSheet');
  protected readonly closeAskDialog = viewChild.required<TemplateRef<unknown>>('closeAskDialog');
  private readonly asksHeading = viewChild<ElementRef<HTMLElement>>('asksHeading');

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
    // The server says whether the plan ends soon (CLI-018); the page counts no days of its own.
    ending: planEnding(this.context.overview()?.attention),
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

  /** The trainee's asks, newest first; none for any other client. */
  protected readonly askRows = computed(() => {
    const read = this.asks();
    // A former trainee has left Max's line (N9c5a), so their asks say nothing of a place.
    return read.kind === 'ready'
      ? askRows(read.asks, { ...this.serviceContext(), former: this.context.isFormer() })
      : [];
  });
  protected readonly asksFailed = computed(() => this.asks().kind === 'failed');

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

  /** The client's packs, those running or to come first, and whether one can be sold here. */
  protected readonly packs = computed(() => {
    const rows = sessionPackRows(
      this.plans(),
      this.serviceContext(),
      !this.context.isFormer(),
      (plan) => offerChoices(this.catalog(), this.locale, plan.productId).length > 0,
    );
    return { live: rows.filter((row) => !row.over), earlier: rows.filter((row) => row.over) };
  });
  protected readonly canSell = computed(() =>
    offerChoices(this.catalog(), this.locale).some((choice) => choice.sessions !== null),
  );
  protected readonly showSessions = computed(
    () =>
      this.packs().live.length + this.packs().earlier.length > 0 ||
      (this.canSell() && !this.context.isFormer()),
  );

  /**
   * Who the owner can say held a session (critique B12). The API refuses another name from a coach, and
   * a failed read still leaves the client's coach and the owner to choose from. A client waiting for a
   * coach (N9d1b) offers the team, You first, and nothing to an owner on their own.
   */
  protected readonly holders = computed(() => {
    const client = this.context.profile();
    const me = this.auth.user();
    if (!client || !me || !this.context.isOwner()) return [];
    return sessionHolders(
      client.assignedCoachUserId === null
        ? null
        : { userId: client.assignedCoachUserId, displayName: client.assignedCoachName },
      this.members() ?? [{ userId: me.id, displayName: me.displayName }],
      me.id,
    );
  });

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
    // client with none (COACH-9) as `?action=start`, and its and the Overview's "Choose a coach" for a
    // client waiting for one (N9d2) as `?action=coach`: open that sheet or dialog once the page has
    // loaded, then take it out of the address so Back and a reload do not reopen it.
    effect(() => {
      const renew = this.query().get('renew');
      const pay = this.query().get('pay');
      const start = this.query().get('action') === 'start';
      const coach = this.query().get('action') === 'coach';
      if ((!renew && !pay && !start && !coach) || this.state() !== 'ready') return;
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
        // The owner's alone; the coach panel opens it once it is drawn, if it is shown at all.
        if (coach) return this.coachAsked.set(this.context.isOwner());
        const plan = this.plans().find((item) => item.id === (pay ?? renew));
        if (!plan) return;
        this.picked.set(plan.id);
        if (!pay) {
          // Max is booked from the trainee's ask alone (N9c5a): its card's Manage plan says so instead.
          if (plan.houseTier !== 'Max') this.openRenew(plan);
          return;
        }
        // Shown either way; the sheet only while the plan still waits for the payment.
        const card = this.card();
        if (card?.canPay) this.openPayment(card);
      });
    });
  }

  protected load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.state.set('loading');
      const former = this.context.isFormer();
      try {
        // The plans and the overview the record read for this page when it opened here, or fresh reads
        // (audit UIQ-8); the overview carries the client's request to renew and whether the plan ends soon.
        const plansRead = this.context.plansForPage();
        const [plans, catalog, overview, members, asks] = await owner.wait(
          Promise.all([
            plansRead,
            former
              ? Promise.resolve(null)
              : firstValueFrom(this.api.getProductCatalog()).catch(() => null),
            former ? Promise.resolve(null) : this.context.overviewForPage().catch(() => null),
            former || !this.context.isOwner()
              ? Promise.resolve(null)
              : firstValueFrom(this.team.getTeamMembers()).catch(() => null),
            plansRead.then((read) => this.readAsks(read)),
          ]),
        );
        this.context.setPlans(plans);
        this.catalog.set(catalog);
        this.renewalRequest.set(renewalRequestOf(overview));
        this.members.set(members);
        this.asks.set(asks);
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

  // ---------- a house trainee's asks for a plan (SUB-020) ----------

  /** The asks of a client holding the house's Free; nothing is read for anyone else. */
  private async readAsks(plans: ClientCommercialOverview | null): Promise<AsksRead> {
    if (!isHouseTrainee(plans?.enrollments)) return { kind: 'none' };
    try {
      const asks = await firstValueFrom(this.houseAsks.list(this.context.clientId()));
      return { kind: 'ready', asks };
    } catch {
      return { kind: 'failed' };
    }
  }

  protected retryAsks(): Promise<void> {
    if (this.retryingAsks()) return Promise.resolve();
    return this.scope.run('asks', async (owner) => {
      this.retryingAsks.set(true);
      try {
        const read = await owner.wait(this.readAsks(this.context.plans()));
        this.asks.set(read);
        // Try again goes with the panel it was in: focus waits on the asks' heading, if any are listed.
        if (read.kind !== 'failed') this.focusAsksIfLost();
      } finally {
        if (owner.current) this.retryingAsks.set(false);
      }
    });
  }

  private askOf(id: string): HousePlanAsk | null {
    const read = this.asks();
    return read.kind === 'ready' ? (read.asks.find((ask) => ask.id === id) ?? null) : null;
  }

  protected openBook(id: string): void {
    const ask = this.askOf(id);
    if (!ask || this.context.isFormer()) return;
    this.askSubject.set(ask);
    this.clearAskWork();
    this.show<boolean | null>(this.bookSheet(), $localize`Book the plan`).closed.subscribe(
      (booked) =>
        this.askSurfaceClosed(
          booked ? $localize`The plan is booked and its payment recorded.` : null,
        ),
    );
  }

  protected openCloseAsk(id: string): void {
    const ask = this.askOf(id);
    if (!ask || this.context.isFormer()) return;
    this.askSubject.set(ask);
    this.clearAskWork();
    const ref = this.dialogs.open<boolean>(this.closeAskDialog(), {
      title: $localize`Close this ask`,
      closeLabel: this.closeLabel,
      // While the closing is on its way, its answer must arrive with the dialog still open.
      canClose: () => !this.askBusy(),
    });
    ref.closed.subscribe((closed) =>
      this.askSurfaceClosed(closed ? $localize`The ask is closed.` : null),
    );
  }

  /** Set by the booking sheet or the closing dialog when the server says the ask ended meanwhile. */
  protected markAsksStale(): void {
    this.asksStale = true;
  }

  private clearAskWork(): void {
    this.askBusy.set(false);
    this.asksStale = false;
  }

  /**
   * The sheet or dialog closed. Booked or closed here: say so. Booked or closed here or meanwhile, as the
   * server said: read the plans and asks again, and put focus on the asks, since the button that opened it
   * goes with the ask's new state.
   */
  private askSurfaceClosed(notice: string | null): void {
    this.askBusy.set(false);
    const stale = this.asksStale;
    this.asksStale = false;
    if (!notice && !stale) return;
    if (notice) {
      this.context.error.set(null);
      this.context.notice.set(notice);
    }
    void this.reread().then(() =>
      afterNextRender(() => this.asksHeading()?.nativeElement.focus(), {
        injector: this.injector,
      }),
    );
  }

  /** Focus fell with a button that went away: the asks' heading takes it, if the asks are still listed. */
  private focusAsksIfLost(): void {
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        this.asksHeading()?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  protected openStart(): void {
    this.renewSource.set(null);
    this.sellingSessions.set(false);
    this.openSheet(this.startSheet(), $localize`Start a plan`, (plan: ClientEnrollment) => {
      this.picked.set(plan.id);
      return $localize`${plan.productName}:plan: is set up for ${this.firstName()}:name:.`;
    });
  }

  protected openSell(): void {
    this.renewSource.set(null);
    this.sellingSessions.set(true);
    this.openSheet(this.startSheet(), $localize`Sell sessions`, (plan: ClientEnrollment) => {
      // A pack waiting for payment comes to the front, for its Record payment.
      if (plan.storedStatus === 'PendingPayment') this.picked.set(plan.id);
      return $localize`${plan.productName}:plan: is set up for ${this.firstName()}:name:.`;
    });
  }

  /** A pack's own menu acts on that pack, which comes to the front with its payments. */
  protected packAction(id: string, action: string): void {
    this.picked.set(id);
    this.onAction(action);
  }

  protected openSession(): void {
    this.openSheet(this.sessionSheet(), $localize`Record a session`, (pack: ClientEnrollment) => {
      const sessions = pack.sessions;
      return sessions
        ? $localize`The session is recorded. ${sessions.left}:left: of ${sessions.count}:count: left on ${pack.productName}:plan:.`
        : $localize`The session is recorded.`;
    });
  }

  protected undoLabel(line: SessionLine): string {
    return $localize`Undo the session of ${line.day}:date:`;
  }

  /** A correction, not a delete: the row stays on the ledger and the session goes back (SES-003). */
  protected async undoSession(line: SessionLine): Promise<void> {
    const undo = await this.ask(
      $localize`The session of ${line.day}:date: goes back on the pack. Both stay in its history.`,
      $localize`Undo session`,
      $localize`Keep it`,
      $localize`Undo this session?`,
    );
    if (!undo) return;
    this.context.clearMessages();
    try {
      await this.csrf.refresh();
      await firstValueFrom(
        this.api.voidSession(
          this.context.clientId(),
          line.id,
          this.undoIntent.forPayload({ entry: line.id }),
        ),
      );
      this.undoIntent.complete();
      this.afterChange($localize`The session is back on the pack.`);
    } catch (error) {
      this.context.error.set(
        serviceWriteError(
          error,
          $localize`The session could not be undone. Try again.`,
          this.firstName(),
        ),
      );
    }
  }

  private openRenew(plan: ClientEnrollment): void {
    this.renewSource.set(plan);
    this.sellingSessions.set(false);
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
        const plansRead = firstValueFrom(this.api.getClientCommercialOverview(clientId));
        const [plans, overview, asks] = await owner.wait(
          Promise.all([
            plansRead,
            this.context.isFormer()
              ? Promise.resolve(null)
              : firstValueFrom(this.api.getClientOverview(clientId)).catch(() => null),
            plansRead.then((read) => this.readAsks(read)),
          ]),
        );
        this.context.setPlans(plans);
        this.asks.set(asks);
        // The header reads it too, so a plan renewed here stops being flagged there.
        if (overview) this.context.setOverview(overview);
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
    this.members.set(null);
    this.picked.set(null);
    this.subject.set(null);
    this.renewSource.set(null);
    this.asks.set({ kind: 'none' });
    this.askSubject.set(null);
    this.retryingAsks.set(false);
    this.coachAsked.set(false);
    this.clearAskWork();
  }
}

/** The house's asks as this page last read them: none to read, the read refused, or the asks. */
type AsksRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ready'; readonly asks: readonly HousePlanAsk[] };

/** The client's standing request to renew, from the overview read; null without one. */
function renewalRequestOf(
  overview: Pick<ClientProfileOverviewView, 'attention'> | null,
): RenewalRequest | null {
  const item = overview?.attention.find((entry) => entry.kind === 'RenewalRequested');
  return item?.since ? { since: item.since, subjectId: item.subjectId ?? null } : null;
}
