import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api-error';
import { AuthStore } from '../../core/auth/auth.store';
import { SESSION_ENDED_REASON } from '../../core/auth/session-expiry';
import { FormAttempt } from '../../core/forms/form-attempt';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Control, Field } from '../../ui/field';
import { PasswordReveal } from '../../ui/password-reveal';
import { AuthFrame } from './auth-frame';
import { emailReasons, requiredReason } from './auth-reasons';

@Component({
  selector: 'app-sign-in',
  imports: [
    AuthFrame,
    Button,
    Checkbox,
    Control,
    Field,
    PasswordReveal,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './sign-in.html',
  styleUrl: './auth.scss',
})
export class SignIn {
  private readonly auth = inject(AuthStore);
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly summary = viewChild.required<ElementRef<HTMLElement>>('summary');

  protected readonly attempt = new FormAttempt();

  /** Sent here because the session ended while the app was open (WEB-1). */
  protected readonly sessionEnded =
    this.route.snapshot.queryParamMap.get('reason') === SESSION_ENDED_REASON;
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly needsConfirmation = signal(false);
  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
    rememberMe: [false],
  });

  protected emailReasons(): string[] {
    return emailReasons(this.form.controls.email);
  }

  protected passwordReasons(): string[] {
    return requiredReason(this.form.controls.password, $localize`Enter your password.`);
  }

  protected formReasons(): string[] {
    return [...this.emailReasons(), ...this.passwordReasons()];
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.attempt.attempt();
      this.summary().nativeElement.focus();
      return;
    }

    this.attempt.reset();
    this.submitting.set(true);
    this.error.set(null);
    this.needsConfirmation.set(false);
    try {
      const value = this.form.getRawValue();
      await this.auth.login(value.email, value.password, value.rememberMe);
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      await this.router.navigateByUrl(returnUrl?.startsWith('/') ? returnUrl : '/');
    } catch (error) {
      const code = error instanceof HttpErrorResponse ? error.error?.code : null;
      this.needsConfirmation.set(code === 'email_not_confirmed');
      this.error.set(signInFailure(error));
    } finally {
      this.submitting.set(false);
    }
  }
}

/**
 * What a refused sign-in says (audit AUTH-2, AUTH-15). Only a 401 means a wrong email or password; a
 * locked account and a busy network say when to try again, and a failure that never reached the
 * password check does not blame the password.
 */
function signInFailure(error: unknown): string {
  const code = error instanceof HttpErrorResponse ? error.error?.code : null;
  if (code === 'email_not_confirmed') return $localize`Confirm your email before signing in.`;
  const unreachable = $localize`You couldn’t be signed in. Check your connection and try again.`;
  if (code === 'account_locked' || code === 'too_many_attempts') {
    return apiErrorMessage(error, unreachable);
  }
  return error instanceof HttpErrorResponse && error.status === 401
    ? $localize`Email or password is incorrect.`
    : unreachable;
}
