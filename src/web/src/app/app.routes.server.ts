import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Which addresses the production build renders ahead of time (UI plan R6.2a, R6.2f).
 *
 * The homepage and the changelog. Both are public and the same for every visitor, so Google and
 * link previews can read them as finished HTML; the build writes them as `index.html` and
 * `changelog/index.html`. Every other address is a signed-in screen or a token-bearing page: those
 * stay client-rendered, and the build keeps the plain application shell as `index.csr.html` for
 * them, so a deep link never shows the homepage first (`nginx.conf` serves that file for everything
 * but these two).
 */
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'changelog', renderMode: RenderMode.Prerender },
  { path: '**', renderMode: RenderMode.Client },
];
