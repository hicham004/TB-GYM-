import { HttpErrorResponse } from '@angular/common/http';
import { apiErrorMessage } from '../../core/api/api-error';

/** What a refused closing says: under the password field, or for the whole dialog. */
export interface CloseAccountRefusal {
  readonly password: string | null;
  readonly message: string | null;
}

/** Said under the password field when nothing was typed; the server asks for it too. */
export const PASSWORD_NEEDED = $localize`Type your password to close your account.`;

/**
 * The words for a closing the server refused (CLI-027). A wrong password is said under its field; an
 * account that owns or coaches a space, a platform admin, or a closing that met a change are said for
 * the dialog. Anything else falls back to the API's own words.
 */
export function closeAccountRefusal(error: unknown): CloseAccountRefusal {
  if (error instanceof HttpErrorResponse) {
    const body = (error.error ?? null) as { code?: unknown; errors?: unknown } | null;
    if (
      error.status === 400 &&
      typeof body?.errors === 'object' &&
      body.errors !== null &&
      'password' in body.errors
    ) {
      return {
        password: $localize`That password isn’t right. Type the one you sign in with.`,
        message: null,
      };
    }

    switch (body?.code) {
      case 'account_closure_staff':
        return {
          password: null,
          message: $localize`This account owns or coaches a coaching space, or once did, so it can’t be closed here.`,
        };
      case 'account_closure_platform_admin':
        return {
          password: null,
          message: $localize`A platform admin’s account can’t be closed here.`,
        };
      case 'account_closure_changed':
        return {
          password: null,
          message: $localize`Something changed while your account was closing, so nothing was closed. Try again.`,
        };
    }
  }

  return {
    password: null,
    message: apiErrorMessage(
      error,
      $localize`Your account couldn’t be closed, and nothing was changed. Try again.`,
    ),
  };
}
