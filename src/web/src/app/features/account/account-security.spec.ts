import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { CurrentUser } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { button, field, fill, press, query, settle } from '../../../testing/dom';
import { AccountSecurity } from './account-security';

const USER: CurrentUser = {
  id: 'user-1',
  email: 'coach@example.test',
  displayName: 'Tarek Bou',
  preferredCulture: 'en-LB',
  emailConfirmed: true,
  roles: [],
};

async function render(api: Partial<ApiClient> = {}) {
  await TestBed.configureTestingModule({
    imports: [AccountSecurity],
    providers: [
      provideRouter([]),
      {
        provide: ApiClient,
        useValue: {
          changePassword: vi.fn(() => of(undefined)),
          revokeAllSessions: vi.fn(() => of(undefined)),
          ...api,
        },
      },
      {
        provide: AuthStore,
        useValue: { user: signal(USER), initialize: vi.fn(() => Promise.resolve()) },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AccountSecurity);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api: TestBed.inject(ApiClient),
    router: TestBed.inject(Router),
  };
}

describe('AccountSecurity', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * A password change needs the current password as well as the new one. A control that never
   * reaches the model would send the wrong pair, and the server's refusal would look like the
   * user misremembering their own password.
   */
  it('changes the password using both the old and the new one', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Current password', 'old-horse-battery');
    fill(host, 'New password', 'correct-horse-battery');
    fill(host, 'Confirm new password', 'correct-horse-battery');
    await settle(fixture);

    expect(button(host, 'Change password').disabled).toBe(false);
    press(host, 'Change password');
    await settle(fixture);

    expect(api.changePassword).toHaveBeenCalledWith('old-horse-battery', 'correct-horse-battery');
    expect(host.textContent).toContain('Password changed.');
  });

  /** The typed passwords must not survive on screen once they have been used. */
  it('clears the form after a successful change', async () => {
    const { fixture, host } = await render();

    fill(host, 'Current password', 'old-horse-battery');
    fill(host, 'New password', 'correct-horse-battery');
    fill(host, 'Confirm new password', 'correct-horse-battery');
    await settle(fixture);
    press(host, 'Change password');
    await settle(fixture);

    expect(field(host, 'Current password').value).toBe('');
    expect(field(host, 'New password').value).toBe('');
    expect(field(host, 'Confirm new password').value).toBe('');
  });

  it('refuses two different new passwords without calling the server', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Current password', 'old-horse-battery');
    fill(host, 'New password', 'correct-horse-battery');
    fill(host, 'Confirm new password', 'correct-horse-batteryy');
    await settle(fixture);
    press(host, 'Change password');
    await settle(fixture);

    expect(api.changePassword).not.toHaveBeenCalled();
    expect(query(host, '[role="alert"]').textContent).toContain('Passwords do not match.');
  });

  it('does not submit a new password shorter than the policy allows', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Current password', 'old-horse-battery');
    fill(host, 'New password', 'short');
    fill(host, 'Confirm new password', 'short');
    await settle(fixture);
    press(host, 'Change password');
    await settle(fixture);

    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it('does not submit without the current password', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'New password', 'correct-horse-battery');
    fill(host, 'Confirm new password', 'correct-horse-battery');
    await settle(fixture);
    press(host, 'Change password');
    await settle(fixture);

    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it('reports a wrong current password rather than claiming the change succeeded', async () => {
    const wrong = new HttpErrorResponse({
      status: 400,
      error: { message: 'The current password is incorrect.' },
    });
    const { fixture, host } = await render({
      changePassword: vi.fn(() => throwError(() => wrong)),
    });

    fill(host, 'Current password', 'wrong');
    fill(host, 'New password', 'correct-horse-battery');
    fill(host, 'Confirm new password', 'correct-horse-battery');
    await settle(fixture);
    press(host, 'Change password');
    await settle(fixture);

    expect(query(host, '[role="alert"]').textContent).toContain(
      'The current password is incorrect.',
    );
    expect(host.textContent).not.toContain('Password changed.');
    // The typed values survive a failure, so the attempt can be corrected rather than retyped.
    expect(field(host, 'New password').value).toBe('correct-horse-battery');
  });

  /** Revoking signs out this device too, so it has to end on the sign-in screen. */
  it('revokes every session and returns to sign in', async () => {
    const { fixture, host, api, router } = await render();
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    press(host, 'Sign out everywhere');
    await settle(fixture);

    expect(api.revokeAllSessions).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/auth/sign-in');
  });

  it('stays put and reports a failed revocation', async () => {
    const { fixture, host, router } = await render({
      revokeAllSessions: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
    });
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    press(host, 'Sign out everywhere');
    await settle(fixture);

    expect(query(host, '[role="alert"]').textContent).toContain('Sessions could not be revoked.');
    expect(navigate).not.toHaveBeenCalled();
  });
});
