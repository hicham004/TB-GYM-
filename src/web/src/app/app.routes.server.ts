import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Which addresses the production build renders ahead of time (UI plan R6.2a, R6.2f, audit UIQ-13).
 *
 * The homepage, the changelog and sign-in. They are public and the same for every visitor, so Google
 * and link previews can read the first two as finished HTML, and sign-in (where the installed app
 * starts) draws its form before the scripts arrive; the build writes them as `index.html`,
 * `changelog/index.html` and `auth/sign-in/index.html`. Every other address is a signed-in screen or
 * a token-bearing page: those stay client-rendered, and the build keeps the plain application shell
 * as `index.csr.html` for them, so a deep link never shows the homepage first. `nginx.conf` serves the
 * three documents only to a visitor without the sign-in cookie, and the shell for everything else.
 */
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'changelog', renderMode: RenderMode.Prerender },
  { path: 'auth/sign-in', renderMode: RenderMode.Prerender },
  { path: '**', renderMode: RenderMode.Client },
];
