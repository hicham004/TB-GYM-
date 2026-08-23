import { Component, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import {
  CoachClientDetails,
  CompleteClientOnboardingRequest,
  UpdateClientIntakeRequest,
} from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { onboardingStatusLabel } from '../../core/i18n/display-labels';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ClientIntakeForm } from './client-intake-form';
import { ClientCommercial } from '../commercial/client-commercial';
import { ClientTraining } from '../training/client-training';
import { ClientNutrition } from '../nutrition/client-nutrition';
import { ProgressView } from '../progress/progress-view';

@Component({
  selector: 'app-client-details',
  imports: [
    ClientCommercial,
    ClientIntakeForm,
    ClientTraining,
    ClientNutrition,
    ProgressView,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './client-details.html',
  styleUrl: './client-details.scss',
})
export class ClientDetails {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly tenants = inject(TenantStore);
  private loadedKey: string | null = null;
  private readonly clientId = this.route.snapshot.paramMap.get('clientId') ?? '';

  protected readonly profile = signal<CoachClientDetails | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly notesForm = this.formBuilder.nonNullable.group({
    notes: ['', Validators.maxLength(8000)],
  });
  protected readonly onboardingStatusLabel = onboardingStatusLabel;

  constructor() {
    effect(() => {
      const tenantId = this.tenants.selectedTenantId();
      const key = tenantId ? `${tenantId}:${this.clientId}` : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.load();
      }
    });
  }

  protected async saveIntake(request: UpdateClientIntakeRequest): Promise<void> {
    await this.run(
      () => this.api.updateClientIntake(this.clientId, request),
      $localize`Client intake saved.`,
    );
  }

  protected async completeOnboarding(request: CompleteClientOnboardingRequest): Promise<void> {
    await this.run(
      () => this.api.completeClientOnboarding(this.clientId, request),
      $localize`Client onboarding completed.`,
    );
  }

  protected async saveNotes(): Promise<void> {
    const profile = this.profile();
    if (!profile || this.notesForm.invalid) {
      this.notesForm.markAllAsTouched();
      return;
    }
    await this.run(
      () =>
        this.api.updateCoachNotes(
          this.clientId,
          this.notesForm.getRawValue().notes || null,
          profile.version,
        ),
      $localize`Coach notes saved.`,
    );
  }

  protected commercialProfileChanged(profile: CoachClientDetails): void {
    this.setProfile(profile);
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.clearMessages();
    try {
      const profile = await firstValueFrom(this.api.getClient(this.clientId));
      this.setProfile(profile);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`The client profile could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
  }

  private async run(
    request: () => ReturnType<ApiClient['updateClientIntake']>,
    successMessage: string,
  ): Promise<void> {
    this.busy.set(true);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      this.setProfile(await firstValueFrom(request()));
      this.notice.set(successMessage);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`The client profile could not be saved.`));
    } finally {
      this.busy.set(false);
    }
  }

  private setProfile(profile: CoachClientDetails): void {
    this.profile.set(profile);
    this.notesForm.controls.notes.setValue(profile.coachNotes ?? '');
  }

  private clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
  }
}
