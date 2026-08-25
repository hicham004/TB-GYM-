import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { EmailActionResponse } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { button, fill, press, query, settle } from '../../../testing/dom';
import { ForgotPassword } from './forgot-password';

const SENT: EmailActionResponse = {
  message: 'If that address has an account, a reset link is on its way.',
  developmentActionUrl: null,
};

async function render(api: Partial<ApiClient> = {}) {
  await TestBed.configureTestingModule({
    imports: [ForgotPassword],
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: { forgotPassword: vi.fn(() => of(SENT)), ...api } },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ForgotPassword);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: TestBed.inject(ApiClient) };
}

describe('ForgotPassword', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /** The only recovery path for a locked-out user, and a one-field form has nothing to hide a
   * broken binding behind: an unwired input leaves the button live and the request unsent. */
  it('requests a reset for the address that was typed', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Email', 'coach@example.test');
    await settle(fixture);

    expect(button(host, 'Send reset link').disabled).toBe(false);
    press(host, 'Send reset link');
    await settle(fixture);

    expect(api.forgotPassword).toHaveBeenCalledWith('coach@example.test');
  });

  it('replaces the form with the server’s own neutral acknowledgement', async () => {
    const { fixture, host } = await render();

    fill(host, 'Email', 'coach@example.test');
    await settle(fixture);
    press(host, 'Send reset link');
    await settle(fixture);

    expect(host.textContent).toContain('Check your email');
    expect(host.textContent).toContain('If that address has an account');
    // The wording must not confirm whether the address exists, and the form is not re-offered.
    expect(host.querySelector('button[type="submit"]')).toBeNull();
  });

  it('does not send a request for an address that is not an address', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Email', 'not-an-email');
    await settle(fixture);
    press(host, 'Send reset link');
    await settle(fixture);

    expect(api.forgotPassword).not.toHaveBeenCalled();
  });

  it('keeps the form available when the request fails', async () => {
    const { fixture, host } = await render({
      forgotPassword: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
    });

    fill(host, 'Email', 'coach@example.test');
    await settle(fixture);
    press(host, 'Send reset link');
    await settle(fixture);

    expect(query(host, '[role="alert"]').textContent).toContain(
      'The reset request could not be sent.',
    );
    expect(host.querySelector('button[type="submit"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Check your email');
  });
});
