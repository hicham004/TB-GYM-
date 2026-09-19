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
  /** Whether the load failed because the server said the link is gone, rather than transiently. */
  protected readonly spent = signal(false);
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

    await this.load();
  }

  /**
   * Reads the invitation the held token names.
   *
   * Separate from `ngOnInit` because the answer depends on who is signed in — `requiresExistingAccountSignIn`
   * is decided against the caller's own session — so signing an account out has to ask again rather
   * than reuse a reply that was computed for somebody else.
   *
   * The token comes from the signal rather than the route, deliberately: the scrubber may already
   * have emptied the address bar, and this component is the only thing that still holds the value.
   */
  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const invitation = await firstValueFrom(this.api.getPublicInvitation(this.token()));
      this.invitation.set(invitation);
      this.accountForm.controls.displayName.setValue(
        `${invitation.firstName} ${invitation.lastName}`.trim(),
      );
      if (invitation.status !== 'Pending') {
        // A terminal invitation has no usable credential left. Remove it from both the address bar
        // and this history entry as soon as the server establishes that fact.
        await this.scrubber.scrub(this.route);
      }
    } catch (error) {
      // Only a server answer that the link is *gone* may spend it. A rate limit, a restarting API
      // or a dropped connection says nothing about the invitation, and scrubbing on one of those
      // destroyed the person's only copy of a link that still worked — with no way to get it back,
      // since the address bar was the only place it existed.
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      this.spent.set(status === 404 || status === 410);
      this.error.set(
        this.spent()
          ? $localize`This invitation link is invalid or no longer available.`
          : $localize`This invitation could not be loaded. Check your connection and try again.`,
      );
      if (this.spent()) {
        await this.scrubber.scrub(this.route);
      }
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

  /**
   * Signs the wrong account out and stays on the invitation.
   *
   * It deliberately does not navigate to the sign-in page. The person holding this link usually has
   * no account at all — that is the ordinary case for an invited client — and sign-in has nothing
   * for them: it cannot create a client account, and the only account it offers to create is a
   * coach workspace. Sending them there stranded them one step away from the one form that could
   * help, with the token left behind in a query parameter of the page they had just left.
   *
   * Staying put re-asks the server who this invitation is for now that nobody is signed in, which
   * is what decides between the create-account form and the sign-in prompt below it.
   */
  protected async signOut(): Promise<void> {
    this.submitting.set(true);
    try {
      await this.auth.logout();
    } catch {
      // A session the server has already dropped is the state this button was trying to reach; the
      // reinitialize below establishes what is actually true either way.
    } finally {
      this.submitting.set(false);
    }

    await this.auth.initialize(true);
    await this.load();
  }

  private clearCredentials(): void {
    this.accountForm.controls.password.reset('');
    this.accountForm.controls.confirmPassword.reset('');
  }
}
