import { Component, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import {
  ClientSelfProfile,
  CompleteClientOnboardingRequest,
  UpdateClientIntakeRequest,
} from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { onboardingStatusLabel } from '../../core/i18n/display-labels';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ClientIntakeForm } from '../clients/client-intake-form';

@Component({
  selector: 'app-client-profile-page',
  imports: [ClientIntakeForm],
  templateUrl: './client-profile.html',
})
export class ClientProfilePage {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private loadedTenantId: string | null = null;

  protected readonly profile = signal<ClientSelfProfile | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
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

  protected async save(request: UpdateClientIntakeRequest): Promise<void> {
    await this.run(() => this.api.updateSelfIntake(request), $localize`Your intake was saved.`);
  }

  protected async complete(request: CompleteClientOnboardingRequest): Promise<void> {
    await this.run(
      () => this.api.completeSelfOnboarding(request),
      $localize`Your onboarding is complete.`,
    );
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.profile.set(await firstValueFrom(this.api.getSelfProfile()));
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`Your profile could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
  }

  private async run(
    request: () => ReturnType<ApiClient['updateSelfIntake']>,
    successMessage: string,
  ): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await this.csrf.refresh();
      this.profile.set(await firstValueFrom(request()));
      this.notice.set(successMessage);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`Your profile could not be saved.`));
    } finally {
      this.busy.set(false);
    }
  }
}
