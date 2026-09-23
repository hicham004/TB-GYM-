import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { Component, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
import { ProgressDashboardView } from '../progress/progress-dashboard';
import { ConversationLaunch } from '../messaging/conversation-launch';
import { ClientCoach } from './client-coach';

@Component({
  selector: 'app-client-details',
  imports: [
    ClientCoach,
    ClientCommercial,
    ClientIntakeForm,
    ClientTraining,
    ClientNutrition,
    ProgressDashboardView,
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
  private readonly router = inject(Router);
  private readonly conversationLaunch = inject(ConversationLaunch);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedKey: string | null = null;
  private readonly clientId = this.route.snapshot.paramMap.get('clientId') ?? '';
  private readonly conversationKeys = new Map<string, string>();
  protected readonly startingConversation = signal(false);

  protected readonly profile = signal<CoachClientDetails | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly notesForm = this.formBuilder.nonNullable.group({
    notes: ['', Validators.maxLength(8000)],
  });
  protected readonly onboardingStatusLabel = onboardingStatusLabel;
  /** Presentation only: the API decides who may reassign a client. */
  protected readonly isOwner = this.tenants.isOwner;

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const key = tenantId ? `${tenantId}:${this.clientId}` : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.load();
      }
    });
  }

  protected async saveIntake(request: UpdateClientIntakeRequest): Promise<void> {
    return this.scope.run('saveIntake', async (owner) => {
      await owner.wait(
        this.run(
          () => this.api.updateClientIntake(this.clientId, request),
          $localize`Client intake saved.`,
        ),
      );
    });
  }

  protected async messageClient(): Promise<void> {
    return this.scope.run('messageClient', async (owner) => {
      const tenantId = this.tenants.selectedTenantId();
      if (!tenantId || this.startingConversation()) return;
      const key = this.conversationKeys.get(tenantId) ?? crypto.randomUUID();
      this.conversationKeys.set(tenantId, key);
      this.startingConversation.set(true);
      this.error.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        if (tenantId !== this.tenants.selectedTenantId()) return;
        const detail = await owner.wait(
          firstValueFrom(this.api.createDirectConversation(this.clientId, key)),
        );
        if (tenantId !== this.tenants.selectedTenantId()) return;
        this.conversationLaunch.open(tenantId, detail.conversation);
        await owner.wait(this.router.navigateByUrl('/messages'));
      } catch (error) {
        if (!owner.current) return;
        if (tenantId === this.tenants.selectedTenantId()) {
          this.error.set(
            apiErrorMessage(
              error,
              $localize`Couldn’t open this conversation. Check messaging access and retry.`,
            ),
          );
        }
      } finally {
        if (owner.current) {
          this.startingConversation.set(false);
        }
      }
    });
  }

  protected async completeOnboarding(request: CompleteClientOnboardingRequest): Promise<void> {
    return this.scope.run('completeOnboarding', async (owner) => {
      await owner.wait(
        this.run(
          () => this.api.completeClientOnboarding(this.clientId, request),
          $localize`Client onboarding completed.`,
        ),
      );
    });
  }

  protected async saveNotes(): Promise<void> {
    return this.scope.run('saveNotes', async (owner) => {
      const profile = this.profile();
      if (!profile || this.notesForm.invalid) {
        this.notesForm.markAllAsTouched();
        return;
      }
      await owner.wait(
        this.run(
          () =>
            this.api.updateCoachNotes(
              this.clientId,
              this.notesForm.getRawValue().notes || null,
              profile.version,
            ),
          $localize`Coach notes saved.`,
        ),
      );
    });
  }

  protected commercialProfileChanged(profile: CoachClientDetails): void {
    this.setProfile(profile);
  }

  protected coachChanged(profile: CoachClientDetails): void {
    this.setProfile(profile);
  }

  private async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.loading.set(true);
      this.clearMessages();
      try {
        const profile = await owner.wait(firstValueFrom(this.api.getClient(this.clientId)));
        this.setProfile(profile);
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`The client profile could not be loaded.`));
      } finally {
        if (owner.current) {
          this.loading.set(false);
        }
      }
    });
  }

  private async run(
    request: () => ReturnType<ApiClient['updateClientIntake']>,
    successMessage: string,
  ): Promise<void> {
    return this.scope.run('run', async (owner) => {
      this.busy.set(true);
      this.clearMessages();
      try {
        await owner.wait(this.csrf.refresh());
        this.setProfile(await owner.wait(firstValueFrom(request())));
        this.notice.set(successMessage);
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`The client profile could not be saved.`));
      } finally {
        if (owner.current) {
          this.busy.set(false);
        }
      }
    });
  }

  private setProfile(profile: CoachClientDetails): void {
    this.profile.set(profile);
    this.notesForm.controls.notes.setValue(profile.coachNotes ?? '');
  }

  private clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
  }

  private resetTenantState(): void {
    this.loadedKey = null;
    this.conversationKeys.clear();
    this.startingConversation.set(false);
    this.profile.set(null);
    this.loading.set(false);
    this.busy.set(false);
    this.error.set(null);
    this.notice.set(null);
    this.notesForm.reset();
  }
}
