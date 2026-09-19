import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { Component, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { ClientOnboardingStatus } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { tenantRoleLabel } from '../../core/i18n/display-labels';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ClientToday } from './client-today';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, ClientToday],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly api = inject(ApiClient);
  private loadedTenantId: string | null = null;

  protected readonly auth = inject(AuthStore);
  protected readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly clientCount = signal(0);
  protected readonly pendingInvitationCount = signal(0);
  protected readonly onboardingStatus = signal<ClientOnboardingStatus | null>(null);
  protected readonly roleLabel = tenantRoleLabel;

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
        if (this.tenants.canCoach()) {
          const [clients, invitations] = await owner.wait(
            Promise.all([
              firstValueFrom(this.api.getClients()),
              firstValueFrom(this.api.getInvitations()),
            ]),
          );
          this.clientCount.set(clients.length);
          this.pendingInvitationCount.set(
            invitations.filter((invitation) => invitation.status === 'Pending').length,
          );
        }
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`Dashboard data could not be loaded.`));
      } finally {
        if (owner.current) {
          this.loading.set(false);
        }
      }
    });
  }

  private resetTenantState(): void {
    this.loadedTenantId = null;
    this.loading.set(false);
    this.error.set(null);
    this.clientCount.set(0);
    this.pendingInvitationCount.set(0);
    this.onboardingStatus.set(null);
  }
}
