import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
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

/** What the API answers for a link that was already used or replaced by a newer one. */
const SPENT = new HttpErrorResponse({
  status: 400,
  error: {
    code: 'invalid_or_expired_token',
    message: 'This reset link has expired or was already used. Ask for a new one.',
  },
});

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

  /**
   * Audit AUTH-7: a spent link left the form on screen with its fields emptied, so the only thing
   * to do was type a password that could never be accepted. It now offers a new link instead.
   */
  it('replaces the form with a new link to ask for when the link is spent or expired', async () => {
    const { fixture, host } = await render(VALID_LINK, {
      resetPassword: vi.fn(() => throwError(() => SPENT)),
    });

    fill(host, 'New password', 'correct-horse-battery');
    fill(host, 'Confirm new password', 'correct-horse-battery');
    await settle(fixture);
    press(host, 'Update password');
    await settle(fixture);

    const notice = query(host, '[data-spent-link]');
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.textContent?.trim()).toBe(
      'This reset link has expired or was already used. Ask for a new one.',
    );
    expect(document.activeElement).toBe(notice);
    const request = query<HTMLAnchorElement>(host, 'a[href="/auth/forgot-password"]');
    expect(request.textContent?.trim()).toBe('Request a new reset link');
    expect(host.textContent).not.toContain('Password updated');
    expect(passwords(host)).toEqual([]);
    expect(host.querySelector('button[type="submit"]')).toBeNull();
  });

  it('keeps the form for a password the server refuses, which the same link can still change', async () => {
    const refused = new HttpErrorResponse({
      status: 400,
      error: { errors: { identity: ['Add a symbol, such as ! or #.'] } },
    });
    const { fixture, host, api } = await render(VALID_LINK, {
      resetPassword: vi.fn(() => throwError(() => refused)),
    });

    fill(host, 'New password', 'correct-horse-battery');
    fill(host, 'Confirm new password', 'correct-horse-battery');
    await settle(fixture);
    press(host, 'Update password');
    await settle(fixture);

    expect(query(host, '[role="alert"]').textContent).toContain('Add a symbol, such as ! or #.');
    expect(host.querySelector('[data-spent-link]')).toBeNull();
    expect(passwords(host).map((input) => input.value)).toEqual(['', '']);

    // The link was not spent: a better password goes out on the same identifiers.
    fill(host, 'New password', 'correct-horse-battery!');
    fill(host, 'Confirm new password', 'correct-horse-battery!');
    await settle(fixture);
    press(host, 'Update password');
    await settle(fixture);
    expect(api.resetPassword).toHaveBeenLastCalledWith(
      'user-1',
      'reset-code-1',
      'correct-horse-battery!',
    );
  });

  it('says it is updating the password while the server works, with the ellipsis character', async () => {
    const { fixture, host } = await render(VALID_LINK, {
      resetPassword: vi.fn(() => new Subject<void>()),
    });

    fill(host, 'New password', 'correct-horse-battery');
    fill(host, 'Confirm new password', 'correct-horse-battery');
    await settle(fixture);
    press(host, 'Update password');
    await settle(fixture);

    expect(query(host, 'button[type="submit"]').textContent?.trim()).toBe('Updating…');
  });

  /**
   * The failed exchange empties both fields, which are required. A refused submit earlier in the
   * visit must not make that emptiness outrank the server's answer in the one summary region.
   */
  it('keeps the server’s answer in view after an earlier refused submit', async () => {
    const { fixture, host } = await render(VALID_LINK, {
      resetPassword: vi.fn(() =>
        throwError(
          () => new HttpErrorResponse({ status: 400, error: { message: 'Server wording.' } }),
        ),
      ),
    });

    press(host, 'Update password');
    await settle(fixture);
    expect(query(host, '[role="alert"]').textContent).toContain("can't be updated yet");

    fill(host, 'New password', 'correct-horse-battery');
    fill(host, 'Confirm new password', 'correct-horse-battery');
    await settle(fixture);
    press(host, 'Update password');
    await settle(fixture);

    const summary = query(host, '[role="alert"]').textContent;
    expect(summary).toContain('Server wording.');
    expect(summary).not.toContain("can't be updated yet");
  });
});

function passwords(host: HTMLElement): HTMLInputElement[] {
  return Array.from(host.querySelectorAll<HTMLInputElement>('input[type="password"]'));
}
