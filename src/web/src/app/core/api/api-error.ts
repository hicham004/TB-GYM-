import { HttpErrorResponse } from '@angular/common/http';
import { ApiErrorBody } from './api.models';

/**
 * Stable server codes for a rejected upload, mapped to something a coach or client can act on.
 * A full allowance is not a broken file, and the difference decides what the user should do next:
 * free space in the workspace, or thin out this client's photos.
 */
function storageAllowanceMessage(code: string): string | null {
  switch (code) {
    case 'MediaWorkspaceStorageExceeded':
      return $localize`This workspace has used all of its media storage. Delete some media to free space, then try again.`;
    case 'ClientProgressPhotoStorageExceeded':
      return $localize`This client has used all of their progress-photo storage. Remove some older photos, then try again.`;
    default:
      return null;
  }
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) {
    return fallback;
  }

  const body = error.error as ApiErrorBody | undefined;
  if (body?.code) {
    const known = storageAllowanceMessage(body.code);
    if (known) {
      return known;
    }
  }

  if (body?.message) {
    return body.message;
  }

  if (body?.errors) {
    const first = Object.values(body.errors).flat()[0];
    if (first) {
      return first;
    }
  }

  // Conflicts are returned as problem details, whose human-readable text is the title. Without
  // this the server's explanation was discarded and every conflict read as a generic failure.
  if (body?.title) {
    return body.title;
  }

  return fallback;
}
