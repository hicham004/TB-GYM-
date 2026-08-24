import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { apiErrorMessage } from './api-error';

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

    expect(message).toContain('workspace has used all of its media storage');
    // The generic upload failure would send the user looking for a problem with their photo.
    expect(message).not.toBe(fallback);
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
    expect(message).not.toContain('workspace has used all');
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
    expect(apiErrorMessage(new HttpErrorResponse({ status: 500, error: null }), fallback)).toBe(
      fallback,
    );
  });
});
