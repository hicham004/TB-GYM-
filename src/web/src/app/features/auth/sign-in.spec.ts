import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../../core/auth/auth.store';
import { button, field, fill, press, query, settle, tick } from '../../../testing/dom';
import { SignIn } from './sign-in';

async function render(auth: Partial<AuthStore> = {}) {
  await TestBed.configureTestingModule({
    imports: [SignIn],
    providers: [
      provideRouter([]),
      {
        provide: AuthStore,
        useValue: { login: vi.fn(() => Promise.resolve()), ...auth },
      },
    ],
  }).compileComponents();

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
});
