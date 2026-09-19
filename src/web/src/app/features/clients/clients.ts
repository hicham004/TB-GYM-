import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { Component, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { ClientSummary } from '../../core/api/api.models';
import { onboardingStatusLabel } from '../../core/i18n/display-labels';
import { TenantStore } from '../../core/tenancy/tenant.store';

@Component({
  selector: 'app-clients',
  imports: [RouterLink],
  templateUrl: './clients.html',
  styleUrl: './clients.scss',
})
export class Clients {
  private readonly api = inject(ApiClient);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedTenantId: string | null = null;

  protected readonly clients = signal<ClientSummary[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly onboardingStatusLabel = onboardingStatusLabel;

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.load();
      }
    });
  }

  private async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.loading.set(true);
      this.error.set(null);
      try {
        this.clients.set(await owner.wait(firstValueFrom(this.api.getClients())));
      } catch (error) {
        if (!owner.current) return;
        this.clients.set([]);
        this.error.set(apiErrorMessage(error, $localize`Clients could not be loaded.`));
      } finally {
        if (owner.current) {
          this.loading.set(false);
        }
      }
    });
  }

  private resetTenantState(): void {
    this.loadedTenantId = null;
    this.clients.set([]);
    this.loading.set(false);
    this.error.set(null);
  }
}
