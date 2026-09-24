import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { DatePipe } from '@angular/common';
import { Component, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { FormerClientsApi } from './former-clients-api';
import { apiErrorMessage } from '../../core/api/api-error';
import { ClientSummary, FormerClient } from '../../core/api/api.models';
import { onboardingStatusLabel } from '../../core/i18n/display-labels';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { SectionLink, SectionNav } from '../../ui/section-nav';

@Component({
  selector: 'app-clients',
  imports: [DatePipe, RouterLink, SectionNav],
  templateUrl: './clients.html',
  styleUrl: './clients.scss',
})
export class Clients {
  private readonly api = inject(ApiClient);
  private readonly formerApi = inject(FormerClientsApi);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedTenantId: string | null = null;

  /** `/clients/former`: the owner's released clients (ADR 0027). Otherwise the current ones. */
  protected readonly showingFormer = inject(ActivatedRoute).snapshot.data['view'] === 'former';
  /** Presentation only: the API decides who may list former clients. */
  protected readonly isOwner = this.tenants.isOwner;
  protected readonly sections: SectionLink[] = [
    { label: $localize`Current clients`, link: '/clients' },
    { label: $localize`Former clients`, link: '/clients/former' },
  ];
  protected readonly clients = signal<ClientSummary[]>([]);
  protected readonly former = signal<FormerClient[]>([]);
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
        if (this.showingFormer) {
          this.former.set(await owner.wait(firstValueFrom(this.formerApi.getFormerClients())));
        } else {
          this.clients.set(await owner.wait(firstValueFrom(this.api.getClients())));
        }
      } catch (error) {
        if (!owner.current) return;
        this.clients.set([]);
        this.former.set([]);
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
    this.former.set([]);
    this.loading.set(false);
    this.error.set(null);
  }
}
