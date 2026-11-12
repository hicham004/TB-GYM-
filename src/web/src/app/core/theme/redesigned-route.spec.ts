import {
  DefaultUrlSerializer,
  type ActivatedRouteSnapshot,
  type Data,
  type Router,
  type Routes,
} from '@angular/router';
import { describe, expect, it } from 'vitest';
import {
  FULL_SCREEN,
  HOUSE_BRAND,
  isRedesigned,
  isWebsitePage,
  REDESIGNED,
  startsOnWebsitePage,
  wantsFullScreen,
  wantsHouseBrand,
  WEBSITE_PAGE,
} from './redesigned-route';

function chain(...data: Data[]): ActivatedRouteSnapshot {
  let child: ActivatedRouteSnapshot | null = null;
  for (const item of [...data].reverse()) {
    child = { data: item, firstChild: child } as unknown as ActivatedRouteSnapshot;
  }
  return child!;
}

describe('isRedesigned', () => {
  it('finds the marker on the active route or any route above it', () => {
    expect(isRedesigned(chain({}, REDESIGNED))).toBe(true);
    expect(isRedesigned(chain(REDESIGNED, {}))).toBe(true);
    expect(isRedesigned(chain({}, {}))).toBe(false);
    // The full-screen player carries both marks (R5.4b).
    expect(isRedesigned(chain({}, { ...FULL_SCREEN, ...REDESIGNED }))).toBe(true);
  });
});

describe('wantsHouseBrand', () => {
  it('keeps TB Gym’s own brand on a marked route or below one', () => {
    expect(wantsHouseBrand(chain({}, HOUSE_BRAND))).toBe(true);
    expect(wantsHouseBrand(chain(HOUSE_BRAND, {}))).toBe(true);
    expect(wantsHouseBrand(chain({}, REDESIGNED))).toBe(false);
  });
});

describe('wantsFullScreen', () => {
  it('fills the screen on a marked route or below one, and nowhere else', () => {
    expect(wantsFullScreen(chain({}, FULL_SCREEN))).toBe(true);
    expect(wantsFullScreen(chain(FULL_SCREEN, {}))).toBe(true);
    expect(wantsFullScreen(chain({}, REDESIGNED))).toBe(false);
  });
});

// Notes plan N2: the homepage opened inside the app, at /about.
describe('isWebsitePage', () => {
  it('knows the website’s own page and a route below it, and no other page', () => {
    expect(isWebsitePage(chain({}, WEBSITE_PAGE))).toBe(true);
    // A child of it, were it ever given one.
    expect(isWebsitePage(chain({}, WEBSITE_PAGE, {}))).toBe(true);
    expect(isWebsitePage(chain(WEBSITE_PAGE, {}))).toBe(true);

    expect(isWebsitePage(chain({}, {}))).toBe(false);
    // No other mark means it: Billing, a rebuilt screen and the workout player keep their shell.
    expect(isWebsitePage(chain({}, HOUSE_BRAND))).toBe(false);
    expect(isWebsitePage(chain({}, REDESIGNED))).toBe(false);
    expect(isWebsitePage(chain({}, { ...FULL_SCREEN, ...REDESIGNED }))).toBe(false);
    // The mark itself, never something that only reads as true.
    expect(isWebsitePage(chain({}, { websitePage: 'true' }))).toBe(false);
  });

  it('asks for TB Gym’s own colours with the same mark, whatever the coaching space’s brand', () => {
    expect(WEBSITE_PAGE).toEqual({ websitePage: true, houseBrand: true });
    expect(wantsHouseBrand(chain({}, WEBSITE_PAGE))).toBe(true);
    expect(wantsHouseBrand(chain({}, WEBSITE_PAGE, {}))).toBe(true);
    // It is neither the workout player nor a screen that follows the person's dark mode: the page
    // paints itself, as it does for a visitor.
    expect(wantsFullScreen(chain({}, WEBSITE_PAGE))).toBe(false);
    expect(isRedesigned(chain({}, WEBSITE_PAGE))).toBe(false);
  });
});

// The app's first picture is drawn before the router has recognised its address (notes plan N2).
describe('startsOnWebsitePage', () => {
  const ROUTES: Routes = [
    { path: '', pathMatch: 'full', children: [] },
    { path: 'about', data: WEBSITE_PAGE, children: [] },
    { path: 'billing', data: HOUSE_BRAND, children: [] },
    { path: 'clients', children: [] },
    { path: '**', children: [] },
  ];

  function router(config: Routes): Router {
    const urls = new DefaultUrlSerializer();
    return { config, parseUrl: (url: string) => urls.parse(url) } as unknown as Router;
  }

  it('knows the website’s own page from the address the app is opened at', () => {
    expect(startsOnWebsitePage(router(ROUTES), '/about')).toBe(true);
    // The tags a link may carry, and a section of the page.
    expect(startsOnWebsitePage(router(ROUTES), '/about?utm_source=menu')).toBe(true);
    expect(startsOnWebsitePage(router(ROUTES), '/about#week')).toBe(true);
  });

  it('says no for every other address, so those starts keep the frame the device remembers', () => {
    for (const address of ['', '/', '/clients', '/billing', '/about/us', '/aboutus', '/x/about']) {
      expect(startsOnWebsitePage(router(ROUTES), address), address).toBe(false);
    }
  });

  it('reads the mark from the routes, never from the word in the address', () => {
    const unmarked: Routes = [{ path: 'about', children: [] }];
    expect(startsOnWebsitePage(router(unmarked), '/about')).toBe(false);
    expect(startsOnWebsitePage(router([]), '/about')).toBe(false);
  });
});
