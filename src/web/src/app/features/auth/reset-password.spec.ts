import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { ActionTokenScrubber } from '../../core/security/action-token.service';
import { CsrfService } from '../../core/security/csrf.service';
import { button, fill, press, query, settle } from '../../../testing/dom';
import { ResetPassword } from './reset-password';

/** The link the emailed reset arrives on, as query parameters. */
function link(params: Record<string, string>) {
  return { snapshot: { queryParamMap: convertToParamMap(params) } };
}

const VALID_LINK = { userId: 'user-1', code: 'reset-code-1' };

async function render(params: Record<string, string>, api: Partial<ApiClient> = {}) {
  const scrubber = { scrub: vi.fn(() => Promise.resolve()) };
  await TestBed.configureTestingModule({
    imports: [ResetPassword],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: link(params) },
      { provide: ApiClient, useValue: { resetPassword: vi.fn(() => of(undefined)), ...api } },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: ActionTokenScrubber, useValue: scrubber },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ResetPassword);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api: TestBed.inject(ApiClient),
    scrubber,
  };
}

describe('ResetPassword', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * The second half of the only recovery path. The credentials come from the link rather than from
   * the form, so this asserts both: the typed password and the link's own identifiers.
   */
  it('sets the new password against the identifiers carried by the link', async () => {
    const { fixture, host, api } = await render(VALID_LINK);

    fill(host, 'New password', 'correct-horse-battery');
    fill(host, 'Confirm new password', 'correct-horse-battery');
    await settle(fixture);

    expect(button(host, 'Update password').disabled).toBe(false);
    press(host, 'Update password');
    await settle(fixture);

    expect(api.resetPassword).toHaveBeenCalledWith(
      'user-1',
      'reset-code-1',
      'correct-horse-battery',
    );
    expect(host.textContent).toContain('Password updated');
  });

  it('refuses two different passwords without calling the server', async () => {
    const { fixture, host, api } = await render(VALID_LINK);

    fill(host, 'New password', 'correct-horse-battery');
    fill(host, 'Confirm new password', 'correct-horse-batteryy');
    await settle(fixture);
    press(host, 'Update password');
    await settle(fixture);

    expect(api.resetPassword).not.toHaveBeenCalled();
    expect(query(host, '[role="alert"]').textContent).toContain('Passwords do not match.');
  });

  it('does not submit a password shorter than the policy allows', async () => {
    const { fixture, host, api } = await render(VALID_LINK);

    fill(host, 'New password', 'short');
    fill(host, 'Confirm new password', 'short');
    await settle(fixture);
    press(host, 'Update password');
    await settle(fixture);

    expect(api.resetPassword).not.toHaveBeenCalled();
  });

  it('offers no form at all when the link is missing its code', async () => {
    const { host, scrubber } = await render({ userId: 'user-1' });

    expect(host.textContent).toContain('This reset link is incomplete.');
    expect(host.querySelector('input[type="password"]')).toBeNull();
    expect(host.querySelector('button[type="submit"]')).toBeNull();
    expect(scrubber.scrub).toHaveBeenCalledOnce();
  });

  it('reports a spent or expired link rather than claiming the password changed', async () => {
    const { fixture, host } = await render(VALID_LINK, {
      resetPassword: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 400 }))),
    });

    fill(host, 'New password', 'correct-horse-battery');
    fill(host, 'Confirm new password', 'correct-horse-battery');
    await settle(fixture);
    press(host, 'Update password');
    await settle(fixture);

    expect(query(host, '[role="alert"]').textContent).toContain(
      'The reset link is invalid or expired.',
    );
    expect(host.textContent).not.toContain('Password updated');
    expect(passwords(host).map((input) => input.value)).toEqual(['', '']);
  });
});

function passwords(host: HTMLElement): HTMLInputElement[] {
  return Array.from(host.querySelectorAll<HTMLInputElement>('input[type="password"]'));
}
