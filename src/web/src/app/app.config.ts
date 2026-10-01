import { provideHttpClient, withInterceptors, withXsrfConfiguration } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';

import { routes } from './app.routes';
import { InstallPrompt } from './core/pwa/install-prompt';
import { tenantInterceptor } from './core/tenancy/tenant.interceptor';
import { devProviders } from './dev/dev-providers';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Chrome announces an installable page once, soon after load, and only to a listener that is
    // already there; the screens that offer the install load later.
    provideAppInitializer(() => {
      inject(InstallPrompt);
    }),
    // A new page starts at its top and Back returns to where the reader was (A11Y-02). Anchor
    // scrolling keeps in-page links such as the homepage's #tour working: the browser reports them
    // to the router as navigations, which would otherwise scroll back to the top.
    provideRouter(
      routes,
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
    ),
    provideHttpClient(
      withXsrfConfiguration({ cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' }),
      withInterceptors([tenantInterceptor]),
    ),
    ...devProviders,
  ],
};
