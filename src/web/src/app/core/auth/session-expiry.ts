import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { DestroyRef, effect, inject, Injectable, Injector, PLATFORM_ID } from '@angular/core';
import { Router, UrlTree } from '@angular/router';
import type { ToastHandle } from '../../ui/toast';
import { AuthStore } from './auth.store';

/** The kit's toast stays out of the first download, as `NavigationFailure` keeps it (about 90 kB). */
const loadToast = () => import('../../ui/toast').then((module) => module.UiToast);

/** How long a tab stays hidden before its return asks the API about the session again. */
export const RECHECK_AFTER_HIDDEN_MS = 5 * 60_000;

/** The `reason` the sign-in page reads to say why the person is there. */
export const SESSION_ENDED_REASON = 'session-ended';

/**
 * The sign-in page, with the page to come back to. An invitation is never carried along: its token
 * would sit in a second address and history entry (WEB-10), and the link opens the page again.
 */
export function signInAfter(router: Router, returnUrl: string, ended: boolean): UrlTree {
  const comesBack = returnUrl !== '/' && !/^\/(auth|invite)(\/|\?|$)/.test(returnUrl);
  return router.createUrlTree(['/auth/sign-in'], {
    queryParams: {
      ...(comesBack ? { returnUrl } : {}),
      ...(ended ? { reason: SESSION_ENDED_REASON } : {}),
    },
  });
}

/**
 * Notices a session that ended while the app was open (audit WEB-1): the sign-in ran out, or Sign
 * out everywhere or a password change on another device ended it. Until now the shell stayed up and
 * every screen failed in its own wrong words ("Clients could not be loaded. Check your connection")
 * until a full reload.
 *
 * The first 401 from the API, or the session check when a long-hidden tab comes back, takes the
 * person to sign-in with the page to come back to and one sentence. That route change passes the
 * leave guards like any other, so typed work is offered before anything closes, and the session is
 * cleared only once they have left (`signedOutGuard`).
 */
@Injectable({ providedIn: 'root' })
export class SessionExpiry {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private hiddenSince: number | null = null;
  private heldNotice: ToastHandle | null = null;

  constructor() {
    this.watchVisibility();
    // The notice belongs to the ended session: gone once it is cleared or someone signs in.
    effect(() => {
      if (!this.auth.ended()) {
        this.heldNotice?.dismiss();
        this.heldNotice = null;
      }
    });
  }

  /** The API refused a signed-in request with 401, or the session check found nobody. */
  async ended(): Promise<void> {
    if (this.auth.user() === null || this.auth.ended()) return;
    this.auth.markEnded();
    // The 401 usually answers the person's own save, whose handlers settle within this task. The
    // next task starts the route change, so a form that was saving knows it failed before the
    // leave guards ask whether its typed work may go.
    await new Promise<void>((resolve) => setTimeout(resolve));
    await this.goToSignIn();
  }

  /**
   * Sign-in, through the leave guards. When one keeps the person with their typed work, a notice
   * says why it asked and offers the way on, since on a phone it covers the top bar's menu; taking
   * it asks about the work again, and keeping the work again brings the notice back.
   */
  private async goToSignIn(): Promise<void> {
    let left: boolean;
    try {
      left = await this.router.navigateByUrl(signInAfter(this.router, this.router.url, true));
    } catch {
      // The sign-in page could not be opened (offline); the navigation failure toast says so.
      return;
    }
    if (left || !this.auth.ended() || this.heldNotice !== null) return;

    const toasts = await loadToast()
      .then((type) => this.injector.get(type))
      .catch(() => null);
    if (!toasts || !this.auth.ended() || this.heldNotice !== null) return;
    this.heldNotice = toasts.show(
      $localize`You were signed out. Copy anything you want to keep, then sign in again.`,
      {
        durationMs: 0,
        action: {
          label: $localize`Sign in`,
          run: () => {
            // The toast closes itself once this returns.
            this.heldNotice = null;
            void this.goToSignIn();
          },
        },
      },
    );
  }

  private watchVisibility(): void {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const document = inject(DOCUMENT);
    const changed = () => {
      if (document.visibilityState === 'hidden') {
        this.hiddenSince ??= Date.now();
        return;
      }
      const hiddenFor = this.hiddenSince === null ? 0 : Date.now() - this.hiddenSince;
      this.hiddenSince = null;
      if (hiddenFor >= RECHECK_AFTER_HIDDEN_MS) void this.recheck();
    };
    document.addEventListener('visibilitychange', changed);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('visibilitychange', changed));
  }

  /**
   * The guards trust the session the app first found, so a phone left in a pocket overnight would
   * show yesterday's screens until something failed. Asking once on the way back costs one request.
   */
  private async recheck(): Promise<void> {
    if (this.auth.user() === null || this.auth.ended()) return;
    if ((await this.auth.stillSignedIn()) === false) await this.ended();
  }
}
