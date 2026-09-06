import { inject, Injectable } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * The credential-bearing query parameters an action link may carry.
 *
 * Named in one place so every action page scrubs the same set, and so a new action route cannot
 * quietly introduce a parameter nobody remembered to remove.
 */
export const ACTION_TOKEN_QUERY_PARAMS = ['code', 'token'] as const;

/**
 * Removes an exchanged action token from the address bar.
 *
 * A confirmation, reset or invitation link carries a single-use credential in its query string, and
 * it stays in the address bar, in `history`, and in anything the browser or the user does with the
 * current URL until it is removed. Once the token has been exchanged it has no further use to this
 * application, so leaving it visible is pure downside: it is copied when somebody shares "the page
 * I'm on", it survives in session restore, and it is read by any browser extension with tab access.
 *
 * The replacement is deliberate rather than cosmetic. `replaceUrl` rewrites the current history
 * entry instead of pushing a new one, so the credential is gone from the back stack as well as from
 * the bar — pushing would leave it one Back press away.
 *
 * The token is never written anywhere else on the way. It is read from the route, passed to one API
 * call, and dropped: no `localStorage`, no `sessionStorage`, no analytics, no error tracker and no
 * `console`. A Vitest case asserts the storage half of that, because it is the part a later
 * convenience feature is most likely to break.
 */
@Injectable({ providedIn: 'root' })
export class ActionTokenScrubber {
  private readonly router = inject(Router);

  /**
   * Rewrites the current URL without its credential parameters.
   *
   * Failure is swallowed on purpose. Scrubbing runs after the exchange has already succeeded or
   * failed, and a navigation that cannot complete — a guard, a teardown, a test harness without a
   * router outlet — must not turn a finished action into an error the person sees.
   */
  async scrub(route: ActivatedRoute): Promise<void> {
    const present = ACTION_TOKEN_QUERY_PARAMS.filter((key) =>
      route.snapshot.queryParamMap.has(key),
    );
    if (present.length === 0) {
      return;
    }

    const cleared: Record<string, null> = {};
    for (const key of present) {
      cleared[key] = null;
    }

    try {
      await this.router.navigate([], {
        relativeTo: route,
        queryParams: cleared,
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    } catch {
      // Deliberately ignored; see above.
    }
  }
}
