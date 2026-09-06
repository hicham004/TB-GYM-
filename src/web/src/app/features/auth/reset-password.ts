import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { ActionTokenScrubber } from '../../core/security/action-token.service';
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
  private readonly scrubber = inject(ActionTokenScrubber);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly submitting = signal(false);
  protected readonly complete = signal(false);
  protected readonly error = signal<string | null>(null);
  /**
   * Captured once, from the URL, and held only in this component instance for the life of the page.
   * Reading it again after the exchange would be reading an address bar the scrubber has already
   * emptied, and holding it anywhere durable is the thing this whole design refuses.
   */
  private readonly userId = this.route.snapshot.queryParamMap.get('userId') ?? '';
  private readonly code = this.route.snapshot.queryParamMap.get('code') ?? '';

  protected readonly validLink = Boolean(this.userId) && Boolean(this.code);
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
      await firstValueFrom(this.api.resetPassword(this.userId, this.code, value.password));
      this.complete.set(true);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`The reset link is invalid or expired.`));
    } finally {
      this.submitting.set(false);
      // The token is single-use and has now been presented, so it is spent whether or not the reset
      // succeeded. Leaving it in the address bar would leave a spent credential on screen and in the
      // back stack for no benefit.
      await this.scrubber.scrub(this.route);
    }
  }
}
