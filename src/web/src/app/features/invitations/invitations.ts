import { DatePipe } from '@angular/common';
import { Component, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { ClientInvitation } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { invitationStatusLabel } from '../../core/i18n/display-labels';
import { TenantStore } from '../../core/tenancy/tenant.store';

@Component({
  selector: 'app-invitations',
  imports: [DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './invitations.html',
  styleUrl: './invitations.scss',
})
export class Invitations {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly tenants = inject(TenantStore);
  private loadedTenantId: string | null = null;

  protected readonly invitations = signal<ClientInvitation[]>([]);
  protected readonly loading = signal(false);
  protected readonly submitting = signal(false);
  protected readonly actingOn = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly showForm = signal(false);
  protected readonly maximumBirthDate = adultCutoff();
  protected readonly invitationStatusLabel = invitationStatusLabel;
  protected readonly form = this.formBuilder.nonNullable.group({
    firstName: ['', [Validators.required, Validators.maxLength(100)]],
    lastName: ['', [Validators.required, Validators.maxLength(100)]],
    email: ['', [Validators.required, Validators.email]],
    phoneNumber: ['', Validators.maxLength(30)],
    birthDate: [''],
  });

  constructor() {
    effect(() => {
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.load();
      }
    });
  }

  protected async create(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      const value = this.form.getRawValue();
      const invitation = await firstValueFrom(
        this.api.createInvitation({
          email: value.email,
          firstName: value.firstName,
          lastName: value.lastName,
          phoneNumber: value.phoneNumber || null,
          birthDate: value.birthDate || null,
        }),
      );
      this.invitations.update((items) => [invitation, ...items]);
      this.form.reset();
      this.showForm.set(false);
      this.notice.set($localize`Invitation created and queued for delivery.`);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`The invitation could not be created.`));
    } finally {
      this.submitting.set(false);
    }
  }

  protected async resend(invitationId: string): Promise<void> {
    await this.runAction(
      invitationId,
      () => this.api.resendInvitation(invitationId),
      $localize`A new invitation link was queued.`,
    );
  }

  protected async revoke(invitationId: string): Promise<void> {
    await this.runAction(
      invitationId,
      () => this.api.revokeInvitation(invitationId),
      $localize`Invitation revoked.`,
    );
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.clearMessages();
    try {
      this.invitations.set(await firstValueFrom(this.api.getInvitations()));
    } catch (error) {
      this.invitations.set([]);
      this.error.set(apiErrorMessage(error, $localize`Invitations could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
  }

  private async runAction(
    invitationId: string,
    request: () => ReturnType<ApiClient['resendInvitation']>,
    successMessage: string,
  ): Promise<void> {
    this.actingOn.set(invitationId);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      const updated = await firstValueFrom(request());
      this.invitations.update((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      );
      this.notice.set(successMessage);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`The invitation could not be updated.`));
    } finally {
      this.actingOn.set(null);
    }
  }

  private clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
  }
}

function adultCutoff(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 18);
  return date.toISOString().slice(0, 10);
}
