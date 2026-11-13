import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { fill, press, settle } from '../../../testing/dom';
import { CloseAccount } from './close-account';
import { CloseAccountApi } from './close-account-api';
import { closeAccountRefusal } from './close-account.models';

type Role = 'Owner' | 'Coach' | 'Client';

async function render(
  options: {
    roles?: readonly Role[];
    platformAdmin?: boolean;
    close?: CloseAccountApi['close'];
  } = {},
) {
  const roles = options.roles ?? ['Client'];
  const api = { close: vi.fn(options.close ?? (() => of(undefined))) };
  const initialize = vi.fn(() => Promise.resolve());
  const clear = vi.fn();
  await TestBed.configureTestingModule({
    imports: [CloseAccount],
    providers: [
      provideRouter([]),
      { provide: CloseAccountApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      {
        provide: AuthStore,
        useValue: {
          user: signal({
            id: 'user-1',
            email: 'mira@example.com',
            roles: options.platformAdmin ? ['PlatformAdmin'] : [],
          }),
          initialize,
        },
      },
      {
        provide: TenantStore,
        useValue: {
          memberships: signal(
            roles.map((role, index) => ({
              tenantId: `tenant-${index}`,
              tenantName: `Space ${index}`,
              role,
            })),
          ),
          clear,
        },
      },
    ],
  }).compileComponents();

  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(CloseAccount);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, initialize, clear, navigate };
}

/** The dialog, which the CDK draws outside the page. */
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

describe('CloseAccount', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('offers closing to a client, as a quiet text button under its own heading', async () => {
    const { host } = await render({ roles: ['Client', 'Client'] });

    expect(host.querySelector('h2')?.textContent?.trim()).toBe('Close your account');
    const button = host.querySelector<HTMLButtonElement>('[data-close-account]');
    expect(button?.textContent?.trim()).toBe('Close your TB Gym account');
    expect(button?.getAttribute('variant')).toBe('text');
    expect(host.textContent).toContain('You can’t undo this.');
  });

  it('offers nothing to someone who owns or coaches a space, or to a platform admin', async () => {
    const staff = await render({ roles: ['Client', 'Coach'] });
    expect(staff.host.querySelector('[data-close-account]')).toBeNull();
    TestBed.resetTestingModule();

    const admin = await render({ platformAdmin: true });
    expect(admin.host.querySelector('[data-close-account]')).toBeNull();
  });

  it('says what is erased and what is kept before asking for the password', async () => {
    const { fixture, host } = await render();

    press(host, 'Close your TB Gym account');
    await settle(fixture);

    expect(dialog()?.querySelector('h2')?.textContent?.trim()).toBe('Close your TB Gym account?');
    const text = dialog()?.textContent ?? '';
    expect(text).toContain('You leave every coaching space you’re part of');
    expect(text).toContain('Erased');
    expect(text).toContain('health details included, and your progress photos');
    expect(text).toContain('Kept, without your name');
    expect(text).toContain('any coach who coaches you is told you left');
    expect(text).not.toContain('height');
    expect(text).toContain('what you logged or wrote: weigh-ins, check-ins, notes and messages');
    expect(text).toContain('You can’t undo this.');
    expect(text).not.toMatch(/workspace|tenant|enrollment/i);
    const field = dialog()?.querySelector<HTMLInputElement>('#close-account-password');
    expect(field?.type).toBe('password');
    expect(field?.autocomplete).toBe('current-password');
  });

  it('asks for the password before sending anything', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Close your TB Gym account');
    await settle(fixture);
    press(dialog()!, 'Close my account');
    await settle(fixture);

    expect(api.close).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('Type your password to close your account.');
  });

  it('closes with the password, then reads the session back and goes to sign-in saying so', async () => {
    const { fixture, host, api, initialize, clear, navigate } = await render();

    press(host, 'Close your TB Gym account');
    await settle(fixture);
    fill(dialog()!, 'Your password', 'Correct horse 12!');
    await settle(fixture);
    press(dialog()!, 'Close my account');
    await settle(fixture);

    expect(api.close).toHaveBeenCalledWith('Correct horse 12!');
    expect(dialog()).toBeNull();
    expect(initialize).toHaveBeenCalledWith(true);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/auth/sign-in'], {
      queryParams: { reason: 'account-closed' },
    });
  });

  it('keeps the dialog open while closing, so its answer lands in it', async () => {
    const answer = new Subject<void>();
    const { fixture, host } = await render({ close: () => answer.asObservable() });

    press(host, 'Close your TB Gym account');
    await settle(fixture);
    fill(dialog()!, 'Your password', 'Correct horse 12!');
    await settle(fixture);
    press(dialog()!, 'Close my account');
    await settle(fixture);
    expect(dialog()?.textContent).toContain('Closing…');
    press(dialog()!, 'Keep my account');
    await settle(fixture);
    expect(dialog()).not.toBeNull();
    // Neither Escape nor the dialog's own close button ends it while the answer is on its way.
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(fixture);
    expect(dialog()).not.toBeNull();
    dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();
    await settle(fixture);
    expect(dialog()?.textContent).toContain('Closing…');

    answer.next();
    answer.complete();
    await settle(fixture);
    expect(dialog()).toBeNull();
  });

  it('moves focus to the password field when it is missing or wrong, so its reason is heard', async () => {
    const refusal = new HttpErrorResponse({ status: 400, error: { errors: { password: ['x'] } } });
    const { fixture, host } = await render({ close: () => throwError(() => refusal) });

    press(host, 'Close your TB Gym account');
    await settle(fixture);
    press(dialog()!, 'Close my account');
    await settle(fixture);
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement?.id).toBe('close-account-password');

    fill(dialog()!, 'Your password', 'not-it');
    await settle(fixture);
    (document.activeElement as HTMLElement | null)?.blur();
    press(dialog()!, 'Close my account');
    await settle(fixture);
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement?.id).toBe('close-account-password');
    const input = document.getElementById('close-account-password');
    const described = (input?.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toContain('That password isn’t right.');
  });

  it('says a wrong password under its field and sends the person nowhere', async () => {
    const refusal = new HttpErrorResponse({
      status: 400,
      error: { errors: { password: ['That password isn’t right.'] } },
    });
    const { fixture, host, initialize, navigate } = await render({
      close: () => throwError(() => refusal),
    });

    press(host, 'Close your TB Gym account');
    await settle(fixture);
    fill(dialog()!, 'Your password', 'wrong');
    await settle(fixture);
    press(dialog()!, 'Close my account');
    await settle(fixture);

    expect(dialog()).not.toBeNull();
    expect(dialog()?.textContent).toContain(
      'That password isn’t right. Type the one you sign in with.',
    );
    expect(dialog()?.querySelector('[role="alert"]')?.textContent?.trim()).toBe('');
    expect(initialize).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('says why a staff account is refused, for the whole dialog', async () => {
    const refusal = new HttpErrorResponse({
      status: 409,
      error: { code: 'account_closure_staff', message: 'Server words.' },
    });
    const { fixture, host } = await render({ close: () => throwError(() => refusal) });

    press(host, 'Close your TB Gym account');
    await settle(fixture);
    fill(dialog()!, 'Your password', 'Correct horse 12!');
    await settle(fixture);
    press(dialog()!, 'Close my account');
    await settle(fixture);

    expect(dialog()?.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'This account owns or coaches a coaching space, or once did, so it can’t be closed here.',
    );
  });

  it('lets the person keep their account without sending anything', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Close your TB Gym account');
    await settle(fixture);
    press(dialog()!, 'Keep my account');
    await settle(fixture);

    expect(dialog()).toBeNull();
    expect(api.close).not.toHaveBeenCalled();
  });
});

describe('closeAccountRefusal', () => {
  it('words each refusal the server names', () => {
    const refused = (status: number, error: unknown) =>
      closeAccountRefusal(new HttpErrorResponse({ status, error }));

    expect(refused(400, { errors: { password: ['x'] } }).password).toContain('That password');
    expect(refused(409, { code: 'account_closure_platform_admin' }).message).toBe(
      'A platform admin’s account can’t be closed here.',
    );
    expect(refused(409, { code: 'account_closure_changed' }).message).toContain(
      'nothing was closed. Try again.',
    );
    expect(refused(500, null).message).toBe(
      'Your account couldn’t be closed, and nothing was changed. Try again.',
    );
  });
});
