import { Component, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { ClientOnboardingStatus } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { tenantRoleLabel } from '../../core/i18n/display-labels';
import { TenantStore } from '../../core/tenancy/tenant.store';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly api = inject(ApiClient);
  private loadedTenantId: string | null = null;

  protected readonly auth = inject(AuthStore);
  protected readonly tenants = inject(TenantStore);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly clientCount = signal(0);
  protected readonly pendingInvitationCount = signal(0);
  protected readonly onboardingStatus = signal<ClientOnboardingStatus | null>(null);
  protected readonly roleLabel = tenantRoleLabel;

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
      if (this.tenants.canCoach()) {
        const [clients, invitations] = await Promise.all([
          firstValueFrom(this.api.getClients()),
          firstValueFrom(this.api.getInvitations()),
        ]);
        this.clientCount.set(clients.length);
        this.pendingInvitationCount.set(
          invitations.filter((invitation) => invitation.status === 'Pending').length,
        );
      } else if (this.tenants.isClient()) {
        const profile = await firstValueFrom(this.api.getSelfProfile());
        this.onboardingStatus.set(profile.onboardingStatus);
      }
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`Dashboard data could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
  }
}
