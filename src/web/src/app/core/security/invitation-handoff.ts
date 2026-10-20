import { Injectable } from '@angular/core';

/**
 * Carries an invitation's token across signing in (audit WEB-10). "Sign in to accept" used to put the
 * token in the sign-in page's `returnUrl`, a second address and history entry holding the credential;
 * now the sign-in page comes back to `/invite` alone and the invitation takes its token from here.
 *
 * Memory only, as `ActionTokenScrubber` asks of every action token: nothing goes to `localStorage`,
 * `sessionStorage` or the history. A reload or a new tab loses it, and the emailed link opens the
 * invitation again.
 */
@Injectable({ providedIn: 'root' })
export class InvitationHandoff {
  private token: string | null = null;

  hold(token: string): void {
    this.token = token || null;
  }

  /** The held token, once: taking it lets it go. */
  take(): string | null {
    const token = this.token;
    this.token = null;
    return token;
  }
}
