import { isPlatformBrowser } from '@angular/common';
import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { TenantMembership } from '../api/api.models';
import { TenantContext } from './tenant-context';

const tenantStorageKey = 'tb-gym.active-tenant';

@Injectable({ providedIn: 'root' })
export class TenantStore {
  private readonly api = inject(ApiClient);
  private readonly context = inject(TenantContext);
  /** Only a browser remembers the workspace; the build-time render of the homepage (R6.2a) has no storage. */
  private readonly storage = isPlatformBrowser(inject(PLATFORM_ID)) ? localStorage : null;
  private loadRequest = 0;
  private readonly membershipsState = signal<TenantMembership[]>([]);
  private readonly selectedTenantIdState = signal<string | null>(
    this.storage?.getItem(tenantStorageKey) ?? null,
  );

  readonly memberships = this.membershipsState.asReadonly();
  readonly selectedTenantId = this.selectedTenantIdState.asReadonly();
  readonly selectedMembership = computed(() =>
    this.membershipsState().find(
      (membership) => membership.tenantId === this.selectedTenantIdState(),
    ),
  );
  readonly canCoach = computed(() => {
    const role = this.selectedMembership()?.role;
    return role === 'Owner' || role === 'Coach';
  });
  readonly isOwner = computed(() => this.selectedMembership()?.role === 'Owner');
  readonly isClient = computed(() => this.selectedMembership()?.role === 'Client');

  async load(preferredTenantId?: string): Promise<void> {
    const request = ++this.loadRequest;
    const epoch = this.context.epoch();
    let memberships: TenantMembership[];
    try {
      memberships = await firstValueFrom(this.api.getTenants());
    } catch (error) {
      if (request !== this.loadRequest || epoch !== this.context.epoch()) return;
      throw error;
    }
    if (request !== this.loadRequest || epoch !== this.context.epoch()) return;
    this.membershipsState.set(memberships);

    const candidate =
      preferredTenantId ??
      this.selectedTenantIdState() ??
      this.storage?.getItem(tenantStorageKey) ??
      null;
    const selected = memberships.some((membership) => membership.tenantId === candidate)
      ? candidate
      : (memberships[0]?.tenantId ?? null);
    this.select(selected);
  }

  select(tenantId: string | null): void {
    if (
      tenantId &&
      !this.membershipsState().some((membership) => membership.tenantId === tenantId)
    ) {
      return;
    }

    const changed = this.selectedTenantIdState() !== tenantId;
    this.selectedTenantIdState.set(tenantId);
    if (changed) this.context.invalidate();
    if (tenantId) {
      this.storage?.setItem(tenantStorageKey, tenantId);
    } else {
      this.storage?.removeItem(tenantStorageKey);
    }
  }

  /** Signing out, or another account: the chosen workspace is forgotten with the session. */
  clear(): void {
    this.storage?.removeItem(tenantStorageKey);
    this.unload();
  }

  /**
   * Empties the memberships and the selection but remembers the chosen workspace, for a session that
   * ended by itself or is being replaced by signing in (audit WEB-8). The next `load` offers it again,
   * and keeps it only if the account that signs in is still a member there.
   */
  unload(): void {
    ++this.loadRequest;
    this.membershipsState.set([]);
    this.selectedTenantIdState.set(null);
    this.context.invalidate();
  }
}
