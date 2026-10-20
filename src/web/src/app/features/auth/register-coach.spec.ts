import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { RegistrationResponse } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { button, field, fill, press, query, settle, tick } from '../../../testing/dom';
import { RegisterCoach } from './register-coach';

const REGISTERED: RegistrationResponse = {
  email: 'coach@example.test',
  developmentConfirmationUrl: null,
  emailAvailable: true,
};

/** The zone this test's device says it is in; registration starts there. */
function deviceZone(timeZone: string) {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone,
  } as Intl.ResolvedDateTimeFormatOptions);
}

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
  overrides: { password?: string; confirmPassword?: string } = {},
) {
  const password = overrides.password ?? 'correct-horse-battery';
  fill(host, 'Your name', 'Tarek Bou');
  fill(host, 'Coaching space name', 'TB Gym');
  fill(host, 'Email', 'coach@example.test');
  fill(host, 'Password', password);
  fill(host, 'Confirm password', overrides.confirmPassword ?? password);
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The sheet on top, which the CDK draws outside the page. */
const sheet = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};

describe('RegisterCoach', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  /**
   * Registration is the only way a coach enters the product at all, and the form returns early on
   * an invalid model. A field the template fails to bind would leave the button live and the click
   * inert, with nothing on screen to say why.
   */
  it('creates the workspace from what was typed, in this device’s time zone and the chosen currency', async () => {
    deviceZone('Asia/Dubai');
    const { fixture, host, api } = await render();

    fillRegistration(host);
    tick(host, 'Lebanese pound');
    await settle(fixture);

    expect(button(host, 'Create coach account').disabled).toBe(false);
    press(host, 'Create coach account');
    await settle(fixture);

    expect(api.registerCoach).toHaveBeenCalledWith({
      displayName: 'Tarek Bou',
      email: 'coach@example.test',
      password: 'correct-horse-battery',
      workspaceName: 'TB Gym',
      timeZoneId: 'Asia/Dubai',
      defaultCulture: 'en-LB',
      defaultCurrencyCode: 'LBP',
      weekStartsOn: 'Monday',
    });
  });

  /**
   * Audit AUTH-5: the zone was a text box that wanted "Asia/Beirut" and refused "Beirut", the
   * currency a code to type and the language a select of one. They are chosen as Settings › Name
   * and region chooses them.
   */
  it('starts in Beirut and US dollars when the device cannot say its zone, with no language to pick', async () => {
    deviceZone('Etc/Unknown');
    const { host } = await render();

    expect(textOf(host.querySelector('[data-zone] strong'))).toBe('Beirut, Asia');
    expect(field(host, 'US dollar').checked).toBe(true);
    expect(textOf(host.querySelector('[data-currency-line]'))).toBe(
      'New plans are priced in US Dollar (USD). You can change it later in Settings.',
    );
    expect(host.querySelector('select')).toBeNull();
    expect(host.textContent).toContain('Emails and invitations go out in English for now.');
    expect(() => field(host, 'Time zone')).toThrow();
  });

  it('finds the time zone by city in a light sheet and registers in it', async () => {
    deviceZone('Asia/Beirut');
    const { fixture, host, api } = await render();

    press(host, 'Change');
    await settle(fixture);
    expect(textOf(sheet()?.querySelector('h2'))).toBe('Time zone');
    // The signed-out pages are always light, so the sheet over them is too.
    expect(sheet()!.closest('.cdk-overlay-pane')?.getAttribute('data-mode')).toBe('light');
    expect(textOf(sheet()!.querySelector('[aria-current="true"] .zone-name'))).toBe('Beirut Asia');

    fill(sheet()!, 'Search by city', 'dubai');
    await settle(fixture);
    const options = Array.from(sheet()!.querySelectorAll<HTMLButtonElement>('.zone-option'));
    expect(options.map((option) => textOf(option.querySelector('.zone-name')))).toEqual([
      'Dubai Asia',
    ]);
    options[0].click();
    await settle(fixture);

    expect(sheet()).toBeNull();
    expect(textOf(host.querySelector('[data-zone] strong'))).toBe('Dubai, Asia');
    fillRegistration(host);
    await settle(fixture);
    press(host, 'Create coach account');
    await settle(fixture);
    expect(api.registerCoach).toHaveBeenCalledWith(
      expect.objectContaining({ timeZoneId: 'Asia/Dubai', defaultCurrencyCode: 'USD' }),
    );
  });

  it('takes another currency by its code, and refuses one that is not a currency', async () => {
    const { fixture, host, api } = await render();

    fillRegistration(host);
    tick(host, 'Another');
    await settle(fixture);
    fill(host, 'Currency code', 'zzq');
    await settle(fixture);
    press(host, 'Create coach account');
    await settle(fixture);

    expect(api.registerCoach).not.toHaveBeenCalled();
    expect(query(host, '[role="alert"]').textContent).toContain(
      'ZZQ isn’t a currency code. Try one like EUR or AED.',
    );
    expect(document.activeElement).toBe(query(host, '[role="alert"]'));

    fill(host, 'Currency code', 'eur');
    await settle(fixture);
    expect(textOf(host.querySelector('[data-currency-line]'))).toBe(
      'New plans are priced in Euro (EUR). You can change it later in Settings.',
    );
    press(host, 'Create coach account');
    await settle(fixture);
    expect(api.registerCoach).toHaveBeenCalledWith(
      expect.objectContaining({ defaultCurrencyCode: 'EUR' }),
    );
  });

  it('marks the fields for password managers and autofill', async () => {
    const { host } = await render();

    expect(field(host, 'Your name').getAttribute('autocomplete')).toBe('name');
    expect(field(host, 'Coaching space name').getAttribute('autocomplete')).toBe('organization');
    expect(field(host, 'Email').getAttribute('autocomplete')).toBe('email');
    expect(field(host, 'Password').getAttribute('autocomplete')).toBe('new-password');
    expect(field(host, 'Confirm password').getAttribute('autocomplete')).toBe('new-password');
  });

  it('states the password rule under the field, and again when the password breaks it', async () => {
    const { fixture, host, api } = await render();
    const password = field(host, 'Password');
    const rule = 'At least 12 characters with upper, lower, number, and symbol.';
    expect(query(host, `#${password.getAttribute('aria-describedby')}`).textContent).toContain(
      rule,
    );

    fillRegistration(host, { password: 'short' });
    await settle(fixture);
    press(host, 'Create coach account');
    await settle(fixture);

    expect(api.registerCoach).not.toHaveBeenCalled();
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(query(host, `#${password.getAttribute('aria-describedby')}`).textContent).toContain(
      'Use at least 12 characters with upper, lower, number, and symbol.',
    );
    expect(document.activeElement).toBe(query(host, '[role="alert"]'));
  });

  it('says it is creating the space while the server works, with the ellipsis character', async () => {
    const answer = new Subject<RegistrationResponse>();
    const { fixture, host } = await render({ registerCoach: vi.fn(() => answer) });

    fillRegistration(host);
    await settle(fixture);
    press(host, 'Create coach account');
    await settle(fixture);

    // Audit WEB-16: the app writes "…", never three dots.
    expect(textOf(host.querySelector('button[type="submit"]'))).toBe(
      'Creating your coaching space…',
    );
    answer.next(REGISTERED);
    answer.complete();
    await settle(fixture);
    expect(host.textContent).toContain('Check your email');
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

  it('says plainly that no confirmation email is coming when this server sends no email', async () => {
    const { fixture, host } = await render({
      registerCoach: vi.fn(() => of({ ...REGISTERED, emailAvailable: false })),
    });

    fillRegistration(host);
    await settle(fixture);
    press(host, 'Create coach account');
    await settle(fixture);

    // Audit LOST-1: the account exists, but no link will ever reach the inbox.
    const notice = query(host, '[role="status"]');
    expect(notice.textContent).toContain('Email is off on this server');
    expect(notice.textContent).toContain('Your account for coach@example.test is created');
    expect(notice.textContent).toContain(
      'If you were given a sign-in for this server, use that instead.',
    );
    expect(notice.textContent).not.toContain('Check your email');
    expect(notice.textContent).not.toContain('We queued');
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

  /**
   * Audit AUTH-9: "An account already uses this email." left the coach with nothing to do. Saying
   * the email is taken is registration's accepted trade-off (BEB-4); the answer now names the way on.
   */
  it('answers an email that already has an account with signing in or resetting its password', async () => {
    const taken = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'email_already_registered',
        message:
          "An account already uses this email. Sign in with it, or reset its password if you've forgotten it.",
      },
    });
    const { fixture, host } = await render({
      registerCoach: vi.fn(() => throwError(() => taken)),
    });

    fillRegistration(host);
    await settle(fixture);
    press(host, 'Create coach account');
    await settle(fixture);

    const alert = query(host, '[role="alert"]');
    expect(alert.textContent).toContain(
      "An account already uses this email. Sign in with it, or reset its password if you've forgotten it.",
    );
    const links = Array.from(alert.querySelectorAll('a')).map((link) => [
      textOf(link),
      link.getAttribute('href'),
    ]);
    expect(links).toEqual([
      ['Sign in', '/auth/sign-in'],
      ['Reset your password', '/auth/forgot-password'],
    ]);
    // The form stays, to correct the email.
    expect(host.querySelector('button[type="submit"]')).not.toBeNull();
  });

  it('shows the server’s own explanation when registration is refused', async () => {
    const refused = new HttpErrorResponse({
      status: 400,
      error: { message: 'That workspace name is not allowed.' },
    });
    const { fixture, host } = await render({
      registerCoach: vi.fn(() => throwError(() => refused)),
    });

    fillRegistration(host);
    await settle(fixture);
    press(host, 'Create coach account');
    await settle(fixture);

    const alert = query(host, '[role="alert"]');
    expect(alert.textContent).toContain('That workspace name is not allowed.');
    // Only a taken email offers the way to sign in.
    expect(alert.querySelector('a')).toBeNull();
    // The form is still there to correct, rather than replaced by a false success.
    expect(host.querySelector('button[type="submit"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Check your email');
  });
  /**
   * The public sign-up allowance is shared by every phone behind a gym's Wi-Fi. A refusal used to
   * read "Your coach account could not be created." with nothing to do about it (audit AUTH-15).
   */
  it('says too many attempts came from this network, and when to try again', async () => {
    const limited = new HttpErrorResponse({
      status: 429,
      error: { code: 'too_many_attempts', message: 'Server wording' },
      headers: new HttpHeaders({ 'Retry-After': '45' }),
    });
    const { fixture, host } = await render({
      registerCoach: vi.fn(() => throwError(() => limited)),
    });

    fillRegistration(host);
    await settle(fixture);
    press(host, 'Create coach account');
    await settle(fixture);

    expect(query(host, '[role="alert"]').textContent?.trim()).toBe(
      'Too many attempts from this network. Try again in a minute.',
    );
  });
});
