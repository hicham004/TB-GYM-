import { HttpErrorResponse } from '@angular/common/http';
import { ApiErrorBody } from './api.models';

/**
 * Stable server codes mapped to something a coach or client can act on. Each of these leads to a
 * different next step, so they must not collapse into one generic failure: a full allowance is not
 * a broken file, and a date that is already taken is not a stale version.
 */
function knownCodeMessage(code: string): string | null {
  switch (code) {
    case 'MediaWorkspaceStorageExceeded':
      return $localize`This workspace has used all of its media storage. Delete some media to free space, then try again.`;
    case 'ClientProgressPhotoStorageExceeded':
      return $localize`This client has used all of their progress-photo storage. Remove some older photos, then try again.`;
    case 'BodyweightDateAlreadyExists':
      return $localize`A weight is already recorded for that date. Correct that entry instead of moving this one onto it.`;
    case 'BodyweightObservationVoided':
      return $localize`That entry was already replaced by a correction. Work from the replacement instead.`;
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
    const known = knownCodeMessage(body.code);
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
