import { formatDate } from '@angular/common';
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
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, firstValueFrom, map } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Avatar } from '../../ui/avatar';
import { Button, ButtonLink } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { SectionNav, type SectionLink } from '../../ui/section-nav';
import { StatusPill, type StatusPillTone } from '../../ui/status-pill';
import { ConversationLaunch } from '../messaging/conversation-launch';
import { mapConversationDetail } from '../messaging/messaging.models';
import { ClientActions, type ClientAction } from './client-actions';
import {
  currentEnrollment,
  daysBetween,
  RENEWAL_PROMPT_DAYS,
  renewalPrompt,
} from './client-overview.models';
import { ClientWorkspaceContext, otherCoachName } from './client-workspace.context';

/**
 * One client's record (C3): the header, the section links and the open section. Each section is
 * its own route under `/clients/:clientId`, so it can be linked to, bookmarked and reloaded. The
 * header is the person first (face, name, goal), then where their plan stands, then the one
 * primary action (Message) with everything else behind Actions (plan §2 rules 3 and 5).
 */
@Component({
  selector: 'app-client-workspace',
  imports: [
    Avatar,
    Button,
    ButtonLink,
    ClientActions,
    EmptyState,
    RouterLink,
    RouterOutlet,
    SectionNav,
    StatusPill,
  ],
  providers: [ClientWorkspaceContext],
  templateUrl: './client-workspace.html',
  styleUrl: './client-workspace.scss',
})
export class ClientWorkspace {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly csrf = inject(CsrfService);
  private readonly router = inject(Router);
  private readonly conversationLaunch = inject(ConversationLaunch);
  private readonly injector = inject(Injector);
  private readonly locale = inject(LOCALE_ID);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly conversationKeys = new Map<string, string>();
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private loadedKey: string | null = null;
  private focusedHeading = false;

  private readonly route = inject(ActivatedRoute);

  protected readonly context = inject(ClientWorkspaceContext);
  protected readonly clientId = this.route.snapshot.paramMap.get('clientId') ?? '';
  /**
   * A section whose own reply box is its action (a check-in's review) keeps the one filled button,
   * so the header's Message is drawn outlined there (plan §2 rule 5). Read once each navigation
   * ends: while this record is being built, the section below it is not activated yet.
   */
  protected readonly replyOnPage = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.route.firstChild?.snapshot?.data['replyOnPage'] === true),
    ),
    { initialValue: false },
  );
  protected readonly profile = this.context.profile;
  protected readonly startingConversation = signal(false);
  /** The breadcrumb's last item until the record has loaded. */
  protected readonly clientLabel = $localize`Client`;
  protected readonly actionsLabel = $localize`Actions`;

  protected readonly fullName = computed(() => {
    const profile = this.profile();
    return profile ? `${profile.firstName} ${profile.lastName}`.trim() : '';
  });

  /** The first character of the first and last names; the avatar is decorative. */
  protected readonly initials = computed(() => {
    const profile = this.profile();
    if (!profile) return '';
    const first = (name: string) => Array.from(name.trim())[0] ?? '';
    return (first(profile.firstName) + first(profile.lastName)).toLocaleUpperCase();
  });

  protected readonly enrollment = computed(() => {
    const workspace = this.context.workspace();
    const plans = this.context.plans();
    return workspace && plans ? currentEnrollment(plans.enrollments, workspace.currentDate) : null;
  });

  /** Where the plan stands, with the days left while it runs. */
  protected readonly planStatus = computed<{ label: string; tone: StatusPillTone } | null>(() => {
    if (this.context.isFormer()) return { label: $localize`Former client`, tone: 'neutral' };
    const workspace = this.context.workspace();
    if (!workspace || !this.context.plans()) return null;
    const enrollment = this.enrollment();
    if (!enrollment) return { label: $localize`No plan yet`, tone: 'neutral' };
    switch (enrollment.effectiveStatus) {
      case 'Active': {
        const daysLeft = daysBetween(workspace.currentDate, enrollment.lastActiveDate);
        if (daysLeft <= 0) return { label: $localize`Plan ends today`, tone: 'warm' };
        if (daysLeft === 1) return { label: $localize`Plan ends tomorrow`, tone: 'warm' };
        if (daysLeft <= RENEWAL_PROMPT_DAYS) {
          return { label: $localize`Plan ends in ${daysLeft}:count: days`, tone: 'warm' };
        }
        return { label: $localize`Active · ${daysLeft}:count: days left`, tone: 'success' };
      }
      case 'Paused':
        return { label: $localize`Plan paused`, tone: 'info' };
      case 'PendingPayment':
        return { label: $localize`Awaiting payment`, tone: 'warning' };
      case 'Upcoming':
        return { label: $localize`Plan not started`, tone: 'neutral' };
      case 'Expired':
        return { label: $localize`Plan ended`, tone: 'neutral' };
      case 'Cancelled':
        return { label: $localize`Plan cancelled`, tone: 'neutral' };
      case 'Blocked':
        return { label: $localize`Access blocked`, tone: 'danger' };
    }
  });

  /**
   * "Online Coaching · 12 weeks · until Thu 22 Oct": the plan in a line. A cancelled plan says the day it
   * was cancelled, never its last day, which may still be to come (COACH-20).
   */
  protected readonly planLine = computed(() => {
    const workspace = this.context.workspace();
    const plan = this.enrollment();
    if (this.context.isFormer() || !workspace || !plan) return '';
    const date = (day: string) =>
      formatDate(
        day,
        day.slice(0, 4) === workspace.currentDate.slice(0, 4) ? 'EEE d MMM' : 'd MMM y',
        this.locale,
      );
    const when =
      plan.effectiveStatus === 'Cancelled' && plan.cancelledOn
        ? $localize`cancelled ${date(plan.cancelledOn)}:date:`
        : plan.effectiveStatus === 'Expired' || plan.effectiveStatus === 'Cancelled'
          ? $localize`ended ${date(plan.lastActiveDate)}:date:`
          : $localize`until ${date(plan.lastActiveDate)}:date:`;
    return [plan.productName, plan.offerLabel, when].filter(Boolean).join(' · ');
  });

  /** The owner sees whose client this is when it is a team member's. */
  protected readonly coachLine = computed(() => {
    const profile = this.profile();
    const me = this.auth.user()?.id;
    return this.tenants.isOwner() && profile && me && profile.assignedCoachUserId !== me
      ? $localize`Coached by ${profile.assignedCoachName}:coach:`
      : '';
  });

  /**
   * Messaging is offered unless the plan is known not to include it, so the coach is not sent to
   * an error after the click. Until the plans arrive it is offered.
   */
  protected readonly messagingDecision = computed(
    () => this.context.plans()?.featureAccess.find((item) => item.feature === 'Messaging') ?? null,
  );

  protected readonly messagingIncluded = computed(
    () => this.messagingDecision()?.isAllowed ?? true,
  );

  /** A team member's client is messaged by their own coach, so the owner is told who instead. */
  protected readonly otherCoach = computed(() =>
    otherCoachName(this.profile(), this.auth.user()?.id ?? null),
  );

  /**
   * Only said when a plan simply lacks messaging; a block or a lapse is told by the plan pill, and a
   * client with no plan at all reads "No plan yet" alone (audit COACH-10).
   */
  protected readonly messagingNote = computed(() =>
    this.messagingDecision()?.reason === 'NoEntitlement' &&
    (this.context.plans()?.enrollments.length ?? 0) > 0
      ? $localize`Messaging isn’t part of this plan.`
      : '',
  );

  /** What else a coach does from here. Assigning a program opens its sheet on the Training section. */
  protected readonly actions = computed<ClientAction[]>(() => {
    const base = `/clients/${this.clientId}`;
    if (this.context.isFormer()) {
      return [{ label: $localize`View intake`, link: `${base}/intake` }];
    }
    const workspace = this.context.workspace();
    const plans = this.context.plans();
    const renewal =
      workspace && plans ? renewalPrompt(plans.enrollments, workspace.currentDate) : null;
    const service: ClientAction = renewal
      ? {
          label: $localize`Renew plan`,
          hint:
            renewal.daysLeft <= 0
              ? $localize`Ends today`
              : renewal.daysLeft === 1
                ? $localize`Ends tomorrow`
                : $localize`Ends in ${renewal.daysLeft}:count: days`,
          link: `${base}/service`,
          queryParams: { renew: renewal.enrollment.id },
        }
      : {
          label: $localize`Plan and payments`,
          hint: $localize`Plans, receipts and access`,
          link: `${base}/service`,
        };
    return [
      {
        label: $localize`Assign program`,
        hint: $localize`Choose a program and a start date`,
        link: `${base}/training`,
        queryParams: { action: 'assign' },
      },
      service,
      {
        label: $localize`Edit intake`,
        hint: $localize`Goals, health and contact details`,
        link: `${base}/intake`,
      },
    ];
  });

  /**
   * Training, nutrition and check-ins are not shown for a former client (ADR 0027), so their
   * sections are not offered. Their records are kept.
   */
  protected readonly sections = computed<SectionLink[]>(() => {
    const base = `/clients/${this.clientId}`;
    const overview = { label: $localize`Overview`, link: base };
    const progress = { label: $localize`Progress`, link: `${base}/progress` };
    const service = { label: $localize`Service & access`, link: `${base}/service` };
    return this.context.isFormer()
      ? [overview, progress, service]
      : [
          overview,
          { label: $localize`Training`, link: `${base}/training` },
          { label: $localize`Nutrition`, link: `${base}/nutrition` },
          { label: $localize`Check-ins`, link: `${base}/checkins`, includesChildren: true },
          progress,
          service,
        ];
  });

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const key = tenantId ? `${tenantId}:${this.clientId}` : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.context.load(this.clientId);
      }
    });
    // A screen reader starts at the client's name when the record opens, once.
    effect(() => {
      if (this.profile() && !this.focusedHeading) {
        this.focusedHeading = true;
        afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }), {
          injector: this.injector,
        });
      }
    });
  }

  protected retry(): void {
    void this.context.load(this.clientId);
  }

  protected async messageClient(): Promise<void> {
    return this.scope.run('messageClient', async (owner) => {
      const tenantId = this.tenants.selectedTenantId();
      if (!tenantId || this.startingConversation()) return;
      const key = this.conversationKeys.get(tenantId) ?? crypto.randomUUID();
      this.conversationKeys.set(tenantId, key);
      this.startingConversation.set(true);
      this.context.clearMessages();
      try {
        await owner.wait(this.csrf.refresh());
        if (tenantId !== this.tenants.selectedTenantId()) return;
        const detail = mapConversationDetail(
          await owner.wait(firstValueFrom(this.api.createDirectConversation(this.clientId, key))),
        );
        if (tenantId !== this.tenants.selectedTenantId()) return;
        this.conversationLaunch.open(tenantId, detail.conversation);
        await owner.wait(this.router.navigateByUrl('/messages'));
      } catch (error) {
        if (!owner.current) return;
        if (tenantId === this.tenants.selectedTenantId()) {
          this.context.error.set(
            apiErrorMessage(
              error,
              $localize`Couldn’t open this conversation. Check messaging access and retry.`,
            ),
          );
        }
      } finally {
        if (owner.current) {
          this.startingConversation.set(false);
        }
      }
    });
  }

  private resetTenantState(): void {
    this.loadedKey = null;
    this.focusedHeading = false;
    this.conversationKeys.clear();
    this.startingConversation.set(false);
  }
}
