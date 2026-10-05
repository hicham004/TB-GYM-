import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, LOCALE_ID, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage, featureAccessReason } from '../../core/api/api-error';
import type { CheckInAssignmentListItem, FeatureAccessReason } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { checkInListGroups, checkInsClosed, type CheckInContext } from './client-checkins.models';
import { ClientWorkspaceContext } from './client-workspace.context';

type ListState = 'loading' | 'ready' | 'denied' | 'error';

/**
 * A client's check-ins (C5, R4.3): what needs review first, then what is not sent yet, then what
 * was reviewed. A sent check-in opens its review; an unsent one has nothing to read yet (CHK-013).
 * Assigning still happens on the check-in screen until it gets its own sheet.
 */
@Component({
  selector: 'app-client-checkins',
  imports: [
    Button,
    ButtonLink,
    EmptyState,
    Icon,
    NgTemplateOutlet,
    RouterLink,
    Skeleton,
    StatusPill,
  ],
  templateUrl: './client-checkins.html',
  styleUrl: './client-checkins.scss',
})
export class ClientCheckIns {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedKey: string | null = null;

  protected readonly context = inject(ClientWorkspaceContext);
  protected readonly pageSize = 50;
  protected readonly items = signal<readonly CheckInAssignmentListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly state = signal<ListState>('loading');
  protected readonly reason = signal<FeatureAccessReason | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly moreError = signal<string | null>(null);
  protected readonly loadingLabel = $localize`Loading check-ins`;

  protected readonly firstName = computed(() => this.context.profile()?.firstName ?? '');

  private readonly checkInContext = computed<CheckInContext | null>(() => {
    const workspace = this.context.workspace();
    return workspace
      ? {
          today: workspace.currentDate,
          locale: this.locale,
          timeZone: workspace.timeZoneId,
          userId: this.auth.user()?.id ?? null,
        }
      : null;
  });

  protected readonly groups = computed(() => {
    const context = this.checkInContext();
    return context ? checkInListGroups(this.items(), context) : null;
  });

  protected readonly closed = computed(() => {
    const reason = this.reason();
    return reason ? checkInsClosed(reason, this.firstName() || $localize`This client`) : '';
  });

  /** The check-in screen opens on this client, where a published form is assigned. */
  protected readonly assignParams = computed(() => ({ clientId: this.context.clientId() }));

  protected readonly emptyDescription = computed(
    () =>
      $localize`Assign one and ${this.firstName()}:name:’s answers come in here, ready to read beside the last.`,
  );

  constructor() {
    this.scope.onReset(() => this.reset());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.context.clientId();
      const workspace = this.context.workspace();
      const key =
        tenantId && clientId && workspace && !this.context.isFormer()
          ? `${tenantId}:${clientId}`
          : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.load();
      }
    });
  }

  protected load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.error.set(null);
      this.moreError.set(null);
      // The plan already says whether check-ins are included, so a client without them is not
      // asked; the refusal names its reason instead of drawing an empty list (CHK-011).
      const decision = this.context
        .plans()
        ?.featureAccess.find((item) => item.feature === 'CheckIns');
      if (decision && !decision.isAllowed) {
        this.reason.set(decision.reason);
        this.state.set('denied');
        return;
      }

      this.state.set('loading');
      try {
        const list = await owner.wait(
          firstValueFrom(
            this.api.listClientCheckInAssignments(this.context.clientId(), 0, this.pageSize),
          ),
        );
        this.items.set(list.items);
        this.total.set(Number(list.total));
        this.state.set('ready');
      } catch (error) {
        if (!owner.current) return;
        const reason = featureAccessReason(error);
        if (reason !== null) {
          this.reason.set(reason);
          this.state.set('denied');
        } else {
          this.error.set(
            apiErrorMessage(
              error,
              $localize`${this.firstName()}:name:’s check-ins could not be loaded.`,
            ),
          );
          this.state.set('error');
        }
      }
    });
  }

  /** Older ones, a page at a time; the list grows for as long as the coaching does. */
  protected loadMore(): Promise<void> {
    return this.scope.run('more', async (owner) => {
      if (this.loadingMore() || this.items().length >= this.total()) return;
      this.loadingMore.set(true);
      this.moreError.set(null);
      try {
        const page = await owner.wait(
          firstValueFrom(
            this.api.listClientCheckInAssignments(
              this.context.clientId(),
              this.items().length,
              this.pageSize,
            ),
          ),
        );
        const seen = new Set(this.items().map((item) => item.assignment.id));
        this.items.update((items) => [
          ...items,
          ...page.items.filter((item) => !seen.has(item.assignment.id)),
        ]);
        this.total.set(Number(page.total));
      } catch (error) {
        if (!owner.current) return;
        this.moreError.set(apiErrorMessage(error, $localize`Older check-ins could not be loaded.`));
      } finally {
        if (owner.current) this.loadingMore.set(false);
      }
    });
  }

  private reset(): void {
    this.loadedKey = null;
    this.items.set([]);
    this.total.set(0);
    this.state.set('loading');
    this.reason.set(null);
    this.error.set(null);
    this.loadingMore.set(false);
    this.moreError.set(null);
  }
}
