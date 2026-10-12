import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

/**
 * The browser configuration plus what the build-time render needs. Only `/` is rendered (R6.2a);
 * `app.routes.server.ts` says so, and `main.server.ts` is the entry the build runs.
 */
export const serverConfig: ApplicationConfig = mergeApplicationConfig(appConfig, {
  providers: [provideServerRendering(withRoutes(serverRoutes))],
});
