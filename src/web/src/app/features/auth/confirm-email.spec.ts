import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { ActionTokenScrubber } from '../../core/security/action-token.service';
import { CsrfService } from '../../core/security/csrf.service';
import { query, settle } from '../../../testing/dom';
import { ConfirmEmail } from './confirm-email';

function link(params: Record<string, string>) {
  return { snapshot: { queryParamMap: convertToParamMap(params) } };
}

async function render(params: Record<string, string>, api: Partial<ApiClient> = {}) {
  const scrubber = { scrub: vi.fn(() => Promise.resolve()) };
  await TestBed.configureTestingModule({
    imports: [ConfirmEmail],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: link(params) },
      { provide: ApiClient, useValue: { confirmEmail: vi.fn(() => of(undefined)), ...api } },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: ActionTokenScrubber, useValue: scrubber },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ConfirmEmail);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api: TestBed.inject(ApiClient),
    scrubber,
  };
}

describe('ConfirmEmail', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * This screen has no controls: arriving on it is the action, so the assertion is that landing on
   * the link confirms the account and offers the way onward. A confirmation that renders "working"
   * forever is the same dead end as a button that never enables.
   */
  it('confirms the account from the link and offers the way on to sign in', async () => {
    const { host, api } = await render({ userId: 'user-1', code: 'confirm-code-1' });

    expect(api.confirmEmail).toHaveBeenCalledWith('user-1', 'confirm-code-1');
    expect(host.textContent).toContain('Email confirmed');
    expect(query<HTMLAnchorElement>(host, 'a.primary-button').getAttribute('href')).toBe(
      '/auth/sign-in',
    );
    expect(host.textContent).not.toContain('Confirming your email...');
  });

  it('says the link is incomplete instead of calling the server with nothing', async () => {
    const { host, api, scrubber } = await render({ userId: 'user-1' });

    expect(api.confirmEmail).not.toHaveBeenCalled();
    expect(host.textContent).toContain('This confirmation link is incomplete.');
    expect(scrubber.scrub).toHaveBeenCalledOnce();
  });

  it('reports a spent or expired link rather than claiming the email is confirmed', async () => {
    const { host } = await render(
      { userId: 'user-1', code: 'stale' },
      { confirmEmail: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 400 }))) },
    );

    expect(host.textContent).toContain('This confirmation link is invalid or expired.');
    expect(host.textContent).not.toContain('Email confirmed');
  });
});
