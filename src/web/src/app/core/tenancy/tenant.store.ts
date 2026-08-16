import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { TenantMembership } from '../api/api.models';

const tenantStorageKey = 'tb-gym.active-tenant';

@Injectable({ providedIn: 'root' })
export class TenantStore {
  private readonly api = inject(ApiClient);
  private readonly membershipsState = signal<TenantMembership[]>([]);
  private readonly selectedTenantIdState = signal<string | null>(
    localStorage.getItem(tenantStorageKey),
  );

  readonly memberships = this.membershipsState.asReadonly();
  readonly selectedTenantId = this.selectedTenantIdState.asReadonly();

  async load(): Promise<void> {
    const memberships = await firstValueFrom(this.api.getTenants());
    this.membershipsState.set(memberships);

    const current = this.selectedTenantIdState();
    const selected = memberships.some((membership) => membership.tenantId === current)
      ? current
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

    this.selectedTenantIdState.set(tenantId);
    if (tenantId) {
      localStorage.setItem(tenantStorageKey, tenantId);
    } else {
      localStorage.removeItem(tenantStorageKey);
    }
  }

  clear(): void {
    this.membershipsState.set([]);
    this.select(null);
  }
}
