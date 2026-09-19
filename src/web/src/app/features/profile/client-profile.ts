import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
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
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedTenantId: string | null = null;

  protected readonly profile = signal<ClientSelfProfile | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
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

  protected async save(request: UpdateClientIntakeRequest): Promise<void> {
    return this.scope.run('save', async (owner) => {
      await owner.wait(
        this.run(() => this.api.updateSelfIntake(request), $localize`Your intake was saved.`),
      );
    });
  }

  protected async complete(request: CompleteClientOnboardingRequest): Promise<void> {
    return this.scope.run('complete', async (owner) => {
      await owner.wait(
        this.run(
          () => this.api.completeSelfOnboarding(request),
          $localize`Your onboarding is complete.`,
        ),
      );
    });
  }

  private async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.loading.set(true);
      this.error.set(null);
      try {
        this.profile.set(await owner.wait(firstValueFrom(this.api.getSelfProfile())));
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`Your profile could not be loaded.`));
      } finally {
        if (owner.current) {
          this.loading.set(false);
        }
      }
    });
  }

  private async run(
    request: () => ReturnType<ApiClient['updateSelfIntake']>,
    successMessage: string,
  ): Promise<void> {
    return this.scope.run('run', async (owner) => {
      this.busy.set(true);
      this.error.set(null);
      this.notice.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        this.profile.set(await owner.wait(firstValueFrom(request())));
        this.notice.set(successMessage);
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`Your profile could not be saved.`));
      } finally {
        if (owner.current) {
          this.busy.set(false);
        }
      }
    });
  }

  private resetTenantState(): void {
    this.loadedTenantId = null;
    this.profile.set(null);
    this.loading.set(false);
    this.busy.set(false);
    this.error.set(null);
    this.notice.set(null);
  }
}
