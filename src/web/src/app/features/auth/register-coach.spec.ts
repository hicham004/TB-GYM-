import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { RegistrationResponse } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { button, fill, press, query, settle } from '../../../testing/dom';
import { RegisterCoach } from './register-coach';

const REGISTERED: RegistrationResponse = {
  email: 'coach@example.test',
  developmentConfirmationUrl: null,
};

async function render(api: Partial<ApiClient> = {}) {
  await TestBed.configureTestingModule({
    imports: [RegisterCoach],
    providers: [
      provideRouter([]),
      {
        provide: ApiClient,
        useValue: { registerCoach: vi.fn(() => of(REGISTERED)), ...api },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(RegisterCoach);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: TestBed.inject(ApiClient) };
}

/** Fills every field the form requires, so a test can vary one of them without repeating the rest. */
function fillRegistration(
  host: HTMLElement,
  overrides: { password?: string; confirmPassword?: string; currency?: string } = {},
) {
  const password = overrides.password ?? 'correct-horse-battery';
  fill(host, 'Your name', 'Tarek Bou');
  fill(host, 'Workspace name', 'TB Gym');
  fill(host, 'Email', 'coach@example.test');
  fill(host, 'Password', password);
  fill(host, 'Confirm password', overrides.confirmPassword ?? password);
  fill(host, 'Time zone', 'Asia/Beirut');
  fill(host, 'Language and region', 'en-LB');
  fill(host, 'Currency', overrides.currency ?? 'usd');
}

describe('RegisterCoach', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * Registration is the only way a coach enters the product at all, and the form returns early on
   * an invalid model. A field the template fails to bind would leave the button live and the click
   * inert, with nothing on screen to say why.
   */
  it('creates the workspace from what was typed, normalising the currency', async () => {
    const { fixture, host, api } = await render();

    fillRegistration(host);
    await settle(fixture);

    expect(button(host, 'Create coach account').disabled).toBe(false);
    press(host, 'Create coach account');
    await settle(fixture);

    expect(api.registerCoach).toHaveBeenCalledWith({
      displayName: 'Tarek Bou',
      email: 'coach@example.test',
      password: 'correct-horse-battery',
      workspaceName: 'TB Gym',
      timeZoneId: 'Asia/Beirut',
      defaultCulture: 'en-LB',
      // The server stores an ISO currency code, so the typed lowercase is normalised, not rejected.
      defaultCurrencyCode: 'USD',
      weekStartsOn: 'Monday',
    });
  });

  it('replaces the form with the confirmation notice once the account exists', async () => {
    const { fixture, host } = await render();

    fillRegistration(host);
    await settle(fixture);
    press(host, 'Create coach account');
    await settle(fixture);

    expect(host.textContent).toContain('Check your email');
    expect(host.textContent).toContain('coach@example.test');
    // The form is gone, so the same registration cannot be submitted twice.
    expect(host.querySelector('button[type="submit"]')).toBeNull();
  });

  it('refuses a registration whose two passwords differ, without calling the server', async () => {
    const { fixture, host, api } = await render();

    fillRegistration(host, {
      password: 'correct-horse-battery',
      confirmPassword: 'correct-horse-batteryy',
    });
    await settle(fixture);
    press(host, 'Create coach account');
    await settle(fixture);

    expect(api.registerCoach).not.toHaveBeenCalled();
    expect(query(host, '[role="alert"]').textContent).toContain('Passwords do not match.');
  });

  it('does not submit a password shorter than the policy allows', async () => {
    const { fixture, host, api } = await render();

    fillRegistration(host, { password: 'short' });
    await settle(fixture);
    press(host, 'Create coach account');
    await settle(fixture);

    expect(api.registerCoach).not.toHaveBeenCalled();
  });

  it('shows the server’s own explanation when registration is refused', async () => {
    const taken = new HttpErrorResponse({
      status: 400,
      error: { message: 'That email address is already registered.' },
    });
    const { fixture, host } = await render({
      registerCoach: vi.fn(() => throwError(() => taken)),
    });

    fillRegistration(host);
    await settle(fixture);
    press(host, 'Create coach account');
    await settle(fixture);

    expect(query(host, '[role="alert"]').textContent).toContain(
      'That email address is already registered.',
    );
    // The form is still there to correct, rather than replaced by a false success.
    expect(host.querySelector('button[type="submit"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Check your email');
  });
});
