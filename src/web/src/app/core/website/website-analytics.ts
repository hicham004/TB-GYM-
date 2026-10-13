import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';

/** The queue Plausible's snippet installs before its script arrives; its script drains it. */
interface PlausibleQueue {
  (...args: unknown[]): void;
  q?: unknown[][];
  o?: { endpoint?: string };
  init?: (options?: { endpoint?: string }) => void;
}

/** The shape nginx proxies: Plausible names each site's script `pa-<id>.js` (nginx.conf). */
const SITE_SCRIPT = /^pa-[A-Za-z0-9_-]{1,64}\.js$/;

/** Where the script and its events are served from on this origin (nginx.conf's /stats/ locations). */
export const ANALYTICS_SCRIPT_PATH = '/stats/';
export const ANALYTICS_EVENT_ENDPOINT = '/stats/event';

/**
 * Plausible analytics on the public website (UI plan R6.2g), loaded from this origin alone.
 *
 * Plausible's own snippet is two tags: a queue stub written inline, then its script. The CSP allows
 * no inline script, so the stub is written here, from the bundle, and the script tag is added with
 * the same-origin address nginx proxies to plausible.io. Events go to this origin too (`endpoint`),
 * so the page connects to nothing else; no cookie is read or set. Nothing happens until the
 * deployment names the site's script (`Website:Analytics:Script`), and never at build time.
 */
@Injectable({ providedIn: 'root' })
export class WebsiteAnalytics {
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private started = false;

  /** True once the script tag was added. */
  get running(): boolean {
    return this.started;
  }

  start(script: string | null | undefined): void {
    if (!this.browser || this.started || !script || !SITE_SCRIPT.test(script)) return;
    const window = this.document.defaultView as (Window & { plausible?: PlausibleQueue }) | null;
    if (!window) return;
    this.started = true;

    const plausible: PlausibleQueue =
      window.plausible ??
      ((...args: unknown[]) => {
        (plausible.q ??= []).push(args);
      });
    plausible.init ??= (options) => {
      plausible.o = options ?? {};
    };
    window.plausible = plausible;
    plausible.init({ endpoint: ANALYTICS_EVENT_ENDPOINT });

    const element = this.document.createElement('script');
    element.async = true;
    element.src = ANALYTICS_SCRIPT_PATH + script;
    element.setAttribute('data-analytics', '');
    this.document.head.appendChild(element);
  }
}
