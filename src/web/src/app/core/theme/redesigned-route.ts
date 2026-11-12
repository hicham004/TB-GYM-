import { ActivatedRouteSnapshot, Data, PRIMARY_OUTLET, Router } from '@angular/router';

/**
 * Route data for a screen rebuilt on brand v2: it follows the person's light or dark mode. Every
 * other screen still has colours in its styles that only work on light, so App keeps it light
 * (`data-mode="light"` on <main>) even inside a dark shell. R5.3 removes both once every screen
 * is rebuilt.
 */
export const REDESIGNED: Data = { redesigned: true };

/** Whether the active route, or a route above it, is rebuilt on brand v2. */
export function isRedesigned(root: ActivatedRouteSnapshot): boolean {
  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
    if (route.data['redesigned'] === true) return true;
  }
  return false;
}

/**
 * Route data for a screen that is TB Gym's own rather than the coach's (plan §3.1): the coach's
 * billing and the platform admin keep TB Gym's colours whatever the workspace's brand.
 */
export const HOUSE_BRAND: Data = { houseBrand: true };

/** Whether the active route, or a route above it, is drawn in TB Gym's own brand. */
export function wantsHouseBrand(root: ActivatedRouteSnapshot): boolean {
  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
    if (route.data['houseBrand'] === true) return true;
  }
  return false;
}

/**
 * Route data for a client screen that fills the whole screen, as the workout player does (M2, as in
 * the prototype): no tab bar over its foot and no page margin around it. Its own × leads back.
 */
export const FULL_SCREEN: Data = { fullScreen: true };

/** Whether the active route, or a route above it, fills the whole screen. */
export function wantsFullScreen(root: ActivatedRouteSnapshot): boolean {
  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
    if (route.data['fullScreen'] === true) return true;
  }
  return false;
}

/**
 * Route data for the website's own page opened inside the app (`/about`, notes plan N2): it fills the
 * window as a visitor sees it, in TB Gym's colours, with no sidebar, top bar or tabs around it,
 * whoever is signed in. Its own header leads back.
 */
export const WEBSITE_PAGE: Data = { websitePage: true, houseBrand: true };

/** Whether the route is the website's own page, which draws no shell around itself. */
export function isWebsitePage(root: ActivatedRouteSnapshot): boolean {
  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
    if (route.data['websitePage'] === true) return true;
  }
  return false;
}

/**
 * Whether the address the app starts at is the website's own page, asked before the router has
 * recognised anything: the app draws its launch screen in its first moment, and there it must not
 * draw the frame of a shell that will not come. A hint for that one picture, read from the routes'
 * own data; from the first navigation's end on, the route decides (`isWebsitePage`).
 */
export function startsOnWebsitePage(router: Router, address: string): boolean {
  const segments = router.parseUrl(address).root.children[PRIMARY_OUTLET]?.segments ?? [];
  return (
    segments.length === 1 &&
    router.config.some(
      (route) => route.path === segments[0].path && route.data?.['websitePage'] === true,
    )
  );
}
