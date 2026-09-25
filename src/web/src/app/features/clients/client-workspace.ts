import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, RouterOutlet } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Avatar } from '../../ui/avatar';
import { Button, ButtonLink } from '../../ui/button';
import { SectionNav, type SectionLink } from '../../ui/section-nav';
import { StatusLabel, type StatusTone } from '../../ui/status-label';
import { ConversationLaunch } from '../messaging/conversation-launch';
import { currentEnrollment, daysBetween, RENEWAL_PROMPT_DAYS } from './client-overview.models';
import { ClientWorkspaceContext } from './client-workspace.context';

/**
 * One client's record (Figma 131:419): the header, the section links and the open section. Each
 * section is its own route under `/clients/:clientId`, so it can be linked to and reloaded.
 */
@Component({
  selector: 'app-client-workspace',
  imports: [
    Avatar,
    Button,
    ButtonLink,
    DatePipe,
    RouterLink,
    RouterOutlet,
    SectionNav,
    StatusLabel,
  ],
  providers: [ClientWorkspaceContext],
  templateUrl: './client-workspace.html',
  styleUrl: './client-workspace.scss',
})
export class ClientWorkspace {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly router = inject(Router);
  private readonly conversationLaunch = inject(ConversationLaunch);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly conversationKeys = new Map<string, string>();
  private loadedKey: string | null = null;

  protected readonly context = inject(ClientWorkspaceContext);
  protected readonly clientId = inject(ActivatedRoute).snapshot.paramMap.get('clientId') ?? '';
  protected readonly profile = this.context.profile;
  protected readonly startingConversation = signal(false);
  /** The breadcrumb's last item until the record has loaded. */
  protected readonly clientLabel = $localize`Client`;

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

  protected readonly planStatus = computed<{ label: string; tone: StatusTone } | null>(() => {
    if (this.context.isFormer()) return { label: $localize`Former client`, tone: 'neutral' };
    const workspace = this.context.workspace();
    if (!workspace || !this.context.plans()) return null;
    const enrollment = this.enrollment();
    if (!enrollment) return { label: $localize`No plan`, tone: 'neutral' };
    switch (enrollment.effectiveStatus) {
      case 'Active': {
        const daysLeft = daysBetween(workspace.currentDate, enrollment.lastActiveDate);
        if (daysLeft === 0) return { label: $localize`Plan ends today`, tone: 'warning' };
        if (daysLeft === 1) return { label: $localize`Plan ends tomorrow`, tone: 'warning' };
        if (daysLeft > 0 && daysLeft <= RENEWAL_PROMPT_DAYS) {
          return {
            label: $localize`Plan ends in ${daysLeft}:count: days`,
            tone: 'warning',
          };
        }
        return { label: $localize`Active plan`, tone: 'success' };
      }
      case 'Paused':
        return { label: $localize`Plan paused`, tone: 'warning' };
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
          { label: $localize`Check-ins`, link: `${base}/checkins` },
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
        const detail = await owner.wait(
          firstValueFrom(this.api.createDirectConversation(this.clientId, key)),
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
    this.conversationKeys.clear();
    this.startingConversation.set(false);
  }
}
