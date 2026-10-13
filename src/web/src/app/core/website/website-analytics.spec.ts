import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { WebsiteAnalytics } from './website-analytics';

interface Stub {
  (...args: unknown[]): void;
  q?: unknown[][];
  o?: { endpoint?: string };
  init?: (options?: { endpoint?: string }) => void;
}

function analyticsScripts(): HTMLScriptElement[] {
  return Array.from(document.head.querySelectorAll<HTMLScriptElement>('script[data-analytics]'));
}

describe('WebsiteAnalytics', () => {
  afterEach(() => {
    for (const script of analyticsScripts()) script.remove();
    delete (window as unknown as { plausible?: Stub }).plausible;
    TestBed.resetTestingModule();
  });

  it('installs the queue stub with this origin as the endpoint, then the script from this origin, once', () => {
    const analytics = TestBed.inject(WebsiteAnalytics);

    analytics.start('pa-AbC123.js');
    analytics.start('pa-AbC123.js');

    const scripts = analyticsScripts();
    expect(scripts).toHaveLength(1);
    expect(scripts[0].getAttribute('src')).toBe('/stats/pa-AbC123.js');
    expect(scripts[0].async).toBe(true);
    expect(analytics.running).toBe(true);

    const plausible = (window as unknown as { plausible: Stub }).plausible;
    expect(plausible.o).toEqual({ endpoint: '/stats/event' });
    // Calls made before the script arrives are queued for it, as Plausible's own snippet does.
    plausible('pageview', { u: '/x' });
    expect(plausible.q).toEqual([['pageview', { u: '/x' }]]);
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
    expect((window as unknown as { plausible?: Stub }).plausible).toBeUndefined();
  });
});
