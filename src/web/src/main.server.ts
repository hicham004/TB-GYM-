/// <reference types="@angular/localize" />

import { bootstrapApplication, type BootstrapContext } from '@angular/platform-browser';
import { App } from './app/app';
import { serverConfig } from './app/app.config.server';

/**
 * The build-time entry for the homepage pre-render (UI plan R6.2a). There is no Node server: the
 * production build renders `/` once, writes it as `index.html`, and keeps the plain application
 * shell as `index.csr.html` for every other address (see `app.routes.server.ts` and `nginx.conf`).
 */
const bootstrap = (context: BootstrapContext) => bootstrapApplication(App, serverConfig, context);

export default bootstrap;
