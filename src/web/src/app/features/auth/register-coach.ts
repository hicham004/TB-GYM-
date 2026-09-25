import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { RegistrationResponse } from '../../core/api/api.models';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { Button, ButtonLink } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { PasswordReveal } from '../../ui/password-reveal';
import { AuthFrame } from './auth-frame';
import { emailReasons, newPasswordReasons, requiredReason } from './auth-reasons';

@Component({
  selector: 'app-register-coach',
  imports: [
    AuthFrame,
    Button,
    ButtonLink,
    Control,
    Field,
    PasswordReveal,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './register-coach.html',
  styleUrl: './auth.scss',
})
export class RegisterCoach {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly summary = viewChild<ElementRef<HTMLElement>>('summary');

  protected readonly attempt = new FormAttempt();

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

  protected displayNameReasons(): string[] {
    const control = this.form.controls.displayName;
    if (control.hasError('required')) return [$localize`Enter your name.`];
    return control.hasError('maxlength') ? [$localize`Use 200 characters or fewer.`] : [];
  }

  protected workspaceNameReasons(): string[] {
    const control = this.form.controls.workspaceName;
    if (control.hasError('required')) return [$localize`Enter a name for your workspace.`];
    return control.hasError('maxlength') ? [$localize`Use 200 characters or fewer.`] : [];
  }

  protected emailReasons(): string[] {
    return emailReasons(this.form.controls.email);
  }

  protected passwordReasons(): string[] {
    return newPasswordReasons(this.form.controls.password);
  }

  protected confirmPasswordReasons(): string[] {
    return requiredReason(
      this.form.controls.confirmPassword,
      $localize`Enter the same password again.`,
    );
  }

  protected timeZoneReasons(): string[] {
    return requiredReason(
      this.form.controls.timeZoneId,
      $localize`Enter a time zone, such as Asia/Beirut.`,
    );
  }

  protected currencyReasons(): string[] {
    return this.form.controls.defaultCurrencyCode.invalid
      ? [$localize`Enter a three-letter currency code, such as USD.`]
      : [];
  }

  protected formReasons(): string[] {
    return [
      ...this.displayNameReasons(),
      ...this.workspaceNameReasons(),
      ...this.emailReasons(),
      ...this.passwordReasons(),
      ...this.confirmPasswordReasons(),
      ...this.timeZoneReasons(),
      ...this.currencyReasons(),
    ];
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.attempt.attempt();
      this.summary()?.nativeElement.focus();
      return;
    }

    const value = this.form.getRawValue();
    if (value.password !== value.confirmPassword) {
      this.error.set($localize`Passwords do not match.`);
      this.summary()?.nativeElement.focus();
      return;
    }

    this.attempt.reset();
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
