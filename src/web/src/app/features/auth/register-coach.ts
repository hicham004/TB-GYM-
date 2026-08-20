import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { RegistrationResponse } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';

@Component({
  selector: 'app-register-coach',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register-coach.html',
  styleUrl: './auth.scss',
})
export class RegisterCoach {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly registration = signal<RegistrationResponse | null>(null);
  protected readonly form = this.formBuilder.nonNullable.group({
    displayName: ['', [Validators.required, Validators.maxLength(200)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(12)]],
    confirmPassword: ['', Validators.required],
    workspaceName: ['', [Validators.required, Validators.maxLength(200)]],
    timeZoneId: ['Asia/Beirut', Validators.required],
    defaultCulture: ['en-LB', Validators.required],
    defaultCurrencyCode: ['USD', [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)]],
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
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
      this.registration.set(
        await firstValueFrom(
          this.api.registerCoach({
            displayName: value.displayName,
            email: value.email,
            password: value.password,
            workspaceName: value.workspaceName,
            timeZoneId: value.timeZoneId,
            defaultCulture: value.defaultCulture,
            defaultCurrencyCode: value.defaultCurrencyCode.toUpperCase(),
            weekStartsOn: 'Monday',
          }),
        ),
      );
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`Your coach account could not be created.`));
    } finally {
      this.submitting.set(false);
    }
  }
}
