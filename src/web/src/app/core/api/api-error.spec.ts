import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { apiErrorMessage, failureKind, retryAfterSeconds } from './api-error';

function conflict(body: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status: 409, statusText: 'Conflict', error: body });
}

describe('apiErrorMessage', () => {
  const fallback = 'The progress photo could not be saved.';

  it('explains a full workspace allowance instead of blaming the file', () => {
    const message = apiErrorMessage(
      conflict({
        code: 'MediaWorkspaceStorageExceeded',
        title: 'The workspace media-storage allowance is full.',
      }),
      fallback,
    );

    expect(message).toContain('coaching space has used all of its media storage');
    // The generic upload failure would send the user looking for a problem with their photo.
    expect(message).not.toBe(fallback);
  });

  it('says an unpaid workspace is read-only instead of reporting a generic refusal', () => {
    const refused = new HttpErrorResponse({
      status: 403,
      statusText: 'Forbidden',
      error: { code: 'workspace_read_only', message: 'Server wording' },
    });

    expect(apiErrorMessage(refused, fallback)).toBe(
      'Your coaching space is read-only until its TB Gym bill is paid. You can still view everything.',
    );
  });

  it('words why a session cannot be started now (TRN-020 v2)', () => {
    expect(
      apiErrorMessage(conflict({ code: 'program_ended', message: 'Server wording' }), fallback),
    ).toBe('This program has ended, so its sessions can no longer be done.');
    expect(
      apiErrorMessage(conflict({ code: 'session_not_due', message: 'Server wording' }), fallback),
    ).toBe('This session isn’t due yet. It opens on its day.');
  });

  it('distinguishes a full client allowance from a full workspace allowance', () => {
    const message = apiErrorMessage(
      conflict({
        code: 'ClientProgressPhotoStorageExceeded',
        title: "This client's progress-photo allowance is full.",
      }),
      fallback,
    );

    // The two lead to different actions, so they must not collapse into one message.
    expect(message).toContain('progress-photo storage');
    expect(message).not.toContain('coaching space has used all');
  });

  it('falls back to the problem title so an unmapped conflict still says something real', () => {
    const message = apiErrorMessage(
      conflict({
        code: 'ProgressPhotoAlreadyExists',
        title: 'A photo already exists for that local date and pose.',
      }),
      fallback,
    );

    expect(message).toBe('A photo already exists for that local date and pose.');
  });

  it('keeps validation errors and the fallback for everything else', () => {
    expect(
      apiErrorMessage(
        new HttpErrorResponse({
          status: 400,
          error: { errors: { file: ['The file is not an image.'] } },
        }),
        fallback,
      ),
    ).toBe('The file is not an image.');
    expect(apiErrorMessage(new Error('offline'), fallback)).toBe(fallback);
  });
});

/** The connection and the server fail in the app's words on every screen (audit UIQ-2). */
describe('apiErrorMessage for a failure that says nothing about the request', () => {
  const fallback = 'Conversations could not be loaded.';

  it('never shows the browser’s "Failed to fetch"', () => {
    // Angular's fetch backend puts the browser's TypeError in the error body, with status 0.
    const offline = new HttpErrorResponse({ status: 0, error: new TypeError('Failed to fetch') });

    expect(apiErrorMessage(offline, fallback)).toBe(
      'The app couldn’t connect. Check your connection and try again.',
    );
    expect(failureKind(offline)).toBe('connection');
  });

  it('says what failed in the screen’s words, never a server fault’s own title', () => {
    for (const body of [
      { title: 'An error occurred while processing your request.' },
      { title: 'Service unavailable', status: 503 },
      { message: 'boom' },
      null,
      '<html>502 Bad Gateway</html>',
    ]) {
      const failed = new HttpErrorResponse({ status: 503, error: body });
      expect(apiErrorMessage(failed, fallback)).toBe(fallback);
      expect(failureKind(failed)).toBe('server');
    }
  });

  it('keeps what the API itself wrote with a code, even on a 5xx', () => {
    const paused = new HttpErrorResponse({
      status: 503,
      error: { code: 'uploads_paused', title: 'Progress photo uploads are unavailable.' },
    });

    expect(apiErrorMessage(paused, fallback)).toBe('Progress photo uploads are unavailable.');
    expect(failureKind(paused)).toBeNull();
  });

  it('leaves a refusal of the request to its own words', () => {
    const refused = new HttpErrorResponse({ status: 403, error: null });

    expect(apiErrorMessage(refused, fallback)).toBe(fallback);
    expect(failureKind(refused)).toBeNull();
    expect(failureKind(new Error('not http'))).toBeNull();
  });
});

/** A refused sign-in or registration says what happened and when to try again (AUTH-2, AUTH-15). */
describe('apiErrorMessage for a refusal that says when to try again', () => {
  function refused(code: string, retryAfter?: string): HttpErrorResponse {
    return new HttpErrorResponse({
      status: 429,
      error: { code, message: 'Server wording' },
      headers:
        retryAfter === undefined ? undefined : new HttpHeaders({ 'Retry-After': retryAfter }),
    });
  }

  it('counts a lock in whole minutes, rounding up', () => {
    expect(apiErrorMessage(refused('account_locked', '900'), 'fallback')).toBe(
      'This account is locked after too many wrong passwords. Try again in 15 minutes.',
    );
    expect(apiErrorMessage(refused('account_locked', '61'), 'fallback')).toBe(
      'This account is locked after too many wrong passwords. Try again in 2 minutes.',
    );
    expect(apiErrorMessage(refused('account_locked', '20'), 'fallback')).toBe(
      'This account is locked after too many wrong passwords. Try again in a minute.',
    );
    expect(apiErrorMessage(refused('account_locked'), 'fallback')).toBe(
      'This account is locked after too many wrong passwords. Try again later.',
    );
  });

  it('says too many attempts came from this network', () => {
    expect(apiErrorMessage(refused('too_many_attempts', '60'), 'fallback')).toBe(
      'Too many attempts from this network. Try again in a minute.',
    );
    expect(apiErrorMessage(refused('too_many_attempts'), 'fallback')).toBe(
      'Too many attempts from this network. Try again in a minute.',
    );
    expect(apiErrorMessage(refused('too_many_attempts', '180'), 'fallback')).toBe(
      'Too many attempts from this network. Try again in 3 minutes.',
    );
  });

  it('reads Retry-After as seconds or as a date, and ignores anything else', () => {
    expect(retryAfterSeconds(refused('x', ' 42 '))).toBe(42);
    const inTwoMinutes = new Date(Date.now() + 120_000).toUTCString();
    const fromDate = retryAfterSeconds(refused('x', inTwoMinutes));
    expect(fromDate).toBeGreaterThan(100);
    expect(fromDate).toBeLessThanOrEqual(120);
    expect(retryAfterSeconds(refused('x', 'soon'))).toBeNull();
    expect(retryAfterSeconds(refused('x'))).toBeNull();
  });
});
