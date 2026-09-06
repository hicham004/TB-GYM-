import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { PublicInvitation } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { ActionTokenScrubber } from '../../core/security/action-token.service';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';

@Component({
  selector: 'app-accept-invitation',
  imports: [DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './accept-invitation.html',
  styleUrl: './accept-invitation.scss',
})
export class AcceptInvitation implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly csrf = inject(CsrfService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly scrubber = inject(ActionTokenScrubber);
  private readonly tenants = inject(TenantStore);

  protected readonly invitation = signal<PublicInvitation | null>(null);
  protected readonly loading = signal(true);
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly token = signal('');
  protected readonly signedInUser = this.auth.user;
  protected readonly returnUrl = computed(
    () => `/invite?token=${encodeURIComponent(this.token())}`,
  );
  protected readonly signedInWithInvitedEmail = computed(() => {
    const userEmail = this.signedInUser()?.email;
    const invitedEmail = this.invitation()?.email;
    return !!userEmail && !!invitedEmail && userEmail.toLowerCase() === invitedEmail.toLowerCase();
  });
  protected readonly accountForm = this.formBuilder.nonNullable.group({
    displayName: ['', [Validators.required, Validators.maxLength(200)]],
    password: ['', [Validators.required, Validators.minLength(12)]],
    confirmPassword: ['', Validators.required],
  });

  async ngOnInit(): Promise<void> {
    await this.auth.initialize();
    const token = this.route.snapshot.queryParamMap.get('token') ?? '';
    this.token.set(token);
    if (!token) {
      this.error.set($localize`This invitation link is incomplete.`);
      this.loading.set(false);
      return;
    }

    try {
      const invitation = await firstValueFrom(this.api.getPublicInvitation(token));
      this.invitation.set(invitation);
      this.accountForm.controls.displayName.setValue(
        `${invitation.firstName} ${invitation.lastName}`.trim(),
      );
      if (invitation.status !== 'Pending') {
        // A terminal invitation has no usable credential left. Remove it from both the address bar
        // and this history entry as soon as the server establishes that fact.
        await this.scrubber.scrub(this.route);
      }
    } catch {
      this.error.set($localize`This invitation link is invalid or no longer available.`);
      // Unknown, expired, superseded and revoked links are all spent from the browser's point of
      // view. Keeping one visible cannot make it usable and only gives it more places to leak.
      await this.scrubber.scrub(this.route);
    } finally {
      this.loading.set(false);
    }
  }

  protected async accept(): Promise<void> {
    const invitation = this.invitation();
    if (!invitation || invitation.status !== 'Pending') {
      return;
    }

    const createsAccount = !invitation.requiresExistingAccountSignIn && !this.signedInUser();
    if (createsAccount && this.accountForm.invalid) {
      this.accountForm.markAllAsTouched();
      return;
    }

    const value = this.accountForm.getRawValue();
    if (createsAccount && value.password !== value.confirmPassword) {
      this.error.set($localize`Passwords do not match.`);
      this.clearCredentials();
      return;
    }

    this.submitting.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      const result = await firstValueFrom(
        this.api.acceptInvitation(
          this.token(),
          createsAccount ? value.displayName : null,
          createsAccount ? value.password : null,
        ),
      );
      // Acceptance is single-use, so the token in the address bar is now spent. Clearing it before
      // navigating away keeps it out of the history entry this page leaves behind.
      await this.scrubber.scrub(this.route);
      await this.auth.initialize(true);
      await this.tenants.load(result.tenantId);
      await this.router.navigateByUrl('/profile');
    } catch (error) {
      const code = error instanceof HttpErrorResponse ? error.error?.code : null;
      if (code === 'existing_account_sign_in_required') {
        this.error.set($localize`Sign in with the invited email before accepting.`);
      } else if (code === 'wrong_signed_in_account') {
        this.error.set($localize`Sign out and use the account matching the invited email.`);
      } else {
        this.error.set(apiErrorMessage(error, $localize`The invitation could not be accepted.`));
      }
      if (createsAccount) {
        this.clearCredentials();
      }
      if (error instanceof HttpErrorResponse && error.status === 410) {
        await this.scrubber.scrub(this.route);
      }
    } finally {
      this.submitting.set(false);
    }
  }

  protected async signOut(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/auth/sign-in'], {
      queryParams: { returnUrl: this.returnUrl() },
    });
  }

  private clearCredentials(): void {
    this.accountForm.controls.password.reset('');
    this.accountForm.controls.confirmPassword.reset('');
  }
}
