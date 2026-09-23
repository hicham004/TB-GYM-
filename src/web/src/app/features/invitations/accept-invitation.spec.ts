import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  CurrentUser,
  InvitationAcceptance,
  PublicInvitation,
} from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { ActionTokenScrubber } from '../../core/security/action-token.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, field as labeledField, fill, press, query, settle } from '../../../testing/dom';
import { AcceptInvitation } from './accept-invitation';

const TOKEN = 'invitation-token-1';

function invitation(overrides: Partial<PublicInvitation> = {}): PublicInvitation {
  return {
    workspaceName: 'TB Gym',
    email: 'rana@example.test',
    firstName: 'Rana',
    lastName: 'Haddad',
    status: 'Pending',
    expiresAtUtc: '2026-09-01T09:00:00Z',
    requiresExistingAccountSignIn: false,
    ...overrides,
  };
}

const ACCEPTED: InvitationAcceptance = {
  tenantId: 'tenant-1',
  clientProfileId: 'client-1',
  signedIn: true,
  kind: 'Client',
};

function user(email: string): CurrentUser {
  return {
    id: 'user-1',
    email,
    displayName: 'Rana Haddad',
    preferredCulture: 'en-LB',
    emailConfirmed: true,
    roles: [],
  };
}

async function render(
  options: {
    invitation?: PublicInvitation;
    signedInAs?: CurrentUser | null;
    token?: string;
    api?: Partial<ApiClient>;
  } = {},
) {
  const token = options.token ?? TOKEN;
  const currentUser = signal<CurrentUser | null>(options.signedInAs ?? null);
  const scrubber = { scrub: vi.fn(() => Promise.resolve()) };
  await TestBed.configureTestingModule({
    imports: [AcceptInvitation],
    providers: [
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(token ? { token } : {}) } },
      },
      {
        provide: ApiClient,
        useValue: {
          getPublicInvitation: vi.fn(() => of(options.invitation ?? invitation())),
          acceptInvitation: vi.fn(() => of(ACCEPTED)),
          ...options.api,
        },
      },
      {
        provide: AuthStore,
        useValue: {
          user: currentUser,
          initialize: vi.fn(() => Promise.resolve()),
          // Signing out really clears the session here, because the page's behaviour after it
          // depends on the session being gone rather than on the call having been made.
          logout: vi.fn(() => {
            currentUser.set(null);
            return Promise.resolve();
          }),
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: ActionTokenScrubber, useValue: scrubber },
      { provide: TenantStore, useValue: { load: vi.fn(() => Promise.resolve()) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AcceptInvitation);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api: TestBed.inject(ApiClient),
    auth: TestBed.inject(AuthStore),
    tenants: TestBed.inject(TenantStore),
    router: TestBed.inject(Router),
    scrubber,
  };
}

describe('AcceptInvitation', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * The only door a client enters through. Accepting creates the account and the membership in one
   * request, so a form field that never reaches the model would send a null password to the server
   * or refuse to submit at all, and the invited client would have no way in.
   */
  it('creates the account and joins the workspace from what was typed', async () => {
    const { fixture, host, api, tenants, router } = await render();
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    // The invited name is offered as a starting point rather than an empty field.
    expect(field(host).value).toBe('Rana Haddad');

    fill(host, 'Display name', 'Rana H.');
    fill(host, 'Password', 'correct-horse-battery');
    fill(host, 'Confirm password', 'correct-horse-battery');
    await settle(fixture);

    expect(button(host, 'Create account and join').disabled).toBe(false);
    press(host, 'Create account and join');
    await settle(fixture);

    expect(api.acceptInvitation).toHaveBeenCalledWith(TOKEN, 'Rana H.', 'correct-horse-battery');
    // The workspace the invitation belongs to becomes the active one, not whatever was last used.
    expect(tenants.load).toHaveBeenCalledWith('tenant-1');
    expect(navigate).toHaveBeenCalledWith('/profile');
  });

  /** A coach invitation adds the person to the team (ADR 0026); they land on the coach dashboard. */
  it('joins a coach to the team and opens the coach dashboard rather than a client profile', async () => {
    const { fixture, host, api, tenants, router } = await render({
      invitation: invitation({ kind: 'Coach' }),
      api: {
        acceptInvitation: vi.fn(() =>
          of<InvitationAcceptance>({ ...ACCEPTED, clientProfileId: null, kind: 'Coach' }),
        ),
      },
    });
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    expect(host.querySelector('h1')?.textContent).toContain('Join the coaching team');
    expect(host.textContent).toContain('Create your coach account');

    fill(host, 'Password', 'correct-horse-battery');
    fill(host, 'Confirm password', 'correct-horse-battery');
    await settle(fixture);
    press(host, 'Create account and join');
    await settle(fixture);

    expect(api.acceptInvitation).toHaveBeenCalledWith(
      TOKEN,
      'Rana Haddad',
      'correct-horse-battery',
    );
    expect(tenants.load).toHaveBeenCalledWith('tenant-1');
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('explains an invalid password instead of making the submit button appear broken', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Password', 'TooShort1!');
    fill(host, 'Confirm password', 'TooShort1!');
    press(host, 'Create account and join');
    await settle(fixture);

    expect(query(host, '#invitation-password-error').textContent).toContain(
      'at least 12 characters',
    );
    expect(labeledField(host, 'Password').getAttribute('aria-invalid')).toBe('true');
    expect(api.acceptInvitation).not.toHaveBeenCalled();
  });

  /**
   * An already-signed-in client accepts with no credentials at all. Sending the untouched form's
   * empty strings instead of nulls would ask the server to reset their password to "".
   */
  it('accepts with no credentials when the invited user is already signed in', async () => {
    const { fixture, host, api, router } = await render({
      signedInAs: user('rana@example.test'),
    });
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    expect(host.textContent).toContain('Accept this invitation using rana@example.test');
    expect(host.querySelector('input[type="password"]')).toBeNull();

    press(host, 'Accept invitation');
    await settle(fixture);

    expect(api.acceptInvitation).toHaveBeenCalledWith(TOKEN, null, null);
  });

  /**
   * The wrong signed-in account is the ordinary case for a coach opening the link they just issued
   * in their own browser, and it must not become a dead end. Signing out has to leave the invitee
   * on the invitation with the account form in front of them: an invited client has no account to
   * sign in with, so a page that sent them to sign-in offered them nothing they could use and left
   * the token behind in a query parameter of the page they had left.
   */
  it('stays on the invitation and offers account creation after signing the wrong account out', async () => {
    const { fixture, host, api, auth } = await render({
      signedInAs: user('someone-else@example.test'),
    });

    expect(host.textContent).toContain('this invitation belongs to rana@example.test');
    // Nothing is accepted under the wrong account.
    expect(api.acceptInvitation).not.toHaveBeenCalled();

    press(host, 'Sign out and continue');
    await settle(fixture);

    expect(auth.logout).toHaveBeenCalled();
    // Asked again, because who the invitation requires depends on who is signed in.
    expect(api.getPublicInvitation).toHaveBeenCalledTimes(2);
    expect(button(host, 'Create account and join')).toBeTruthy();
    // The link is still held, and was never scrubbed on the way through.
    expect(host.textContent).not.toContain('no longer available');
  });

  it('offers sign-in rather than account creation when the email already has an account', async () => {
    const { host } = await render({
      invitation: invitation({ requiresExistingAccountSignIn: true }),
    });

    expect(host.textContent).toContain('An account already exists for this email');
    expect(host.querySelector('input[type="password"]')).toBeNull();
    const signIn = query<HTMLAnchorElement>(host, 'a.primary-button');
    // The link carries the invitation back, so signing in does not lose it.
    expect(signIn.getAttribute('href')).toContain('returnUrl');
    expect(signIn.getAttribute('href')).toContain(encodeURIComponent(TOKEN));
  });

  it('refuses two different passwords without creating anything', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Display name', 'Rana H.');
    fill(host, 'Password', 'correct-horse-battery');
    fill(host, 'Confirm password', 'correct-horse-batteryy');
    await settle(fixture);
    press(host, 'Create account and join');
    await settle(fixture);

    expect(api.acceptInvitation).not.toHaveBeenCalled();
    expect(query(host, '[role="alert"]').textContent).toContain('Passwords do not match.');
    expect(field(host).value).toBe('Rana H.');
    expect(passwords(host).map((input) => input.value)).toEqual(['', '']);
  });

  it('does not submit a password shorter than the policy allows', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Display name', 'Rana H.');
    fill(host, 'Password', 'short');
    fill(host, 'Confirm password', 'short');
    await settle(fixture);
    press(host, 'Create account and join');
    await settle(fixture);

    expect(api.acceptInvitation).not.toHaveBeenCalled();
  });

  it('says an accepted invitation is spent instead of offering to accept it again', async () => {
    const { host, scrubber } = await render({ invitation: invitation({ status: 'Accepted' }) });

    expect(host.textContent).toContain('This invitation has already been accepted.');
    expect(host.querySelector('form')).toBeNull();
    expect(scrubber.scrub).toHaveBeenCalledOnce();
  });

  it('says a revoked invitation is closed rather than offering a form', async () => {
    const { host } = await render({ invitation: invitation({ status: 'Revoked' }) });

    expect(host.textContent).toContain('This invitation is no longer active.');
    expect(host.querySelector('form')).toBeNull();
  });

  it('explains a link with no token instead of rendering an empty invitation', async () => {
    const { host, api } = await render({ token: '' });

    expect(host.textContent).toContain('This invitation link is incomplete.');
    expect(api.getPublicInvitation).not.toHaveBeenCalled();
  });

  it('reports an unknown or expired token as an unavailable link', async () => {
    const { host, scrubber } = await render({
      api: {
        getPublicInvitation: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 404 }))),
      },
    });

    expect(host.textContent).toContain('This invitation link is invalid or no longer available.');
    expect(host.querySelector('form')).toBeNull();
    expect(scrubber.scrub).toHaveBeenCalledOnce();
  });

  /**
   * A rate limit, a restarting API or a dropped connection says nothing about the invitation.
   * Scrubbing on one of those destroyed the holder's only copy of a link that still worked — the
   * address bar is where it lives — so a link is spent only when the server says it is gone.
   */
  it('keeps a token the server never rejected and offers a retry', async () => {
    const getPublicInvitation = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 429 })))
      .mockReturnValueOnce(of(invitation()));
    const { fixture, host, scrubber } = await render({ api: { getPublicInvitation } });

    expect(host.textContent).toContain('Check your connection and try again.');
    expect(scrubber.scrub).not.toHaveBeenCalled();

    press(host, 'Try again');
    await settle(fixture);

    expect(button(host, 'Create account and join')).toBeTruthy();
  });

  it('removes a token the server rejects as expired after an acceptance attempt', async () => {
    const expired = new HttpErrorResponse({
      status: 410,
      error: { code: 'invitation_invalid_or_expired' },
    });
    const { fixture, host, scrubber } = await render({
      signedInAs: user('rana@example.test'),
      api: { acceptInvitation: vi.fn(() => throwError(() => expired)) },
    });

    press(host, 'Accept invitation');
    await settle(fixture);

    expect(scrubber.scrub).toHaveBeenCalledOnce();
  });

  it('preserves the display name but clears credentials after a failed account creation', async () => {
    const refused = new HttpErrorResponse({ status: 503 });
    const { fixture, host } = await render({
      api: { acceptInvitation: vi.fn(() => throwError(() => refused)) },
    });

    fill(host, 'Display name', 'Rana H.');
    fill(host, 'Password', 'correct-horse-battery');
    fill(host, 'Confirm password', 'correct-horse-battery');
    await settle(fixture);
    press(host, 'Create account and join');
    await settle(fixture);

    expect(field(host).value).toBe('Rana H.');
    expect(passwords(host).map((input) => input.value)).toEqual(['', '']);
  });

  it('names the mismatched-account refusal the server sent rather than a generic failure', async () => {
    const refused = new HttpErrorResponse({
      status: 409,
      error: { code: 'wrong_signed_in_account' },
    });
    const { fixture, host } = await render({
      signedInAs: user('rana@example.test'),
      api: { acceptInvitation: vi.fn(() => throwError(() => refused)) },
    });

    press(host, 'Accept invitation');
    await settle(fixture);

    expect(query(host, '[role="alert"]').textContent).toContain(
      'Sign out and use the account matching the invited email.',
    );
  });
});

/** The display-name control, addressed without assuming which binding fills it. */
function field(host: HTMLElement): HTMLInputElement {
  return query<HTMLInputElement>(host, 'input[type="text"]');
}

function passwords(host: HTMLElement): HTMLInputElement[] {
  return Array.from(host.querySelectorAll<HTMLInputElement>('input[type="password"]'));
}
