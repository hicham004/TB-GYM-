import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type { FeatureAccessReason } from '../../core/api/generated';
import { TenantStore } from '../../core/tenancy/tenant.store';
import type { ProgressDashboard } from './progress-dashboard.models';

@Component({
  selector: 'app-progress-dashboard',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './progress-dashboard.html',
  styleUrl: './progress-dashboard.scss',
})
export class ProgressDashboardView {
  readonly clientId = input<string | null>(null);
  private readonly api = inject(ApiClient);
  private readonly tenants = inject(TenantStore);
  private loadedKey: string | null = null;

  protected readonly dashboard = signal<ProgressDashboard | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly coachMode = computed(() => this.clientId() !== null);

  constructor() {
    effect(() => {
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.clientId();
      const key = tenantId ? `${tenantId}:${clientId ?? 'me'}` : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.load();
      }
    });
  }

  /**
   * Why a cross-domain section could not be shown. The dashboard says this out loud rather than
   * rendering an empty panel, because "you are not entitled to see this" and "nothing was recorded"
   * are different facts and must not look the same.
   */
  protected unavailableReason(reason: FeatureAccessReason): string {
    switch (reason) {
      case 'Expired':
        return $localize`This subscription has ended.`;
      case 'NotStarted':
        return $localize`This subscription has not started yet.`;
      case 'PaymentRequired':
        return $localize`This subscription is awaiting payment.`;
      case 'Paused':
        return $localize`This subscription is paused.`;
      case 'Cancelled':
        return $localize`This subscription was cancelled.`;
      case 'NoEntitlement':
        return $localize`This is not part of the current plan.`;
      default:
        return $localize`This section is not available.`;
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const clientId = this.clientId();
      this.dashboard.set(
        clientId
          ? await firstValueFrom(this.api.getClientProgressDashboard(clientId))
          : await firstValueFrom(this.api.getMyProgressDashboard()),
      );
    } catch (error) {
      this.dashboard.set(null);
      this.error.set(
        apiErrorMessage(error, $localize`The progress dashboard could not be loaded.`),
      );
    } finally {
      this.loading.set(false);
    }
  }
}
