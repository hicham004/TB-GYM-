import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import type { CoachingFeature, FeatureAccessDecision } from '../api/api.models';
import { AuthStore } from '../auth/auth.store';
import { TenantAsyncScope } from '../tenancy/tenant-async-scope';
import { TenantStore } from '../tenancy/tenant.store';

export type ClientAccessStatus = 'idle' | 'loading' | 'loaded' | 'failed';

/**
 * The signed-in client's access to each coaching feature in the selected workspace, from
 * `GET /api/client-access/me`.
 *
 * Presentation only. It hides the tab of a feature that is not in the client's plan and lets Today
 * say why a section is closed; every feature API still makes its own decision. While the answer is
 * unknown (loading, failed, or not a client) nothing counts as "not in the plan", so a tab is never
 * hidden on a guess.
 */
@Injectable({ providedIn: 'root' })
export class ClientAccessStore {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly decisionsState = signal<readonly FeatureAccessDecision[] | null>(null);
  private readonly statusState = signal<ClientAccessStatus>('idle');
  private context: string | null = null;

  readonly decisions = this.decisionsState.asReadonly();
  readonly status = this.statusState.asReadonly();

  /** One user in one workspace where they are a client; anything else has nothing to read. */
  private readonly contextKey = computed(() => {
    const userId = this.auth.user()?.id ?? null;
    const membership = this.tenants.selectedMembership();
    return userId === null || membership?.role !== 'Client'
      ? null
      : `${userId}|${membership.tenantId}`;
  });

  constructor() {
    this.scope.onReset(() => {
      // Forget the context too, so the effect below reads the new workspace's answer.
      this.context = null;
      this.clear();
    });
    effect(() => {
      this.scope.epoch();
      const key = this.contextKey();
      if (key === this.context) return;
      this.context = key;
      this.clear();
      if (key !== null) void this.load();
    });
  }

  decision(feature: CoachingFeature): FeatureAccessDecision | null {
    return this.decisionsState()?.find((item) => item.feature === feature) ?? null;
  }

  /** The feature is not part of the client's plan at all (never merely paused or ended). */
  notInPlan(feature: CoachingFeature): boolean {
    return this.decision(feature)?.reason === 'NoEntitlement';
  }

  /** Re-reads the decisions, for a retry after a failure. */
  async load(): Promise<void> {
    return this.scope.run('access', async (owner) => {
      this.statusState.set('loading');
      try {
        const decisions = await owner.wait(firstValueFrom(this.api.getOwnFeatureAccess()));
        this.decisionsState.set(decisions);
        this.statusState.set('loaded');
      } catch {
        if (owner.current) this.statusState.set('failed');
      }
    });
  }

  private clear(): void {
    this.decisionsState.set(null);
    this.statusState.set('idle');
  }
}
