import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { CsrfService } from '../../core/security/csrf.service';

@Component({
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './reset-password.html',
  styleUrl: './auth.scss',
})
export class ResetPassword {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly route = inject(ActivatedRoute);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly submitting = signal(false);
  protected readonly complete = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly validLink =
    Boolean(this.route.snapshot.queryParamMap.get('userId')) &&
    Boolean(this.route.snapshot.queryParamMap.get('code'));
  protected readonly form = this.formBuilder.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(12)]],
    confirmPassword: ['', Validators.required],
  });

  protected async submit(): Promise<void> {
    if (!this.validLink || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    if (value.password !== value.confirmPassword) {
      this.error.set($localize`Passwords do not match.`);
      return;
    }

    this.submitting.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      await firstValueFrom(
        this.api.resetPassword(
          this.route.snapshot.queryParamMap.get('userId') ?? '',
          this.route.snapshot.queryParamMap.get('code') ?? '',
          value.password,
        ),
      );
      this.complete.set(true);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`The reset link is invalid or expired.`));
    } finally {
      this.submitting.set(false);
    }
  }
}
