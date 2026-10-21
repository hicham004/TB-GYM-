import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../../core/auth/auth.store';
import { button, field, fill, press, query, settle, tick } from '../../../testing/dom';
import { SignIn } from './sign-in';

async function render(auth: Partial<AuthStore> = {}, url?: string) {
  await TestBed.configureTestingModule({
    imports: [SignIn],
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      {
        provide: AuthStore,
        useValue: { login: vi.fn(() => Promise.resolve()), ...auth },
      },
    ],
  }).compileComponents();

  // The page reads its query from the route it was opened on.
  if (url) await TestBed.inject(Router).navigateByUrl(url);
  const fixture = TestBed.createComponent(SignIn);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    auth: TestBed.inject(AuthStore),
    router: TestBed.inject(Router),
  };
}

describe('SignIn', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * Drives the rendered fields rather than the form model. Sign-in returns early on an invalid
   * form, so a control the template never binds leaves the button clickable and the click silently
   * doing nothing: the screen would look alive and refuse to sign anyone in.
   */
  it('signs in with what was typed into the form', async () => {
    const { fixture, host, auth, router } = await render();
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    fill(host, 'Email', 'coach@example.test');
    fill(host, 'Password', 'correct-horse-battery');
    tick(host, 'Keep me signed in');
    await settle(fixture);

    expect(button(host, 'Sign in').disabled).toBe(false);
    expect(query(host, '[role="alert"]').textContent?.trim()).toBe('');

    press(host, 'Sign in');
    await settle(fixture);

    expect(auth.login).toHaveBeenCalledWith('coach@example.test', 'correct-horse-battery', true);
    expect(navigate).toHaveBeenCalledWith('/');
  });

  /** Password managers and phone autofill find the account and its saved password by these. */
  it('marks the fields for password managers and autofill', async () => {
    const { host } = await render();

    expect(field(host, 'Email').getAttribute('autocomplete')).toBe('username');
    expect(field(host, 'Email').type).toBe('email');
    expect(field(host, 'Password').getAttribute('autocomplete')).toBe('current-password');
  });

  /**
   * A refused submit used to do nothing visible at all. Each missing field now says what it needs,
   * tied to the field so a screen reader reads it with the field, and focus moves to the one summary
   * so the refusal is announced where the person is.
   */
  it('explains a refused sign-in beside each field and in the summary', async () => {
    const { fixture, host, auth } = await render();

    press(host, 'Sign in');
    await settle(fixture);

    expect(auth.login).not.toHaveBeenCalled();
    const email = field(host, 'Email');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(query(host, `#${email.getAttribute('aria-describedby')}`).textContent).toContain(
      'Enter your email address.',
    );
    expect(field(host, 'Password').getAttribute('aria-invalid')).toBe('true');
    const summary = query<HTMLElement>(host, '[role="alert"]');
    expect(summary.textContent).toContain('Enter your password.');
    expect(document.activeElement).toBe(summary);
  });

  it('leaves "keep me signed in" off unless it was ticked', async () => {
    const { fixture, host, auth, router } = await render();
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    fill(host, 'Email', 'coach@example.test');
    fill(host, 'Password', 'correct-horse-battery');
    press(host, 'Sign in');
    await settle(fixture);

    expect(auth.login).toHaveBeenCalledWith('coach@example.test', 'correct-horse-battery', false);
  });

  it('does not attempt a sign-in when the form is incomplete', async () => {
    const { fixture, host, auth } = await render();

    fill(host, 'Email', 'coach@example.test');
    press(host, 'Sign in');
    await settle(fixture);

    expect(auth.login).not.toHaveBeenCalled();
  });

  it('names an unconfirmed email as the reason rather than as wrong credentials', async () => {
    const unconfirmed = new HttpErrorResponse({
      status: 401,
      error: { code: 'email_not_confirmed' },
    });
    const { fixture, host } = await render({
      login: vi.fn(() => Promise.reject(unconfirmed)),
    });

    fill(host, 'Email', 'coach@example.test');
    fill(host, 'Password', 'correct-horse-battery');
    press(host, 'Sign in');
    await settle(fixture);

    expect(host.textContent).toContain('Confirm your email before signing in.');
    expect(host.textContent).not.toContain('Email or password is incorrect.');
  });

  it('reports a rejected sign-in and stays on the form', async () => {
    const { fixture, host, router } = await render({
      login: vi.fn(() => Promise.reject(new HttpErrorResponse({ status: 401 }))),
    });
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    fill(host, 'Email', 'coach@example.test');
    fill(host, 'Password', 'wrong');
    press(host, 'Sign in');
    await settle(fixture);

    expect(query(host, '[role="alert"]').textContent).toContain('Email or password is incorrect.');
    expect(navigate).not.toHaveBeenCalled();
    // The button is released, so a second attempt is possible.
    expect(button(host, 'Sign in').disabled).toBe(false);
  });
  /** Sent here because the session ended under the open app (WEB-1): one sentence says so. */
  it('says why the person is here after their session ended, and goes back where they were', async () => {
    const { fixture, host, router } = await render(
      {},
      '/auth/sign-in?returnUrl=%2Fclients%2F42&reason=session-ended',
    );
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    expect(host.textContent).toContain(
      'You were signed out. Sign in again to carry on where you left off.',
    );

    fill(host, 'Email', 'coach@example.test');
    fill(host, 'Password', 'correct-horse-battery');
    press(host, 'Sign in');
    await settle(fixture);

    expect(navigate).toHaveBeenCalledWith('/clients/42');
  });

  it('says nothing about an ended session to someone who simply came to sign in', async () => {
    const { host } = await render();

    expect(host.textContent).not.toContain('You were signed out.');
  });

  async function refusedWith(error: HttpErrorResponse): Promise<HTMLElement> {
    const { fixture, host } = await render({ login: vi.fn(() => Promise.reject(error)) });
    fill(host, 'Email', 'coach@example.test');
    fill(host, 'Password', 'correct-horse-battery');
    press(host, 'Sign in');
    await settle(fixture);
    return host;
  }

  /** A locked account was told its password was wrong, even when it was right (AUTH-2). */
  it('says a locked account is locked, and when to try again', async () => {
    const host = await refusedWith(
      new HttpErrorResponse({
        status: 429,
        error: { code: 'account_locked' },
        headers: new HttpHeaders({ 'Retry-After': '840' }),
      }),
    );

    expect(query(host, '[role="alert"]').textContent?.trim()).toBe(
      'This account is locked after too many wrong passwords. Try again in 14 minutes.',
    );
  });

  /** A gym's phones share one address behind its Wi-Fi; a busy one is not a wrong password (AUTH-15). */
  it('says too many attempts came from this network, and when to try again', async () => {
    const host = await refusedWith(
      new HttpErrorResponse({
        status: 429,
        error: { code: 'too_many_attempts' },
        headers: new HttpHeaders({ 'Retry-After': '37' }),
      }),
    );

    expect(query(host, '[role="alert"]').textContent?.trim()).toBe(
      'Too many attempts from this network. Try again in a minute.',
    );
  });

  it('does not blame the password for a failure that never reached the password check', async () => {
    const host = await refusedWith(new HttpErrorResponse({ status: 0 }));

    expect(query(host, '[role="alert"]').textContent?.trim()).toBe(
      'You couldn’t be signed in. Check your connection and try again.',
    );
  });
});

/**
 * Sign-in is rendered at build time (audit UIQ-13), so on a slow connection its fields can be typed
 * into, or filled by a password manager, before the app takes the page over.
 */
describe('SignIn as the pre-rendered page', () => {
  afterEach(() => {
    document.querySelectorAll('[data-prerendered]').forEach((element) => element.remove());
    TestBed.resetTestingModule();
  });

  /** The page's fields as the build drew them, ahead of the app's own in the document. */
  function prerenderedFields(email: string, password: string, remember: boolean): void {
    const page = document.createElement('div');
    page.setAttribute('data-prerendered', '');
    page.innerHTML =
      '<input id="sign-in-email" type="email"><input id="sign-in-password" type="password">' +
      '<input id="sign-in-remember" type="checkbox">';
    document.body.prepend(page);
    (page.querySelector('#sign-in-email') as HTMLInputElement).value = email;
    (page.querySelector('#sign-in-password') as HTMLInputElement).value = password;
    (page.querySelector('#sign-in-remember') as HTMLInputElement).checked = remember;
  }

  it('starts from what was typed before the app arrived, so the first sign-in sends it', async () => {
    prerenderedFields('maya@example.test', 'typed-early', true);
    const { fixture, host, auth, router } = await render();
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    press(host, 'Sign in');
    await settle(fixture);

    expect(auth.login).toHaveBeenCalledWith('maya@example.test', 'typed-early', true);
  });

  it('starts empty on any later visit, when the fields are the ones it has just drawn', async () => {
    const { fixture, host, auth } = await render();

    press(host, 'Sign in');
    await settle(fixture);

    expect(auth.login).not.toHaveBeenCalled();
    expect(query(host, '[role="alert"]').textContent).toContain('Enter your email address.');
  });

  // The build draws the button disabled until the app is live; scripts/check-prerender.mjs and the
  // `built` Playwright project check the rendered page, where the build's render runs.
  it('submits once the app is live', async () => {
    const { host } = await render();

    expect(button(host, 'Sign in').disabled).toBe(false);
    expect(button(host, 'Sign in').type).toBe('submit');
  });
});
