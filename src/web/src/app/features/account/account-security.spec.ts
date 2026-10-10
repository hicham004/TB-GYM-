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
import { TenantStore } from '../../core/tenancy/tenant.store';
import { UiToast } from '../../ui/toast';
import { announced, field, fill, focusedId, press, settle } from '../../../testing/dom';
import { AccountSecurity } from './account-security';
import { LeaveWorkspaceApi } from './leave-workspace-api';

const USER: CurrentUser = {
  id: 'user-1',
  email: 'coach@example.test',
  displayName: 'Tarek Bou',
  preferredCulture: 'en-LB',
  preferredThemeMode: 'system',
  preferredWeightUnit: 'Kilogram',
  emailConfirmed: true,
  roles: [],
};

async function render(api: Partial<Record<keyof ApiClient, unknown>> = {}, role = 'Owner') {
  const toast = { show: vi.fn() };
  const isClient = role === 'Client';
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
      { provide: LeaveWorkspaceApi, useValue: {} },
      { provide: UiToast, useValue: toast },
      {
        provide: TenantStore,
        useValue: {
          selectedTenantId: signal('tenant-1'),
          selectedMembership: signal({ tenantId: 'tenant-1', tenantName: 'Atlas', role }),
          isClient: signal(isClient),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AccountSecurity);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api: TestBed.inject(ApiClient) as unknown as Record<string, ReturnType<typeof vi.fn>>,
    auth: TestBed.inject(AuthStore) as unknown as { initialize: ReturnType<typeof vi.fn> },
    router: TestBed.inject(Router),
    toast,
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The dialog on top, which the CDK draws outside the page. */
const dialog = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};

async function typePasswords(
  fixture: Awaited<ReturnType<typeof render>>['fixture'],
  host: HTMLElement,
  current: string,
  next: string,
  again: string,
) {
  fill(host, 'Current password', current);
  fill(host, 'New password', next);
  fill(host, 'New password again', again);
  await settle(fixture);
}

describe('Settings › Password and security', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  /**
   * A password change needs the current password as well as the new one. A control that never
   * reaches the request would send the wrong pair, and the server's refusal would look like the
   * person misremembering their own password.
   */
  it('changes the password using both the old and the new one, then clears the form', async () => {
    const { fixture, host, api, toast } = await render();

    expect(textOf(host.querySelector('.lede'))).toBe('Signed in as coach@example.test.');
    await typePasswords(fixture, host, 'Old-horse-1!', 'Correct-horse-2!', 'Correct-horse-2!');
    press(host, 'Change password');
    await settle(fixture);

    expect(api['changePassword']).toHaveBeenCalledWith('Old-horse-1!', 'Correct-horse-2!');
    expect(field(host, 'Current password').value).toBe('');
    expect(field(host, 'New password').value).toBe('');
    expect(toast.show).toHaveBeenCalledWith(
      'Password changed. Use the new one next time you sign in.',
      { tone: 'success' },
    );
  });

  it('says what is wrong beside each field and moves focus there, without calling the server', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Change password');
    await settle(fixture);
    await new Promise((resolve) => setTimeout(resolve));
    expect(api['changePassword']).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Type the password you use now.');
    expect(focusedId()).toBe('password-current');

    await typePasswords(fixture, host, 'Old-horse-1!', 'short', 'short');
    press(host, 'Change password');
    await settle(fixture);
    expect(host.textContent).toContain(
      'Use at least 12 characters with upper, lower, number, and symbol.',
    );

    await typePasswords(fixture, host, 'Old-horse-1!', 'Correct-horse-2!', 'Correct-horse-3!');
    press(host, 'Change password');
    await settle(fixture);
    expect(host.textContent).toContain('This doesn’t match the new password. Type it again.');
    expect(api['changePassword']).not.toHaveBeenCalled();
  });

  it('reports a wrong current password rather than claiming the change succeeded', async () => {
    const { fixture, host, toast } = await render({
      changePassword: vi.fn(() =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: { message: 'The current password is incorrect.' },
            }),
        ),
      ),
    });

    await typePasswords(fixture, host, 'Wrong-horse-1!', 'Correct-horse-2!', 'Correct-horse-2!');
    press(host, 'Change password');
    await settle(fixture);

    expect(announced(host)).toBe('The current password is incorrect.');
    expect(toast.show).not.toHaveBeenCalled();
    expect(field(host, 'New password').value).toBe('Correct-horse-2!');
  });

  it('asks before signing out everywhere, then ends every session and goes to sign in', async () => {
    const { fixture, host, api, auth, router } = await render();
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    press(host, 'Sign out everywhere');
    await settle(fixture);
    expect(textOf(dialog()?.querySelector('h2'))).toBe('Sign out everywhere?');
    press(dialog()!, 'Cancel');
    await settle(fixture);
    expect(api['revokeAllSessions']).not.toHaveBeenCalled();

    press(host, 'Sign out everywhere');
    await settle(fixture);
    press(dialog()!, 'Sign out everywhere');
    await settle(fixture);

    expect(api['revokeAllSessions']).toHaveBeenCalled();
    expect(auth.initialize).toHaveBeenCalledWith(true);
    expect(navigate).toHaveBeenCalledWith('/auth/sign-in');
  });

  it('stays put and says so when signing out everywhere fails', async () => {
    const { fixture, host, router } = await render({
      revokeAllSessions: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
    });
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    press(host, 'Sign out everywhere');
    await settle(fixture);
    press(dialog()!, 'Sign out everywhere');
    await settle(fixture);

    expect(announced(host)).toBe('You couldn’t be signed out everywhere. Try again.');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('asks before a half-typed password change is left behind', async () => {
    const { fixture, host } = await render();
    const page = fixture.componentInstance;

    await expect(page.canLeave()).resolves.toBe(true);
    fill(host, 'New password', 'Correct-horse');
    await settle(fixture);

    const leaving = page.canLeave();
    await settle(fixture);
    expect(textOf(dialog()?.querySelector('h2'))).toBe('Leave without saving?');
    press(dialog()!, 'Stay');
    await expect(leaving).resolves.toBe(false);
  });

  it('gives a client the way back to Me instead of the Settings pages', async () => {
    const { host } = await render({}, 'Client');

    expect(host.querySelector('nav[aria-label="Settings"]')).toBeNull();
    expect(host.querySelector('a.back')?.getAttribute('href')).toBe('/me');
  });

  it('shows a coach their own account pages only', async () => {
    const { host } = await render({}, 'Coach');

    const nav = host.querySelector('nav[aria-label="Settings"]')!;
    expect(Array.from(nav.querySelectorAll('a')).map(textOf)).toEqual([
      'Notifications',
      'Appearance',
      'Password and security',
    ]);
    expect(host.querySelector('a.back')).toBeNull();
  });
});
