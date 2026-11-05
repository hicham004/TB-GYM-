import { createEnvironmentInjector, DestroyRef, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
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
});

describe('keepPageCounts', () => {
  it('lets a page view of the homepage or What changed through, with its path and campaign tags alone', () => {
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
    ]) {
      const payload = { n: 'pageview', u: `${ORIGIN}${path}`, d: 'tbgym.com', r: null };
      expect(keepPageCounts(payload, ORIGIN), path).toEqual({ ...payload, u: `${ORIGIN}${sent}` });
    }
  });

  it('drops a page view of any other address: the app, sign-in, sign-up, an invitation, a legal document, another site', () => {
    for (const address of [
      `${ORIGIN}/clients`,
      `${ORIGIN}/clients/01a1ad8a-21ae-71fc-90d8-318b1d6ca254`,
      `${ORIGIN}/training/programs`,
      `${ORIGIN}/auth/sign-in`,
      `${ORIGIN}/auth/register`,
      `${ORIGIN}/auth/reset-password?token=abc`,
      `${ORIGIN}/invite?token=abc`,
      `${ORIGIN}/legal/privacy`,
      `${ORIGIN}/changelog/2026`,
      `${ORIGIN}/about`,
      'https://example.com/',
      'https://example.com/changelog',
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
});
