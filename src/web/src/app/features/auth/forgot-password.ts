import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { EmailActionResponse } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';

@Component({
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password.html',
  styleUrl: './auth.scss',
})
export class ForgotPassword {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<EmailActionResponse | null>(null);
  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      this.result.set(await firstValueFrom(this.api.forgotPassword(this.form.getRawValue().email)));
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`The reset request could not be sent.`));
    } finally {
      this.submitting.set(false);
    }
  }
}
