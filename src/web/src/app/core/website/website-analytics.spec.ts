import { createEnvironmentInjector, DestroyRef, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COUNTED_PAGES,
  countedAddress,
  keepPageCounts,
  WebsiteAnalytics,
  type PlausibleOptions,
} from './website-analytics';

interface Stub {
  (...args: unknown[]): void;
  q?: unknown[][];
  o?: PlausibleOptions;
  init?: (options?: PlausibleOptions) => void;
}

const ORIGIN = window.location.origin;

function analyticsScripts(): HTMLScriptElement[] {
  return Array.from(document.head.querySelectorAll<HTMLScriptElement>('script[data-analytics]'));
}

function plausible(): Stub | undefined {
  return (window as unknown as { plausible?: Stub }).plausible;
}

/** A page's life: its DestroyRef, and the page closing. */
function openPage(): { destroyRef: DestroyRef; close: () => void } {
  const injector = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
  return { destroyRef: injector.get(DestroyRef), close: () => injector.destroy() };
}

describe('WebsiteAnalytics', () => {
  afterEach(() => {
    for (const script of analyticsScripts()) script.remove();
    delete (window as unknown as { plausible?: Stub }).plausible;
    history.replaceState(null, '', '/');
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('installs the queue stub with this origin as the endpoint and no counting of its own, then the script from this origin, once', () => {
    const analytics = TestBed.inject(WebsiteAnalytics);

    analytics.start('pa-AbC123.js');
    analytics.start('pa-AbC123.js');

    const scripts = analyticsScripts();
    expect(scripts).toHaveLength(1);
    expect(scripts[0].getAttribute('src')).toBe('/stats/pa-AbC123.js');
    expect(scripts[0].async).toBe(true);
    expect(analytics.running).toBe(true);

    const options = plausible()!.o!;
    expect(options.endpoint).toBe('/stats/event');
    // The pages ask for their own counts; the script would otherwise count every address change.
    expect(options.autoCapturePageviews).toBe(false);
    // A new site at Plausible tracks these by default, on every page the tab opens.
    expect(options.outboundLinks).toBe(false);
    expect(options.fileDownloads).toBe(false);
    expect(options.formSubmissions).toBe(false);
    expect(options.logging).toBe(false);
    expect(typeof options.transformRequest).toBe('function');
    // Calls made before the script arrives are queued for it, as Plausible's own snippet does.
    plausible()!('pageview', { url: `${ORIGIN}/` });
    expect(plausible()!.q).toEqual([['pageview', { url: `${ORIGIN}/` }]]);
  });

  it('counts the page now open with its own address, queued before the stub has options, and start keeps that queue', () => {
    history.replaceState(null, '', '/?utm_source=talk');
    const analytics = TestBed.inject(WebsiteAnalytics);
    const page = openPage();

    analytics.pageview(page.destroyRef);
    expect(analyticsScripts()).toHaveLength(0);
    expect(plausible()!.q).toEqual([['pageview', { url: `${ORIGIN}/?utm_source=talk` }]]);

    analytics.start('pa-AbC123.js');
    expect(analyticsScripts()).toHaveLength(1);
    expect(plausible()!.q).toEqual([['pageview', { url: `${ORIGIN}/?utm_source=talk` }]]);
    expect(plausible()!.o!.autoCapturePageviews).toBe(false);

    // The address changes before the script lands: the queued count still names its own page.
    history.replaceState(null, '', '/auth/sign-in');
    page.close();
    expect(plausible()!.q).toEqual([
      ['pageview', { url: `${ORIGIN}/?utm_source=talk` }],
      ['pageview', { url: 'about:blank' }],
    ]);
  });

  it('once the script has landed, a page calls it directly, and tells it of a page it must not count when the page closes', () => {
    const analytics = TestBed.inject(WebsiteAnalytics);
    analytics.start('pa-AbC123.js');
    const script = vi.fn();
    (window as unknown as { plausible: unknown }).plausible = script;
    history.replaceState(null, '', '/changelog');
    const page = openPage();

    analytics.pageview(page.destroyRef);
    expect(script).toHaveBeenCalledExactlyOnceWith('pageview', { url: `${ORIGIN}/changelog` });

    history.replaceState(null, '', '/auth/sign-in');
    page.close();
    expect(script).toHaveBeenCalledTimes(2);
    expect(script).toHaveBeenLastCalledWith('pageview', { url: 'about:blank' });
    // That closing call is one the guard drops, which is what ends the page's time on page.
    expect(keepPageCounts({ n: 'pageview', u: 'about:blank' }, ORIGIN)).toBeNull();
  });

  it('counts a page opened out of sight once it is first shown, with its own address, and not at all if it closes unseen', () => {
    // A tab opened behind, or the browser's prerender: the page runs while nobody sees it.
    const visibility = vi
      .spyOn(Document.prototype, 'visibilityState', 'get')
      .mockReturnValue('hidden');
    history.replaceState(null, '', '/changelog');
    const analytics = TestBed.inject(WebsiteAnalytics);
    const seen = openPage();

    analytics.pageview(seen.destroyRef);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(plausible()?.q ?? []).toEqual([]);

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(plausible()!.q).toEqual([['pageview', { url: `${ORIGIN}/changelog` }]]);
    seen.close();
    expect(plausible()!.q).toEqual([
      ['pageview', { url: `${ORIGIN}/changelog` }],
      ['pageview', { url: 'about:blank' }],
    ]);

    // Closed before it was ever shown: no count, no closing call, no listener left behind.
    visibility.mockReturnValue('hidden');
    const unseen = openPage();
    analytics.pageview(unseen.destroyRef);
    unseen.close();
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(plausible()!.q).toHaveLength(2);
  });

  it('counts a page the browser brings back from its back/forward cache again, while the page is open', () => {
    const analytics = TestBed.inject(WebsiteAnalytics);
    const page = openPage();
    analytics.pageview(page.destroyRef);

    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    expect(plausible()!.q).toEqual([['pageview', { url: `${ORIGIN}/` }]]);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(plausible()!.q).toEqual([
      ['pageview', { url: `${ORIGIN}/` }],
      ['pageview', { url: `${ORIGIN}/` }],
    ]);

    page.close();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(plausible()!.q).toEqual([
      ['pageview', { url: `${ORIGIN}/` }],
      ['pageview', { url: `${ORIGIN}/` }],
      ['pageview', { url: 'about:blank' }],
    ]);
  });

  it('loads nothing without a script name, or with one that is not a Plausible site script', () => {
    const analytics = TestBed.inject(WebsiteAnalytics);

    analytics.start(null);
    analytics.start('');
    analytics.start('https://plausible.io/js/pa-x.js');
    analytics.start('script.js');
    analytics.start('../pa-x.js');

    expect(analyticsScripts()).toHaveLength(0);
    expect(analytics.running).toBe(false);
    expect(plausible()).toBeUndefined();
  });

  it('with no script named, a count waits in the stub and nothing is loaded or sent', () => {
    const analytics = TestBed.inject(WebsiteAnalytics);

    analytics.pageview(openPage().destroyRef);
    analytics.start(null);

    expect(analyticsScripts()).toHaveLength(0);
    expect(analytics.running).toBe(false);
    expect(plausible()!.o).toBeUndefined();
    expect(plausible()!.q).toEqual([['pageview', { url: `${ORIGIN}/` }]]);
  });

  it('the guard in the options is keepPageCounts for this origin', () => {
    const analytics = TestBed.inject(WebsiteAnalytics);
    analytics.start('pa-AbC123.js');
    const guard = plausible()!.o!.transformRequest;

    const count = { n: 'pageview', u: `${ORIGIN}/`, d: 'tbgym.com', r: null };
    expect(guard(count)).toEqual(count);
    expect(guard({ n: 'pageview', u: `${ORIGIN}/clients` })).toBeNull();
  });

  it('counts the sign-up page when it asks, and the guard sends its path and campaign tags alone', () => {
    history.replaceState(
      null,
      '',
      '/auth/register?utm_source=instagram&email=coach%40example.test&next=%2Fclients',
    );
    const analytics = TestBed.inject(WebsiteAnalytics);
    analytics.start('pa-AbC123.js');
    const page = openPage();

    analytics.pageview(page.destroyRef);
    expect(plausible()!.q).toHaveLength(1);
    const [name, { url }] = plausible()!.q![0] as [string, { url: string }];
    expect(name).toBe('pageview');
    expect(new URL(url).pathname).toBe('/auth/register');

    // What the script would send for that call goes through the guard first.
    expect(plausible()!.o!.transformRequest({ n: 'pageview', u: url })).toEqual({
      n: 'pageview',
      u: `${ORIGIN}/auth/register?utm_source=instagram`,
    });
  });
});

describe('keepPageCounts', () => {
  it('lets a page view of the homepage, What changed or the sign-up page through, with its path and campaign tags alone', () => {
    for (const [path, sent] of [
      ['/', '/'],
      ['/?utm_source=instagram&utm_campaign=launch', '/?utm_source=instagram&utm_campaign=launch'],
      ['/#talk', '/'],
      ['/changelog', '/changelog'],
      ['/changelog?ref=a&tab=2', '/changelog?ref=a'],
      // The Talk-to-us form sent before the page is live puts its fields in the address.
      [
        '/?name=Karim&gymName=Atlas&contact=karim%40atlas.example&message=Hi&website=&utm_source=talk#talk',
        '/?utm_source=talk',
      ],
      // The sign-up page (notes plan N2): its path and the same tags, never the rest of its address.
      ['/auth/register', '/auth/register'],
      [
        '/auth/register?utm_source=instagram&utm_medium=story',
        '/auth/register?utm_source=instagram&utm_medium=story',
      ],
      [
        '/auth/register?email=coach%40example.test&next=%2Fclients&ref=flyer#form',
        '/auth/register?ref=flyer',
      ],
      ['/auth/register?email=coach%40example.test&next=%2Fclients', '/auth/register'],
    ]) {
      const payload = { n: 'pageview', u: `${ORIGIN}${path}`, d: 'tbgym.com', r: null };
      expect(keepPageCounts(payload, ORIGIN), path).toEqual({ ...payload, u: `${ORIGIN}${sent}` });
    }
  });

  it('drops a page view of any other address: the app, sign-in, an invitation, a legal document, the homepage inside the app, another site', () => {
    for (const address of [
      `${ORIGIN}/clients`,
      `${ORIGIN}/clients/01a1ad8a-21ae-71fc-90d8-318b1d6ca254`,
      `${ORIGIN}/training/programs`,
      `${ORIGIN}/auth/sign-in`,
      `${ORIGIN}/auth/register/`,
      `${ORIGIN}/auth/register/coach`,
      `${ORIGIN}/auth`,
      `${ORIGIN}/auth/reset-password?token=abc`,
      `${ORIGIN}/invite?token=abc`,
      `${ORIGIN}/legal/privacy`,
      `${ORIGIN}/changelog/2026`,
      // The homepage's address inside the app (notes plan N2) is never counted, tagged or not.
      `${ORIGIN}/about`,
      `${ORIGIN}/about?utm_source=x`,
      `${ORIGIN}/about#week`,
      'https://example.com/',
      'https://example.com/changelog',
      'https://example.com/auth/register',
      'about:blank',
      '',
      undefined,
    ]) {
      expect(keepPageCounts({ n: 'pageview', u: address }, ORIGIN), String(address)).toBeNull();
    }
  });

  it("drops every event but a page view, even on the website's own pages", () => {
    for (const name of [
      'Outbound Link: Click',
      'File Download',
      'Form: Submission',
      'engagement',
      'Signup',
    ]) {
      expect(
        keepPageCounts({ n: name, u: `${ORIGIN}/`, p: { url: 'https://wa.me/1' } }, ORIGIN),
        name,
      ).toBeNull();
    }
  });
});

describe('countedAddress', () => {
  it('reads an address against this origin and keeps only what may be sent', () => {
    expect(countedAddress('/', ORIGIN)).toBe(`${ORIGIN}/`);
    expect(countedAddress('/changelog#2026-11-05', ORIGIN)).toBe(`${ORIGIN}/changelog`);
    expect(countedAddress('/?source=whatsapp&email=a%40b.example', ORIGIN)).toBe(
      `${ORIGIN}/?source=whatsapp`,
    );
    expect(countedAddress('/today', ORIGIN)).toBeNull();
    expect(countedAddress(42, ORIGIN)).toBeNull();
    expect(countedAddress('http://[bad', ORIGIN)).toBeNull();
  });

  it('counts three pages, the homepage, What changed and the sign-up page, and no other', () => {
    expect(COUNTED_PAGES).toEqual(['/', '/changelog', '/auth/register']);
  });

  it('keeps the sign-up page’s path and campaign tags, and drops whatever else its address carries', () => {
    expect(countedAddress('/auth/register', ORIGIN)).toBe(`${ORIGIN}/auth/register`);
    expect(countedAddress(`${ORIGIN}/auth/register#form`, ORIGIN)).toBe(`${ORIGIN}/auth/register`);
    expect(
      countedAddress(
        '/auth/register?email=coach%40example.test&next=%2Fclients&utm_campaign=launch',
        ORIGIN,
      ),
    ).toBe(`${ORIGIN}/auth/register?utm_campaign=launch`);
    expect(
      countedAddress('/auth/register?email=coach%40example.test&next=%2Fclients', ORIGIN),
    ).toBe(`${ORIGIN}/auth/register`);
  });

  it('never counts the homepage’s address inside the app, with a campaign tag or a section or without', () => {
    expect(countedAddress('/about', ORIGIN)).toBeNull();
    expect(countedAddress('/about?utm_source=x', ORIGIN)).toBeNull();
    expect(countedAddress('/about#week', ORIGIN)).toBeNull();
    expect(countedAddress(`${ORIGIN}/about`, ORIGIN)).toBeNull();
  });
});
