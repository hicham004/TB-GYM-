import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type { FeatureAccessReason } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { previewAssetIds, type ProgressDashboard } from './progress-dashboard.models';

@Component({
  selector: 'app-progress-dashboard',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './progress-dashboard.html',
  styleUrl: './progress-dashboard.scss',
})
export class ProgressDashboardView {
  readonly clientId = input<string | null>(null);
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private loadedKey: string | null = null;
  private loadGeneration = 0;

  protected readonly dashboard = signal<ProgressDashboard | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly coachMode = computed(() => this.clientId() !== null);
  /** Only exact asset ids returned by the batch are eligible to bind protected image paths. */
  protected readonly grantedPreviewIds = signal<ReadonlySet<string>>(new Set());

  constructor() {
    effect(() => {
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.clientId();
      const key = tenantId ? `${tenantId}:${clientId ?? 'me'}` : null;
      if (key === this.loadedKey) {
        return;
      }

      this.loadedKey = key;
      ++this.loadGeneration;
      this.dashboard.set(null);
      this.grantedPreviewIds.set(new Set());
      this.error.set(null);
      this.loading.set(false);
      if (key !== null) {
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
    const key = this.loadedKey;
    const generation = ++this.loadGeneration;
    this.loading.set(true);
    this.error.set(null);
    this.grantedPreviewIds.set(new Set());
    try {
      const clientId = this.clientId();
      const dashboard = clientId
        ? await firstValueFrom(this.api.getClientProgressDashboard(clientId))
        : await firstValueFrom(this.api.getMyProgressDashboard());
      if (!this.ownsLoad(key, generation)) {
        return;
      }

      this.dashboard.set(dashboard);
      await this.grantPreviews(dashboard, key, generation);
    } catch (error) {
      if (!this.ownsLoad(key, generation)) {
        return;
      }

      this.dashboard.set(null);
      this.error.set(
        apiErrorMessage(error, $localize`The progress dashboard could not be loaded.`),
      );
    } finally {
      if (this.ownsLoad(key, generation)) {
        this.loading.set(false);
      }
    }
  }

  /**
   * Asks for one grant per previewed photo, in a single bounded request.
   *
   * A thumbnail path is not a public URL: the content route requires a short-lived, HTTP-only,
   * path-scoped grant cookie, and the dashboard previously bound the paths straight to `img.src`
   * without ever asking for one. That worked only if some other screen had already granted those
   * exact assets in the same session, so a coach opening a client for the first time saw nothing.
   * The server bounds the timeline it returns, so this set is bounded too and needs no paging.
   *
   * A failure here leaves the tiles unbound rather than failing the whole dashboard: the figures
   * are still worth showing when the images are not available.
   */
  private async grantPreviews(
    dashboard: ProgressDashboard,
    key: string | null,
    generation: number,
  ): Promise<void> {
    const assetIds = previewAssetIds(dashboard);
    if (assetIds.length === 0) {
      return;
    }

    try {
      await this.csrf.refresh();
      if (!this.ownsLoad(key, generation)) {
        return;
      }

      const batch = await firstValueFrom(this.api.createMediaAccessBatch(assetIds));
      if (this.ownsLoad(key, generation)) {
        this.grantedPreviewIds.set(new Set(batch.items.map((item) => item.assetId)));
      }
    } catch {
      if (this.ownsLoad(key, generation)) {
        this.grantedPreviewIds.set(new Set());
      }
    }
  }

  private ownsLoad(key: string | null, generation: number): boolean {
    return this.loadedKey === key && this.loadGeneration === generation;
  }
}
