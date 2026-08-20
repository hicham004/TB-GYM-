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
  private loadedTenantId: string | null = null;

  protected readonly clients = signal<ClientSummary[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly onboardingStatusLabel = onboardingStatusLabel;

  constructor() {
    effect(() => {
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.load();
      }
    });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.clients.set(await firstValueFrom(this.api.getClients()));
    } catch (error) {
      this.clients.set([]);
      this.error.set(apiErrorMessage(error, $localize`Clients could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
  }
}
