import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';

@Component({
  selector: 'app-sign-in',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './sign-in.html',
  styleUrl: './auth.scss',
})
export class SignIn {
  private readonly auth = inject(AuthStore);
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly needsConfirmation = signal(false);
  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
    rememberMe: [false],
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

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
      this.error.set(
        code === 'email_not_confirmed'
          ? $localize`Confirm your email before signing in.`
          : $localize`Email or password is incorrect.`,
      );
    } finally {
      this.submitting.set(false);
    }
  }
}
