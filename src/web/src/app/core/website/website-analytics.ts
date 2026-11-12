import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { DestroyRef, inject, Injectable, PLATFORM_ID } from '@angular/core';

/** What Plausible's script would send: the event's name (`n`) and its page's address (`u`), among others. */
export interface PlausiblePayload {
  readonly n?: string;
  readonly u?: string;
  readonly [field: string]: unknown;
}

/** The options the script reads from the stub (`o`) when it lands; they override the site's own. */
export interface PlausibleOptions {
  readonly endpoint: string;
  readonly autoCapturePageviews: boolean;
  readonly outboundLinks: boolean;
  readonly fileDownloads: boolean;
  readonly formSubmissions: boolean;
  readonly logging: boolean;
  readonly transformRequest: (payload: PlausiblePayload) => PlausiblePayload | null;
}

/** The queue Plausible's snippet installs before its script arrives; its script drains it. */
interface PlausibleQueue {
  (...args: unknown[]): void;
  q?: unknown[][];
  o?: PlausibleOptions;
  init?: (options?: PlausibleOptions) => void;
}

type PlausibleWindow = Window & { plausible?: PlausibleQueue };

/** The shape nginx proxies: Plausible names each site's script `pa-<id>.js` (nginx.conf). */
const SITE_SCRIPT = /^pa-[A-Za-z0-9_-]{1,64}\.js$/;

/** Where the script and its events are served from on this origin (nginx.conf's /stats/ locations). */
export const ANALYTICS_SCRIPT_PATH = '/stats/';
export const ANALYTICS_EVENT_ENDPOINT = '/stats/event';

/**
 * The website's own pages, the only addresses ever counted (notes plan N1 and N2, DOMAIN-RULES
 * WEB-003): the homepage, What changed and the sign-up page. Each counts itself for a visitor who is
 * not signed in (`pageview`). The homepage's address inside the app, `/about`, is not one of them.
 */
export const COUNTED_PAGES: readonly string[] = ['/', '/changelog', '/auth/register'];

/** The tags Plausible reads from an address to say where a visitor came from: the only query kept. */
const CAMPAIGN_TAGS: readonly string[] = [
  'ref',
  'source',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
];

/** The address a page's closing call carries (`pageview`): no page of this origin, so never counted. */
const PAGE_CLOSED = 'about:blank';

/**
 * A counted page's address as it is sent: this origin, the page's path and its campaign tags, nothing
 * else. Any other query goes, since one can carry a person's words (the Talk-to-us form sent before
 * the page is live puts its fields there), and so does the fragment. Null for any other address.
 */
export function countedAddress(address: unknown, origin: string): string | null {
  if (typeof address !== 'string' || address === '') return null;
  try {
    const url = new URL(address, origin);
    if (url.origin !== origin || !COUNTED_PAGES.includes(url.pathname)) return null;
    const tags = new URLSearchParams();
    for (const [tag, value] of url.searchParams) {
      if (CAMPAIGN_TAGS.includes(tag)) tags.append(tag, value);
    }
    const query = tags.toString();
    return `${origin}${url.pathname}${query === '' ? '' : `?${query}`}`;
  } catch {
    return null;
  }
}

/**
 * The second guard, which Plausible's script asks before it sends any event: only a page view of a
 * counted page goes on, with its address cleaned (`countedAddress`), so nothing an app page does is
 * ever sent, nor any other kind of event (the tagged clicks the script listens for, or anything its
 * site settings switch on). The page's time on page takes the address of the view it follows.
 */
export function keepPageCounts(payload: PlausiblePayload, origin: string): PlausiblePayload | null {
  if (payload.n !== 'pageview') return null;
  const address = countedAddress(payload.u, origin);
  return address === null ? null : { ...payload, u: address };
}

/**
 * Plausible analytics on the public website (UI plan R6.2g, notes plan N1), loaded from this origin
 * alone.
 *
 * Plausible's own snippet is two tags: a queue stub written inline, then its script. The CSP allows
 * no inline script, so the stub is written here, from the bundle, and the script tag is added with
 * the same-origin address nginx proxies to plausible.io. Events go to this origin too (`endpoint`),
 * so the page connects to nothing else; no cookie is read or set. Nothing happens until the
 * deployment names the site's script (`Website:Analytics:Script`), and never at build time.
 *
 * The script counts nothing on its own: a page view is counted only when one of the website's own
 * pages asks for it (`pageview`), so the pages of the app, which a visitor who signs in opens in
 * the same tab, are never counted, and `keepPageCounts` refuses anything else as a second guard.
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
    const plausible = this.queue();
    if (!plausible) return;
    this.started = true;

    const origin = this.document.location.origin;
    plausible.init ??= (options) => {
      plausible.o = options;
    };
    plausible.init({
      endpoint: ANALYTICS_EVENT_ENDPOINT,
      autoCapturePageviews: false,
      // On by default for a new site at Plausible, and they would fire on the app's pages too.
      outboundLinks: false,
      fileDownloads: false,
      formSubmissions: false,
      // A closing page's call is dropped on purpose (`pageview`); the script would log each one.
      logging: false,
      transformRequest: (payload) => keepPageCounts(payload, origin),
    });

    const element = this.document.createElement('script');
    element.async = true;
    element.src = ANALYTICS_SCRIPT_PATH + script;
    element.setAttribute('data-analytics', '');
    this.document.head.appendChild(element);
  }

  /**
   * One count of the page now open, which the page asks for once per opening: the homepage, What
   * changed and the sign-up page, for a visitor. It carries the page's address, so a call queued
   * before the script lands (or with no script named, kept and never sent) counts the page it was
   * made on.
   *
   * It keeps the two rules the script's own counting had: a page opened out of sight (a tab opened
   * behind, the browser's prerender) counts once it is first shown, and not at all if it closes
   * unseen; and a page the browser brings back from its back/forward cache, which runs no Angular
   * code again, counts again.
   *
   * The script keeps timing the last page it counted until it hears of the next one, and that time
   * is not passed through `transformRequest`. So when a counted page closes the script is told of a
   * page the guard drops: it sends the closing page's time, then nothing until a counted page asks.
   */
  pageview(destroyRef: DestroyRef): void {
    if (!this.browser) return;
    const window = this.document.defaultView as PlausibleWindow | null;
    if (!window) return;
    const address = this.document.location.href;
    // The stub until the script lands, then the script, which takes the stub's place: read each time.
    const send = (url: string) => this.queue()?.('pageview', { url });
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) send(this.document.location.href);
    };
    let counted = false;
    const shown = () => {
      if (counted || this.document.visibilityState !== 'visible') return;
      counted = true;
      this.document.removeEventListener('visibilitychange', shown);
      send(address);
      window.addEventListener('pageshow', restored);
    };
    this.document.addEventListener('visibilitychange', shown);
    shown();
    destroyRef.onDestroy(() => {
      this.document.removeEventListener('visibilitychange', shown);
      window.removeEventListener('pageshow', restored);
      if (counted) send(PAGE_CLOSED);
    });
  }

  /** Plausible's queue stub as its snippet writes it, or the script itself once it has landed. */
  private queue(): PlausibleQueue | null {
    const window = this.document.defaultView as PlausibleWindow | null;
    if (!window) return null;
    const plausible: PlausibleQueue =
      window.plausible ??
      ((...args: unknown[]) => {
        (plausible.q ??= []).push(args);
      });
    window.plausible = plausible;
    return plausible;
  }
}
