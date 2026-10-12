import { provideHttpClient, withInterceptors, withXsrfConfiguration } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {
  provideClientHydration,
  withI18nSupport,
  withNoHttpTransferCache,
  withNoIncrementalHydration,
} from '@angular/platform-browser';
import { provideRouter, withInMemoryScrolling, withNavigationErrorHandler } from '@angular/router';

import { routes } from './app.routes';
import { InstallPrompt } from './core/pwa/install-prompt';
import { NavigationFailure, reportNavigationFailure } from './core/routing/navigation-failure';
import { tenantInterceptor } from './core/tenancy/tenant.interceptor';
import { devProviders } from './dev/dev-providers';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // The homepage arrives as finished HTML from the build (R6.2a, `app.routes.server.ts`). Hydration
    // takes that page over instead of clearing it and drawing it again, so a visitor sees no flicker.
    // Every other address loads the plain shell, where there is nothing to hydrate. Incremental
    // hydration (on by default, and event replay with it) is turned off on purpose: it writes inline
    // scripts into the page, which the CSP (`nginx.conf`, script-src 'self') has no nonce for. The
    // build-time render calls no API, so there is no HTTP cache to carry over either; i18n support
    // lets the translated blocks hydrate.
    provideClientHydration(
      withI18nSupport(),
      withNoIncrementalHydration(),
      withNoHttpTransferCache(),
    ),
    // Chrome announces an installable page once, soon after load, and only to a listener that is
    // already there; the screens that offer the install load later. The navigation failure toast is
    // fetched ahead once someone signs in, so it can still be shown when the connection is gone.
    provideAppInitializer(() => {
      inject(InstallPrompt);
      inject(NavigationFailure);
    }),
    // A new page starts at its top and Back returns to where the reader was (A11Y-02). Anchor
    // scrolling keeps in-page links such as the homepage's #tour working: the browser reports them
    // to the router as navigations, which would otherwise scroll back to the top. A page that cannot
    // be opened (offline, or a release renamed its files) says so in a toast (R5.4b).
    provideRouter(
      routes,
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
      withNavigationErrorHandler(reportNavigationFailure),
    ),
    provideHttpClient(
      withXsrfConfiguration({ cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' }),
      withInterceptors([tenantInterceptor]),
    ),
    ...devProviders,
  ],
};
