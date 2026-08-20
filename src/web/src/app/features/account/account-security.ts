import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';

@Component({
  selector: 'app-account-security',
  imports: [ReactiveFormsModule],
  templateUrl: './account-security.html',
  styleUrl: './account-security.scss',
})
export class AccountSecurity {
  private readonly api = inject(ApiClient);
  protected readonly auth = inject(AuthStore);
  private readonly csrf = inject(CsrfService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly router = inject(Router);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly form = this.formBuilder.nonNullable.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(12)]],
    confirmPassword: ['', Validators.required],
  });

  protected async changePassword(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    if (value.newPassword !== value.confirmPassword) {
      this.error.set($localize`Passwords do not match.`);
      return;
    }

    this.busy.set(true);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      await firstValueFrom(this.api.changePassword(value.currentPassword, value.newPassword));
      this.form.reset();
      this.notice.set($localize`Password changed.`);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`The password could not be changed.`));
    } finally {
      this.busy.set(false);
    }
  }

  protected async revokeSessions(): Promise<void> {
    this.busy.set(true);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      await firstValueFrom(this.api.revokeAllSessions());
      await this.auth.initialize(true);
      await this.router.navigateByUrl('/auth/sign-in');
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`Sessions could not be revoked.`));
    } finally {
      this.busy.set(false);
    }
  }

  private clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
  }
}
