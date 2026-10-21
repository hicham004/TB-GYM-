import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
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
export class SignIn implements OnInit {
  private readonly auth = inject(AuthStore);
  private readonly document = inject(DOCUMENT);
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly summary = viewChild.required<ElementRef<HTMLElement>>('summary');

  protected readonly attempt = new FormAttempt();

  /** Sent here because the session ended while the app was open (WEB-1). */
  protected readonly sessionEnded =
    this.route.snapshot.queryParamMap.get('reason') === SESSION_ENDED_REASON;
  /**
   * The page arrives as finished HTML (audit UIQ-13), and until the app has taken it over the button
   * is disabled: Enter or a tap then does nothing, where a native submit would reload the page and
   * lose what was typed. Once the app is live it submits.
   */
  protected readonly live = signal(false);
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly needsConfirmation = signal(false);
  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
    rememberMe: [false],
  });

  constructor() {
    afterNextRender(() => this.live.set(true));
  }

  /**
   * Starts the form from what the fields already hold. In the same pass as the form's first write
   * into them, so nothing typed into the pre-rendered page before the app took it over is lost.
   */
  ngOnInit(): void {
    this.form.setValue(typedBeforeTheApp(this.document), { emitEvent: false });
  }

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
 * What was typed into the pre-rendered form before the app took the page over (audit UIQ-13). On a
 * slow connection the fields of the finished HTML take typing, or a password manager's fill, before
 * the scripts arrive; the form starts from that, as Angular would otherwise empty the fields when it
 * binds them. On any later visit the fields the page has just drawn are empty, and so is the form.
 */
function typedBeforeTheApp(document: Document): {
  email: string;
  password: string;
  rememberMe: boolean;
} {
  const field = (id: string) => document.getElementById(id) as HTMLInputElement | null;
  return {
    email: field('sign-in-email')?.value ?? '',
    password: field('sign-in-password')?.value ?? '',
    rememberMe: field('sign-in-remember')?.checked ?? false,
  };
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
